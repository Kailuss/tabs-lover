import * as vscode from 'vscode';
import { CopilotService } from '../services/CopilotService';
import { TabStateService } from '../services/TabStateService';

/**
 * Registra comandos para añadir archivos al contexto de GitHub Copilot Chat.
 */
export function registerCopilotCommands(
  context: vscode.ExtensionContext,
  copilotService: CopilotService,
  stateService: TabStateService
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('tabsLover.addToCopilotChat', async (tabId: string) => {
      const tab = typeof tabId === 'string' ? stateService.getTab(tabId) : undefined;
      if (tab) {
        await copilotService.addFileToChat(tab.metadata.uri);
      }
    }),

    vscode.commands.registerCommand('tabsLover.addMultipleToCopilotChat', async () => {
      const allTabs = stateService.getAllTabs();
      if (allTabs.length === 0) {
        vscode.window.showInformationMessage('No tabs open');
        return;
      }
      await copilotService.addMultipleFiles(allTabs);
    }),
  );
}
