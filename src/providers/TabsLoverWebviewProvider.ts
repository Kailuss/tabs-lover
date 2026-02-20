import * as vscode from 'vscode';
import { TabStateService }          from '../services/core/TabStateService';
import { TabIconManager }           from '../services/ui/TabIconManager';
import { CopilotService }           from '../services/integration/CopilotService';
import { TabDragDropService }       from '../services/ui/TabDragDropService';
import { FileActionRegistry }      from '../services/registry/FileActionRegistry';
import { SideTab }                  from '../models/SideTab';
import { getConfiguration }         from '../constants/styles';
import { TabsLoverHtmlBuilder }     from './TabsLoverHtmlBuilder';
import { TabContextMenu }           from './TabContextMenu';

/**
 * Proveedor del Webview que coordina la vista de pestañas.
 * Gestiona el ciclo de vida del webview, mensajes y eventos.
 * La generación de HTML se delega a `TabsLoverHtmlBuilder`.
 */
export class TabsLoverWebviewProvider implements vscode.WebviewViewProvider { 
  public static readonly viewType = 'tabsLover';

  private _view?: vscode.WebviewView;
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _fullRefreshPending = false;
  private readonly htmlBuilder: TabsLoverHtmlBuilder;
  private readonly contextMenu: TabContextMenu;

  constructor(
    private readonly _extensionUri  : vscode.Uri,
    private readonly stateService   : TabStateService,
    private readonly copilotService : CopilotService,
    private readonly iconManager    : TabIconManager,
    private readonly context        : vscode.ExtensionContext,
    private readonly dragDropService: TabDragDropService,
    private readonly fileActionRegistry: FileActionRegistry,
  ) {
    this.htmlBuilder = new TabsLoverHtmlBuilder(_extensionUri, iconManager, context, fileActionRegistry);
    this.contextMenu = new TabContextMenu(stateService, copilotService);
    // Full rebuild on structural changes
    stateService.onDidChangeState(() => this.refresh());
    // Partial update for lightweight changes (active tab only)
    stateService.onDidChangeStateSilent(() => this.refreshSilent());
    // Notify tab state changes for animation
    stateService.onDidChangeTabState((tabId) => this.notifyTabStateChanged(tabId));
  }

  //= WEBVIEW LIFECYCLE

  resolveWebviewView(
    webviewView : vscode.WebviewView,
    _ctx        : vscode.WebviewViewResolveContext,
    _token      : vscode.CancellationToken,
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts      : true,
      localResourceRoots : [this._extensionUri],
    };

    webviewView.webview.onDidReceiveMessage(msg => this.handleMessage(msg));

    this.refresh();
  }

  /**
   * Reconstruye el HTML completo y lo envía al webview.
   * Pequeño debounce para evitar repintados repetidos cuando cambian muchos eventos.
   */
  refresh(): void {
    if (!this._view) { return; }
    this._fullRefreshPending = true;
    if (this._debounceTimer) { clearTimeout(this._debounceTimer); }
    this._debounceTimer = setTimeout(async () => {
      this._debounceTimer = null;
      this._fullRefreshPending = false;
      if (!this._view) { return; }

      const config       = getConfiguration();
      const groups       = this.stateService.getGroups();
      const copilotReady = this.copilotService.isAvailable();

      this._view.webview.html = await this.htmlBuilder.buildHtml(
        this._view.webview,
        groups,
        config.tabHeight,
        config.showFilePath,
        copilotReady,
        config.enableDragDrop,
        (groupId) => this.stateService.getTabsInGroup(groupId),
      );
    }, 30);
  }

  /**
   * Envía una actualización parcial al webview (solo estado activo).
   * Evita reconstruir todo el HTML cuando solo cambia la pestaña activa.
   */
  private refreshSilent(): void {
    if (!this._view || this._fullRefreshPending) { return; }

    const activeTabIds: string[] = [];
    for (const group of this.stateService.getGroups()) {
      for (const tab of this.stateService.getTabsInGroup(group.id)) {
        if (tab.state.isActive) { activeTabIds.push(tab.metadata.id); }
      }
    }

    this._view.webview.postMessage({
      type: 'updateActiveTab',
      activeTabIds,
    });
  }

  /**
   * Notifica al webview que el estado de una tab ha cambiado (diagnóstico o git status).
   * Envía el nuevo estado para actualización granular sin reconstruir el HTML.
   */
  async notifyTabStateChanged(tabId: string): Promise<void> {
    if (!this._view || this._fullRefreshPending) { return; }

    const tab = this.stateService.getTab(tabId);
    if (!tab) { return; }

    const { getStateIndicator } = await import('../utils/stateIndicator.js');
    const stateIndicator = getStateIndicator(tab);

    this._view.webview.postMessage({
      type: 'tabStateChanged',
      tabId,
      stateClass: stateIndicator.nameClass,
      stateHtml: stateIndicator.html,
    });
  }


  //= MESSAGE HANDLERS

  private async handleMessage(msg: any): Promise<void> {
    switch (msg.type) {
      case 'openTab': {
        const tab = this.findTab(msg.tabId);
        if (tab) { await tab.activate(); }
        break;
      }
      case 'closeTab': {
        const tab = this.findTab(msg.tabId);
        if (tab) { await tab.close(); }
        break;
      }
      case 'pinTab': {
        const tab = this.findTab(msg.tabId);
        if (tab) {
          await tab.pin();
          this.stateService.reorderOnPin(tab.metadata.id);
        }
        break;
      }
      case 'unpinTab': {
        const tab = this.findTab(msg.tabId);
        if (tab) {
          await tab.unpin();
          this.stateService.reorderOnUnpin(tab.metadata.id);
        }
        break;
      }
      case 'addToChat': {
        const tab = this.findTab(msg.tabId);
        if (tab) { await this.copilotService.addFileToChat(tab.metadata.uri); }
        break;
      }
      case 'contextMenu': {
        const tab = this.findTab(msg.tabId);
        if (tab) { await this.contextMenu.show(tab); }
        break;
      }
      case 'dropTab': {
        const { sourceTabId, targetTabId, insertPosition, sourceGroupId, targetGroupId } = msg;
        
        // Movimiento dentro del mismo grupo
        if (sourceGroupId === targetGroupId) {
          this.dragDropService.reorderWithinGroup(sourceTabId, targetTabId, insertPosition);
        } else {
          // Movimiento entre grupos
          await this.dragDropService.moveBetweenGroups(sourceTabId, targetGroupId, targetTabId, insertPosition);
        }
        break;
      }
      case 'fileAction': {
        const tab = this.findTab(msg.tabId);
        if (tab?.metadata.uri && msg.actionId) {
          await this.fileActionRegistry.execute(msg.actionId, tab.metadata.uri);
        }
        break;
      }
    }
  }

  private findTab(id: string): SideTab | undefined {
    return this.stateService.getTab(id);
  }
}
