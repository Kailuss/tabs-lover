import * as vscode from 'vscode';
import { SideTab } from '../models/SideTab';

/**
 * Optional integration with GitHub Copilot Chat.
 * Allows adding files to the chat context via commands or a clipboard fallback.
 */
export class CopilotService {
  private copilotExtension?: vscode.Extension<unknown>;

  constructor() {
    this.copilotExtension = vscode.extensions.getExtension('github.copilot-chat');
  }

  /** Returns true when the Copilot Chat extension is installed. */
  isAvailable(): boolean {
    return this.copilotExtension !== undefined;
  }

  /**
   * Add a single file to Copilot Chat context.
   * Falls back to a clipboard-based workflow if the direct command is unavailable.
   */
  async addFileToChat(uri: vscode.Uri): Promise<boolean> {
    if (!this.isAvailable()) {
      vscode.window.showWarningMessage(
        'GitHub Copilot Chat is not installed. Install it to use this feature.'
      );
      return false;
    }

    try {
      await vscode.commands.executeCommand('github.copilot.chat.addContext', { uri });
      return true;
    } catch {
      return await this.fallbackAddToChat(uri);
    }
  }

  private async fallbackAddToChat(uri: vscode.Uri): Promise<boolean> {
    const relativePath = vscode.workspace.asRelativePath(uri);

    // Copy reference
    await vscode.env.clipboard.writeText(`#file:${relativePath}`);

    // Open chat
    await vscode.commands.executeCommand('workbench.action.chat.open');

    // Notify
    const action = await vscode.window.showInformationMessage(
      `Reference copied: #file:${relativePath}`,
      'Paste in Chat'
    );

    if (action === 'Paste in Chat') {
      await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
    }

    return true;
  }

  /** Show a QuickPick to select multiple files and add them to chat. */
  async addMultipleFiles(tabs: SideTab[]): Promise<void> {
    const selected = await vscode.window.showQuickPick(
      tabs.map(tab => ({
        label: tab.metadata.label,
        description: tab.metadata.description,
        detail: tab.metadata.tooltip,
        tab,
      })),
      {
        canPickMany: true,
        placeHolder: 'Select files to add to Copilot Chat context',
      }
    );

    if (!selected || selected.length === 0) {
      return;
    }

    for (const item of selected) {
      await this.addFileToChat(item.tab.metadata.uri);
    }

    vscode.window.showInformationMessage(
      `Added ${selected.length} file(s) to Copilot Chat context`
    );
  }
}
