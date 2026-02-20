// Solo gestiona datos y la lógica de mapeo — no devuelve rutas absolutas ni HTML.
// Construye y expone un `iconMap` (solo datos) que el webview usa para resolver iconos.

import * as vscode from 'vscode';
import * as fsp    from 'fs/promises';
import * as path   from 'path';

/**
 * Resuelve y cachea iconos de archivo según el tema de iconos activo.
 * En términos sencillos: encuentra el icono adecuado (por nombre/ext/idioma)
 * y devuelve una imagen en `data:` base64 lista para el webview.
 */
export class TabIconManager {
  private _iconCache         : Map<string, string> = new Map();
  private _iconMap           : Record<string, string> | undefined;
  private _iconThemeId       : string | undefined;
  private _iconThemePath     : string | undefined;
  private _iconThemeJson     : any;
  private _iconPathCache     : Map<string, string> = new Map();
  private _isPreloadingIcons : boolean = false;
  private _configListener    : vscode.Disposable | undefined;

  /**
   * Inicializa el gestor de iconos y registra listeners.
   * Llamar una vez desde `activate()`; prepara la tabla de búsqueda del tema.
   */
  public initialize(context: vscode.ExtensionContext): void { 
    this._configListener = vscode.workspace.onDidChangeConfiguration(async e => {
      if (e.affectsConfiguration('workbench.iconTheme')) {
        this.clearCache();
        await this.buildIconMap(context);
      }
    });

    context.subscriptions.push(this._configListener);

    this.buildIconMap(context).catch(err => console.error('[TabsLover] Error building initial icon map:', err));
  }

  /**
   * Construye una tabla (mapa) que permite encontrar el icono correcto
   * para un nombre o extensión según el tema activo. No carga los iconos
   * en base64 aquí; solo analiza el JSON del tema.
   */
  public async buildIconMap(
    context: vscode.ExtensionContext,
    forceRebuild: boolean = false
  ): Promise<void> {
    try {
      const config    = vscode.workspace.getConfiguration();
      const iconTheme = config.get<string>('workbench.iconTheme');

      // Si no hay tema de iconos configurado, limpiar el mapa y salir.
      if (!iconTheme) {
        this._iconMap     = {};
        this._iconThemeId = '';
        return;
      }

      // Si el tema no cambió y ya tenemos el mapa, no volver a reconstruir.
      if (this._iconThemeId === iconTheme && this._iconMap && !forceRebuild) {
        return;
      }

      let ext               = this.findIconThemeExtension(iconTheme);
      let themeJson: any    = null;
      let themePath: string = '';
      let themeId           = iconTheme;

      // Fallback a 'vs-seti' si no encontramos el tema configurado
      if (!ext) {
        ext = this.findIconThemeExtension('vs-seti');
        themeId = 'vs-seti';

        if (!ext) {
          this._iconMap     = {};
          this._iconThemeId = iconTheme;
          return;
        }
      }

      // Buscar la entrada del tema en el package.json de la extensión
      const themeContribution = ext.packageJSON.contributes.iconThemes.find( (t: any) => t.id === themeId );
      if (!themeContribution) {
        this._iconMap     = {};
        this._iconThemeId = iconTheme;
        return;
      }

      // Resolver la ruta absoluta al archivo JSON del tema
      themePath = path.join(ext.extensionPath, themeContribution.path);

      try {
        await fsp.access(themePath);
      } catch {
        this._iconMap     = {};
        this._iconThemeId = iconTheme;
        return;
      }

      try {
        const themeContent = await fsp.readFile(themePath, 'utf8');
        themeJson          = JSON.parse(themeContent);
      } catch (err) {
        console.error('[TabsLover] Error parsing icon theme JSON:', err);
        this._iconMap     = {};
        this._iconThemeId = iconTheme;
        return;
      }

      this._iconThemeId = iconTheme;
      this._iconThemePath = themePath;
      this._iconThemeJson = themeJson;

      const iconMap: Record<string, string> = {};

      // Mapear nombres de archivo → id de icono
      if (themeJson.fileNames) {
        Object.entries(themeJson.fileNames).forEach(([name, value]) => {
          iconMap[`name:${name.toLowerCase()}`] = value as string;
        });
      }

      // Mapear extensiones de archivo → id de icono
      if (themeJson.fileExtensions) {
        Object.entries(themeJson.fileExtensions).forEach(([fileExt, value]) => {
          iconMap[`ext:${fileExt.toLowerCase()}`] = value as string;
        });
      }

      // Mapear ids de lenguaje → id de icono
      if (themeJson.languageIds) {
        Object.entries(themeJson.languageIds).forEach(([lang, value]) => {
          iconMap[`lang:${lang.toLowerCase()}`] = value as string;
        });
      }

      this._iconMap = iconMap;
    } catch (error) {
      console.error('[TabsLover] Error building icon map:', error);
      this._iconMap = this._iconMap || {};
    }
  }

  /**
   * Busca la extensión que declara el tema de iconos activo.
   * Devuelve `undefined` si no se encuentra (usamos un fallback entonces).
   */
  private findIconThemeExtension(themeId: string): vscode.Extension<any> | undefined {
    return vscode.extensions.all.find(e => {
      try {
        const contributes = e.packageJSON.contributes;
        if (!contributes || !contributes.iconThemes) {
          return false;
        }
        return contributes.iconThemes.some((t: any) => t.id === themeId);
      } catch {
        return false;
      }
    });
  }

  /**
   * Devuelve el icono para `fileName` como una URI `data:` base64 lista para `<img>`.
   * Uso: la vista inserta directamente este string en el `src` de la etiqueta.
   */
  public async getFileIconAsBase64(
    fileName: string,
    context: vscode.ExtensionContext,
    languageId?: string
  ): Promise<string | undefined> {
    try {
      if (!this._iconMap || !this._iconThemeJson) {
        if (!this._iconThemeId) {
          await this.buildIconMap(context);
        }
        if (!this._iconMap || !this._iconThemeJson) {
          return undefined;
        }
      }

      const themeJson = this._iconThemeJson;
      const fileNameLower = fileName.toLowerCase();

      const lastDotIndex = fileNameLower.lastIndexOf('.');
      const extName = lastDotIndex >= 0 ? fileNameLower.substring(lastDotIndex + 1) : '';

      // Compound extension for dotfiles/multi-dot names (e.g. ".d.ts", ".test.js")
      const firstDotIndex = fileNameLower.indexOf('.');
      const compoundExt = firstDotIndex >= 0 && firstDotIndex !== lastDotIndex
        ? fileNameLower.substring(firstDotIndex + 1)
        : '';

      const cacheKey = `${fileNameLower}|${languageId || ''}`;

      // Check path cache
      let iconPath = this._iconPathCache.get(cacheKey);

      if (!iconPath) {
        let iconId: string | undefined = undefined;

        // Priority: exact file name → compound ext → simple ext → language id
        if (this._iconMap[`name:${fileNameLower}`]) {
          iconId = this._iconMap[`name:${fileNameLower}`];
        } else if (compoundExt && this._iconMap[`ext:${compoundExt}`]) {
          iconId = this._iconMap[`ext:${compoundExt}`];
        } else if (extName && this._iconMap[`ext:${extName}`]) {
          iconId = this._iconMap[`ext:${extName}`];
        } else if (languageId && this._iconMap[`lang:${languageId.toLowerCase()}`]) {
          iconId = this._iconMap[`lang:${languageId.toLowerCase()}`];
        }

        // Try inferring language from extension
        if (!iconId) {
          let inferredLanguageId = languageId;
          if (!inferredLanguageId) {
            const extensionToLanguageMap: Record<string, string> = {
              js:   'javascript',
              ts:   'typescript',
              jsx:  'javascriptreact',
              tsx:  'typescriptreact',
              json: 'json',
              md:   'markdown',
              py:   'python',
              html: 'html',
              css:  'css',
            };

            inferredLanguageId = extensionToLanguageMap[extName];
          }

          if (inferredLanguageId && this._iconMap[`lang:${inferredLanguageId.toLowerCase()}`]) {
            iconId = this._iconMap[`lang:${inferredLanguageId.toLowerCase()}`];
          } else if (['js', 'ts', 'jsx', 'tsx'].includes(extName)) {
            iconId = this.getJavaScriptTypeScriptIconId(fileNameLower, extName);
          }
        }

        // Fallback al icono de archivo por defecto
        if (!iconId) {
          if (themeJson.iconDefinitions?.['_file']) {
            iconId = '_file';
          } else if (themeJson.iconDefinitions?.['file']) {
            iconId = 'file';
          } else {
            const fileIconKey = Object.keys(themeJson.iconDefinitions || {}).find(
              key => key.toLowerCase().includes('file') && !key.toLowerCase().includes('folder')
            );
            if (fileIconKey) {
              iconId = fileIconKey;
            }
          }
        }

        if (!iconId || !themeJson.iconDefinitions) {
          return undefined;
        }

        const iconDef = themeJson.iconDefinitions[iconId];
        if (!iconDef) {
          return undefined;
        }

        iconPath = iconDef.iconPath || iconDef.path;
        if (!iconPath) {
          return undefined;
        }

        this._iconPathCache.set(cacheKey, iconPath);
      }

      const iconThemeDir = path.dirname(this._iconThemePath!);

      let normalizedIconPath = iconPath;
      if (process.platform === 'win32') {
        normalizedIconPath = iconPath.replace(/\//g, path.sep);
      }

      const absIconPath = path.resolve(iconThemeDir, normalizedIconPath);

      try {
        await fsp.access(absIconPath);
      } catch {
        const altPath = path.join(iconThemeDir, normalizedIconPath);
        try {
          await fsp.access(altPath);
          const result = await this.readIconAndConvertToBase64(altPath);
          if (result) { this._iconCache.set(cacheKey, result); }
          return result;
        } catch {
          return undefined;
        }
      }

      const result = await this.readIconAndConvertToBase64(absIconPath, fileName);
      if (result) { this._iconCache.set(cacheKey, result); }
      return result;
    } catch (e) {
      console.error(`[TabsLover] Error getting icon for ${fileName}:`, e);
      return undefined;
    }
  }

  /** Specialised lookup for JS/TS family icons. */
  private getJavaScriptTypeScriptIconId(
    _fileName: string,
    ext: string
  ): string | undefined {
    if (!this._iconMap || !this._iconThemeJson) {
      return undefined;
    }

    const langMap: Record<string, string[]> = {
      js:  ['lang:javascript', 'ext:js'],
      ts:  ['lang:typescript', 'ext:ts'],
      jsx: ['lang:javascriptreact', 'ext:jsx'],
      tsx: ['lang:typescriptreact', 'ext:tsx'],
    };

    const keys = langMap[ext];
    if (!keys) {
      return undefined;
    }

    for (const key of keys) {
      if (this._iconMap[key]) {
        return this._iconMap[key];
      }
    }

    return undefined;
  }

  /**
   * Pre-loads icons for all currently open tabs in the background.
   */
  public async preloadIconsInBackground(
    context: vscode.ExtensionContext,
    forceRefresh: boolean = false
  ): Promise<void> {
    if (this._isPreloadingIcons && !forceRefresh) {
      return;
    }

    this._isPreloadingIcons = true;
    try {
      const allTabs: vscode.Tab[] = [];
      for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
          allTabs.push(tab);
        }
      }

      const iconPromises: Promise<void>[] = [];

      for (const tab of allTabs) {
        if (tab.input instanceof vscode.TabInputText) {
          const input = tab.input as vscode.TabInputText;
          const fileName = input.uri.path.split('/').pop() || '';

          const loadIcon = async () => {
            try {
              let languageId: string | undefined;
              const doc = vscode.workspace.textDocuments.find(
                d => d.uri.toString() === input.uri.toString()
              );
              if (doc) {
                languageId = doc.languageId;
              }

              if (!languageId && input.uri.scheme === 'file') {
                try {
                  await fsp.access(input.uri.fsPath);
                  const opened = await vscode.workspace.openTextDocument(input.uri);
                  languageId = opened.languageId;
                } catch {
                  // ignore — we'll use the filename only
                }
              }

              const cacheKey = `${fileName}|${languageId || ''}`;
              if (!this._iconCache.has(cacheKey) || forceRefresh) {
                const iconBase64 = await this.getFileIconAsBase64(fileName, context, languageId);
                if (iconBase64) {
                  this._iconCache.set(cacheKey, iconBase64);
                }
              }
            } catch (error) {
              console.error(`[TabsLover] Error preloading icon for ${fileName}:`, error);
            }
          };

          iconPromises.push(loadIcon());
        }
      }

      // Batch execution (5 at a time)
      const batchSize = 5;
      for (let i = 0; i < iconPromises.length; i += batchSize) {
        const batch = iconPromises.slice(i, i + batchSize);
        await Promise.all(batch);
      }
    } finally {
      this._isPreloadingIcons = false;
    }
  }

  /** Retrieve an icon from the in-memory cache. */
  public getCachedIcon(fileName: string, languageId?: string): string | undefined {
    const cacheKey = `${fileName.toLowerCase()}|${languageId || ''}`;
    return this._iconCache.get(cacheKey);
  }

  /** Clear all icon caches. */
  public clearCache(): void {
    this._iconCache.clear();
    this._iconPathCache.clear();
  }

  /** Read an icon file from disk and return a base64 data URI. */
  private async readIconAndConvertToBase64(
    iconPath: string,
    _fileName?: string
  ): Promise<string | undefined> {
    try {
      const fileData   = await fsp.readFile(iconPath);
      const base64Data = fileData.toString('base64');
      const isSvg      = iconPath.toLowerCase().endsWith('.svg');
      const mimeType   = isSvg ? 'image/svg+xml' : 'image/png';
      return `data:${mimeType};base64,${base64Data}`;
    } catch (e) {
      console.error(`[TabsLover] Error reading icon from ${iconPath}:`, e);
      return undefined;
    }
  }
}
