/**
 * Builder encargado de generar el HTML/CSS del webview de tabs.
 * Orquesta los módulos especializados para renderizado.
 *
 * Arquitectura:
 *  - IconRenderer   → renderizado de iconos (font/base64/codicon)
 *  - StylesBuilder  → CSS crítico y CSP
 *  - types.ts       → tipos compartidos
 */

import * as vscode from 'vscode';
import { TabIconManager } from '../services/ui/TabIconManager';
import { SideTab } from '../models/SideTab';
import { SideTabGroup } from '../models/SideTabGroup';
import { FileActionRegistry } from '../services/registry/FileActionRegistry';
import { getStateIndicator } from '../utils/stateIndicator';
import { IconRenderer, StylesBuilder, BuildHtmlOptions, WebviewResourceUris } from './html';

export class TabsLoverHtmlBuilder {
  private readonly iconRenderer: IconRenderer;
  private readonly stylesBuilder: StylesBuilder;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly iconManager: TabIconManager,
    private readonly context: vscode.ExtensionContext,
    private readonly fileActionRegistry?: FileActionRegistry,
  ) {
    this.iconRenderer = new IconRenderer(iconManager, context);
    this.stylesBuilder = new StylesBuilder();
  }

  //= HTML PRINCIPAL

  /**
   * Construye el HTML completo del webview.
   */
  async buildHtml(options: BuildHtmlOptions): Promise<string> {
    const {
      webview,
      groups: grps,
      getTabsInGroup: getTabs,
      showPath: path,
      copilotReady: copilot,
      enableDragDrop: dragDrop = false,
      compactMode,
      workspaceName,
    } = options;

    const uris = this.resolveResourceUris(webview, dragDrop);
    const nonce = this.generateNonce();
    const tabsHtml = await this.renderAllTabs(grps, getTabs, path, copilot, dragDrop, compactMode);

    return this.assembleHtml(webview, uris, nonce, workspaceName, compactMode, tabsHtml, dragDrop);
  }

  //= RESOLUCIÓN DE RECURSOS

  private resolveResourceUris(webview: vscode.Webview, enableDragDrop: boolean): WebviewResourceUris {
    const asUri = (segments: string[]) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, ...segments));

    return {
      codiconCss: asUri(['dist', 'codicons', 'codicon.css']),
      webviewCss: asUri(['dist', 'styles', 'webview.css']),
      webviewScript: asUri(['dist', 'webview', 'webview.js']),
      dragDropScript: enableDragDrop ? asUri(['dist', 'webview', 'dragdrop.js']) : null,
    };
  }

  //= ENSAMBLAJE HTML

  private assembleHtml(
    webview: vscode.Webview,
    uris: WebviewResourceUris,
    nonce: string,
    workspaceName: string,
    compactMode: boolean,
    tabsHtml: string,
    enableDragDrop: boolean,
  ): string {
    const csp = this.stylesBuilder.buildCSP(webview, nonce);

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link href="${uris.codiconCss}" rel="stylesheet" />
<link href="${uris.webviewCss}" rel="stylesheet" />
</head>
<body>
  ${tabsHtml || '<div class="empty">No open tabs</div>'}
  <script nonce="${nonce}" src="${uris.webviewScript}"></script>
  ${uris.dragDropScript ? `<script nonce="${nonce}" src="${uris.dragDropScript}"></script>` : ''}
</body>
</html>`;
  }

  //= RENDERIZADO DE TABS

  private async renderAllTabs(
    groups: SideTabGroup[],
    getTabsInGroup: (groupId: number) => SideTab[],
    showPath: boolean,
    copilotReady: boolean,
    enableDragDrop: boolean,
    compactMode: boolean,
  ): Promise<string> {
    if (groups.length <= 1) {
      const groupId = groups[0]?.id;
      if (groupId !== undefined) {
        return this.renderTabList(getTabsInGroup(groupId), showPath, copilotReady, enableDragDrop, compactMode);
      }
      return '';
    }

    let html = '';
    for (const group of groups) {
      html += this.renderGroupHeader(group);
      html += await this.renderTabList(getTabsInGroup(group.id), showPath, copilotReady, enableDragDrop, compactMode);
    }
    return html;
  }

  private renderGroupHeader(group: SideTabGroup): string {
    const marker = group.isActive ? ' ●' : '';
    return `<div class="group-header" data-groupid="${group.id}">
      <span class="codicon codicon-files group-icon"></span>
      <span class="group-label">${this.esc(group.label)}${marker}</span>
      <span class="group-actions">
        <button class="group-btn" data-action="closeGroup" data-groupid="${group.id}" title="Close Group"><span class="codicon codicon-close-all"></span></button>
        <button class="group-btn" data-action="toggleGroup" data-groupid="${group.id}" title="Collapse/Expand"><span class="codicon codicon-fold-down"></span></button>
      </span>
    </div>`;
  }

  private async renderTabList(
    tabs: SideTab[],
    showPath: boolean,
    copilotReady: boolean,
    enableDragDrop: boolean,
    compactMode: boolean,
  ): Promise<string> {
    // Separate parent tabs (no parentId) from child tabs (have parentId)
    const parentTabs = tabs.filter(t => !t.metadata.parentId);
    const childTabs = tabs.filter(t => t.metadata.parentId);
    
    // Build a map of parentId -> children
    const childrenByParent = new Map<string, SideTab[]>();
    for (const child of childTabs) {
      const parentId = child.metadata.parentId!;
      if (!childrenByParent.has(parentId)) {
        childrenByParent.set(parentId, []);
      }
      childrenByParent.get(parentId)!.push(child);
    }
    
    // Sort parent tabs: pinned first
    const sortedParents = [...parentTabs].sort((a, b) => {
      if (a.state.isPinned && !b.state.isPinned) { return -1; }
      if (!a.state.isPinned && b.state.isPinned) { return 1; }
      return 0;
    });

    // Render parents with their children immediately after
    const rendered: string[] = [];
    for (const parent of sortedParents) {
      // Render parent
      rendered.push(await this.renderTab(parent, showPath, copilotReady, enableDragDrop, compactMode));
      
      // Render children (always compact, no path, attached to parent)
      const children = childrenByParent.get(parent.metadata.id) || [];
      for (const child of children) {
        rendered.push(await this.renderChildTab(child, copilotReady, parent));
      }
    }
    
    // Render orphan child tabs (their parent file tab is not open)
    // These are shown as regular compact tabs with indication they're diffs
    for (const child of childTabs) {
      if (!parentTabs.some(p => p.metadata.id === child.metadata.parentId)) {
        rendered.push(await this.renderOrphanChildTab(child, showPath, copilotReady, compactMode));
      }
    }
    
    return rendered.join('');
  }

  /**
   * Renders a child tab (diff) attached to its parent.
   * Always compact, indented, no path shown.
   */
  private async renderChildTab(
    tab: SideTab,
    copilotReady: boolean,
    parent: SideTab,
  ): Promise<string> {
    const activeClass = tab.state.isActive ? ' active' : '';
    const dataGroupId = `data-groupid="${tab.state.groupId}"`;
    const dataParentId = `data-parentid="${this.esc(parent.metadata.id)}"`;
    
    // Determine icon based on diffType and parent state
    let iconHtml = '<span class="codicon codicon-diff"></span>'; // Default
    if (tab.metadata.diffType) {
      switch (tab.metadata.diffType) {
        case 'working-tree':
          iconHtml = '<span class="codicon codicon-worktree"></span>';
          break;
        case 'staged':
          iconHtml = '<span class="codicon codicon-git-stage"></span>';
          break;
        case 'snapshot':
          iconHtml = '<span class="codicon codicon-history"></span>';
          break;
        case 'merge-conflict':
          iconHtml = '<span class="codicon codicon-git-merge"></span>';
          break;
        case 'incoming':
          iconHtml = '<span class="codicon codicon-arrow-down"></span>';
          break;
        case 'current':
          iconHtml = '<span class="codicon codicon-arrow-right"></span>';
          break;
        case 'incoming-current':
          iconHtml = '<span class="codicon codicon-git-pull-request"></span>';
          break;
      }
    }
    
    // Build diff stats display
    let statsHtml = '';
    if (tab.state.diffStats) {
      const stats = tab.state.diffStats;
      if (stats.linesAdded !== undefined && stats.linesRemoved !== undefined) {
        // Working tree / staged: show +/- lines
        statsHtml = `<span class="child-stats" title="${stats.linesAdded} lines added, ${stats.linesRemoved} lines removed">
          <span class="stats-added">+${stats.linesAdded}</span>
          <span class="stats-removed">-${stats.linesRemoved}</span>
        </span>`;
      } else if (stats.timestamp) {
        // Snapshot: show relative time
        const date = new Date(stats.timestamp);
        const relativeTime = this.formatRelativeTime(stats.timestamp);
        statsHtml = `<span class="child-stats" title="${date.toLocaleString()}">${relativeTime}</span>`;
      } else if (stats.conflictSections) {
        // Merge conflict: show conflict count
        statsHtml = `<span class="child-stats conflict" title="${stats.conflictSections} conflict sections">${stats.conflictSections} conflicts</span>`;
      }
    }
    
    // Show inherited state indicator (errors/warnings from parent)
    let stateIconHtml = '';
    if (tab.state.diagnosticSeverity === 0) {
      stateIconHtml = '<span class="codicon codicon-error state-indicator-error"></span>';
    } else if (tab.state.diagnosticSeverity === 1) {
      stateIconHtml = '<span class="codicon codicon-warning state-indicator-warning"></span>';
    } else if (tab.state.gitStatus === 'conflict') {
      stateIconHtml = '<span class="codicon codicon-diff-ignored state-indicator-conflict"></span>';
    }

    const closeBtn = tab.state.capabilities.canClose
      ? `<button data-action="closeTab" data-tabid="${this.esc(tab.metadata.id)}" title="Close"><span class="codicon codicon-remove-close"></span></button>`
      : '';

    return `<div class="tab child-tab${activeClass}" data-tabid="${this.esc(tab.metadata.id)}" data-pinned="false" ${dataGroupId} ${dataParentId}>
      <span class="tab-icon">${iconHtml}</span>
      <div class="child-label">
        <span class="child-name">${this.esc(tab.metadata.label)}</span>
        ${statsHtml}
      </div>
      ${stateIconHtml}
      <span class="tab-actions">
        ${closeBtn}
      </span>
    </div>`;
  }

  /**
   * Formats a timestamp as relative time (e.g., "2 hours ago")
   */
  private formatRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
      return `${days}d ago`;
    }
    if (hours > 0) {
      return `${hours}h ago`;
    }
    if (minutes > 0) {
      return `${minutes}m ago`;
    }
    return 'just now';
  }

  /**
   * Renders an orphan child tab (diff whose parent file is not open).
   * Shown with full info since there's no parent context.
   */
  private async renderOrphanChildTab(
    tab: SideTab,
    showPath: boolean,
    copilotReady: boolean,
    compactMode: boolean,
  ): Promise<string> {
    // Render like a normal tab but with diff icon prefix
    return this.renderTab(tab, showPath, copilotReady, false, compactMode);
  }

  private async renderTab(
    tab: SideTab,
    showPath: boolean,
    copilotReady: boolean,
    _enableDragDrop: boolean,
    compactMode: boolean,
  ): Promise<string> {
    const activeClass = tab.state.isActive ? ' active' : '';
    const dataPinned = `data-pinned="${tab.state.isPinned}"`;
    const dataGroupId = `data-groupid="${tab.state.groupId}"`;
    const stateIndicator = getStateIndicator(tab);

    const pinBadge = tab.state.isPinned
      ? '<span class="pin-badge codicon codicon-pinned" title="Pinned"></span>'
      : '';

    const fileActionBtn = tab.state.capabilities.canTogglePreview
      ? this.renderFileActionButton(tab)
      : '';

    const chatBtn = copilotReady && tab.metadata.uri
      ? `<button data-action="addToChat" data-tabid="${this.esc(tab.metadata.id)}" title="Add to Copilot Chat"><span class="codicon codicon-attach"></span></button>`
      : '';

    const closeBtn = tab.state.capabilities.canClose
      ? `<button data-action="closeTab" data-tabid="${this.esc(tab.metadata.id)}" title="Close"><span class="codicon codicon-remove-close"></span></button>`
      : '';

    const iconHtml = await this.iconRenderer.render(tab);

    // Compact mode: same layout as normal, single-line text (name + inline path)
    if (compactMode) {
      const pathSuffix = showPath && tab.metadata.detailLabel
        ? `<span class="tab-path-inline">${this.esc(tab.metadata.detailLabel)}</span>`
        : '';
      return `<div class="tab compact${activeClass}" data-tabid="${this.esc(tab.metadata.id)}" ${dataPinned} ${dataGroupId}>
      <span class="tab-icon">${iconHtml}</span>
      <div class="tab-text">
        <div class="tab-name${stateIndicator.nameClass}">${this.esc(tab.metadata.label)}${pinBadge}${pathSuffix}</div>
      </div>
      ${stateIndicator.html}
      <span class="tab-actions">
        ${fileActionBtn}${chatBtn}${closeBtn}
      </span>
    </div>`;
    }

    // Normal mode: two-line layout
    const pathHtml = showPath && tab.metadata.detailLabel
      ? `<div class="tab-path">${this.esc(tab.metadata.detailLabel)}</div>`
      : '';

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

  //= BOTONES DE ACCIÓN

  private renderFileActionButton(tab: SideTab): string {
    if (!this.fileActionRegistry || !tab.metadata.uri) { return ''; }

    // Pass viewMode context for dynamic actions (like MD toggle)
    const context = { viewMode: tab.state.viewMode };
    const resolved = this.fileActionRegistry.resolve(tab.metadata.label, tab.metadata.uri, context);
    if (!resolved) { return ''; }

    return `<button data-action="fileAction" data-tabid="${this.esc(tab.metadata.id)}" data-actionid="${this.esc(resolved.id)}" title="${this.esc(resolved.tooltip)}"><span class="codicon codicon-${this.esc(resolved.icon)}"></span></button>`;
  }

  //= UTILIDADES

  private esc(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private generateNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
      nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
  }
}

