import * as vscode from 'vscode';
import { TabStateService } from '../services/core/TabStateService';
import { VSCODE_COMMANDS } from '../constants/commands';

/**
 * Registra los comandos relacionados con pestañas (abrir, cerrar, mover, etc.).
 * Normalmente reciben un ID de pestaña desde el webview y resuelven el `SideTab`.
 */
export function registerTabCommands(
  context: vscode.ExtensionContext,
  stateService: TabStateService
): void {
  const resolve = (arg: unknown) => {
    if (typeof arg === 'string') { return stateService.getTab(arg); }
    return undefined;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('tabsLover.openTab', async (arg: unknown) => {
      const tab = resolve(arg);
      if (tab) { await tab.activate(); }
    }),

    vscode.commands.registerCommand('tabsLover.closeTab', async (arg: unknown) => {
      const tab = resolve(arg);
      if (tab) { await tab.close(); }
    }),

    vscode.commands.registerCommand('tabsLover.closeOthers', async (arg: unknown) => {
      const tab = resolve(arg);
      if (tab) { await tab.closeOthers(); }
    }),

    vscode.commands.registerCommand('tabsLover.closeToRight', async (arg: unknown) => {
      const tab = resolve(arg);
      if (tab) { await tab.closeToRight(); }
    }),

    vscode.commands.registerCommand('tabsLover.closeAll', async () => {
      await vscode.commands.executeCommand(VSCODE_COMMANDS.CLOSE_ALL_EDITORS);
    }),

    vscode.commands.registerCommand('tabsLover.saveAll', async () => {
      await vscode.workspace.saveAll(false);
    }),

    vscode.commands.registerCommand('tabsLover.reorder', () => {
      vscode.window.showInformationMessage('Reorder: Coming soon');
    }),

    vscode.commands.registerCommand('tabsLover.toggleCompactMode', async () => {
      const cfg = vscode.workspace.getConfiguration('tabsLover');
      const current = cfg.get<boolean>('compactMode', false);
      await cfg.update('compactMode', !current, vscode.ConfigurationTarget.Global);
    }),

    vscode.commands.registerCommand('tabsLover.pinTab', async (arg: unknown) => {
      const tab = resolve(arg);
      if (tab) { await tab.pin(); }
    }),

    vscode.commands.registerCommand('tabsLover.unpinTab', async (arg: unknown) => {
      const tab = resolve(arg);
      if (tab) { await tab.unpin(); }
    }),

    vscode.commands.registerCommand('tabsLover.revealInExplorer', async (arg: unknown) => {
      const tab = resolve(arg);
      if (tab) { await tab.revealInExplorer(); }
    }),

    vscode.commands.registerCommand('tabsLover.copyRelativePath', async (arg: unknown) => {
      const tab = resolve(arg);
      if (tab) { await tab.copyRelativePath(); }
    }),

    vscode.commands.registerCommand('tabsLover.copyFileContents', async (arg: unknown) => {
      const tab = resolve(arg);
      if (tab) { await tab.copyFileContents(); }
    }),

    vscode.commands.registerCommand('tabsLover.compareWithActive', async (arg: unknown) => {
      const tab = resolve(arg);
      if (tab) { await tab.compareWithActive(); }
    }),

    vscode.commands.registerCommand('tabsLover.moveToGroup', async (arg: unknown) => {
      const tab = resolve(arg);
      if (!tab) { return; }

      const groups = vscode.window.tabGroups.all;
      if (groups.length <= 1) {
        vscode.window.showInformationMessage('Only one group available');
        return;
      }

      const options = groups
        .filter(g => g.viewColumn !== tab.state.viewColumn)
        .map(g => ({ label: `Group ${g.viewColumn}`, viewColumn: g.viewColumn }));

      const selected = await vscode.window.showQuickPick(options, {
        placeHolder: 'Select target group',
      });

      if (selected) { await tab.moveToGroup(selected.viewColumn); }
    }),
  );
}
