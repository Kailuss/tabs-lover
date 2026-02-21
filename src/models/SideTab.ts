import * as vscode from 'vscode';
import { SideTabActions } from './SideTabActions';

//: The kind of editor input the tab represents.
export type SideTabType = 'file' | 'diff' | 'webview' | 'custom' | 'notebook' | 'unknown';
//: Git decoration status for a file
export type GitStatus   = 'modified' | 'added' | 'deleted' | 'untracked' | 'ignored' | 'conflict' | null;
//: View mode for tabs that support multiple visualizations
export type TabViewMode = 'source' | 'preview' | 'split';

/**
 * Immutable metadata describing a tab.
 * Computed once at creation and should not change during tab lifetime.
 */
export type SideTabMetadata = {
  //: IDENTITY
  id            : string;        // Unique identifier (uri-based for file tabs, label-based for webview tabs).
  parentId?     : string;        // ID of parent tab (for diff tabs that belong to a file tab).
  tabType       : SideTabType;   // What kind of VS Code tab input this wraps.

  //: FILE INFORMATION
  uri?          : vscode.Uri;    // File URI. Only present for file / custom / notebook tabs.
  fileName?     : string;        // Base file name with extension (e.g. "SideTab.ts")
  baseName?     : string;        // File name without extension (e.g. "SideTab")
  fileExtension : string;        // File extension with dot (e.g. ".ts"). Empty for non-file tabs.
  dirPath?      : string;        // Parent directory path (for reveal/terminal actions)

  //: URI CHARACTERISTICS (cached for performance)
  scheme?       : string;        // URI scheme: file, untitled, vscode-remote, etc.
  isRemote?     : boolean;       // Is remote file (SSH, WSL, containers)
  isUntitled?   : boolean;       // Is unsaved new file

  //: DISPLAY
  label         : string;        // Display name shown in the sidebar.
  detailLabel?  : string;        // Relative path (description line).
  tooltipText?  : string;        // Tooltip text (can be enriched with size, date, etc.)

  //: VISUAL IDENTITY
  iconId?       : string;        // Cached icon ID from FileActionRegistry (performance)
  category?     : string;        // Semantic category: config, test, doc, component, style, etc.

  //: LANGUAGE & EDITOR
  languageId?   : string;        // VS Code language ID (typescript, markdown, python...)
  viewType?     : string;        // Webview / custom editor viewType (for icon mapping).

  //: FILE CHARACTERISTICS
  isReadOnly?   : boolean;       // File is read-only (permissions or remote)
  isBinary?     : boolean;       // Binary file (images, PDFs, etc.)
  isSymlink?    : boolean;       // File is symbolic link
  fileSize?     : number;        // File size in bytes (useful for large file warnings)

  //: RELATIONSHIPS
  relatedTabIds?: string[];      // Related tabs (diff pair, preview pair, etc.)
  originalUri?  : vscode.Uri;    // Original URI before rename/move (for tracking)

  //: EXTENSIBILITY
  customData?   : Record<string, any>;  // Extension-specific metadata
}

/**
 * Capabilities define what actions can be performed on a tab.
 * Computed from metadata and state to enable/disable UI actions.
 */
export type SideTabCapabilities = {
  //: BASIC ACTIONS
  canClose            : boolean; // Can be closed
  canPin              : boolean; // Can be pinned
  canUnpin            : boolean; // Can be unpinned
  canSplit            : boolean; // Can be opened in split view
  canRename           : boolean; // Can be renamed (files vs webviews)

  //: NAVIGATION
  canRevealInExplorer : boolean; // Has physical file to reveal
  canCopyPath         : boolean; // Has copyable path
  canOpenInTerminal   : boolean; // Can open terminal in directory

  //: COMPARISON
  canCompare          : boolean; // Can be compared (diff)
  canCompareWith      : boolean; // Can be selected for comparison

  //: VISUALIZATION
  canTogglePreview    : boolean; // Can toggle source ↔ preview (MD, SVG...)
  canReload           : boolean; // Can be reloaded (webviews)
  canZoom             : boolean; // Has zoom capability (images, PDFs)

  //: EDITING
  canEdit             : boolean; // Is editable
  canFormat           : boolean; // Can be formatted
  canSave             : boolean; // Can be saved

  //: HIERARCHY
  canHaveChildren     : boolean; // Can have child tabs
  canBeChild          : boolean; // Can be a child tab
  canExpand           : boolean; // Can be expanded (if has children)

  //: ADVANCED
  canDragDrop         : boolean; // Can be dragged/reordered
  canProtect          : boolean; // Can be marked as protected
  supportsGit         : boolean; // Has git status
  supportsDiagnostics : boolean; // Has diagnostics (errors/warnings)
};

//: Mutable runtime state of a tab.
export type SideTabState = {
  //: VS CODE NATIVE STATE (synchronized)
  isActive           : boolean;
  isDirty            : boolean;
  isPinned           : boolean;
  isPreview          : boolean;  // VS Code preview tab (italic, replaceable)
  
  //: LOCATION
  groupId            : number;
  viewColumn         : vscode.ViewColumn;
  indexInGroup       : number;
  
  //: VISUALIZATION MODE
  viewMode           : TabViewMode;  // How the tab is visualized: source | preview | split
  /** @deprecated Use viewMode instead. Kept for backward compatibility. */
  previewMode        : boolean;  // For MD files: true = show preview, false = show source
  
  //: CAPABILITIES
  capabilities       : SideTabCapabilities;  // What actions can be performed
  
  //: HIERARCHY
  hasChildren        : boolean;   // Has child tabs (diffs, previews)
  isChild            : boolean;   // Is a child tab of another
  isExpanded         : boolean;   // If has children: is expanded in UI?
  childrenCount      : number;    // Number of child tabs (for badge display)
  
  //: UI STATE
  isLoading          : boolean;   // Loading content (large files, remote)
  hasError           : boolean;   // Error loading/syncing
  errorMessage?      : string;    // Error description
  isHighlighted      : boolean;   // Temporarily highlighted (search, navigation)
  
  //: TRACKING
  lastAccessTime     : number;    // Timestamp of last access
  syncVersion        : number;    // Sync version (prevent stale updates)
  
  //: DECORATIONS
  gitStatus          : GitStatus;  // Git decoration state
  diagnosticSeverity : vscode.DiagnosticSeverity | null;  // Highest severity (error > warning)
  
  //: PROTECTION
  isTransient        : boolean;   // Closes automatically (like VS Code preview)
  isProtected        : boolean;   // Requires confirmation to close
}

/**
 * Representa una pestaña en la barra lateral de Tabs Lover.
 * En pocas palabras: guarda la información que mostramos (nombre, ruta, icono)
 * y ofrece métodos para las acciones que el usuario puede realizar (abrir, cerrar, pinear...).
 * Los métodos de acción están definidos en SideTabActions (herencia).
 */
export class SideTab extends SideTabActions {
  constructor(
    public readonly metadata: SideTabMetadata,
    public state: SideTabState,
  ) {
    super();
  }
}
