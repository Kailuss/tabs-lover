import * as vscode from 'vscode';
import * as path from 'path';
import type { FileAction, DynamicFileAction } from './types';
import { byExtension } from './matchers';

/**
 * Acción dinámica para Markdown: toggle entre preview y source.
 * - Si viewMode='source' → muestra icono "preview" → acción: abrir preview
 * - Si viewMode='preview' → muestra icono "edit" → acción: volver al source
 */
export const MARKDOWN_TOGGLE_ACTION: DynamicFileAction = {
  id: 'toggleMarkdownPreview',
  match: byExtension('.md', '.mdx', '.markdown'),
  resolve: (context) => {
    const isPreview = context?.viewMode === 'preview';
    
    if (isPreview) {
      return {
        icon: 'edit-code',
        tooltip: 'Edit Source',
        actionId: 'editMarkdownSource',
      };
    }
    return {
      icon: 'preview',
      tooltip: 'Open Preview',
      actionId: 'openMarkdownPreview',
    };
  },
  execute: async (uri, context) => {
    const isPreview = context?.viewMode === 'preview';
    
    if (isPreview) {
      // Already in preview mode, switch back to source
      await vscode.commands.executeCommand('vscode.open', uri);
    } else {
      // In source mode, open preview
      await vscode.commands.executeCommand('markdown.showPreview', uri);
    }
  },
};

export const WEB_ACTIONS: FileAction[] = [

  // NOTE: Markdown is handled by MARKDOWN_TOGGLE_ACTION (dynamic)
  // The static entry below is kept as fallback for registry compatibility

  // ── HTML: abrir en Simple Browser ──
  {
    id      : 'previewHtml',
    icon    : 'globe',
    tooltip : 'Open in Browser',
    match   : byExtension('.html', '.htm'),
    execute : async (uri) => {
      await vscode.commands.executeCommand('simpleBrowser.api.open', uri.toString());
    },
  },

  // ── CSS ──
  {
    id      : 'formatCss',
    icon    : 'symbol-ruler',
    tooltip : 'Format Stylesheet',
    match   : byExtension('.css'),
    execute : async (uri) => {
      await vscode.commands.executeCommand('vscode.open', uri);
      await vscode.commands.executeCommand('editor.action.formatDocument');
    },
  },

  // ── SCSS / Less: compilar a CSS ──
  {
    id      : 'compileCss',
    icon    : 'symbol-color',
    tooltip : 'Compile to CSS',
    match   : byExtension('.scss', '.less', '.sass'),
    execute : async (uri) => {
      const terminal = vscode.window.createTerminal({ name: 'Compile CSS' });
      terminal.show();
      const ext = path.extname(uri.fsPath);
      if (ext === '.scss' || ext === '.sass') {
        terminal.sendText(`sass "${uri.fsPath}" "${uri.fsPath.replace(/\.s[ac]ss$/, '.css')}"`);
      } else if (ext === '.less') {
        terminal.sendText(`lessc "${uri.fsPath}" "${uri.fsPath.replace(/\.less$/, '.css')}"`);
      }
    },
  },

  // ── REST/GraphQL: ejecutar request (extensión REST Client) ──
  {
    id      : 'sendRequest',
    icon    : 'send',
    tooltip : 'Send HTTP Request',
    match   : byExtension('.http', '.rest'),
    execute : async (uri) => {
      await vscode.commands.executeCommand('vscode.open', uri);
      try {
        await vscode.commands.executeCommand('rest-client.request');
      } catch {
        vscode.window.showWarningMessage('Install REST Client extension to send requests');
      }
    },
  },

];
