import * as vscode from 'vscode';
import type { SideTabMetadata, SideTabState } from '../SideTab';

/**
 * Pin/Unpin actions - Pinear y despinear tabs
 */

export async function pin(
  metadata: SideTabMetadata,
  state: SideTabState,
  activateFn: () => Promise<void>
): Promise<void> {
  if (!state.capabilities.canPin) {
    vscode.window.showWarningMessage('This tab cannot be pinned');
    return;
  }
  await activateFn();
  await vscode.commands.executeCommand('workbench.action.pinEditor');
  state.isPinned = true;
}

export async function unpin(
  metadata: SideTabMetadata,
  state: SideTabState,
  activateFn: () => Promise<void>
): Promise<void> {
  if (!state.capabilities.canUnpin) {
    vscode.window.showWarningMessage('This tab is not pinned');
    return;
  }
  await activateFn();
  await vscode.commands.executeCommand('workbench.action.unpinEditor');
  state.isPinned = false;
}
