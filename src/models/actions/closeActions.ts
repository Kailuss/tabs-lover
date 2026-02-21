import * as vscode from 'vscode';
import type { SideTabMetadata, SideTabState } from '../SideTab';
import { SideTabHelpers } from '../SideTabHelpers';

/**
 * Close actions - Cerrar tabs y grupos
 */

export async function close(metadata: SideTabMetadata, state: SideTabState): Promise<void> {
  if (!state.capabilities.canClose) {
    vscode.window.showWarningMessage('This tab cannot be closed');
    return;
  }
  const t = SideTabHelpers.findNativeTab(metadata, state);
  if (t) {
    await vscode.window.tabGroups.close(t);
  }
}

export async function closeOthers(
  metadata: SideTabMetadata,
  state: SideTabState,
  activateFn: () => Promise<void>
): Promise<void> {
  await activateFn();
  await vscode.commands.executeCommand('workbench.action.closeOtherEditors');
}

export async function closeGroup(metadata: SideTabMetadata, state: SideTabState): Promise<void> {
  const group = SideTabHelpers.nativeGroup(state.viewColumn);
  if (!group) {
    return;
  }
  await vscode.window.tabGroups.close(group);
}

export async function closeToRight(
  metadata: SideTabMetadata,
  state: SideTabState
): Promise<void> {
  const group = SideTabHelpers.nativeGroup(state.viewColumn);
  if (!group) {
    return;
  }

  const idx = group.tabs.findIndex((t) => SideTabHelpers.matchesNative(t, metadata));
  if (idx === -1) {
    return;
  }

  for (const t of group.tabs.slice(idx + 1)) {
    await vscode.window.tabGroups.close(t);
  }
}
