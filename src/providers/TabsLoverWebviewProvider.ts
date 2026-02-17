import * as vscode from 'vscode';
import { TabStateService }          from '../services/TabStateService';
import { TabIconManager }           from '../services/TabIconManager';
import { CopilotService }           from '../services/CopilotService';
import { TabDragDropService }       from '../services/TabDragDropService';
import { FileActionRegistry }      from '../services/FileActionRegistry';
import { SideTab }                  from '../models/SideTab';
import { getConfiguration }         from '../constants/styles';
import { TabsLoverHtmlBuilder }     from './TabsLoverHtmlBuilder';

/**
 * Proveedor del Webview que coordina la vista de pestañas.
 * Gestiona el ciclo de vida del webview, mensajes y eventos.
 * La generación de HTML se delega a `TabsLoverHtmlBuilder`.
 */
export class TabsLoverWebviewProvider implements vscode.WebviewViewProvider { 
  public static readonly viewType = 'tabsLover';

  private _view?: vscode.WebviewView;
  private _refreshScheduled = false;
  private readonly htmlBuilder: TabsLoverHtmlBuilder;

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
    // Re-render on every state change
    stateService.onDidChangeState(() => this.refresh());
    stateService.onDidChangeStateSilent(() => this.refresh());
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
    if (!this._view || this._refreshScheduled) { return; }
    this._refreshScheduled = true;
    // Micro-debounce: coalesce rapid-fire events within the same tick
    setTimeout(async () => {
      this._refreshScheduled = false;
      if (!this._view) { return; }

      const config       = getConfiguration();
      const groups       = this.stateService.getGroups();
      const copilotReady = this.copilotService.isAvailable();

      this._view.webview.html = await this.htmlBuilder.buildHtml(
        this._view.webview,
        groups,
        (groupId) => this.stateService.getTabsInGroup(groupId),
        config.tabHeight,
        config.showFilePath,
        copilotReady,
        config.enableDragDrop,
      );
    }, 0);
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
        if (tab) { await this.showContextMenu(tab); }
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

  //= CONTEXT MENU

  private async showContextMenu(tab: SideTab): Promise<void> {
    const hasUri = !!tab.metadata.uri;
    const hasMultipleGroups = this.stateService.getGroups().length > 1;
    const items: vscode.QuickPickItem[] = [
      { label: '$(close)  Close' },
      { label: '$(close-all)  Close Others' },
      { label: '$(close-all)  Close to the Right' },
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      { label: tab.state.isPinned ? '$(pin)  Unpin' : '$(pinned)  Pin' },
    ];

    if (hasMultipleGroups) {
      items.push(
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        { label: '$(close-all)  Close Group' },
      );
    }

    if (hasUri) {
      items.push(
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        { label: '$(files)  Reveal in Explorer View' },
        { label: '$(folder-opened)  Reveal in File Explorer' },
        { label: '$(history)  Open Timeline' },
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        { label: '$(clippy)  Copy Relative Path' },
        { label: '$(copy)  Copy Path' },
        { label: '$(copy)  Copy File Contents' },
        { label: '$(files)  Duplicate File' },
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        { label: '$(diff)  Compare with Active Editor' },
        { label: '$(git-compare)  Open Changes' },
        { label: '$(split-horizontal)  Split Right' },
        { label: '$(multiple-windows)  Move to New Window' },
      );
    }

    if (hasUri && this.copilotService.isAvailable()) {
      items.push(
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        { label: '$(attach)  Add to Copilot Chat' },
      );
    }

    const pick = await vscode.window.showQuickPick(items, { placeHolder: tab.metadata.label });
    if (!pick) { return; }

    const label = pick.label;
    if      (label.includes('Close Others'))              { await tab.closeOthers(); }
    else if (label.includes('Close to the Right'))        { await tab.closeToRight(); }
    else if (label.includes('Close Group'))               { await tab.closeGroup(); }
    else if (label.includes('Close'))                     { await tab.close(); }
    else if (label.includes('Unpin'))                     { await tab.unpin();  this.stateService.reorderOnUnpin(tab.metadata.id); }
    else if (label.includes('Pin'))                       { await tab.pin();    this.stateService.reorderOnPin(tab.metadata.id); }
    else if (label.includes('Reveal in Explorer View'))   { await tab.revealInExplorerView(); }
    else if (label.includes('Reveal in File Explorer'))   { await tab.revealInFileExplorer(); }
    else if (label.includes('Open Timeline'))             { await tab.openTimeline(); }
    else if (label.includes('Copy Relative Path'))        { await tab.copyRelativePath(); }
    else if (label.includes('Copy Path'))                 { await tab.copyPath(); }
    else if (label.includes('Copy File Contents'))        { await tab.copyFileContents(); }
    else if (label.includes('Duplicate File'))            { await tab.duplicateFile(); }
    else if (label.includes('Compare'))                   { await tab.compareWithActive(); }
    else if (label.includes('Open Changes'))              { await tab.openChanges(); }
    else if (label.includes('Split Right'))               { await tab.splitRight(); }
    else if (label.includes('Move to New Window'))        { await tab.moveToNewWindow(); }
    else if (label.includes('Add to Copilot Chat'))       { await this.copilotService.addFileToChat(tab.metadata.uri); }
  }
}
