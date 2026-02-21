import * as vscode from 'vscode';
import type { SideTabMetadata, SideTabState } from '../SideTab';

/**
 * Reveal actions - Revelar archivos en exploradores
 */

export async function revealInExplorer(
  metadata: SideTabMetadata,
  state: SideTabState
): Promise<void> {
  if (!state.capabilities.canRevealInExplorer) {
    vscode.window.showWarningMessage('This tab has no file to reveal');
    return;
  }
  if (metadata.uri) {
    await vscode.commands.executeCommand('revealInExplorer', metadata.uri);
  }
}

export async function revealInExplorerView(
  metadata: SideTabMetadata,
  state: SideTabState
): Promise<void> {
  if (metadata.uri) {
    await vscode.commands.executeCommand('revealInExplorer', metadata.uri);
  }
}

export async function revealInFileExplorer(
  metadata: SideTabMetadata,
  state: SideTabState
): Promise<void> {
  if (metadata.uri) {
    await vscode.commands.executeCommand('revealFileInOS', metadata.uri);
  }
}

export async function openTimeline(
  metadata: SideTabMetadata,
  state: SideTabState,
  activateFn: () => Promise<void>
): Promise<void> {
  if (!metadata.uri) {
    return;
  }
  await vscode.commands.executeCommand('timeline.focus');
  await activateFn();
}
