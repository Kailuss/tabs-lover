import * as vscode                                             from 'vscode';
import * as path                                               from 'path';
import { TabStateService }                                     from './TabStateService';
import { SideTab, SideTabMetadata, SideTabState, SideTabType } from '../models/SideTab';
import { createTabGroup }                                      from '../models/SideTabGroup';
import { formatFilePath }                                      from '../utils/helpers';

/**
 * Mantiene el estado interno de pestañas sincronizado con VS Code.
 * En palabras sencillas: escucha los eventos del editor (abrir/cerrar/mover)
 * y actualiza el `TabStateService` para que la UI muestre datos fiables.
 * Esta capa solo transforma datos — no hace operaciones de disco pesadas.
 */
export class TabSyncService {
  private disposables: vscode.Disposable[] = [];
  private _gitApi: any | null = null;

  constructor(private stateService: TabStateService) {}

  /** Registra los listeners necesarios y realiza una sincronización inicial.
   *  Resultado: el `TabStateService` queda poblado y listo para la UI. */
  activate(context: vscode.ExtensionContext): void {
    // Cache git API reference (avoid resolving the extension on every call)
    this._gitApi = this.resolveGitApi();
    this.disposables.push(
      vscode.extensions.onDidChange(() => { this._gitApi = this.resolveGitApi(); }),
    );

    this.syncAll();

    this.disposables.push(
      vscode.window.tabGroups.onDidChangeTabs(e => this.handleTabChanges(e)),
    );

    this.disposables.push(
      vscode.window.tabGroups.onDidChangeTabGroups(e => this.handleGroupChanges(e)),
    );

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) { this.updateActiveTab(editor.document.uri); }
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

    context.subscriptions.push(...this.disposables);
  }

  //: Manejadores de eventos (qué hacer cuando cambian las pestañas)
  private handleTabChanges(e: vscode.TabChangeEvent): void {
    for (const tab of e.opened) {
      const st = this.convertToSideTab(tab);
      if (st) { this.stateService.addTab(st); }
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

      existing.state.isActive  = tab.isActive;
      existing.state.isDirty   = tab.isDirty;
      existing.state.isPinned  = tab.isPinned;
      existing.state.isPreview = tab.isPreview;
      
      // Solo actualizar git/diagnósticos en cambios estructurales (no solo isActive)
      if (!onlyActive && existing.metadata.uri) {
        existing.state.gitStatus = this.getGitStatus(existing.metadata.uri);
        existing.state.diagnosticSeverity = this.getDiagnosticSeverity(existing.metadata.uri);
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
    const newGitStatus = this.getGitStatus(uri);

    if (tab.state.diagnosticSeverity !== newDiagnosticSeverity || 
        tab.state.gitStatus !== newGitStatus) {
      tab.state.diagnosticSeverity = newDiagnosticSeverity;
      tab.state.gitStatus = newGitStatus;
      this.stateService.updateTabStateWithAnimation(tab);
    }
  }

  /**
   * Sincroniza el estado isActive de todas las tabs con el estado real de VS Code.
   * Esto es especialmente importante para webview tabs (Settings, Extensions, etc.)
   * que no disparan onDidChangeActiveTextEditor.
   */
  private syncActiveState(): void {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const id = this.generateIdFromNativeTab(tab);
        if (!id) { continue; }

        const existing = this.stateService.getTab(id);
        if (!existing) { continue; }

        if (existing.state.isActive !== tab.isActive) {
          existing.state.isActive = tab.isActive;
          this.stateService.updateTabSilent(existing);
        }
      }
    }
  }

  /**
   * Builds the set of IDs that currently exist in VS Code and removes any
   * internal tab whose ID is no longer present. This is more reliable than
   * trying to regenerate the ID from a closed-tab event (which may have
   * different properties than the original open event).
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
    }
    else if (tab.input instanceof vscode.TabInputWebview) {
      // Webview tabs (Markdown Preview, Release Notes, extension webviews…)
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

    const metadata: SideTabMetadata = {
      id: this.generateId(label, uri, viewColumn, tabType),
      uri,
      label,
      description,
      tooltip,
      fileType,
      tabType,
      viewType,
    };

    const state: SideTabState = {
      isActive       : tab.isActive,
      isDirty        : tab.isDirty,
      isPinned       : tab.isPinned,
      isPreview      : tab.isPreview,
      groupId        : viewColumn,
      viewColumn,
      indexInGroup   : index ?? 0,
      lastAccessTime : Date.now(),
      gitStatus      : uri ? this.getGitStatus(uri) : null,
      diagnosticSeverity : uri ? this.getDiagnosticSeverity(uri) : null,
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
   * Obtiene el estado de git para un archivo basado en decoraciones SCM.
   * Utiliza la API de git de VS Code para obtener el estado del archivo.
   */
  /** Resolves the git extension API (cached in _gitApi). */
  private resolveGitApi(): any | null {
    try {
      const ext = vscode.extensions.getExtension('vscode.git');
      return ext?.isActive ? ext.exports?.getAPI(1) ?? null : null;
    } catch { return null; }
  }

  private getGitStatus(uri: vscode.Uri): import('../models/SideTab').GitStatus {
    try {
      // Lazy init: resolve git API if not yet cached
      if (!this._gitApi) { this._gitApi = this.resolveGitApi(); }
      if (!this._gitApi || this._gitApi.repositories.length === 0) { return null; }

      // Buscar el repositorio que contiene este archivo
      for (const repo of this._gitApi.repositories) {
        const repoUri = repo.rootUri;
        if (!uri.fsPath.startsWith(repoUri.fsPath)) { continue; }

        // Buscar el cambio en working tree o index
        const allChanges = [
          ...(repo.state.workingTreeChanges || []),
          ...(repo.state.indexChanges || []),
          ...(repo.state.mergeChanges || []),
        ];

        const change = allChanges.find((c: any) => c.uri.fsPath === uri.fsPath);

        if (change) {
          // Mapear el estado de git a nuestras clases
          // Status values from git extension API:
          // 0: INDEX_MODIFIED, 1: INDEX_ADDED, 2: INDEX_DELETED, 3: INDEX_RENAMED, 4: INDEX_COPIED
          // 5: MODIFIED, 6: DELETED, 7: UNTRACKED, 8: IGNORED, 9: INTENT_TO_ADD
          const status = change.status;
          
          if (status === 1 || status === 7) { return 'untracked'; }  // INDEX_ADDED or UNTRACKED
          if (status === 0 || status === 5) { return 'modified'; }   // INDEX_MODIFIED or MODIFIED
          if (status === 2 || status === 6) { return 'deleted'; }    // INDEX_DELETED or DELETED
          if (status === 8) { return 'ignored'; }                    // IGNORED
          if (repo.state.mergeChanges && repo.state.mergeChanges.length > 0) {
            return 'conflict';
          }
          
          return 'modified'; // default for other statuses
        }
      }
    } catch (error) {
      // Silently fail if git is not available
    }
    return null;
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
  }
}
