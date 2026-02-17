import * as vscode from 'vscode';
import { TabIconManager } from '../services/TabIconManager';
import { SideTab }        from '../models/SideTab';
import { SideTabGroup }   from '../models/SideTabGroup';

/**
 * Builder encargado de generar el HTML/CSS del webview de tabs.
 * Separado del provider para mantener responsabilidades claras y facilitar testing.
 */
export class TabsLoverHtmlBuilder {
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly iconManager: TabIconManager,
    private readonly context: vscode.ExtensionContext,
  ) {}

  /**
   * Construye el HTML completo del webview incluyendo CSS y JavaScript.
   */
  async buildHtml(
    webview: vscode.Webview,
    groups: SideTabGroup[],
    getTabsInGroup: (groupId: number) => SideTab[],
    tabHeight: number,
    showPath: boolean,
    copilotReady: boolean,
  ): Promise<string> {
    // Get CSS URIs
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
        tabsHtml = await this.renderTabList(getTabsInGroup(groupId), tabHeight, showPath, copilotReady);
      }
    } else {
      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        const tabs = getTabsInGroup(group.id);
        tabsHtml += this.renderGroupHeader(group);
        tabsHtml += await this.renderTabList(tabs, tabHeight, showPath, copilotReady);
      }
    }

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

  private renderGroupHeader(group: SideTabGroup): string {
    const marker = group.isActive ? ' ● Active' : '';
    return `<div class="group-header">
      <span class="codicon codicon-window"></span>
      <span>${this.esc(group.label)}${marker}</span>
    </div>`;
  }

  private async renderTabList(
    tabs: SideTab[],
    tabHeight: number,
    showPath: boolean,
    copilotReady: boolean,
  ): Promise<string> {
    // Ensure pinned tabs appear first, preserving relative order within each section
    const sorted = [...tabs].sort((a, b) => {
      if (a.state.isPinned && !b.state.isPinned) { return -1; }
      if (!a.state.isPinned && b.state.isPinned) { return  1; }
      return 0; // stable sort keeps original order within pinned / unpinned
    });

    const rendered = await Promise.all(
      sorted.map(t => this.renderTab(t, tabHeight, showPath, copilotReady))
    );
    return rendered.join('');
  }

  private async renderTab(
    tab: SideTab,
    _tabHeight: number,
    showPath: boolean,
    copilotReady: boolean,
  ): Promise<string> {
    const activeClass = tab.state.isActive ? ' active' : '';

    // Estado visual del archivo (modificado)
    const dirtyDot = tab.state.isDirty
      ? '<span class="tab-state" title="Modified"><span class="codicon codicon-close-dirty"></span></span>'
      : '<span class="tab-state clean"></span>';

    // Determinar clase de estado para el nombre del archivo
    const stateClass = tab.state.isDirty ? ' modified' : '';
    const stateStyle = tab.state.isDirty 
      ? ' style="color: var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d);"' 
      : '';

    // Badge de pinned junto al nombre
    const pinBadge = tab.state.isPinned ? '<span class="pin-badge codicon codicon-pinned" title="Pinned"></span>' : '';

    // Botones de acción
    const pinBtn = tab.state.isPinned
      ? `<button data-action="unpinTab" data-tabid="${this.esc(tab.metadata.id)}" title="Unpin"><span class="codicon codicon-pin"></span></button>`
      : `<button data-action="pinTab"   data-tabid="${this.esc(tab.metadata.id)}" title="Pin"><span class="codicon codicon-pinned"></span></button>`;

    const chatBtn = copilotReady && tab.metadata.uri
      ? `<button data-action="addToChat" data-tabid="${this.esc(tab.metadata.id)}" title="Add to Copilot Chat"><span class="codicon codicon-attach"></span></button>`
      : '';

    const closeBtn = `<button data-action="closeTab" data-tabid="${this.esc(tab.metadata.id)}" title="Close"><span class="codicon codicon-remove-close"></span></button>`;

    const pathHtml = showPath && tab.metadata.description
      ? `<div class="tab-path">${this.esc(tab.metadata.description)}</div>`
      : '';

    const iconHtml = await this.getIconHtml(tab);

    return `<div class="tab${activeClass}" data-tabid="${this.esc(tab.metadata.id)}">
      <span class="tab-icon">${iconHtml}</span>
      <div class="tab-text">
        <div class="tab-name${stateClass}"${stateStyle}>${this.esc(tab.metadata.label)}${pinBadge}</div>
        ${pathHtml}
      </div>
      ${dirtyDot}
      <span class="tab-actions">
        ${pinBtn}${chatBtn}${closeBtn}
      </span>
    </div>`;
  }

  /** Escapa caracteres especiales para insertar texto de forma segura en HTML. */
  private esc(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Codicon names for built-in webview / unknown-input tabs. */
  private static readonly BUILTIN_ICON_MAP: Record<string, string> = {
    // By viewType (webview / custom editor tabs)
    'releaseNotes':                        'info',
    'simpleBrowser.view':                  'globe',
    'markdown.preview':                    'open-preview',
    'vscode.markdown.preview.editor':      'open-preview',
    'mainThreadWebview-markdown.preview':   'open-preview',
    // By label (unknown-input built-in editors)
    'Settings':                            'settings-gear',
    'Keyboard Shortcuts':                  'keyboard',
    'Welcome':                             'star-empty',
    'Getting Started':                     'star-empty',
    'Editor Playground':                   'education',
    'Running Extensions':                  'extensions',
    'Process Explorer':                    'server-process',
    'Language Models':                     'hubot',
  };

  /** Label prefixes for built-in tabs whose title is dynamic. */
  private static readonly BUILTIN_PREFIX_MAP: [string, string][] = [
    ['Extension:',      'extensions'],
    ['Walkthrough:',    'star-empty'],
    ['Release Notes:',  'info'],
    ['Preview ',        'open-preview'],
    ['[Preview] ',      'open-preview'],
  ];

  /**
   * Obtiene el HTML del icono para un tab.
   * - Tabs de archivo / diff: icono del tema activo (base64).
   * - Tabs webview / unknown: codicon correspondiente al tipo de editor.
   */
  private async getIconHtml(tab: SideTab): Promise<string> {
    const { tabType, viewType, label, uri } = tab.metadata;

    // Non-file tabs: resolve a codicon instead of a file-theme icon
    if (tabType === 'webview' || tabType === 'unknown') {
      const codicon = this.resolveBuiltInCodicon(label, viewType);
      return `<span class="codicon codicon-${codicon}"></span>`;
    }

    // For diff tabs, resolve the icon from the underlying file name (strip the URI basename)
    const fileName = tabType === 'diff' && uri
      ? uri.path.split('/').pop() || label
      : label;

    if (!fileName) {
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
      console.warn(`[TabsLover] Icon resolution failed for ${fileName}:`, error);
    }

    return this.getFallbackIcon();
  }

  /**
   * Resolves a codicon name for a built-in (non-file) tab.
   * Tries viewType first, then exact label, then label prefix.
   */
  private resolveBuiltInCodicon(label: string, viewType?: string): string {
    // 1. Match by viewType
    if (viewType) {
      const byView = TabsLoverHtmlBuilder.BUILTIN_ICON_MAP[viewType];
      if (byView) { return byView; }
    }

    // 2. Match by exact label
    const byLabel = TabsLoverHtmlBuilder.BUILTIN_ICON_MAP[label];
    if (byLabel) { return byLabel; }

    // 3. Match by label prefix
    for (const [prefix, icon] of TabsLoverHtmlBuilder.BUILTIN_PREFIX_MAP) {
      if (label.startsWith(prefix)) { return icon; }
    }

    // 4. Generic fallback
    return 'preview';
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
