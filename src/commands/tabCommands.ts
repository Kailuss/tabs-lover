import * as vscode from 'vscode';
import { SideTab } from '../models/SideTab';
import { TabTreeItem } from '../models/TabTreeItem';
import { TabStateService } from '../services/TabStateService';

/**
 * Registers all tab-related commands (open, close, pin, copy, compare…).
 */
export function registerTabCommands(
  context: vscode.ExtensionContext,
  _stateService: TabStateService
): void {
  // Open Tab
  context.subscriptions.push(
    vscode.commands.registerCommand('tabsLover.openTab', async (tab: SideTab) => {
      if (tab) {
        await tab.activate();
      }
    })
  );

  // Close Tab
  context.subscriptions.push(
    vscode.commands.registerCommand('tabsLover.closeTab', async (item: TabTreeItem) => {
      if (item?.tab) {
        await item.tab.close();
      }
    })
  );

  // Close Others
  context.subscriptions.push(
    vscode.commands.registerCommand('tabsLover.closeOthers', async (item: TabTreeItem) => {
      if (item?.tab) {
        await item.tab.closeOthers();
      }
    })
  );

  // Close to Right
  context.subscriptions.push(
    vscode.commands.registerCommand('tabsLover.closeToRight', async (item: TabTreeItem) => {
      if (item?.tab) {
        await item.tab.closeToRight();
      }
    })
  );

  // Close All
  context.subscriptions.push(
    vscode.commands.registerCommand('tabsLover.closeAll', async () => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    })
  );

  // Pin Tab
  context.subscriptions.push(
    vscode.commands.registerCommand('tabsLover.pinTab', async (item: TabTreeItem) => {
      if (item?.tab) {
        await item.tab.pin();
      }
    })
  );

  // Unpin Tab
  context.subscriptions.push(
    vscode.commands.registerCommand('tabsLover.unpinTab', async (item: TabTreeItem) => {
      if (item?.tab) {
        await item.tab.unpin();
      }
    })
  );

  // Reveal in Explorer
  context.subscriptions.push(
    vscode.commands.registerCommand('tabsLover.revealInExplorer', async (item: TabTreeItem) => {
      if (item?.tab) {
        await item.tab.revealInExplorer();
      }
    })
  );

  // Copy Relative Path
  context.subscriptions.push(
    vscode.commands.registerCommand('tabsLover.copyRelativePath', async (item: TabTreeItem) => {
      if (item?.tab) {
        await item.tab.copyRelativePath();
      }
    })
  );

  // Copy File Contents
  context.subscriptions.push(
    vscode.commands.registerCommand('tabsLover.copyFileContents', async (item: TabTreeItem) => {
      if (item?.tab) {
        await item.tab.copyFileContents();
      }
    })
  );

  // Compare with Active
  context.subscriptions.push(
    vscode.commands.registerCommand('tabsLover.compareWithActive', async (item: TabTreeItem) => {
      if (item?.tab) {
        await item.tab.compareWithActive();
      }
    })
  );

  // Move to Group
  context.subscriptions.push(
    vscode.commands.registerCommand('tabsLover.moveToGroup', async (item: TabTreeItem) => {
      if (!item?.tab) {
        return;
      }

      const groups = vscode.window.tabGroups.all;
      if (groups.length <= 1) {
        vscode.window.showInformationMessage('Only one group available');
        return;
      }

      const options = groups
        .filter(g => g.viewColumn !== item.tab.state.viewColumn)
        .map(g => ({
          label: `Group ${g.viewColumn}`,
          viewColumn: g.viewColumn,
        }));

      const selected = await vscode.window.showQuickPick(options, {
        placeHolder: 'Select target group',
      });

      if (selected) {
        await item.tab.moveToGroup(selected.viewColumn);
      }
    })
  );
}
