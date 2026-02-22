import * as vscode                                             from 'vscode';
import * as path                                               from 'path';
import { TabStateService }                                     from './TabStateService';
import { GitSyncService }                                      from '../integration/GitSyncService';
import { SideTab, SideTabMetadata, SideTabState, SideTabType } from '../../models/SideTab';
import { SideTabHelpers }                                      from '../../models/SideTabHelpers';
import { createTabGroup }                                      from '../../models/SideTabGroup';
import { formatFilePath }                                      from '../../utils/helpers';
import { Logger }                                              from '../../utils/logger';

/**
 * Mantiene el estado interno de pestañas sincronizado con VS Code.
 * En palabras sencillas: escucha los eventos del editor (abrir/cerrar/mover)
 * y actualiza el `TabStateService` para que la UI muestre datos fiables.
 * Esta capa solo transforma datos — no hace operaciones de disco pesadas.
 * 
 * NOTA: Las tabs de Markdown Preview se filtran directamente en convertToSideTab()
 * y se manejan como estado toggle (viewMode) en la tab del archivo fuente.
 */
export class TabSyncService {
  private disposables: vscode.Disposable[] = [];
  private gitSyncService: GitSyncService;

  constructor(private stateService: TabStateService) {
    this.gitSyncService = new GitSyncService(this.stateService);
  }

  /** Registra los listeners necesarios y realiza una sincronización inicial.
   *  Resultado: el `TabStateService` queda poblado y listo para la UI. */
  activate(context: vscode.ExtensionContext): void {
    this.syncAll();

    this.disposables.push(
      vscode.window.tabGroups.onDidChangeTabs(e => this.handleTabChanges(e)),
    );

    this.disposables.push(
      vscode.window.tabGroups.onDidChangeTabGroups(e => this.handleGroupChanges(e)),
    );

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) {
          this.updateActiveTab(editor.document.uri);
        }
      }),
    );

    // Listener para cambios en diagnósticos (errores/warnings)
    this.disposables.push(
      vscode.languages.onDidChangeDiagnostics(e => {
        for (const uri of e.uris) {
          this.updateTabDiagnostics(uri);
        }
      }),
    );

    // Sincronización/estado Git (servicio dedicado)
    this.gitSyncService.activate(context);

    context.subscriptions.push(...this.disposables);
  }

  //: Manejadores de eventos (qué hacer cuando cambian las pestañas)
  private handleTabChanges(e: vscode.TabChangeEvent): void {
    for (const tab of e.opened) {
      const st = this.convertToSideTab(tab);
      if (st) {
        // If this is a child tab (diff), ensure its parent exists
        if (st.metadata.parentId) {
          this.ensureParentExists(st, tab);
        }

        if (st.state.isPreview) {
          Logger.log('[TabSync] Opened preview tab: ' + st.metadata.label);
        }
        this.stateService.addTab(st);
      }
    }

    // For closed tabs, don't try to regenerate the ID (it may not match the
    // original for unknown/webview/diff tabs). Instead, build the set of IDs
    // that *still exist* in VS Code and remove any internal tab that is gone.
    if (e.closed.length > 0) {
      this.removeOrphanedTabs();
    }

    for (const tab of e.changed) {
      const st = this.convertToSideTab(tab);
      if (!st) { continue; }

      const existing = this.stateService.getTab(st.metadata.id);
      if (!existing) {
        this.stateService.updateTab(st);
        continue;
      }

      const onlyActive =
        existing.state.isDirty   === tab.isDirty   &&
        existing.state.isPinned  === tab.isPinned  &&
        existing.state.isPreview === tab.isPreview &&
        existing.state.isActive  !== tab.isActive;

      // Log cuando una preview tab se convierte en permanente
      if (existing.state.isPreview && !tab.isPreview) {
        Logger.log('[TabSync] Preview tab became permanent: ' + existing.metadata.label);
      }

      existing.state.isActive  = tab.isActive;
      existing.state.isDirty   = tab.isDirty;
      existing.state.isPinned  = tab.isPinned;
      existing.state.isPreview = tab.isPreview;

      // Solo actualizar git/diagnósticos en cambios estructurales (no solo isActive)
      if (!onlyActive && existing.metadata.uri) {
        const oldGitStatus = existing.state.gitStatus;
        const oldDiagnostics = existing.state.diagnosticSeverity;
        existing.state.gitStatus = this.gitSyncService.getGitStatus(existing.metadata.uri);
        existing.state.diagnosticSeverity = this.getDiagnosticSeverity(existing.metadata.uri);
        if (oldGitStatus !== existing.state.gitStatus || oldDiagnostics !== existing.state.diagnosticSeverity) {
          Logger.log(`[TabSync] handleTabChanges - updated git/diagnostics: ${existing.metadata.label}, gitStatus: ${oldGitStatus} -> ${existing.state.gitStatus}, diagnostics: ${oldDiagnostics} -> ${existing.state.diagnosticSeverity}`);
        }
      }

      if (onlyActive) { this.stateService.updateTabSilent(existing); }
      else            { this.stateService.updateTab(existing);       }
    }

    // Sincronizar estado activo de todas las tabs del grupo afectado
    // Esto es crucial para webview tabs que no disparan onDidChangeActiveTextEditor
    this.syncActiveState();
  }

  private handleGroupChanges(e: vscode.TabGroupChangeEvent): void {
    for (const g of e.opened)  { this.stateService.addGroup(createTabGroup(g)); }
    for (const g of e.closed)  { this.stateService.removeGroup(g.viewColumn); }

    if (e.changed.length > 0) {
      this.stateService.setActiveGroup(vscode.window.tabGroups.activeTabGroup.viewColumn);
    }
  }

  //: Sincronización completa (reconstruir todo el estado) 
  private syncAll(): void {
    for (const group of vscode.window.tabGroups.all) {
      this.stateService.addGroup(createTabGroup(group));
    }

    const allTabs: SideTab[] = [];
    for (const group of vscode.window.tabGroups.all) {
      group.tabs.forEach((tab, idx) => {
        const st = this.convertToSideTab(tab, idx);
        if (st) { allTabs.push(st); }
      });
    }
    this.stateService.replaceTabs(allTabs);
  }

  /**
   * Asegura que el parent tab de un diff exista en el estado.
   * Si el archivo base no está abierto como tab, lo crea automáticamente.
   */
  private ensureParentExists(childTab: SideTab, nativeChildTab: vscode.Tab): void {
    const parentId = childTab.metadata.parentId;
    if (!parentId) { return; }

    // Check if parent already exists
    if (this.stateService.getTab(parentId)) {
      return; // Parent exists, all good
    }

    // Parent doesn't exist - we need to find or create it
    // For diff tabs, the parent is the file tab with the same URI in the same group
    const group = nativeChildTab.group;
    const childUri = childTab.metadata.uri;
    if (!childUri) { return; }

    // Search for a file tab with matching URI in the same group
    let parentNativeTab: vscode.Tab | undefined;
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText) {
        if (tab.input.uri.toString() === childUri.toString()) {
          parentNativeTab = tab;
          break;
        }
      }
    }

    // If found, convert and add it
    if (parentNativeTab) {
      const parentSideTab = this.convertToSideTab(parentNativeTab);
      if (parentSideTab) {
        Logger.log(`[TabSync] Creating parent tab for child: ${childTab.metadata.label} → ${parentSideTab.metadata.label}`);
        this.stateService.addTab(parentSideTab);
      }
    } else {
      // Parent tab doesn't exist in VS Code - this child is orphaned
      // The HTML builder will render it as an orphan (full display, no indent)
      Logger.log(`[TabSync] Orphan child tab detected (no parent in group): ${childTab.metadata.label}`);
    }
  }

  //: Seguimiento de la pestaña activa (actualiza solo isActive) 
  private updateActiveTab(_activeUri: vscode.Uri): void {
    // Delegate to syncActiveState which reads tab.isActive from the native API.
    // This correctly handles the same file open in multiple groups
    // (only the focused group's tab will have isActive === true).
    this.syncActiveState();
  }

  /**
   * Actualiza los diagnósticos y git status de una pestaña específica cuando cambian.
   */
  private updateTabDiagnostics(uri: vscode.Uri): void {
    const tab = this.stateService.findTabByUri(uri);
    if (!tab) { return; }

    const newDiagnosticSeverity = this.getDiagnosticSeverity(uri);
    const newGitStatus = this.gitSyncService.getGitStatus(uri);

    Logger.log(`[TabSync] updateTabDiagnostics - ${tab.metadata.label}: diagnostics: ${tab.state.diagnosticSeverity} -> ${newDiagnosticSeverity}, gitStatus: ${tab.state.gitStatus} -> ${newGitStatus}`);

    if (tab.state.diagnosticSeverity !== newDiagnosticSeverity || 
        tab.state.gitStatus !== newGitStatus) {
      Logger.log('[TabSync] ✅ Updating tab state with animation for: ' + tab.metadata.label);
      tab.state.diagnosticSeverity = newDiagnosticSeverity;
      tab.state.gitStatus = newGitStatus;
      this.stateService.updateTabStateWithAnimation(tab);
    }
  }

  /**
   * Sincroniza el estado isActive e isPreview de todas las tabs con el estado real de VS Code.
   * Esto es especialmente importante para:
   * - Webview tabs (Settings, Extensions, etc.) que no disparan onDidChangeActiveTextEditor.
   * - Preview tabs que pueden convertirse en permanentes sin disparar el evento onChange.
   * - Markdown Previews: cuando están activos, la tab del archivo fuente debe mostrarse activa.
   * - **Garantiza que solo una tab por grupo esté visualmente activa.**
   * 
   * NOTA: viewMode es una preferencia persistente del usuario por tab.
   * Cada tab recuerda si prefiere verse en modo preview o source.
   * 
   * Público para permitir sincronización bajo demanda antes de operaciones críticas.
   */
  public syncActiveState(): void {
    // First, detect if a Markdown Preview is active (we filter these tabs)
    // If so, we need to mark the corresponding source file tab as active
    let activeMarkdownSourceId: string | null = null;
    let activeMarkdownSourceUri: vscode.Uri | null = null;
    
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.isActive && tab.input instanceof vscode.TabInputWebview) {
          // Check if it's a Markdown Preview
          if (tab.input.viewType === 'markdown.preview' || 
              (tab.label.startsWith('Preview ') && (tab.label.endsWith('.md') || tab.label.endsWith('.mdx') || tab.label.endsWith('.markdown')))) {
            
            // Extract the source file name from the preview label
            const sourceFileName = tab.label.replace('Preview ', '');
            
            // Find the actual source tab in the same group by matching the filename
            for (const sourceTab of group.tabs) {
              if (sourceTab.input instanceof vscode.TabInputText) {
                const sourcePath = sourceTab.input.uri.path;
                if (sourcePath.endsWith('/' + sourceFileName) || 
                    sourcePath.endsWith('\\' + sourceFileName)) {
                  // Found the source tab that matches the preview
                  activeMarkdownSourceUri = sourceTab.input.uri;
                  activeMarkdownSourceId = `${sourceTab.input.uri.toString()}-${group.viewColumn}`;
                  
                  // Update the tracker to reflect the currently previewed document
                  // This is important when navigating between documents via internal links
                  if (this.stateService.lastMarkdownPreviewTabId !== activeMarkdownSourceId) {
                    Logger.log(`[TabSync] Preview navigated to different document: ${sourceFileName}`);
                    this.stateService.setLastMarkdownPreviewTabId(activeMarkdownSourceId);
                    
                    // Also update the tab's viewMode to 'preview' if not already set
                    const sourceTabInstance = this.stateService.getTab(activeMarkdownSourceId);
                    if (sourceTabInstance && sourceTabInstance.state.viewMode !== 'preview') {
                      sourceTabInstance.state.viewMode = 'preview';
                      Logger.log(`[TabSync] Set viewMode=preview for newly previewed tab: ${sourceFileName}`);
                    }
                  }
                  break;
                }
              }
            }
            
            // FALLBACK: If we couldn't find by filename match, try using the last tracked ID
            // (but this is less accurate and may be stale)
            if (!activeMarkdownSourceId) {
              const lastPreviewTabId = this.stateService.lastMarkdownPreviewTabId;
              if (lastPreviewTabId) {
                const lastTab = this.stateService.getTab(lastPreviewTabId);
                // Verify it's still in the same group
                if (lastTab && lastTab.state.groupId === group.viewColumn) {
                  activeMarkdownSourceId = lastPreviewTabId;
                }
              }
            }
          }
        }
      }
    }

    // Track active tab per group to ensure only one is active
    const activeTabPerGroup = new Map<number, string>(); // viewColumn -> tabId

    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const id = this.generateIdFromNativeTab(tab);
        if (!id) { continue; }

        const existing = this.stateService.getTab(id);
        if (!existing) { continue; }

        // Determine if this tab should be active
        let shouldBeActive = tab.isActive;
        
        // If a Markdown Preview is active, mark its source file as active instead
        if (activeMarkdownSourceId && existing.metadata.id === activeMarkdownSourceId) {
          shouldBeActive = true;
        }

        // Track active tab for this group
        if (shouldBeActive) {
          const viewColumn = existing.state.viewColumn;
          const currentActive = activeTabPerGroup.get(viewColumn);
          
          if (currentActive) {
            // Already have an active tab in this group - deactivate this one
            Logger.log(`[TabSync] Multiple active tabs detected in group ${viewColumn}. Deactivating: ${existing.metadata.label}`);
            shouldBeActive = false;
          } else {
            activeTabPerGroup.set(viewColumn, id);
          }
        }

        // Sincronizar isActive e isPreview para mantener el estado actualizado
        const activeChanged = existing.state.isActive !== shouldBeActive;
        const previewChanged = existing.state.isPreview !== tab.isPreview;
        
        if (activeChanged || previewChanged) {
          existing.state.isActive = shouldBeActive;
          existing.state.isPreview = tab.isPreview;
          this.stateService.updateTabSilent(existing);
        }
      }
    }

    // Additional safety: ensure all tabs in the same group as the active tab are deactivated
    for (const [viewColumn, activeTabId] of activeTabPerGroup) {
      const allTabsInGroup = this.stateService.getAllTabs()
        .filter(tab => tab.state.viewColumn === viewColumn);
      
      for (const tab of allTabsInGroup) {
        if (tab.metadata.id !== activeTabId && tab.state.isActive) {
          Logger.log(`[TabSync] Force deactivating tab in group ${viewColumn}: ${tab.metadata.label}`);
          tab.state.isActive = false;
          this.stateService.updateTabSilent(tab);
        }
      }
    }
  }

  /**
   * Builds the set of IDs that currently exist in VS Code and removes any
   * internal tab whose ID is no longer present. This is more reliable than
   * trying to regenerate the ID from a closed-tab event (which may have
   * different properties than the original open event).
   * 
   * Especialmente importante para preview tabs que pueden ser reemplazadas
   * automáticamente por VS Code sin disparar un evento explícito de cierre.
   */
  private removeOrphanedTabs(): void {
    const nativeIds = new Set<string>();
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const id = this.generateIdFromNativeTab(tab);
        if (id) { nativeIds.add(id); }
      }
    }

    for (const tab of this.stateService.getAllTabs()) {
      if (!nativeIds.has(tab.metadata.id)) {
        Logger.log(`[TabSync] Removing orphaned tab: ${tab.metadata.label} (wasPreview: ${tab.state.isPreview})`);
        this.stateService.removeTab(tab.metadata.id);
      }
    }
  }

  /**
   * Lightweight ID extraction from a native tab — avoids full `convertToSideTab()`
   * conversion.  Used by `removeOrphanedTabs` and `syncActiveState`.
   */
  private generateIdFromNativeTab(tab: vscode.Tab): string | null {
    let uri   : vscode.Uri | undefined;
    let label : string;
    let tabType: SideTabType;

    if (tab.input instanceof vscode.TabInputText) {
      uri     = tab.input.uri;
      label   = path.basename(uri.fsPath);
      tabType = 'file';
    } else if (tab.input instanceof vscode.TabInputTextDiff) {
      uri     = tab.input.modified;
      label   = tab.label;
      tabType = 'diff';
    } else if (tab.input instanceof vscode.TabInputWebview) {
      label   = tab.label;
      tabType = 'webview';
    } else if (tab.input instanceof vscode.TabInputCustom) {
      uri     = tab.input.uri;
      label   = path.basename(uri.fsPath) || tab.label || 'Custom';
      tabType = 'custom';
    } else if (tab.input instanceof vscode.TabInputNotebook) {
      uri     = tab.input.uri;
      label   = path.basename(uri.fsPath);
      tabType = 'notebook';
    } else {
      label   = tab.label;
      tabType = 'unknown';
    }

    return this.generateId(label, uri, tab.group.viewColumn, tabType);
  }

  /**
   * Convierte una pestaña nativa de VS Code a nuestro modelo `SideTab`.
   *
   * Explicación simple:
   * - Si es un archivo (texto, editor custom, notebook) recoge la `uri`, el nombre
   *   del archivo, la ruta relativa y la extensión.
   * - Si es una pestaña `webview` (Settings, Extensions, Welcome), NO crea una URI
   *   falsa; deja `uri` sin definir y genera un id estable basado en la etiqueta.
   * - El método solo transforma datos y devuelve un `SideTab` listo para la UI.
   *
   * Devuelve `SideTab` o `null` si el tipo de pestaña no es soportado.
   */
  private convertToSideTab(tab: vscode.Tab, index?: number): SideTab | null {
    let uri         : vscode.Uri | undefined;
    let label       : string;
    let description : string | undefined;
    let tooltip     : string;
    let fileType    : string = '';
    let tabType     : SideTabType = 'file';
    let viewType    : string | undefined;

    if (tab.input instanceof vscode.TabInputText) {
      uri         = tab.input.uri;
      label       = path.basename(uri.fsPath);
      description = formatFilePath(uri, { useWorkspaceRelative: true });
      tooltip     = uri.fsPath;
      fileType    = path.extname(uri.fsPath);
      tabType     = 'file';
    }
    else if (tab.input instanceof vscode.TabInputTextDiff) {
      // Diff tabs (Working Tree, Staged Changes, etc.)
      // Use the modified URI as the primary URI (right side of diff)
      uri         = tab.input.modified;
      label       = tab.label; // VS Code provides a descriptive label like "file.ts (Working Tree)"
      description = formatFilePath(uri, { useWorkspaceRelative: true });
      tooltip     = tab.label;
      fileType    = path.extname(uri.fsPath);
      tabType     = 'diff';
      
      // Extract short label for child tab display (e.g., "Working Tree" from "file.ts (Working Tree)")
      const match = label.match(/\(([^)]+)\)$/);
      if (match) {
        label = match[1]; // Just "Working Tree", "Staged Changes", etc.
      }
    }
    else if (tab.input instanceof vscode.TabInputWebview) {
      // Webview tabs (Markdown Preview, Release Notes, extension webviews…)
      // FILTER OUT Markdown Previews - they are handled as a toggle state on the source file tab
      if (tab.input.viewType === 'markdown.preview' || 
          tab.label.startsWith('Preview ') && tab.label.endsWith('.md')) {
        Logger.log('[TabSync] Filtering out Markdown Preview tab (handled as toggle): ' + tab.label);
        return null;
      }
      uri         = undefined;
      label       = tab.label;
      description = undefined;
      tooltip     = tab.label;
      tabType     = 'webview';
      viewType    = tab.input.viewType;
    }
    else if (tab.input instanceof vscode.TabInputCustom) {
      uri         = tab.input.uri;
      label       = path.basename(uri.fsPath) || tab.label || 'Custom';
      description = formatFilePath(uri, { useWorkspaceRelative: true });
      tooltip     = uri.fsPath;
      fileType    = path.extname(uri.fsPath);
      tabType     = 'custom';
      viewType    = tab.input.viewType;
    }
    else if (tab.input instanceof vscode.TabInputNotebook) {
      uri         = tab.input.uri;
      label       = path.basename(uri.fsPath);
      description = formatFilePath(uri, { useWorkspaceRelative: true });
      tooltip     = uri.fsPath;
      fileType    = path.extname(uri.fsPath);
      tabType     = 'notebook';
    }
    else {
      // Unknown input — built-in editors like Settings, Extensions, Keyboard Shortcuts, Welcome…
      // tab.input is undefined for these; identify them by tab.label.
      uri         = undefined;
      label       = tab.label;
      description = undefined;
      tooltip     = tab.label;
      tabType     = 'unknown';
    }

    const viewColumn = tab.group.viewColumn;

    // Calculate parentId for diff tabs (link to corresponding file tab)
    let parentId: string | undefined;
    if (tabType === 'diff' && uri) {
      // The parent is the file tab with the same URI in the same group
      parentId = `${uri.toString()}-${viewColumn}`;
    }

    // Build base metadata
    const baseMetadata: SideTabMetadata = {
      id: this.generateId(label, uri, viewColumn, tabType),
      parentId,
      uri,
      label,
      detailLabel: description,
      tooltipText: tooltip,
      fileExtension: fileType,
      tabType,
      viewType,
    };

    // ✨ FASE 2: Enrich metadata with computed properties
    const metadata = SideTabHelpers.enrichMetadata(baseMetadata);

    // Build base state from VS Code tab
    const baseState = {
      isActive       : tab.isActive,
      isDirty        : tab.isDirty,
      isPinned       : tab.isPinned,
      isPreview      : tab.isPreview,
      groupId        : viewColumn,
      viewColumn,
      indexInGroup   : index ?? 0,
      gitStatus      : uri ? this.gitSyncService.getGitStatus(uri) : null,
      diagnosticSeverity : uri ? this.getDiagnosticSeverity(uri) : null,
    };

    // ✨ FASE 3: Get default values for new properties
    const defaultState = SideTabHelpers.createDefaultState();

    // Merge defaults + base (base overrides defaults)
    const stateWithDefaults = { ...defaultState, ...baseState };

    // ✨ FASE 3: Compute capabilities based on metadata + state
    const capabilities = SideTabHelpers.computeCapabilities(metadata, stateWithDefaults);

    // ✨ FASE 4: Map legacy previewMode to new viewMode
    const viewMode = SideTabHelpers.mapPreviewModeToViewMode(false); // Default to source

    // Build final state with all required properties
    const state: SideTabState = {
      // VS CODE NATIVE STATE
      isActive: tab.isActive,
      isDirty: tab.isDirty,
      isPinned: tab.isPinned,
      isPreview: tab.isPreview,
      
      // LOCATION
      groupId: viewColumn,
      viewColumn,
      indexInGroup: index ?? 0,
      
      // VISUALIZATION MODE
      viewMode,
      
      // ACTION CONTEXT (from defaults)
      actionContext: stateWithDefaults.actionContext!,
      operationState: stateWithDefaults.operationState!,
      
      // CAPABILITIES & PERMISSIONS
      capabilities,
      permissions: stateWithDefaults.permissions!,
      
      // HIERARCHY
      hasChildren: false, // Will be computed later when children are detected
      isChild: tabType === 'diff',
      isExpanded: false,
      childrenCount: 0,
      
      // UI STATE
      isLoading: false,
      hasError: false,
      errorMessage: undefined,
      isHighlighted: false,
      
      // TRACKING
      lastAccessTime: Date.now(),
      syncVersion: 0,
      
      // DECORATIONS
      gitStatus: uri ? this.gitSyncService.getGitStatus(uri) : null,
      diagnosticSeverity: uri ? this.getDiagnosticSeverity(uri) : null,
      
      // PROTECTION
      isTransient: false,
      isProtected: false,
      
      // INTEGRATIONS (from defaults)
      integrations: stateWithDefaults.integrations!,
      
      // CUSTOMIZATION (from defaults)
      customActions: stateWithDefaults.customActions,
      shortcuts: stateWithDefaults.shortcuts,
    };

    return new SideTab(metadata, state);
  }

  /** Stable, unique ID for a tab.  URI-based for files, label-based for webviews. */
  private generateId(
    label: string,
    uri: vscode.Uri | undefined,
    viewColumn: vscode.ViewColumn,
    tabType: SideTabType,
  ): string {
    if (uri) {
      // Diff tabs share the same modified URI as the original file — prefix to distinguish
      const prefix = tabType === 'diff' ? 'diff:' : '';
      return `${prefix}${uri.toString()}-${viewColumn}`;
    }
    // Webview / unknown tabs have no URI — use a sanitised label
    const safe = label.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    return `${tabType}:${safe}-${viewColumn}`;
  }

  /**
   * Obtiene la severidad más alta de diagnóstico para un archivo.
   * Retorna Error si hay errores, Warning si hay advertencias, o null si no hay diagnósticos.
   */
  private getDiagnosticSeverity(uri: vscode.Uri): vscode.DiagnosticSeverity | null {
    const diagnostics = vscode.languages.getDiagnostics(uri);
    if (diagnostics.length === 0) { return null; }

    let maxSeverity: vscode.DiagnosticSeverity | null = null;
    for (const diagnostic of diagnostics) {
      if (maxSeverity === null || diagnostic.severity < maxSeverity) {
        maxSeverity = diagnostic.severity;
      }
    }

    // Solo retornar si es Error o Warning
    if (maxSeverity === vscode.DiagnosticSeverity.Error || 
        maxSeverity === vscode.DiagnosticSeverity.Warning) {
      return maxSeverity;
    }

    return null;
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
    this.gitSyncService.dispose();
  }
}
