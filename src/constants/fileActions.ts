import * as vscode from 'vscode';
import * as path   from 'path';

//! ───────────────────────────── Shared interfaces ──────────────────────────────

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

//! ───────────────────────────── Helpers de matching ─────────────────────────────

/** Genera un matcher por extensiones (case-insensitive). */
export function byExtension(...exts: string[]): FileAction['match'] {
  const set = new Set(exts.map(e => e.toLowerCase()));
  return (fileName: string) => set.has(path.extname(fileName).toLowerCase());
}

/** Genera un matcher por nombre exacto del archivo (case-insensitive). */
export function byName(...names: string[]): FileAction['match'] {
  const set = new Set(names.map(n => n.toLowerCase()));
  return (fileName: string) => set.has(fileName.toLowerCase());
}

/** Genera un matcher por patrón en el nombre (case-insensitive). */
export function byPattern(regex: RegExp): FileAction['match'] {
  return (fileName: string) => regex.test(fileName);
}

//! ─────────────────────────── Acciones predefinidas ────────────────────────────

export const BUILTIN_ACTIONS: FileAction[] = [

  // ── Abrir con app externa por defecto ──
  {
    id      : 'openExternal',
    icon    : 'link-external',
    tooltip : 'Open with Default App',
    match   : byExtension(
      // Imágenes vectoriales y especializadas
      '.svg', '.ai', '.eps', '.psd', '.sketch', '.fig', '.xd',
      // Documentos
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp',
      // Audio
      '.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.wma',
      // Video
      '.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv', '.m4v',
      // Archivos comprimidos
      '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2',
      // Ejecutables y binarios
      '.exe', '.dmg', '.app', '.msi', '.deb', '.rpm',
      // Bases de datos
      '.db', '.sqlite', '.sqlite3', '.mdb', '.accdb',
      // Diseño 3D y CAD
      '.blend', '.obj', '.fbx', '.stl', '.dwg', '.dxf',
      // Fuentes
      '.ttf', '.otf', '.woff', '.woff2', '.eot'
    ),
    execute : async (uri) => {
      await vscode.env.openExternal(uri);
    },
  },

  // ── Markdown: abrir preview ──
  {
    id      : 'previewMarkdown',
    icon    : 'preview',
    tooltip : 'Open Preview',
    match   : byExtension('.md', '.mdx', '.markdown'),
    execute : async (uri) => {
      await vscode.commands.executeCommand('markdown.showPreview', uri);
    },
  },

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

  // ── Lock files: abrir npm scripts / audit ──
  {
    id      : 'openLockFile',
    icon    : 'unlock',
    tooltip : 'Show in Explorer & Outline',
    match   : byPattern(/^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Gemfile\.lock|poetry\.lock|Cargo\.lock|composer\.lock)$/i),
    execute : async (uri) => {
      await vscode.commands.executeCommand('vscode.open', uri);
      // Fuerza el panel Outline para navegar dependencias visualmente
      await vscode.commands.executeCommand('outline.focus');
    },
  },

  // ── JSON / JSONC: formatear documento ──
  {
    id      : 'formatJson',
    icon    : 'bracket',
    tooltip : 'Format Document',
    match   : byExtension('.json', '.jsonc', '.json5'),
    execute : async (uri) => {
      //await vscode.commands.executeCommand('vscode.open', uri);
      //await vscode.commands.executeCommand('editor.action.formatDocument');
    },
  },

  // ── CSV / TSV: abrir como tabla (extensión Data Preview o similar) ──
  {
    id      : 'previewData',
    icon    : 'table',
    tooltip : 'Preview as Table',
    match   : byExtension('.csv', '.tsv'),
    execute : async (uri) => {
      try {
        await vscode.commands.executeCommand('csv.preview', uri);
      } catch {
        await vscode.commands.executeCommand('vscode.open', uri);
      }
    },
  },

  // ── Imágenes: abrir a un lado para previsualizar ──
  {
    id      : 'previewImage',
    icon    : 'file-media',
    tooltip : 'Preview Image',
    match   : byExtension('.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico'),
    execute : async (uri) => {
      await vscode.commands.executeCommand('vscode.open', uri, { viewColumn: vscode.ViewColumn.Beside });
    },
  },

  // ── SVG: optimizar con SVGO ──
  {
    id      : 'optimizeSvg',
    icon    : 'sparkle',
    tooltip : 'Optimize SVG',
    match   : byExtension('.svg'),
    execute : async (uri) => {
      const terminal = vscode.window.createTerminal({ name: 'Optimize SVG' });
      terminal.show();
      terminal.sendText(`npx svgo "${uri.fsPath}" -o "${uri.fsPath}"`);
    },
  },

  // ── Imágenes/Archivos: copiar como Base64 ──
  {
    id      : 'copyAsBase64',
    icon    : 'copy',
    tooltip : 'Copy as Base64',
    match   : byExtension('.png', '.jpg', '.jpeg', '.svg', '.woff2', '.ico', '.gif'),
    execute : async (uri) => {
      const fs = await import('fs/promises');
      const buffer = await fs.readFile(uri.fsPath);
      const base64 = buffer.toString('base64');
      const mimeTypes: Record<string, string> = {
        '.png'   : 'image/png',
        '.jpg'   : 'image/jpeg',
        '.jpeg'  : 'image/jpeg',
        '.svg'   : 'image/svg+xml',
        '.gif'   : 'image/gif',
        '.woff2' : 'font/woff2',
        '.ico'   : 'image/x-icon'
      };
      const ext = path.extname(uri.fsPath).toLowerCase();
      const mimeType = mimeTypes[ext] || 'application/octet-stream';
      
      const dataUri = `data:${mimeType};base64,${base64}`;
      await vscode.env.clipboard.writeText(dataUri);
      vscode.window.showInformationMessage('✓ Copied as Base64 data URI');
    },
  },

  // ── Tests: ejecutar archivo de test ──
  {
    id      : 'runTest',
    icon    : 'beaker',
    tooltip : 'Run Tests',
    match   : byPattern(/\.(test|spec)\.(ts|js|tsx|jsx|mjs|cjs)$/i),
    execute : async (uri) => {
      await vscode.commands.executeCommand('vscode.open', uri);
      await vscode.commands.executeCommand('testing.runCurrentFile');
    },
  },

  // ── package.json: ejecutar scripts ──
  {
    id      : 'npmScripts',
    icon    : 'play',
    tooltip : 'Show npm Scripts',
    match   : byName('package.json'),
    execute : async (_uri) => {
      await vscode.commands.executeCommand('workbench.action.tasks.runTask');
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

  // ── .env: encriptar/desencriptar secretos ──
  {
    id      : 'encryptEnv',
    icon    : 'lock',
    tooltip : 'Encrypt/Decrypt Secrets',
    match   : byPattern(/\.env(\.\w+)?$/),
    execute : async (_uri) => {
      const action = await vscode.window.showQuickPick(
        ['Encrypt', 'Decrypt'],
        { placeHolder: 'Choose action for .env file' }
      );
      
      if (!action) {
        return;
      }
      
      const terminal = vscode.window.createTerminal({ name: 'dotenv-vault' });
      terminal.show();
      
      if (action === 'Encrypt') {
        terminal.sendText('npx dotenv-vault encrypt');
      } else {
        terminal.sendText('npx dotenv-vault decrypt');
      }
    },
  },

  // ── LICENSE: ver resumen de permisos ──
  {
    id      : 'showLicense',
    icon    : 'law',
    tooltip : 'View License Summary',
    match   : byName('LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md'),
    execute : async (uri) => {
      await vscode.commands.executeCommand('vscode.open', uri);
      const choice = await vscode.window.showInformationMessage(
        'View full license details at choosealicense.com',
        'Open Site'
      );
      if (choice) {
        vscode.env.openExternal(vscode.Uri.parse('https://choosealicense.com'));
      }
    },
  },

  // ── Prettier config: formatear todo el workspace ──
  {
    id      : 'formatWorkspace',
    icon    : 'wand',
    tooltip : 'Format All Files',
    match   : byName('.prettierrc', '.prettierrc.json', '.prettierrc.js', 'prettier.config.js', '.prettierrc.yml'),
    execute : async (_uri) => {
      const confirm = await vscode.window.showWarningMessage(
        'Format all files in workspace with Prettier?',
        { modal: true },
        'Yes, Format All'
      if (!confirm) {
        return;
      }
      
      if (!confirm) return;
      
      const terminal = vscode.window.createTerminal({ name: 'Format Workspace' });
      terminal.show();
      terminal.sendText('npx prettier --write .');
    },
  },

  // ── Dockerfile: build ──
  {
    id      : 'dockerBuild',
    icon    : 'package',
    tooltip : 'Build Image',
    match   : byPattern(/^Dockerfile/i),
    execute : async (uri) => {
      const folder = path.dirname(uri.fsPath);
      const terminal = vscode.window.createTerminal({ name: 'Docker Build', cwd: folder });
      terminal.show();
      terminal.sendText(`docker build -t ${path.basename(folder).toLowerCase()} .`);
    },
  },

  // ── Shell scripts: ejecutar en terminal ──
  {
    id      : 'runScript',
    icon    : 'terminal',
    tooltip : 'Run in Terminal',
    match   : byExtension('.sh', '.bash', '.zsh', '.bat', '.cmd', '.ps1'),
    execute : async (uri) => {
      await vscode.commands.executeCommand('vscode.open', uri);
      await vscode.commands.executeCommand('workbench.action.terminal.runActiveFile');
    },
  },

  // ── YAML: validar (con extensión YAML de Red Hat) ──
  {
    id      : 'validateYaml',
    icon    : 'check-all',
    tooltip : 'Validate YAML',
    match   : byExtension('.yml', '.yaml'),
    execute : async (uri) => {
      await vscode.commands.executeCommand('vscode.open', uri);
      await vscode.commands.executeCommand('editor.action.formatDocument');
    },
  },

  // ── TypeScript / JavaScript: ejecutar con node/ts-node ──
  {
    id      : 'runFile',
    icon    : 'play',
    tooltip : 'Run File',
    match   : byExtension('.ts', '.js', '.mjs', '.cjs'),
    execute : async (uri) => {
      const ext = path.extname(uri.fsPath).toLowerCase();
      const terminal = vscode.window.createTerminal({ name: 'Run File' });
      terminal.show();
      if (ext === '.ts') {
        terminal.sendText(`npx ts-node "${uri.fsPath}"`);
      } else {
        terminal.sendText(`node "${uri.fsPath}"`);
      }
    },
  },

  // ── Python: ejecutar archivo ──
  {
    id      : 'runPython',
    icon    : 'play',
    tooltip : 'Run Python File',
    match   : byExtension('.py'),
    execute : async (uri) => {
      await vscode.commands.executeCommand('vscode.open', uri);
      await vscode.commands.executeCommand('python.execInTerminal');
    },
  },

  // ── Jupyter Notebooks: abrir en modo interactivo ──
  {
    id      : 'openNotebook',
    icon    : 'notebook',
    tooltip : 'Open as Notebook',
    match   : byExtension('.ipynb'),
    execute : async (uri) => {
      await vscode.commands.executeCommand('vscode.openWith', uri, 'jupyter-notebook');
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

];
