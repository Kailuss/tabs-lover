import * as vscode      from 'vscode';
import { SideTab }      from '../models/SideTab';
import { SideTabGroup } from '../models/SideTabGroup';

/**
 * Almacén en memoria de pestañas y grupos — la "fuente de la verdad" para la UI.
 * - `onDidChangeState`: cuando cambia la estructura (abrir/cerrar/mover pestañas).
 * - `onDidChangeStateSilent`: cambios ligeros (ej. solo `isActive`) que no necesitan
 *   una recarga completa del webview.
 */
export class TabStateService {
  private tabs   : Map<string, SideTab>      = new Map();
  private groups : Map<number, SideTabGroup> = new Map();
  private _isBulkLoading                     = false;
  private _onDidChangeState                  = new vscode.EventEmitter<void>();
  readonly onDidChangeState                  = this._onDidChangeState.event;
  private _onDidChangeStateSilent            = new vscode.EventEmitter<void>();
  readonly onDidChangeStateSilent            = this._onDidChangeStateSilent.event;
  private _onDidChangeTabState               = new vscode.EventEmitter<string>();
  readonly onDidChangeTabState               = this._onDidChangeTabState.event;

  //- Tab management

  // Add a tab (or update if it already exists in the group).
  addTab(tab: SideTab): void {
    this.tabs.set(tab.metadata.id, tab);

    const group = this.groups.get(tab.state.groupId);
    if (group) {
      if (!group.tabs.find(t => t.metadata.id === tab.metadata.id)) {
        group.tabs.push(tab);
      }
    }

    if (!this._isBulkLoading) { this._onDidChangeState.fire(); }
  }

  // Remove a tab by id and clean it from its group.
  removeTab(id: string): void {
    const tab = this.tabs.get(id);
    if (tab) {
      const group = this.groups.get(tab.state.groupId);
      if (group) {
        group.tabs = group.tabs.filter(t => t.metadata.id !== id);
      }

      this.tabs.delete(id);
      this._onDidChangeState.fire();
    }
  }

  // Update a tab in-place (both the map and its group array).
  updateTab(tab: SideTab): void {
    this.tabs.set(tab.metadata.id, tab);

    const group = this.groups.get(tab.state.groupId);
    if (group) {
      const index = group.tabs.findIndex(t => t.metadata.id === tab.metadata.id);
      if (index !== -1) {
        group.tabs[index] = tab;
      }
    }

    this._onDidChangeState.fire();
  }

  // Update a tab without triggering tree refresh (for silent state updates like isActive).
  updateTabSilent(tab: SideTab): void {
    this.tabs.set(tab.metadata.id, tab);

    const group = this.groups.get(tab.state.groupId);
    if (group) {
      const index = group.tabs.findIndex(t => t.metadata.id === tab.metadata.id);
      if (index !== -1) {
        group.tabs[index] = tab;
      }
    }
    this._onDidChangeStateSilent.fire();
  }

  // Update a tab's diagnostic/git state and notify for animation.
  updateTabStateWithAnimation(tab: SideTab): void {
    this.tabs.set(tab.metadata.id, tab);

    const group = this.groups.get(tab.state.groupId);
    if (group) {
      const index = group.tabs.findIndex(t => t.metadata.id === tab.metadata.id);
      if (index !== -1) {
        group.tabs[index] = tab;
      }
    }
    
    // Solo dispara el evento de cambio de estado para la animación
    // NO dispara _onDidChangeState para evitar rebuild completo
    this._onDidChangeTabState.fire(tab.metadata.id);
  }

  getTab(id: string): SideTab | undefined {
    return this.tabs.get(id);
  }

  getAllTabs(): SideTab[] {
    return Array.from(this.tabs.values());
  }

  getTabsInGroup(groupId: number): SideTab[] {
    const group = this.groups.get(groupId);
    return group ? [...group.tabs] : [];
  }

  // Replace all tabs with a new set (used during full sync).
  replaceTabs(tabs: SideTab[]): void {
    this._isBulkLoading = true;
    this.tabs.clear();

    // Clear tabs from all groups
    this.groups.forEach(group => {
      group.tabs = [];
    });

    tabs.forEach(tab => this.addTab(tab));
    this._isBulkLoading = false;
    this._onDidChangeState.fire();
  }

  //- Group management

  addGroup(group: SideTabGroup): void {
    this.groups.set(group.id, group);
    this._onDidChangeState.fire();
  }

  removeGroup(id: number): void {
    this.groups.delete(id);
    this._onDidChangeState.fire();
  }

  getGroup(id: number): SideTabGroup | undefined {
    return this.groups.get(id);
  }

  getGroups(): SideTabGroup[] {
    return Array.from(this.groups.values());
  }

  setActiveGroup(id: number): void {
    this.groups.forEach(group => {
      group.isActive = group.id === id;
    });
    this._onDidChangeState.fire();
  }

  //- Search

  // Buscar una pestaña por su URI; opcionalmente limitar al grupo indicado.
  findTabByUri(uri: vscode.Uri, groupId?: number): SideTab | undefined {
    const uriString = uri.toString();

    for (const tab of this.tabs.values()) {
      if (tab.metadata.uri?.toString() === uriString) {
        if (groupId === undefined || tab.state.groupId === groupId) {
          return tab;
        }
      }
    }

    return undefined;
  }

  //- Pin / unpin reordering

  /**
   * Moves a tab to just after the last pinned tab in its group.
   * Called after the tab is pinned so it visually moves up.
   */
  reorderOnPin(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab) { return; }

    const group = this.groups.get(tab.state.groupId);
    if (!group) { return; }

    // Remove the tab from its current position
    const idx = group.tabs.findIndex(t => t.metadata.id === tabId);
    if (idx === -1) { return; }
    group.tabs.splice(idx, 1);

    // Find the insertion point: after the last pinned tab
    let insertAt = 0;
    for (let i = 0; i < group.tabs.length; i++) {
      if (group.tabs[i].state.isPinned) { insertAt = i + 1; }
    }

    group.tabs.splice(insertAt, 0, tab);
    this._onDidChangeState.fire();
  }

  /**
   * Moves a tab to the first position among non-pinned tabs in its group.
   * Called after the tab is unpinned.
   */
  reorderOnUnpin(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab) { return; }

    const group = this.groups.get(tab.state.groupId);
    if (!group) { return; }

    // Remove the tab from its current position
    const idx = group.tabs.findIndex(t => t.metadata.id === tabId);
    if (idx === -1) { return; }
    group.tabs.splice(idx, 1);

    // Insert right after the last remaining pinned tab
    let insertAt = 0;
    for (let i = 0; i < group.tabs.length; i++) {
      if (group.tabs[i].state.isPinned) { insertAt = i + 1; }
    }

    group.tabs.splice(insertAt, 0, tab);
    this._onDidChangeState.fire();
  }

  //- Utilities

  clear(): void {
    this.tabs.clear();
    this.groups.clear();
    this._onDidChangeState.fire();
  }

  getStats(): { tabs: number; groups: number } {
    return {
      tabs: this.tabs.size,
      groups: this.groups.size,
    };
  }
}
