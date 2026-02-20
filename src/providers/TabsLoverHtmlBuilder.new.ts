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
   * Soporta dos formas de llamada para compatibilidad:
   * 
   * Nueva (recomendada):
   *   buildHtml(options: BuildHtmlOptions)
   * 
   * Legacy (deprecated):
   *   buildHtml(webview, groups, tabHeight, showPath, copilotReady, enableDragDrop, getTabsInGroup)
   */
  async buildHtml(
    optionsOrWebview: BuildHtmlOptions | vscode.Webview,
    groups?: SideTabGroup[],
    tabHeight?: number,
    showPath?: boolean,
    copilotReady?: boolean,
    enableDragDrop?: boolean,
    getTabsInGroup?: (groupId: number) => SideTab[],
  ): Promise<string> {
    // Detectar si es llamada con objeto de opciones o parámetros individuales
    let options: BuildHtmlOptions;

    if ('webview' in optionsOrWebview && 'groups' in optionsOrWebview) {
      // Nueva API con objeto de opciones
      options = optionsOrWebview as BuildHtmlOptions;
    } else {
      // API legacy con parámetros individuales
      options = {
        webview: optionsOrWebview as vscode.Webview,
        groups: groups!,
        getTabsInGroup: getTabsInGroup!,
        tabHeight: tabHeight!,
        showPath: showPath!,
        copilotReady: copilotReady!,
        enableDragDrop,
      };
    }

    const {
      webview,
      groups: grps,
      getTabsInGroup: getTabs,
      tabHeight: height,
      showPath: path,
      copilotReady: copilot,
      enableDragDrop: dragDrop = false,
    } = options;

    const uris = this.resolveResourceUris(webview, dragDrop);
    const nonce = this.generateNonce();
    const tabsHtml = await this.renderAllTabs(grps, getTabs, height, path, copilot, dragDrop);

    return this.assembleHtml(webview, uris, nonce, height, tabsHtml, dragDrop);
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
    tabHeight: number,
    tabsHtml: string,
    enableDragDrop: boolean,
  ): string {
    const csp = this.stylesBuilder.buildCSP(webview, nonce);
    const inlineStyles = this.stylesBuilder.buildInlineStyles(uris.setiFont, tabHeight);

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
    tabHeight: number,
    showPath: boolean,
    copilotReady: boolean,
    enableDragDrop: boolean,
  ): Promise<string> {
    if (groups.length <= 1) {
      const groupId = groups[0]?.id;
      if (groupId !== undefined) {
        return this.renderTabList(getTabsInGroup(groupId), tabHeight, showPath, copilotReady, enableDragDrop);
      }
      return '';
    }

    let html = '';
    for (const group of groups) {
      html += this.renderGroupHeader(group);
      html += await this.renderTabList(getTabsInGroup(group.id), tabHeight, showPath, copilotReady, enableDragDrop);
    }
    return html;
  }

  private renderGroupHeader(group: SideTabGroup): string {
    const marker = group.isActive ? ' (Active)' : '';
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
    enableDragDrop: boolean,
  ): Promise<string> {
    // Pinned tabs primero, orden estable dentro de cada sección
    const sorted = [...tabs].sort((a, b) => {
      if (a.state.isPinned && !b.state.isPinned) return -1;
      if (!a.state.isPinned && b.state.isPinned) return 1;
      return 0;
    });

    const rendered = await Promise.all(
      sorted.map(t => this.renderTab(t, tabHeight, showPath, copilotReady, enableDragDrop))
    );
    return rendered.join('');
  }

  private async renderTab(
    tab: SideTab,
    _tabHeight: number,
    showPath: boolean,
    copilotReady: boolean,
    _enableDragDrop: boolean,
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

    const pathHtml = showPath && tab.metadata.description
      ? `<div class="tab-path">${this.esc(tab.metadata.description)}</div>`
      : '';

    const iconHtml = await this.iconRenderer.render(tab);

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
    if (!this.fileActionRegistry || !tab.metadata.uri) return '';

    const resolved = this.fileActionRegistry.resolve(tab.metadata.label, tab.metadata.uri);
    if (!resolved) return '';

    return `<button data-action="fileAction" data-tabid="${this.esc(tab.metadata.id)}" data-actionid="${this.esc(resolved.id)}" title="${this.esc(resolved.tooltip)}"><span class="codicon codicon-${this.esc(resolved.icon)}"></span></button>`;
  }

  //= UTILIDADES

  /** Escapa caracteres especiales para insertar texto de forma segura en HTML. */
  private esc(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /** Genera un nonce aleatorio para CSP. */
  private generateNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
      nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
  }
}
