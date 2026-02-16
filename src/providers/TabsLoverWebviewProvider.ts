import * as vscode from 'vscode';
import { TabStateService }          from '../services/TabStateService';
import { TabIconManager }           from '../services/TabIconManager';
import { CopilotService }           from '../services/CopilotService';
import { SideTab }                   from '../models/SideTab';
import { SideTabGroup }              from '../models/SideTabGroup';
import { getConfiguration }          from '../constants/styles';

/**
 * Proveedor del Webview que dibuja la lista vertical de pestañas.
 * ¿Qué hace, explicado fácil?
 * - Toma el estado interno y lo convierte en HTML/CSS para mostrar la UI.
 * - Muestra nombre, ruta, icono y botones de acción; envía eventos al host.
 * - Usa iconos en base64 para evitar parpadeos y depende del `TabStateService`.
 */
export class TabsLoverWebviewProvider implements vscode.WebviewViewProvider { 
  public static readonly viewType = 'tabsLover';

  private _view?: vscode.WebviewView;
  private _refreshScheduled = false;

  constructor(
    private readonly _extensionUri  : vscode.Uri,
    private readonly stateService   : TabStateService,
    private readonly copilotService : CopilotService,
    private readonly iconManager    : TabIconManager,
    private readonly context        : vscode.ExtensionContext,
  ) {
    // Re-render on every state change
    stateService.onDidChangeState(() => this.refresh());
    stateService.onDidChangeStateSilent(() => this.refresh());
  }

  /* ------------------------------------------------------------------ */
  /*  Lifecycle                                                          */
  /* ------------------------------------------------------------------ */

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _ctx: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
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
      this._view.webview.html = await this.buildHtml();
    }, 0);
  }

  /* ------------------------------------------------------------------ */
  /*  Message handling (webview → extension)                             */
  /* ------------------------------------------------------------------ */

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
        if (tab) { await tab.pin(); }
        break;
      }
      case 'unpinTab': {
        const tab = this.findTab(msg.tabId);
        if (tab) { await tab.unpin(); }
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
    }
  }

  private findTab(id: string): SideTab | undefined {
    return this.stateService.getTab(id);
  }

  /* ------------------------------------------------------------------ */
  /*  Context menu                                                       */
  /* ------------------------------------------------------------------ */

  private async showContextMenu(tab: SideTab): Promise<void> {
    const hasUri = !!tab.metadata.uri;
    const items: vscode.QuickPickItem[] = [
      { label: '$(close)  Close' },
      { label: '$(close-all)  Close Others' },
      { label: '$(close-all)  Close to the Right' },
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      { label: tab.state.isPinned ? '$(pin)  Unpin' : '$(pinned)  Pin' },
    ];

    if (hasUri) {
      items.push(
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        { label: '$(go-to-file)  Reveal in Explorer' },
        { label: '$(clippy)  Copy Relative Path' },
        { label: '$(copy)  Copy File Contents' },
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        { label: '$(diff)  Compare with Active Editor' },
      );
    }

    if (hasUri && this.copilotService.isAvailable()) {
      items.push(
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        { label: '$(add)  Add to Copilot Chat' },
      );
    }

    const pick = await vscode.window.showQuickPick(items, { placeHolder: tab.metadata.label });
    if (!pick) { return; }

    const label = pick.label;
    if      (label.includes('Close Others'))          { await tab.closeOthers(); }
    else if (label.includes('Close to the Right'))    { await tab.closeToRight(); }
    else if (label.includes('Close'))                 { await tab.close(); }
    else if (label.includes('Unpin'))                 { await tab.unpin(); }
    else if (label.includes('Pin'))                   { await tab.pin(); }
    else if (label.includes('Reveal'))                { await tab.revealInExplorer(); }
    else if (label.includes('Copy Relative Path'))    { await tab.copyRelativePath(); }
    else if (label.includes('Copy File Contents'))    { await tab.copyFileContents(); }
    else if (label.includes('Compare'))               { await tab.compareWithActive(); }
    else if (label.includes('Add to Copilot Chat'))   { await this.copilotService.addFileToChat(tab.metadata.uri); }
  }

  /* ------------------------------------------------------------------ */
  /*  HTML builder                                                       */
  /* ------------------------------------------------------------------ */

  private async buildHtml(): Promise<string> {
    const config        = getConfiguration();
    const groups        = this.stateService.getGroups();
    const copilotReady  = this.copilotService.isAvailable();
    const tabHeight     = config.tabHeight;
    const showPath      = config.showFilePath;

    let tabsHtml = '';

    if (groups.length <= 1) {
      const groupId = groups[0]?.id;
      if (groupId !== undefined) {
        tabsHtml = await this.renderTabList(this.stateService.getTabsInGroup(groupId), tabHeight, showPath, copilotReady);
      }
    } else {
      for (const group of groups) {
        const tabs = this.stateService.getTabsInGroup(group.id);
        tabsHtml += this.renderGroupHeader(group);
        tabsHtml += await this.renderTabList(tabs, tabHeight, showPath, copilotReady);
      }
    }

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>
  /* ===== Reset ===== */
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    font-family: var(--vscode-font-family);
    font-size:   var(--vscode-font-size);
    color:       var(--vscode-foreground);
    background:  var(--vscode-sideBar-background, var(--vscode-editor-background));
    overflow-x:  hidden;
    user-select: none;
    border-top: 1px solid var(--vscode-editorGroupHeader-tabsBorder, var(--vscode-panel-border, rgba(128,128,128,0.35)));
  }

  /* ===== Group header ===== */
  .group-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground));
    background: var(--vscode-sideBarSectionHeader-background, transparent);
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, transparent);
  }

  /* ===== Tab row ===== */
  .tab {
    display: flex;
    align-items: center;
    height: ${tabHeight}px;
    padding: 0 8px 0 0;
    cursor: pointer;
    position: relative;
    border-left: 4px solid transparent;
    border-bottom: 1px solid var(--vscode-editorGroupHeader-tabsBorder, var(--vscode-panel-border, rgba(128,128,128,0.35)));
    transition: background 80ms ease;
  }
  .tab:hover {
    background: var(--vscode-list-hoverBackground);
  }
  .tab.active {
    border-left-color: var(--vscode-focusBorder, var(--vscode-activityBar-activeBorder, #007acc));
    background: var(--vscode-list-activeSelectionBackground);
    color:      var(--vscode-list-activeSelectionForeground, var(--vscode-foreground));
  }

  /* Icon area — fixed width to prevent shifts */
  .tab-icon {
    flex: 0 0 28px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .tab-icon img {
    width: 16px;
    height: 16px;
    object-fit: contain;
  }

  /* Text block (name + path stacked) */
  .tab-text {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    line-height: 1.3;
    overflow: hidden;
  }
  .tab-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 13px;
  }
  .tab-path {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 11px;
    opacity: 0.6;
    margin-top: 1px;
  }

  /* State dot (isDirty) — sits at the right edge */
  .tab-state {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    font-size: 16px;
    color: var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d);
  }
  /* Hide dirty dot on hover (replaced by close) */
  .tab:hover .tab-state { display: none; }
  /* When not dirty and not hovered, keep placeholder width */
  .tab-state.clean { visibility: hidden; }

  /* ===== Action buttons ===== */
  .tab-actions {
    flex: 0 0 auto;
    display: none;          /* hidden by default */
    align-items: center;
    gap: 2px;
  }
  .tab:hover .tab-actions { display: flex; }

  .tab-actions button {
    background: transparent;
    border: none;
    color: var(--vscode-icon-foreground, var(--vscode-foreground));
    cursor: pointer;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    padding: 0;
    line-height: 1;
  }
  .tab-actions button:hover {
    background: var(--vscode-toolbar-hoverBackground, rgba(90,93,94,0.31));
  }

  /* Pinned indicator on the name */
  .tab-name .pin-badge {
    font-size: 11px;
    margin-left: 4px;
    opacity: 0.7;
  }

  /* Icon support */
  .icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }

  /* ===== Empty state ===== */
  .empty {
    padding: 16px;
    text-align: center;
    opacity: 0.6;
    font-size: 12px;
  }
</style>
</head>
<body>
  ${tabsHtml || '<div class="empty">No open tabs</div>'}
  <script>
    const vscode = acquireVsCodeApi();

    document.addEventListener('click', e => {
      const btn = e.target.closest('button[data-action]');
      if (btn) {
        e.stopPropagation();
        vscode.postMessage({ type: btn.dataset.action, tabId: btn.dataset.tabid });
        return;
      }
      const tab = e.target.closest('.tab');
      if (tab) {
        vscode.postMessage({ type: 'openTab', tabId: tab.dataset.tabid });
      }
    });

    document.addEventListener('contextmenu', e => {
      const tab = e.target.closest('.tab');
      if (tab) {
        e.preventDefault();
        vscode.postMessage({ type: 'contextMenu', tabId: tab.dataset.tabid });
      }
    });
  </script>
</body>
</html>`;
  }

  /* ------------------------------------------------------------------ */
  /*  Partial renderers                                                  */
  /* ------------------------------------------------------------------ */

  private renderGroupHeader(group: SideTabGroup): string {
    const marker = group.isActive ? ' ● Active' : '';
    return `<div class="group-header">
      <span class="icon">▢</span>
      <span>${this.esc(group.label)}${marker}</span>
    </div>`;
  }

  private async renderTabList(
    tabs       : SideTab[],
    tabHeight  : number,
    showPath   : boolean,
    copilotReady: boolean,
  ): Promise<string> {
    const rendered = await Promise.all(
      tabs.map(t => this.renderTab(t, tabHeight, showPath, copilotReady))
    );
    return rendered.join('');
  }

  private async renderTab(
    tab        : SideTab,
    _tabHeight : number,
    showPath   : boolean,
    copilotReady: boolean,
  ): Promise<string> {
    const activeClass = tab.state.isActive ? ' active' : '';
    const dirtyDot    = tab.state.isDirty
      ? '<span class="tab-state" title="Modified">●</span>'
      : '<span class="tab-state clean"></span>';

    const pinBadge = tab.state.isPinned ? '<span class="pin-badge icon" title="Pinned">📌</span>' : '';

    const pinBtn = tab.state.isPinned
      ? `<button data-action="unpinTab" data-tabid="${this.esc(tab.metadata.id)}" title="Unpin"><span class="icon">📌</span></button>`
      : `<button data-action="pinTab"   data-tabid="${this.esc(tab.metadata.id)}" title="Pin"><span class="icon">📍</span></button>`;

    const chatBtn = copilotReady
      ? `<button data-action="addToChat" data-tabid="${this.esc(tab.metadata.id)}" title="Add to Copilot Chat"><span class="icon">➕</span></button>`
      : '';

    const closeBtn = `<button data-action="closeTab" data-tabid="${this.esc(tab.metadata.id)}" title="Close"><span class="icon">✕</span></button>`;

    const pathHtml = showPath && tab.metadata.description
      ? `<div class="tab-path">${this.esc(tab.metadata.description)}</div>`
      : '';

    const iconHtml = await this.getIconHtml(tab);

    return `<div class="tab${activeClass}" data-tabid="${this.esc(tab.metadata.id)}">
      <span class="tab-icon">${iconHtml}</span>
      <div class="tab-text">
        <div class="tab-name">${this.esc(tab.metadata.label)}${pinBadge}</div>
        ${pathHtml}
      </div>
      ${dirtyDot}
      <span class="tab-actions">
        ${pinBtn}${chatBtn}${closeBtn}
      </span>
    </div>`;
  }

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                            */
  /* ------------------------------------------------------------------ */

  /** Escapa caracteres especiales para insertar texto de forma segura en HTML. */
  private esc(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Obtiene el HTML del icono para un archivo (image `data:` base64 o SVG de respaldo).
   * Nunca usamos emojis: preferimos los iconos del tema para mantener coherencia visual.
   */
  private async getIconHtml(tab: SideTab): Promise<string> {
    const fileName = tab.metadata.label;

    // For non-file tabs (Settings, Extensions, etc.) use a generic icon
    if (!fileName || tab.metadata.tabType === 'webview') {
      return this.getFallbackIcon();
    }

    try {
      // Try cached icon first (synchronous, no I/O)
      const cached = this.iconManager.getCachedIcon(fileName);
      if (cached) {
        return `<img src="${cached}" alt="" />`;
      }

      // Resolver desde el tema de iconos (async — lee disco una sola vez y cachea)
      const base64 = await this.iconManager.getFileIconAsBase64(
        fileName,
        this.context,
      );

      if (base64) {
        return `<img src="${base64}" alt="" />`;
      }
    } catch (error) {
      // Falló la resolución del icono — usar el fallback
      console.warn(`[TabsLover] Icon resolution failed for ${fileName}:`, error);
    }

    // Fallback: SVG inline mínimo para el icono de archivo (sin emojis)
    return this.getFallbackIcon();
  }

  private getFallbackIcon(): string {
    return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"
      xmlns="http://www.w3.org/2000/svg">
      <path d="M3 1h7l3 3v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z"
        stroke="currentColor" stroke-width="1" fill="none"/>
      <path d="M10 1v3h3" stroke="currentColor" stroke-width="1" fill="none"/>
    </svg>`;
  }
}
