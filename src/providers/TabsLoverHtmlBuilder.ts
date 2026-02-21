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
      setiFont: asUri(['dist', 'fonts', 'seti.woff']),
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
    const inlineStyles = this.stylesBuilder.buildInlineStyles(uris.setiFont);
    const compactIcon = compactMode ? 'codicon-list-tree' : 'codicon-list-flat';

    const headerHtml = `<div class="view-header">
  <span class="view-header-title">${this.esc(workspaceName)}</span>
  <span class="view-header-actions">
    <button class="view-header-btn" data-action="refresh" title="Refresh"><span class="codicon codicon-refresh"></span></button>
    <button class="view-header-btn" data-action="reorder" title="Reorder Tabs"><span class="codicon codicon-list-ordered"></span></button>
    <button class="view-header-btn" data-action="toggleCompactMode" title="Toggle Compact Mode"><span class="codicon ${compactIcon}"></span></button>
    <button class="view-header-btn" data-action="saveAll" title="Save All"><span class="codicon codicon-save-all"></span></button>
  </span>
</div>`;

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link href="${uris.codiconCss}" rel="stylesheet" />
<link href="${uris.webviewCss}" rel="stylesheet" />
<style>${inlineStyles}</style>
</head>
<body>
  ${headerHtml}
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
    const sorted = [...tabs].sort((a, b) => {
      if (a.state.isPinned && !b.state.isPinned) { return -1; }
      if (!a.state.isPinned && b.state.isPinned) { return 1; }
      return 0;
    });

    const rendered = await Promise.all(
      sorted.map(t => this.renderTab(t, showPath, copilotReady, enableDragDrop, compactMode))
    );
    return rendered.join('');
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

    const fileActionBtn = this.renderFileActionButton(tab);

    const chatBtn = copilotReady && tab.metadata.uri
      ? `<button data-action="addToChat" data-tabid="${this.esc(tab.metadata.id)}" title="Add to Copilot Chat"><span class="codicon codicon-attach"></span></button>`
      : '';

    const closeBtn = `<button data-action="closeTab" data-tabid="${this.esc(tab.metadata.id)}" title="Close"><span class="codicon codicon-remove-close"></span></button>`;

    const iconHtml = await this.iconRenderer.render(tab);

    // Compact mode: same layout as normal, single-line text (name + inline path)
    if (compactMode) {
      const pathSuffix = showPath && tab.metadata.description
        ? `<span class="tab-path-inline">${this.esc(tab.metadata.description)}</span>`
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
    const pathHtml = showPath && tab.metadata.description
      ? `<div class="tab-path">${this.esc(tab.metadata.description)}</div>`
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

    const resolved = this.fileActionRegistry.resolve(tab.metadata.label, tab.metadata.uri);
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

