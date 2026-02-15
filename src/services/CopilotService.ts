import * as vscode from 'vscode';
import { SideTab } from '../models/SideTab';

/**
 * Integración opcional con GitHub Copilot Chat.
 * Explicación práctica: permite añadir archivos al contexto de chat desde la UI.
 */
export class CopilotService {
  private copilotExtension?: vscode.Extension<unknown>;

  constructor() {
    this.copilotExtension = vscode.extensions.getExtension('github.copilot-chat');
  }

  /** Indica si la extensión GitHub Copilot Chat está disponible. */
  isAvailable(): boolean {
    return this.copilotExtension !== undefined;
  }

  /**
   * Añade un archivo al contexto de Copilot Chat.
   * Si la integración directa no está disponible usa el portapapeles como alternativa.
   */
  async addFileToChat(uri: vscode.Uri | undefined): Promise<boolean> {
    if (!uri) {
      vscode.window.showWarningMessage('This tab has no file to add to chat.');
      return false;
    }
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

  /**
   * Alternativa cuando la API de Copilot no está disponible: copia una referencia
   * `#file:ruta` al portapapeles y abre el chat para que el usuario la pegue.
   */
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

  /** Muestra un QuickPick para seleccionar varios archivos y añadirlos al chat. */
  async addMultipleFiles(tabs: SideTab[]): Promise<void> {
    const fileTabs = tabs.filter(t => t.metadata.uri);
    if (fileTabs.length === 0) {
      vscode.window.showInformationMessage('No file tabs to add');
      return;
    }
    const selected = await vscode.window.showQuickPick(
      fileTabs.map(tab => ({
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
      if (item.tab.metadata.uri) {
        await this.addFileToChat(item.tab.metadata.uri);
      }
    }

    vscode.window.showInformationMessage(
      `Added ${selected.length} file(s) to Copilot Chat context`
    );
  }
}
