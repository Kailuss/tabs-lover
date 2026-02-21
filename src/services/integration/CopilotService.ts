import * as vscode from 'vscode';
import { SideTab } from '../../models/SideTab';

/**
 * Options accepted by the `workbench.action.chat.open` command.
 * Subset of the internal IChatViewOpenOptions interface.
 */
interface ChatOpenOptions {
  /** Prompt text to pre-fill in the chat input. */
  query?: string;
  /** If true, the query is placed in the input but not sent automatically. */
  isPartialQuery?: boolean;
  /** File URIs (or URI + range) to attach as context. */
  attachFiles?: (vscode.Uri | { uri: vscode.Uri; range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } })[];
  /** Chat mode: 'agent', 'ask', or 'edit'. */
  mode?: string;
}

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
      return false;
    }
    if (!this.isAvailable()) {
      return false;
    }

    try {
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: '',
        isPartialQuery: true,
        attachFiles: [uri],
      } satisfies ChatOpenOptions);
      return true;
    } catch (error) {
      vscode.window.showWarningMessage(
        `Failed to attach file to Copilot Chat: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  /**
   * Añade varios archivos al contexto de Copilot Chat en una sola acción.
   * All files are attached simultaneously to a single chat session.
   */
  async addFilesToChat(uris: vscode.Uri[], query?: string): Promise<boolean> {
    if (uris.length === 0) {
      return false;
    }
    if (!this.isAvailable()) {
      return false;
    }

    try {
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: query ?? '',
        isPartialQuery: !query,
        attachFiles: uris,
      } satisfies ChatOpenOptions);
      return true;
    } catch (error) {
      vscode.window.showWarningMessage(
        `Failed to attach files to Copilot Chat: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
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
        description: tab.metadata.detailLabel,
        detail: tab.metadata.tooltipText,
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

    // Collect all URIs and attach them in a single chat.open call
    const uris = selected
      .map(item => item.tab.metadata.uri)
      .filter((uri): uri is vscode.Uri => uri !== undefined);

    const success = await this.addFilesToChat(uris);

    if (success) {
      vscode.window.showInformationMessage(
        `Added ${uris.length} file(s) to Copilot Chat context`
      );
    }
  }
}
