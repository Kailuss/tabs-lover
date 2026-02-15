import * as vscode from 'vscode';
import { TabsLoverProvider } from './providers/TabsLoverProvider';
import { TabStateService } from './services/TabStateService';
import { TabSyncService } from './services/TabSyncService';
import { TabIconManager } from './services/TabIconManager';
import { ThemeService } from './services/ThemeService';
import { CopilotService } from './services/CopilotService';
import { registerTabCommands } from './commands/tabCommands';
import { registerCopilotCommands } from './commands/copilotCommands';
import { Logger } from './utils/logger';

console.log('[Tabs Lover] Module loaded, activate() will be called');

export function activate(context: vscode.ExtensionContext) {
  try {
    Logger.initialize();
    console.log('[Tabs Lover] Logger initialized');
    Logger.log('🚀 Activating Tabs Lover…');

  } catch (initError) {
    console.error('[Tabs Lover] Logger init failed:', initError);
  }

  try {
    // Services
    Logger.log('📦 Creating services…');
    const stateService = new TabStateService();
    Logger.log('✅ TabStateService created');
    
    const syncService = new TabSyncService(stateService);
    Logger.log('✅ TabSyncService created');
    
    const iconManager = new TabIconManager();
    Logger.log('✅ TabIconManager created');
    
    const themeService = new ThemeService();
    Logger.log('✅ ThemeService created');
    
    const copilotService = new CopilotService();
    Logger.log('✅ CopilotService created');

    // Provider
    Logger.log('🎨 Creating TreeDataProvider…');
    const provider = new TabsLoverProvider(stateService, copilotService);
    Logger.log('✅ TabsLoverProvider created');

    // Register TreeView
    Logger.log('📋 Registering TreeView…');
    const treeView = vscode.window.createTreeView('tabsLover', {
      treeDataProvider: provider,
      showCollapseAll: false,
    });
    context.subscriptions.push(treeView);
    Logger.log('✅ TreeView registered');

    // Activate services
    Logger.log('⚙️ Activating services…');
    syncService.activate(context);
    Logger.log('✅ TabSyncService activated');
    
    themeService.activate(context);
    Logger.log('✅ ThemeService activated');
    
    iconManager.initialize(context);
    Logger.log('✅ TabIconManager initialized');

    // Register commands
    Logger.log('🎯 Registering commands…');
    registerTabCommands(context, stateService);
    Logger.log('✅ Tab commands registered');
    
    registerCopilotCommands(context, copilotService, stateService);
    Logger.log('✅ Copilot commands registered');

    // Refresh command
    Logger.log('🔄 Registering refresh command…');
    context.subscriptions.push(
      vscode.commands.registerCommand('tabsLover.refresh', () => {
        Logger.log('🔄 Refresh triggered');
        provider.refresh();
      })
    );
    Logger.log('✅ Refresh command registered');

    // Refresh on theme change
    themeService.onDidChangeTheme(() => {
      Logger.log('🎨 Theme changed, refreshing…');
      provider.refresh();
    });

    // Log stats
    const stats = stateService.getStats();
    Logger.log(`📊 Initial state: ${stats.tabs} tabs, ${stats.groups} groups`);

    Logger.log('✅ Tabs Lover activated successfully!');
  } catch (error) {
    console.error('[Tabs Lover] Activation error:', error);
    Logger.error('❌ Error during activation', error);
    throw error;
  }
}

export function deactivate() {
  Logger.log('Tabs Lover deactivated');
}
