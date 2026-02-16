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

    for (const tab of e.closed) {
      const st = this.convertToSideTab(tab);
      if (st) { this.stateService.removeTab(st.metadata.id); }
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
  private updateActiveTab(activeUri: vscode.Uri): void {
    const activeStr = activeUri.toString();

    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const st = this.convertToSideTab(tab);
        if (!st) { continue; }

        const existing = this.stateService.getTab(st.metadata.id);
        if (!existing) { continue; }

        const isNowActive = st.metadata.uri?.toString() === activeStr;
        if (existing.state.isActive !== isNowActive) {
          existing.state.isActive = isNowActive;
          this.stateService.updateTabSilent(existing);
        }
      }
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

    if (tab.input instanceof vscode.TabInputText) {
      uri         = tab.input.uri;
      label       = path.basename(uri.fsPath);
      description = formatFilePath(uri, { useWorkspaceRelative: true });
      tooltip     = uri.fsPath;
      fileType    = path.extname(uri.fsPath);
      tabType     = 'file';
    }
    else if (tab.input instanceof vscode.TabInputWebview) {
      // No URI — webview tabs (Settings, Extensions, Welcome…)
      uri         = undefined;
      label       = tab.label;
      description = undefined;
      tooltip     = tab.label;
      tabType     = 'webview';
    }
    else if (tab.input instanceof vscode.TabInputCustom) {
      uri         = tab.input.uri;
      label       = path.basename(uri.fsPath) || tab.label || 'Custom';
      description = formatFilePath(uri, { useWorkspaceRelative: true });
      tooltip     = uri.fsPath;
      fileType    = path.extname(uri.fsPath);
      tabType     = 'custom';
    }
    else if (tab.input instanceof vscode.TabInputNotebook) {
      uri         = tab.input.uri;
      label       = path.basename(uri.fsPath);
      description = formatFilePath(uri, { useWorkspaceRelative: true });
      tooltip     = uri.fsPath;
      fileType    = path.extname(uri.fsPath);
      tabType     = 'notebook';
    }
    else { return null; }

    const viewColumn = tab.group.viewColumn;

    const metadata: SideTabMetadata = {
      id: this.generateId(label, uri, viewColumn, tabType),
      uri,
      label,
      description,
      tooltip,
      fileType,
      tabType,
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
      return `${uri.toString()}-${viewColumn}`;
    }
    // Webview tabs have no URI — use a sanitised label
    const safe = label.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    return `${tabType}:${safe}-${viewColumn}`;
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}
