import * as vscode from 'vscode';
import * as path   from 'path';

/**
 * Descripción de una acción contextual asociada a un tipo de archivo.
 *
 * Para añadir una nueva acción basta con registrar un `FileAction` en
 * `FileActionRegistry.register()` — no es necesario tocar otros archivos.
 */
export interface FileAction {
  /** Identificador único de la acción (se envía como mensaje al webview). */
  id: string;

  /** Codicon que se muestra en el botón de la tab (sin el prefijo `codicon-`). */
  icon: string;

  /** Tooltip del botón. */
  tooltip: string;

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
export interface ResolvedFileAction {
  id      : string;
  icon    : string;
  tooltip : string;
}

// ───────────────────────────── Helpers de matching ─────────────────────────────

/** Genera un matcher por extensiones (case-insensitive). */
function byExtension(...exts: string[]): FileAction['match'] {
  const set = new Set(exts.map(e => e.toLowerCase()));
  return (fileName: string) => set.has(path.extname(fileName).toLowerCase());
}

/** Genera un matcher por nombre exacto del archivo (case-insensitive). */
function byName(...names: string[]): FileAction['match'] {
  const set = new Set(names.map(n => n.toLowerCase()));
  return (fileName: string) => set.has(fileName.toLowerCase());
}

/** Genera un matcher por patrón en el nombre (case-insensitive). */
function byPattern(regex: RegExp): FileAction['match'] {
  return (fileName: string) => regex.test(fileName);
}

// ─────────────────────────── Acciones predefinidas ────────────────────────────

const BUILTIN_ACTIONS: FileAction[] = [

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
// ── CSS / SCSS / Less: formatear ──
{
  id      : 'formatCss',
  icon    : 'paintcan',
  tooltip : 'Format Stylesheet',
  match   : byExtension('.css', '.scss', '.less', '.sass'),
  execute : async (uri) => {
    await vscode.commands.executeCommand('vscode.open', uri);
    await vscode.commands.executeCommand('editor.action.formatDocument');
  },
},// ── Lock files: abrir npm scripts / audit ──
{
  id      : 'openLockFile',
  icon    : 'lock',
  tooltip : 'Show in Explorer & Outline',
  match   : byPattern(/^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Gemfile\.lock|poetry\.lock|Cargo\.lock|composer\.lock)$/i),
  execute : async (uri) => {
    await vscode.commands.executeCommand('vscode.open', uri);
    // Fuerza el panel Outline para navegar dependencias visualmente
    await vscode.commands.executeCommand('outline.focus');
  },
},
  // ── SVG: previsualizar ──
  {
    id      : 'previewSvg',
    icon    : 'eye',
    tooltip : 'Preview SVG',
    match   : byExtension('.svg'),
    execute : async (uri) => {
      // Intenta la extensión SVG Preview; si no existe, abre el built-in
      try {
        await vscode.commands.executeCommand('svgPreviewer.showPreviewToSide', uri);
      } catch {
        await vscode.commands.executeCommand('vscode.openWith', uri, 'default');
      }
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
    execute : async (uri) => {
      await vscode.commands.executeCommand('workbench.action.tasks.runTask');
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

];

// ──────────────────────────────── Registry ─────────────────────────────────────

/**
 * Registro extensible de acciones contextuales por tipo de archivo.
 *
 * **Cómo añadir una acción nueva:**
 * ```ts
 * registry.register({
 *   id      : 'myAction',
 *   icon    : 'codicon-name',
 *   tooltip : 'Do something cool',
 *   match   : (name, uri) => name.endsWith('.xyz'),
 *   execute : async (uri) => { ... },
 * });
 * ```
 *
 * Las acciones se evalúan en orden de registro; la primera cuyo `match`
 * devuelva `true` gana.  Las acciones registradas manualmente tienen
 * prioridad sobre las built-in.
 */
export class FileActionRegistry {

  /** Acciones añadidas por el usuario / otros módulos (mayor prioridad). */
  private custom: FileAction[] = [];

  /** Acciones predefinidas (menor prioridad). */
  private builtin: FileAction[] = [...BUILTIN_ACTIONS];

  /** Registra una acción personalizada (se evalúa antes que las built-in). */
  register(action: FileAction): void {
    this.custom.push(action);
  }

  /** Elimina una acción por su id. */
  unregister(id: string): void {
    this.custom  = this.custom.filter(a => a.id !== id);
    this.builtin = this.builtin.filter(a => a.id !== id);
  }

  /**
   * Resuelve la acción contextual para un archivo.
   * Devuelve la primera acción cuyo `match` sea `true`, o `null` si
   * ninguna aplica (el botón no se mostrará).
   */
  resolve(fileName: string, uri: vscode.Uri): ResolvedFileAction | null {
    // Custom first (higher priority)
    for (const action of this.custom) {
      if (action.match(fileName, uri)) {
        return { id: action.id, icon: action.icon, tooltip: action.tooltip };
      }
    }
    // Then built-in
    for (const action of this.builtin) {
      if (action.match(fileName, uri)) {
        return { id: action.id, icon: action.icon, tooltip: action.tooltip };
      }
    }
    return null;
  }

  /**
   * Ejecuta la acción asociada a un archivo (buscada por id).
   * Devuelve `true` si se ejecutó, `false` si no se encontró.
   */
  async execute(actionId: string, uri: vscode.Uri): Promise<boolean> {
    const action =
      this.custom.find(a => a.id === actionId) ??
      this.builtin.find(a => a.id === actionId);

    if (!action) { return false; }

    try {
      await action.execute(uri);
      return true;
    } catch (error) {
      console.error(`[FileAction] Failed to execute "${actionId}":`, error);
      return false;
    }
  }

  /** Devuelve todas las acciones registradas (para depuración). */
  getAll(): ReadonlyArray<FileAction> {
    return [...this.custom, ...this.builtin];
  }
}
