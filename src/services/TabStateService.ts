import * as vscode from 'vscode';
import { SideTab } from '../models/SideTab';
import { SideTabGroup } from '../models/SideTabGroup';

/**
 * In-memory state store for tabs and groups.
 * Emits `onDidChangeState` whenever the data changes so
 * the TreeDataProvider can refresh.
 */
export class TabStateService {
  private tabs: Map<string, SideTab> = new Map();
  private groups: Map<number, SideTabGroup> = new Map();

  private _onDidChangeState = new vscode.EventEmitter<void>();
  readonly onDidChangeState = this._onDidChangeState.event;

  // === Tab management ===

  /** Add a tab (or update if it already exists in the group). */
  addTab(tab: SideTab): void {
    this.tabs.set(tab.metadata.id, tab);

    const group = this.groups.get(tab.state.groupId);
    if (group) {
      if (!group.tabs.find(t => t.metadata.id === tab.metadata.id)) {
        group.tabs.push(tab);
      }
    }

    this._onDidChangeState.fire();
  }

  /** Remove a tab by id and clean it from its group. */
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

  /** Update a tab in-place (both the map and its group array). */
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

  /** Replace all tabs with a new set (used during full sync). */
  replaceTabs(tabs: SideTab[]): void {
    this.tabs.clear();

    // Clear tabs from all groups
    this.groups.forEach(group => {
      group.tabs = [];
    });

    tabs.forEach(tab => this.addTab(tab));
  }

  // === Group management ===

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

  // === Search ===

  /** Find a tab by its URI, optionally scoped to a group. */
  findTabByUri(uri: vscode.Uri, groupId?: number): SideTab | undefined {
    const uriString = uri.toString();

    for (const tab of this.tabs.values()) {
      if (tab.metadata.uri.toString() === uriString) {
        if (groupId === undefined || tab.state.groupId === groupId) {
          return tab;
        }
      }
    }

    return undefined;
  }

  // === Utilities ===

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
