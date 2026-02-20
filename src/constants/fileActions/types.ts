import * as vscode from 'vscode';

/**
 * Descripción de una acción contextual asociada a un tipo de archivo.
 *
 * Para añadir una nueva acción basta con registrar un `FileAction` en
 * `FileActionRegistry.register()` — no es necesario tocar otros archivos.
 */
export type FileAction = {
  id: string;      // Identificador único de la acción (se envía como mensaje al webview).
  icon: string;    // Codicon que se muestra en el botón de la tab (sin el prefijo `codicon-`).
  tooltip: string; // Tooltip del botón.

  /**
   * Función que decide si esta acción aplica a un archivo dado.
   * Recibe el nombre del archivo (`basename`) y la URI completa.
   * La primera acción cuyo `match` devuelva `true` gana.
   */
  match: (fileName: string, uri: vscode.Uri) => boolean;

  /**
   * Función que ejecuta la acción.
   * Recibe la URI del archivo afectado.
   */
  execute: (uri: vscode.Uri) => Promise<void>;
}

/**
 * Resultado resuelto para un archivo concreto (lo que el HTML builder necesita).
 */
export type ResolvedFileAction = {
  id      : string;
  icon    : string;
  tooltip : string;
}
