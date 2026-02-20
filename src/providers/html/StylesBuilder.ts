/**
 * Constructor de estilos CSS para el webview.
 * Genera CSS crítico inline y gestiona la carga de fuentes.
 */

import * as vscode from 'vscode';
import { SETI_ICON_SIZE } from './types';

export class StylesBuilder {
  /**
   * Genera el CSS crítico inline para el webview.
   */
  buildInlineStyles(setiFontUri: vscode.Uri, tabHeight: number): string {
    return `
/* Critical inline fallback styles */
* { margin: 0; padding: 0; box-sizing: border-box; }

/* Seti font for icon theme */
@font-face {
  font-family: 'seti';
  src: url('${setiFontUri}') format('woff');
  font-weight: normal;
  font-style: normal;
}

.seti-icon {
  font-family: 'seti' !important;
  font-size: ${SETI_ICON_SIZE.fontSize}px;
  line-height: 1;
  display: inline-block;
  vertical-align: middle;
  text-align: center;
  width: ${SETI_ICON_SIZE.width}px;
  height: ${SETI_ICON_SIZE.height}px;
  font-style: normal;
  font-weight: normal;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  font-family: var(--vscode-font-family, sans-serif);
  font-size: var(--vscode-font-size, 13px);
  color: var(--vscode-foreground, #cccccc);
  background: var(--vscode-sideBar-background, var(--vscode-editor-background, #1e1e1e));
}

.tab {
  display: flex;
  align-items: center;
  height: ${tabHeight}px;
  padding: 0 8px;
  cursor: pointer;
  border-left: 5px solid transparent;
  border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
}

.tab.active {
  border-left-color: var(--vscode-focusBorder, #007acc);
  background: var(--vscode-tab-activeBackground, var(--vscode-editor-background));
}

.tab-icon {
  width: 28px;
  display: flex;
  justify-content: center;
}

.tab-icon img {
  width: 16px;
  height: 16px;
}

.tab-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.tab-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab-path {
  font-size: 0.85em;
  opacity: 0.7;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab-actions {
  display: none;
  gap: 2px;
}

.tab:hover .tab-actions {
  display: flex;
}

.tab-actions button {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 2px;
}

.empty {
  padding: 20px;
  text-align: center;
  opacity: 0.6;
}
`.trim();
  }

  /**
   * Genera la Content Security Policy para el webview.
   */
  buildCSP(webview: vscode.Webview, nonce: string): string {
    return `
  default-src 'none';
  style-src ${webview.cspSource} 'unsafe-inline';
  font-src ${webview.cspSource};
  img-src ${webview.cspSource} data:;
  script-src 'nonce-${nonce}';
`.trim();
  }
}
