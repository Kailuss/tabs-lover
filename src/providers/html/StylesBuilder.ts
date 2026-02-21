/**
 * Constructor de estilos CSS para el webview.
 * Genera CSS crítico inline y gestiona la carga de fuentes.
 *
 * Solo genera los estilos que requieren la URI del webview (fuente seti),
 * el resto de los estilos vive en los archivos CSS estáticos en src/styles/.
 */

import * as vscode from 'vscode';
import { SETI_ICON_SIZE } from './types';

export class StylesBuilder {
  /**
   * Genera el CSS crítico inline para el webview.
   * Solo incluye @font-face con la URI absoluta del webview (necesaria para seti)
   * y la clase .seti-icon con el tamaño correcto.
   */
  buildInlineStyles(setiFontUri: vscode.Uri): string {
    return `
/* Seti icon font — requires absolute webview URI */
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
