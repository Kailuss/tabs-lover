import * as vscode from 'vscode';
import type { SideTabMetadata, SideTabState } from '../SideTab';

/**
 * Copy actions - Copiar paths y contenido
 */

export async function copyRelativePath(
  metadata: SideTabMetadata,
  state: SideTabState
): Promise<void> {
  if (!state.capabilities.canCopyPath) {
    vscode.window.showWarningMessage('This tab has no path to copy');
    return;
  }
  if (!metadata.uri) {
    return;
  }
  const rel = vscode.workspace.asRelativePath(metadata.uri);
  await vscode.env.clipboard.writeText(rel);
  vscode.window.showInformationMessage(`Copied: ${rel}`);
}

export async function copyPath(metadata: SideTabMetadata, state: SideTabState): Promise<void> {
  if (!state.capabilities.canCopyPath) {
    vscode.window.showWarningMessage('This tab has no path to copy');
    return;
  }
  if (!metadata.uri) {
    return;
  }
  await vscode.env.clipboard.writeText(metadata.uri.fsPath);
  vscode.window.showInformationMessage(`Copied: ${metadata.uri.fsPath}`);
}

export async function copyFileContents(
  metadata: SideTabMetadata,
  state: SideTabState
): Promise<void> {
  if (!metadata.uri) {
    return;
  }
  try {
    const doc = await vscode.workspace.openTextDocument(metadata.uri);
    await vscode.env.clipboard.writeText(doc.getText());
    vscode.window.showInformationMessage('File contents copied to clipboard');
  } catch {
    vscode.window.showErrorMessage('Failed to copy file contents');
  }
}
