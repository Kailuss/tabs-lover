import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from '../utils/logger';
import { VSCODE_COMMANDS } from '../constants/commands';
import type { SideTabMetadata, SideTabState, SideTabCapabilities, TabViewMode, SideTabType } from './SideTab';

/**
 * Constantes para identificación de tabs especiales.
 */
const MARKDOWN_PREVIEW_PREFIX = 'Preview ';
const MARKDOWN_PREVIEW_VIEWTYPE = 'markdown.preview';

/**
 * Utilidades auxiliares para interactuar con pestañas nativas de VS Code.
 * Separado de SideTabActions para mantener responsabilidades claras.
 */
export class SideTabHelpers {
  /** Maps label keywords to VS Code commands for built-in editor tabs. */
  private static readonly WEBVIEW_COMMANDS: Record<string, string> = {
    'settings':                'workbench.action.openSettings2',
    'keyboard shortcuts':      'workbench.action.openGlobalKeybindings',
    'welcome':                 'workbench.action.showWelcomePage',
    'release notes':           'update.showCurrentReleaseNotes',
    'interactive playground':  'workbench.action.showInteractivePlayground',
  };

  /** Maps viewColumn (1–8) to the specific focusGroup command. */
  private static readonly FOCUS_GROUP_CMDS: Record<number, string> = {
    1: 'workbench.action.focusFirstEditorGroup',
    2: 'workbench.action.focusSecondEditorGroup',
    3: 'workbench.action.focusThirdEditorGroup',
    4: 'workbench.action.focusFourthEditorGroup',
    5: 'workbench.action.focusFifthEditorGroup',
    6: 'workbench.action.focusSixthEditorGroup',
    7: 'workbench.action.focusSeventhEditorGroup',
    8: 'workbench.action.focusEighthEditorGroup',
  };

  /**
   * Detecta si una tab es un Markdown Preview basándose en su metadata.
   */
  static isMarkdownPreview(metadata: SideTabMetadata): boolean {
    // Método 1: Detectar por viewType (más confiable)
    if (metadata.viewType === MARKDOWN_PREVIEW_VIEWTYPE) {
      return true;
    }
    // Método 2: Detectar por label pattern (fallback para webviews)
    if (metadata.tabType === 'webview' && 
        metadata.label.startsWith(MARKDOWN_PREVIEW_PREFIX)) {
      return true;
    }
    return false;
  }

  /**
   * Focuses the editor group that contains this tab.
   */
  static async focusGroup(viewColumn: vscode.ViewColumn): Promise<void> {
    const cmd = SideTabHelpers.FOCUS_GROUP_CMDS[viewColumn];
    if (cmd) {
      await vscode.commands.executeCommand(cmd);
    }
  }

  /**
   * Activates a tab that can't be opened via openTextDocument (webview, unknown, diff).
   * Strategy:
   * 1. For diff tabs: reopen the diff via vscode.diff with the correct viewColumn.
   * 2. For all non-URI tabs: focus group → openEditorAtIndex.
   * 3. Fallback for known built-in tabs: use the mapped VS Code command.
   * 
   * Re-busca la tab nativa cada vez para obtener el estado más actualizado.
   * 
   * NOTA: Las tabs de Markdown Preview se filtran en TabSyncService y no llegan aquí.
   * Se manejan como estado toggle (viewMode) en la tab del archivo fuente.
   */
  static async activateByNativeTab(
    metadata: SideTabMetadata,
    state: SideTabState
  ): Promise<void> {
    // Siempre re-buscar la tab nativa para obtener el estado más reciente
    const nativeTab = SideTabHelpers.findNativeTab(metadata, state);

    // Best approach for any tab: focus its group, then open by native index.
    // This works reliably for diff tabs, webviews, unknown-input tabs, etc.
    if (nativeTab) {
      const tabIndex = nativeTab.group.tabs.indexOf(nativeTab);
      if (tabIndex !== -1) {
        try {
          Logger.log(`[TabHelper] Activating by index: ${metadata.label}, index: ${tabIndex}, isPreview: ${nativeTab.isPreview}`);
          await SideTabHelpers.focusGroup(state.viewColumn);
          await vscode.commands.executeCommand(VSCODE_COMMANDS.OPEN_EDITOR_AT_INDEX, tabIndex);
          return;
        } catch (err) {
          Logger.error('[TabHelper] Failed to activate by index: ' + metadata.label, err);
          /* fall through */
        }
      }
    } else {
      Logger.warn('[TabHelper] Native tab not found for activation: ' + metadata.label);
      // Tab doesn't exist anymore - throw error so caller can handle it
      throw new Error(`Native tab not found: ${metadata.label}`);
    }

    // Fallback for known built-in editor commands (Settings, Welcome, etc.)
    const label = metadata.label.toLowerCase();
    for (const [keyword, cmd] of Object.entries(SideTabHelpers.WEBVIEW_COMMANDS)) {
      if (label.includes(keyword)) {
        try { await vscode.commands.executeCommand(cmd); return; } catch { /* tab may be gone */ }
      }
    }
  }

  /**
   * Checks if a native VS Code tab matches this SideTab's metadata.
   */
  static matchesNative(t: vscode.Tab, metadata: SideTabMetadata): boolean {
    // Webview tabs: match by label (no URI available)
    if (t.input instanceof vscode.TabInputWebview) {
      return t.label === metadata.label;
    }
    // Unknown-input tabs (Settings, Extensions…): also match by label
    if (!t.input) {
      return metadata.tabType === 'unknown' && t.label === metadata.label;
    }
    // Diff tabs: match by modified URI and tab type
    if (t.input instanceof vscode.TabInputTextDiff) {
      return metadata.tabType === 'diff'
        && metadata.uri?.toString() === t.input.modified.toString();
    }
    // A diff SideTab must only match TabInputTextDiff (handled above)
    if (metadata.tabType === 'diff') { return false; }
    // URI-based tabs
    const uri = metadata.uri;
    if (!uri) { return false; }
    if (t.input instanceof vscode.TabInputText)     { return t.input.uri.toString() === uri.toString(); }
    if (t.input instanceof vscode.TabInputCustom)   { return t.input.uri.toString() === uri.toString(); }
    if (t.input instanceof vscode.TabInputNotebook)  { return t.input.uri.toString() === uri.toString(); }
    return false;
  }

  /**
   * Finds the native VS Code tab that corresponds to this SideTab.
   */
  static findNativeTab(metadata: SideTabMetadata, state: SideTabState): vscode.Tab | undefined {
    const group = SideTabHelpers.nativeGroup(state.viewColumn);
    return group?.tabs.find(t => SideTabHelpers.matchesNative(t, metadata));
  }

  /**
   * Gets the native VS Code tab group by view column.
   */
  static nativeGroup(viewColumn: vscode.ViewColumn): vscode.TabGroup | undefined {
    return vscode.window.tabGroups.all.find(g => g.viewColumn === viewColumn);
  }

  //:--> FASE 1: Metadata & State Helpers

  /**
   * Enriches metadata with computed properties for better performance and functionality.
   * Populates: fileName, baseName, dirPath, scheme, isRemote, isUntitled, category.
   * 
   * @param metadata - Base metadata to enrich
   * @returns New metadata object with enriched properties (immutable)
   */
  static enrichMetadata(metadata: SideTabMetadata): SideTabMetadata {
    const enriched = { ...metadata };

    // Extract file information from URI
    if (metadata.uri) {
      const uri = metadata.uri;
      const fsPath = uri.fsPath;
      
      // fileName: full name with extension
      enriched.fileName = path.basename(fsPath);
      
      // baseName: name without extension
      const ext = path.extname(fsPath);
      enriched.baseName = ext ? path.basename(fsPath, ext) : path.basename(fsPath);
      
      // dirPath: parent directory path
      enriched.dirPath = path.dirname(fsPath);
      
      // scheme: URI scheme (file, untitled, vscode-remote, etc.)
      enriched.scheme = uri.scheme;
      
      // isRemote: SSH, WSL, containers, etc.
      enriched.isRemote = uri.scheme !== 'file' && uri.scheme !== 'untitled';
      
      // isUntitled: unsaved new file
      enriched.isUntitled = uri.scheme === 'untitled';
      
      // isBinary: common binary extensions
      const binaryExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.pdf', '.zip', '.exe', '.dll'];
      enriched.isBinary = binaryExts.includes(metadata.fileExtension.toLowerCase());
      
      // category: semantic categorization
      enriched.category = SideTabHelpers.categorizeFile(metadata.fileName || metadata.label, metadata.fileExtension, metadata.dirPath);
    } else {
      // Non-file tabs (webviews, unknown)
      enriched.fileName = undefined;
      enriched.baseName = undefined;
      enriched.dirPath = undefined;
      enriched.scheme = undefined;
      enriched.isRemote = false;
      enriched.isUntitled = false;
      enriched.isBinary = false;
      
      // Categorize webviews/unknown tabs
      enriched.category = SideTabHelpers.categorizeNonFileTab(metadata.tabType, metadata.label);
    }

    return enriched;
  }

  /**
   * Categorizes a file based on its name, extension, and path.
   * Categories: config, test, doc, component, style, script, data, build, asset
   */
  private static categorizeFile(fileName: string, ext: string, dirPath?: string): string {
    const name = fileName.toLowerCase();
    const dir = dirPath?.toLowerCase() || '';
    const extension = ext.toLowerCase();

    // Config files
    if (name.includes('config') || name.includes('settings') || 
        ['.json', '.yaml', '.yml', '.toml', '.ini', '.env'].includes(extension) ||
        name.startsWith('.') && !extension) {
      return 'config';
    }

    // Test files
    if (name.includes('test') || name.includes('spec') || dir.includes('test') || dir.includes('__tests__')) {
      return 'test';
    }

    // Documentation
    if (['.md', '.txt', '.rst', '.adoc'].includes(extension) || name === 'readme' || name === 'license') {
      return 'doc';
    }

    // Styles
    if (['.css', '.scss', '.sass', '.less', '.styl'].includes(extension)) {
      return 'style';
    }

    // Scripts
    if (['.js', '.ts', '.jsx', '.tsx', '.py', '.rb', '.sh', '.ps1', '.bat'].includes(extension)) {
      return dir.includes('script') ? 'script' : 'component';
    }

    // Data files
    if (['.json', '.xml', '.csv', '.sql', '.db'].includes(extension)) {
      return 'data';
    }

    // Build files
    if (name.includes('build') || name.includes('webpack') || name.includes('rollup') || 
        name.includes('vite') || name.includes('esbuild')) {
      return 'build';
    }

    // Assets
    if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.ttf'].includes(extension)) {
      return 'asset';
    }

    return 'file';
  }

  /**
   * Categorizes non-file tabs (webviews, unknown).
   */
  private static categorizeNonFileTab(tabType: SideTabType, label: string): string {
    if (tabType === 'webview') {
      const lower = label.toLowerCase();
      if (lower.includes('settings')) { return 'settings'; }
      if (lower.includes('extension')) { return 'extensions'; }
      if (lower.includes('welcome')) { return 'welcome'; }
      if (lower.includes('output')) { return 'output'; }
      return 'webview';
    }
    if (tabType === 'diff') { return 'diff'; }
    if (tabType === 'notebook') { return 'notebook'; }
    return 'unknown';
  }

  /**
   * Computes capabilities for a tab based on its metadata and state.
   * Determines what actions can be performed (close, pin, edit, etc.).
   * 
   * @param metadata - Tab metadata
   * @param state - Tab state
   * @returns Computed capabilities object
   */
  static computeCapabilities(metadata: SideTabMetadata, state: Partial<SideTabState>): SideTabCapabilities {
    const hasUri = !!metadata.uri;
    const isFile = metadata.tabType === 'file';
    const isDiff = metadata.tabType === 'diff';
    const isWebview = metadata.tabType === 'webview';
    const isNotebook = metadata.tabType === 'notebook';
    const isReadOnly = metadata.isReadOnly || false;
    const isBinary = metadata.isBinary || false;
    const isRemote = metadata.isRemote || false;
    
    // Get permissions to check restrictions
    const permissions = state.permissions || {
      canRename: true,
      canDelete: true,
      canMove: true,
      canShare: true,
      canExport: true,
      restrictedActions: [],
    };
    
    // Preview toggle: Markdown, SVG, HTML files
    const ext = metadata.fileExtension.toLowerCase();
    const supportsPreview = ['.md', '.svg', '.html', '.htm'].includes(ext);

    return {
      // BASIC ACTIONS
      canClose: true, // All tabs can be closed
      canPin: !state.isPinned && !isDiff, // Can't pin if already pinned or is a diff
      canUnpin: state.isPinned || false,
      canSplit: hasUri && !isDiff, // Can split if has URI and not a diff
      canRename: isFile && !isReadOnly && !isRemote && permissions.canRename,

      // NAVIGATION
      canRevealInExplorer: hasUri && metadata.scheme === 'file',
      canCopyPath: hasUri && permissions.canShare,
      canOpenInTerminal: hasUri && metadata.scheme === 'file' && !!metadata.dirPath,

      // COMPARISON
      canCompare: isFile && hasUri,
      canCompareWith: isFile && hasUri,

      // VISUALIZATION
      canTogglePreview: supportsPreview && hasUri,
      canReload: isWebview,
      canZoom: isBinary, // Images, PDFs

      // EDITING
      canEdit: !isReadOnly && !isBinary && (isFile || isNotebook),
      canFormat: !isReadOnly && !isBinary && isFile,
      canSave: state.isDirty || false,

      // HIERARCHY
      canHaveChildren: isFile && hasUri, // File tabs can have diffs as children
      canBeChild: isDiff,
      canExpand: state.hasChildren || false,

      // ADVANCED
      canDragDrop: !state.isPinned && !isDiff && permissions.canMove, // Pinned and diff tabs can't be dragged
      canProtect: !state.isProtected || false,
      supportsGit: hasUri && metadata.scheme === 'file',
      supportsDiagnostics: isFile && hasUri,
    };
  }

  /**
   * Creates default state for new properties added in refactoring.
   * Returns partial state to be merged with base state from VS Code.
   * 
   * @returns Partial state with default values for new properties
   */
  static createDefaultState(): Partial<SideTabState> {
    return {
      // VISUALIZATION MODE
      viewMode: 'source', // Default to source view
      
      // ACTION CONTEXT (NEW)
      actionContext: {
        viewMode: 'source',
        editMode: 'editable',
        compareMode: false,
        debugMode: false,
      },
      
      // OPERATION STATE (NEW)
      operationState: {
        isProcessing: false,
        canCancel: false,
      },
      
      // CAPABILITIES (will be computed separately)
      capabilities: SideTabHelpers.createEmptyCapabilities(),
      
      // PERMISSIONS (NEW)
      permissions: {
        canRename: true,
        canDelete: true,
        canMove: true,
        canShare: true,
        canExport: true,
        restrictedActions: [],
      },
      
      // HIERARCHY
      hasChildren: false,
      isChild: false,
      isExpanded: false,  // Non-optional: always initialized
      childrenCount: 0,   // Non-optional: always initialized
      
      // UI STATE
      isLoading: false,
      hasError: false,
      errorMessage: undefined,
      isHighlighted: false,
      
      // TRACKING
      lastAccessTime: Date.now(),
      syncVersion: 0,
      
      // DECORATIONS (will be computed from VS Code)
      gitStatus: null,
      diagnosticSeverity: null,
      
      // PROTECTION
      isTransient: false,
      isProtected: false,
      
      // INTEGRATIONS (NEW)
      integrations: {
        copilot: {
          inContext: false,
        },
        git: {
          hasUncommittedChanges: false,
        },
      },
      
      // CUSTOMIZATION (NEW) - undefined by default
      customActions: undefined,
      shortcuts: undefined,
    };
  }

  /**
   * Creates an empty capabilities object with all flags set to false.
   * Used as placeholder before real capabilities are computed.
   */
  private static createEmptyCapabilities(): SideTabCapabilities {
    return {
      canClose: false,
      canPin: false,
      canUnpin: false,
      canSplit: false,
      canRename: false,
      canRevealInExplorer: false,
      canCopyPath: false,
      canOpenInTerminal: false,
      canCompare: false,
      canCompareWith: false,
      canTogglePreview: false,
      canReload: false,
      canZoom: false,
      canEdit: false,
      canFormat: false,
      canSave: false,
      canHaveChildren: false,
      canBeChild: false,
      canExpand: false,
      canDragDrop: false,
      canProtect: false,
      supportsGit: false,
      supportsDiagnostics: false,
    };
  }

  /**
   * Maps legacy previewMode boolean to new viewMode enum.
   * 
   * @param previewMode - Legacy boolean preview mode
   * @returns Corresponding TabViewMode
   */
  static mapPreviewModeToViewMode(previewMode: boolean): TabViewMode {
    return previewMode ? 'preview' : 'source';
  }

  /**
   * Maps viewMode enum to legacy previewMode boolean for backward compatibility.
   * 
   * @param viewMode - Current view mode
   * @returns Boolean preview mode
   */
  static mapViewModeToPreviewMode(viewMode: TabViewMode): boolean {
    return viewMode === 'preview';
  }
}
