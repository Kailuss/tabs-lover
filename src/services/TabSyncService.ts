import * as vscode from 'vscode';
import * as path from 'path';
import { TabStateService } from './TabStateService';
import { SideTab, SideTabMetadata, SideTabState } from '../models/SideTab';
import { createTabGroup } from '../models/SideTabGroup';
import { Logger } from '../utils/logger';

/**
 * Keeps the in-memory TabStateService in sync with VS Code's
 * native Tab API by listening to tab and group change events.
 */
export class TabSyncService {
  private disposables: vscode.Disposable[] = [];

  constructor(private stateService: TabStateService) {}

  /** Register listeners and perform initial sync. */
  activate(context: vscode.ExtensionContext): void {
    Logger.log('📡 TabSyncService.activate() called');
    
    // Initial sync
    this.syncAll();
    
    Logger.log(`📡 Initial sync complete. Total tabs: ${vscode.window.tabGroups.all.reduce((acc, g) => acc + g.tabs.length, 0)}`);

    // Tab change listener
    this.disposables.push(
      vscode.window.tabGroups.onDidChangeTabs(e => {
        Logger.log(`📡 onDidChangeTabs: opened=${e.opened.length}, closed=${e.closed.length}, changed=${e.changed.length}`);
        this.handleTabChanges(e);
      })
    );

    // Group change listener
    this.disposables.push(
      vscode.window.tabGroups.onDidChangeTabGroups(e => {
        Logger.log(`📡 onDidChangeTabGroups: opened=${e.opened.length}, closed=${e.closed.length}, changed=${e.changed.length}`);
        this.handleGroupChanges(e);
      })
    );

    context.subscriptions.push(...this.disposables);
    Logger.log('📡 TabSyncService listeners registered');
  }

  private handleTabChanges(e: vscode.TabChangeEvent): void {
    // Opened tabs
    e.opened.forEach(tab => {
      if (tab.input instanceof vscode.TabInputText) {
        const sideTab = this.convertToSideTab(tab);
        this.stateService.addTab(sideTab);
      }
    });

    // Closed tabs
    e.closed.forEach(tab => {
      if (tab.input instanceof vscode.TabInputText) {
        const input = tab.input as vscode.TabInputText;
        const id = this.generateId(input.uri, tab.group.viewColumn);
        this.stateService.removeTab(id);
      }
    });

    // Changed tabs (dirty, pinned, active…)
    e.changed.forEach(tab => {
      if (tab.input instanceof vscode.TabInputText) {
        const sideTab = this.convertToSideTab(tab);
        this.stateService.updateTab(sideTab);
      }
    });
  }

  private handleGroupChanges(e: vscode.TabGroupChangeEvent): void {
    // Groups opened
    e.opened.forEach(group => {
      this.stateService.addGroup(createTabGroup(group));
    });

    // Groups closed
    e.closed.forEach(group => {
      this.stateService.removeGroup(group.viewColumn);
    });

    // Active group changed
    if (e.changed.length > 0) {
      const activeGroup = vscode.window.tabGroups.activeTabGroup;
      this.stateService.setActiveGroup(activeGroup.viewColumn);
    }
  }

  /** Perform a full sync of all groups and tabs. */
  private syncAll(): void {
    // Sync groups
    vscode.window.tabGroups.all.forEach(group => {
      this.stateService.addGroup(createTabGroup(group));
    });

    // Sync tabs
    const allTabs: SideTab[] = [];

    vscode.window.tabGroups.all.forEach(group => {
      group.tabs.forEach((tab, tabIndex) => {
        if (tab.input instanceof vscode.TabInputText) {
          allTabs.push(this.convertToSideTab(tab, tabIndex));
        }
      });
    });

    this.stateService.replaceTabs(allTabs);
  }

  /** Convert a native VS Code Tab into our SideTab model. */
  private convertToSideTab(tab: vscode.Tab, index?: number): SideTab {
    const input = tab.input as vscode.TabInputText;
    const uri = input.uri;
    const fileName = path.basename(uri.fsPath);

    const metadata: SideTabMetadata = {
      id: this.generateId(uri, tab.group.viewColumn),
      uri,
      label: fileName,
      description: vscode.workspace.asRelativePath(uri),
      tooltip: uri.fsPath,
      fileType: path.extname(uri.fsPath),
    };

    const state: SideTabState = {
      isActive: tab.isActive,
      isDirty: tab.isDirty,
      isPinned: tab.isPinned,
      isPreview: tab.isPreview,
      groupId: tab.group.viewColumn,
      viewColumn: tab.group.viewColumn,
      indexInGroup: index ?? 0,
      lastAccessTime: Date.now(),
    };

    return new SideTab(metadata, state);
  }

  private generateId(uri: vscode.Uri, viewColumn: vscode.ViewColumn): string {
    return `${uri.toString()}-${viewColumn}`;
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}
