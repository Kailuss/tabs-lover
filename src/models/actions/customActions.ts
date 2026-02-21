import * as vscode from 'vscode';
import type { SideTabMetadata, SideTabState, CustomTabAction } from '../SideTab';
import { isActionRestricted, startOperation, finishOperation } from './stateActions';

/**
 * Custom actions management - Gestión de acciones personalizadas
 */

export function addCustomAction(state: SideTabState, action: CustomTabAction): void {
  if (!state.customActions) {
    state.customActions = [];
  }
  // Remove existing action with same ID
  state.customActions = state.customActions.filter((a) => a.id !== action.id);
  state.customActions.push(action);
}

export async function executeCustomAction(
  metadata: SideTabMetadata,
  state: SideTabState,
  actionId: string
): Promise<void> {
  const action = state.customActions?.find((a) => a.id === actionId);
  if (!action) {
    vscode.window.showWarningMessage(`Custom action '${actionId}' not found`);
    return;
  }

  if (isActionRestricted(state, actionId)) {
    vscode.window.showWarningMessage(`Action '${action.label}' is restricted`);
    return;
  }

  try {
    startOperation(state, `Custom: ${action.label}`, false);
    await action.execute(metadata, state);
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to execute '${action.label}': ${err}`);
  } finally {
    finishOperation(state);
  }
}

export function removeCustomAction(state: SideTabState, actionId: string): void {
  if (state.customActions) {
    state.customActions = state.customActions.filter((a) => a.id !== actionId);
  }
}
