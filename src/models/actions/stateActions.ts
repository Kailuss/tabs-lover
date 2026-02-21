import type { SideTabState, ActionContext, TabIntegrations } from '../SideTab';

/**
 * State management actions - Operaciones, contexto, integraciones
 */

//- Operations State

export function startOperation(
  state: SideTabState,
  operationName: string,
  canCancel: boolean = false
): void {
  state.operationState = {
    isProcessing    : true,
    currentOperation: operationName,
    canCancel,
    progress        : 0,
  };
}

export function updateOperationProgress(state: SideTabState, progress: number): void {
  if (state.operationState.isProcessing) {
    state.operationState.progress = Math.max(0, Math.min(100, progress));
  }
}

export function finishOperation(state: SideTabState): void {
  state.operationState = {
    isProcessing    : false,
    canCancel       : false,
  };
}

//- Action Context

export function updateActionContext(
  state: SideTabState,
  context: Partial<ActionContext>
): void {
  state.actionContext = {
    ...state.actionContext,
    ...context,
  };
}

export function isActionRestricted(state: SideTabState, actionId: string): boolean {
  return state.permissions.restrictedActions?.includes(actionId) || false;
}

//- Integrations

export function addToCopilotContext(state: SideTabState): void {
  state.integrations.copilot = {
    inContext    : true,
    lastAddedTime: Date.now(),
  };
}

export function removeFromCopilotContext(state: SideTabState): void {
  state.integrations.copilot = {
    inContext    : false,
  };
}

export function updateGitIntegration(
  state: SideTabState,
  gitInfo: Partial<TabIntegrations['git']>
): void {
  state.integrations.git = {
    hasUncommittedChanges: false, // Default
    ...state.integrations.git,
    ...gitInfo,
  };
}
