import * as vscode from 'vscode';
import { TabIconManager }        from '../services/TabIconManager';
import { SideTab }               from '../models/SideTab';
import { SideTabGroup }          from '../models/SideTabGroup';
import { FileActionRegistry }    from '../services/FileActionRegistry';
import { getStateIndicator }     from '../utils/stateIndicator';
import { resolveBuiltInCodicon } from '../utils/builtinIcons';
import { getDragDropScript }     from '../webview/dragDropScript';
import { getWebviewScript }      from '../webview/webviewScript';

/**
 * Builder encargado de generar el HTML/CSS del webview de tabs.
 * Separado del provider para mantener responsabilidades claras y facilitar testing.
 *
 * Lógica de presentación delegada a módulos específicos:
 *  - getStateIndicator()    → utils/stateIndicator.ts
 *  - resolveBuiltInCodicon() → utils/builtinIcons.ts
 *  - getWebviewScript()     → webview/webviewScript.ts
 *  - getDragDropScript()    → webview/dragDropScript.ts
 */
export class TabsLoverHtmlBuilder {
  constructor(
    private readonly extensionUri     : vscode.Uri,
    private readonly iconManager      : TabIconManager,
    private readonly context          : vscode.ExtensionContext,
    private readonly fileActionRegistry?: FileActionRegistry,
  ) {}

  // ─────────────────────────── HTML principal ──────────────────────────────────

  async buildHtml(
    webview        : vscode.Webview,
    groups         : SideTabGroup[],
    getTabsInGroup : (groupId: number) => SideTab[],
    tabHeight      : number,
    showPath       : boolean,
    copilotReady   : boolean,
    enableDragDrop : boolean = false,
  ): Promise<string> {
    const codiconCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css')
    );
    const webviewCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'src', 'styles', 'webview.css')
    );

    let tabsHtml = '';

    if (groups.length <= 1) {
      const groupId = groups[0]?.id;
      if (groupId !== undefined) {
        tabsHtml = await this.renderTabList(getTabsInGroup(groupId), tabHeight, showPath, copilotReady, enableDragDrop);
      }
    } else {
      for (const group of groups) {
        tabsHtml += this.renderGroupHeader(group);
        tabsHtml += await this.renderTabList(getTabsInGroup(group.id), tabHeight, showPath, copilotReady, enableDragDrop);
      }
    }

    const script = getWebviewScript(enableDragDrop ? getDragDropScript() : '');

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<link href="${codiconCssUri}" rel="stylesheet" />
<link href="${webviewCssUri}" rel="stylesheet" />
</head>
<body>
  ${tabsHtml || '<div class="empty">No open tabs</div>'}
  <script>${script}</script>
</body>
</html>`;
  }

  // ─────────────────────────── Renderizado ─────────────────────────────────────

  private renderGroupHeader(group: SideTabGroup): string {
    const marker = group.isActive ? ' ● Active' : '';
    return `<div class="group-header">
      <span class="codicon codicon-window"></span>
      <span>${this.esc(group.label)}${marker}</span>
    </div>`;
  }

  private async renderTabList(
    tabs          : SideTab[],
    tabHeight     : number,
    showPath      : boolean,
    copilotReady  : boolean,
    enableDragDrop: boolean = false,
  ): Promise<string> {
    // Pinned tabs first, stable order within each section
    const sorted = [...tabs].sort((a, b) => {
      if ( a.state.isPinned && !b.state.isPinned) { return -1; }
      if (!a.state.isPinned &&  b.state.isPinned) { return  1; }
      return 0;
    });

    const rendered = await Promise.all(
      sorted.map(t => this.renderTab(t, tabHeight, showPath, copilotReady, enableDragDrop))
    );
    return rendered.join('');
  }

  private async renderTab(
    tab           : SideTab,
    _tabHeight    : number,
    showPath      : boolean,
    copilotReady  : boolean,
    _enableDragDrop: boolean = false,
  ): Promise<string> {
    const activeClass    = tab.state.isActive  ? ' active' : '';
    const dataPinned     = `data-pinned="${tab.state.isPinned}"`;
    const dataGroupId    = `data-groupid="${tab.state.groupId}"`;
    const stateIndicator = getStateIndicator(tab);

    const pinBadge  = tab.state.isPinned
      ? '<span class="pin-badge codicon codicon-pinned" title="Pinned"></span>'
      : '';

    const fileActionBtn = this.renderFileActionButton(tab);

    const chatBtn = copilotReady && tab.metadata.uri
      ? `<button data-action="addToChat" data-tabid="${this.esc(tab.metadata.id)}" title="Add to Copilot Chat"><span class="codicon codicon-attach"></span></button>`
      : '';

    const closeBtn = `<button data-action="closeTab" data-tabid="${this.esc(tab.metadata.id)}" title="Close"><span class="codicon codicon-remove-close"></span></button>`;

    const pathHtml = showPath && tab.metadata.description
      ? `<div class="tab-path">${this.esc(tab.metadata.description)}</div>`
      : '';

    const iconHtml = await this.getIconHtml(tab);

    return `<div class="tab${activeClass}" data-tabid="${this.esc(tab.metadata.id)}" ${dataPinned} ${dataGroupId}>
      <span class="tab-icon">${iconHtml}</span>
      <div class="tab-text">
        <div class="tab-name${stateIndicator.nameClass}">${this.esc(tab.metadata.label)}${pinBadge}</div>
        ${pathHtml}
      </div>
      ${stateIndicator.html}
      <span class="tab-actions">
        ${fileActionBtn}${chatBtn}${closeBtn}
      </span>
    </div>`;
  }

  // ─────────────────────────── Iconos ──────────────────────────────────────────

  private async getIconHtml(tab: SideTab): Promise<string> {
    const { tabType, viewType, label, uri } = tab.metadata;

    if (tabType === 'webview' || tabType === 'unknown') {
      return `<span class="codicon codicon-${resolveBuiltInCodicon(label, viewType)}"></span>`;
    }

    const fileName = (tabType === 'diff' && uri)
      ? uri.path.split('/').pop() || label
      : label;

    if (!fileName) { return this.getFallbackIcon(); }

    try {
      const cached = this.iconManager.getCachedIcon(fileName);
      if (cached) { return `<img src="${cached}" alt="" />`; }

      const base64 = await this.iconManager.getFileIconAsBase64(fileName, this.context);
      if (base64)  { return `<img src="${base64}" alt="" />`; }
    } catch (error) {
      console.warn(`[TabsLover] Icon resolution failed for ${fileName}:`, error);
    }

    return this.getFallbackIcon();
  }

  private getFallbackIcon(): string {
    return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 1h7l3 3v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1" fill="none"/>
      <path d="M10 1v3h3" stroke="currentColor" stroke-width="1" fill="none"/>
    </svg>`;
  }

  // ─────────────────────────── Botones de acción ───────────────────────────────

  private renderFileActionButton(tab: SideTab): string {
    if (!this.fileActionRegistry || !tab.metadata.uri) { return ''; }

    const resolved = this.fileActionRegistry.resolve(tab.metadata.label, tab.metadata.uri);
    if (!resolved) { return ''; }

    return `<button data-action="fileAction" data-tabid="${this.esc(tab.metadata.id)}" data-actionid="${this.esc(resolved.id)}" title="${this.esc(resolved.tooltip)}"><span class="codicon codicon-${this.esc(resolved.icon)}"></span></button>`;
  }

  // ─────────────────────────── Utilidades ──────────────────────────────────────

  /** Escapa caracteres especiales para insertar texto de forma segura en HTML. */
  private esc(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

