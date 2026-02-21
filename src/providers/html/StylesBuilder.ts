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
  // Note: Seti font removed - VS Code provides file icons through its API

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
