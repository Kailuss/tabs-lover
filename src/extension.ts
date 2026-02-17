import * as vscode from 'vscode';
import { TabsLoverWebviewProvider } from './providers/TabsLoverWebviewProvider';
import { TabStateService } from './services/TabStateService';
import { TabSyncService } from './services/TabSyncService';
import { TabDragDropService } from './services/TabDragDropService';
import { TabIconManager } from './services/TabIconManager';
import { ThemeService } from './services/ThemeService';
import { CopilotService } from './services/CopilotService';
import { registerTabCommands } from './commands/tabCommands';
import { registerCopilotCommands } from './commands/copilotCommands';
import { Logger } from './utils/logger';

export function activate(context: vscode.ExtensionContext) {
  Logger.initialize();
  Logger.log('Activating Tabs Lover…');

  try {
    // Core services
    const stateService  = new TabStateService();
    const syncService   = new TabSyncService(stateService);
    const dragDropService = new TabDragDropService(stateService);
    const iconManager   = new TabIconManager();
    const themeService  = new ThemeService();
    const copilotService = new CopilotService();

    // Initialise icon manager (loads icon map in background)
    iconManager.initialize(context);
    // WebviewView provider
    const provider = new TabsLoverWebviewProvider(
      context.extensionUri,
      stateService,
      copilotService,
      iconManager,
      context,
      dragDropService,
    );

    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        TabsLoverWebviewProvider.viewType,
        provider,
      ),
    );

    // Configuration reload
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('tabsLover')) { provider.refresh(); }
      }),
    );

    // Activate services
    syncService.activate(context);
    themeService.activate(context);

    // Register commands
    registerTabCommands(context, stateService);
    registerCopilotCommands(context, copilotService, stateService);

    context.subscriptions.push(
      vscode.commands.registerCommand('tabsLover.refresh', () => provider.refresh()),
    );

    // Refresh on theme change
    themeService.onDidChangeTheme(() => provider.refresh());

    Logger.log('Tabs Lover activated successfully');
  } catch (error) {
    Logger.error('Activation failed', error);
    throw error;
  }
}

export function deactivate() {
  // nothing to clean up — disposables handled via context.subscriptions
}
