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

  constructor(private stateService: TabStateService) {}

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
        if (editor) { this.updateActiveTab(editor.document.uri); }
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
   * Sincroniza el estado isActive de todas las tabs con el estado real de VS Code.
   * Esto es especialmente importante para webview tabs (Settings, Extensions, etc.)
   * que no disparan onDidChangeActiveTextEditor.
   */
  private syncActiveState(): void {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const st = this.convertToSideTab(tab);
        if (!st) { continue; }

        const existing = this.stateService.getTab(st.metadata.id);
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
        const st = this.convertToSideTab(tab);
        if (st) { nativeIds.add(st.metadata.id); }
      }
    }

    for (const tab of this.stateService.getAllTabs()) {
      if (!nativeIds.has(tab.metadata.id)) {
        this.stateService.removeTab(tab.metadata.id);
      }
    }
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

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}
