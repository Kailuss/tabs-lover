import * as vscode from 'vscode';
import { TabStateService } from '../services/TabStateService';
import { CopilotService } from '../services/CopilotService';
import { TabTreeItem, GroupTreeItem } from '../models/TabTreeItem';
import { getConfiguration } from '../constants/styles';

/**
 * TreeDataProvider that renders open tabs grouped by editor group.
 * When only one group exists, tabs are shown flat (no group header).
 */
export class TabsLoverProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private stateService: TabStateService,
    private copilotService: CopilotService
  ) {
    // Refresh whenever state changes
    stateService.onDidChangeState(() => {
      this.refresh();
    });
  }

  /** Force a full tree refresh. */
  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
    this.updateContextKeys();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (!element) {
      // Root level — show groups
      const groups = this.stateService.getGroups();

      if (groups.length === 0) {
        return [];
      }

      // Single group → flat list of tabs
      if (groups.length === 1) {
        return this.getTabsForGroup(groups[0].id);
      }

      // Multiple groups → group headers
      return groups.map(group => new GroupTreeItem(group));
    }

    if (element instanceof GroupTreeItem) {
      return this.getTabsForGroup(element.group.id);
    }

    return [];
  }

  private getTabsForGroup(groupId: number): TabTreeItem[] {
    const config = getConfiguration();
    const tabs = this.stateService.getTabsInGroup(groupId);
    return tabs.map(tab => new TabTreeItem(tab, config));
  }

  private updateContextKeys(): void {
    vscode.commands.executeCommand(
      'setContext',
      'tabsLover.copilotAvailable',
      this.copilotService.isAvailable()
    );

    vscode.commands.executeCommand(
      'setContext',
      'tabsLover.hasMultipleGroups',
      vscode.window.tabGroups.all.length > 1
    );
  }
}
