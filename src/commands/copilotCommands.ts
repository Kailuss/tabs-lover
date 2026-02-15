import * as vscode from 'vscode';
import { TabTreeItem } from '../models/TabTreeItem';
import { CopilotService } from '../services/CopilotService';
import { TabStateService } from '../services/TabStateService';

/**
 * Registers Copilot Chat–related commands.
 */
export function registerCopilotCommands(
  context: vscode.ExtensionContext,
  copilotService: CopilotService,
  stateService: TabStateService
): void {
  // Add single file to Copilot Chat
  context.subscriptions.push(
    vscode.commands.registerCommand('tabsLover.addToCopilotChat', async (item: TabTreeItem) => {
      if (item?.tab) {
        await copilotService.addFileToChat(item.tab.metadata.uri);
      }
    })
  );

  // Add multiple files to Copilot Chat
  context.subscriptions.push(
    vscode.commands.registerCommand('tabsLover.addMultipleToCopilotChat', async () => {
      const allTabs = stateService.getAllTabs();
      if (allTabs.length === 0) {
        vscode.window.showInformationMessage('No tabs open');
        return;
      }

      await copilotService.addMultipleFiles(allTabs);
    })
  );
}
