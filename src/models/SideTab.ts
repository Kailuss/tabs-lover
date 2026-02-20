import * as vscode from 'vscode';
import { SideTabActions } from './SideTabActions';

//: The kind of editor input the tab represents.
export type SideTabType = 'file' | 'diff' | 'webview' | 'custom' | 'notebook' | 'unknown';
//: Git decoration status for a file
export type GitStatus   = 'modified' | 'added' | 'deleted' | 'untracked' | 'ignored' | 'conflict' | null;

//: Immutable metadata describing a tab.
export type SideTabMetadata = {
  
  id           : string;      // Unique identifier (uri-based for file tabs, label-based for webview tabs).
  uri?         : vscode.Uri;  // File URI. Only present for file / custom / notebook tabs.
  label        : string;      // Display name shown in the sidebar.
  description? : string;      // Relative path (description line).
  tooltip?     : string;      // Tooltip text.
  fileType     : string;      // File extension (e.g. ".ts"). Empty for non-file tabs.
  tabType      : SideTabType; // What kind of VS Code tab input this wraps.
  viewType?    : string;      // Webview / custom editor viewType (for icon mapping).
}

//: Mutable runtime state of a tab.
export type SideTabState = {
  isActive       : boolean;
  isDirty        : boolean;
  isPinned       : boolean;
  isPreview      : boolean;
  groupId        : number;
  viewColumn     : vscode.ViewColumn;
  indexInGroup   : number;
  lastAccessTime : number;
  gitStatus      : GitStatus;                    // Git decoration state
  diagnosticSeverity : vscode.DiagnosticSeverity | null;  // Highest severity diagnostic (error > warning)
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
