import * as vscode from 'vscode';
import * as path   from 'path';

// The kind of editor input the tab represents.
export type SideTabType = 'file' | 'webview' | 'custom' | 'notebook';

// Immutable metadata describing a tab.
export interface SideTabMetadata {

  id           : string;      // Unique identifier (uri-based for file tabs, label-based for webview tabs).
  uri?         : vscode.Uri;  // File URI. Only present for file / custom / notebook tabs.
  label        : string;      // Display name shown in the sidebar.
  description? : string;      // Relative path (description line).
  tooltip?     : string;      // Tooltip text.
  fileType     : string;      // File extension (e.g. ".ts"). Empty for non-file tabs.
  tabType      : SideTabType; // What kind of VS Code tab input this wraps.

}

// Mutable runtime state of a tab.
export interface SideTabState {
  isActive       : boolean;
  isDirty        : boolean;
  isPinned       : boolean;
  isPreview      : boolean;
  groupId        : number;
  viewColumn     : vscode.ViewColumn;
  indexInGroup   : number;
  lastAccessTime : number;
}

/**
 * Represents a single tab in the Tabs Lover sidebar.
 * Wraps VS Code tab data and exposes high-level actions.
*/
export class SideTab {
  constructor(
    public readonly metadata: SideTabMetadata,
    public state: SideTabState,
  ) {}

  //:-->  Basic actions

  async close(): Promise<void> {
    const t = this.findNativeTab();
    if (t) { await vscode.window.tabGroups.close(t); }
  }

  async closeOthers(): Promise<void> {
    await this.activate();
    await vscode.commands.executeCommand('workbench.action.closeOtherEditors');
  }

  async closeToRight(): Promise<void> {

    const group = this.nativeGroup();
    if (!group) { return; }

    const idx = group.tabs.findIndex(t => this.matchesNative(t));
    if (idx === -1) { return; }

    for (const t of group.tabs.slice(idx + 1)) {
      await vscode.window.tabGroups.close(t);
    }
  }

  async pin(): Promise<void> {
    await this.activate();
    await vscode.commands.executeCommand('workbench.action.pinEditor');
    this.state.isPinned = true;
  }

  async unpin(): Promise<void> {
    await this.activate();
    await vscode.commands.executeCommand('workbench.action.unpinEditor');
    this.state.isPinned = false;
  }

  async revealInExplorer(): Promise<void> {
    if (this.metadata.uri) {
      await vscode.commands.executeCommand('revealInExplorer', this.metadata.uri);
    }
  }

  async copyRelativePath(): Promise<void> {
    if (!this.metadata.uri) { return; }
    const rel = vscode.workspace.asRelativePath(this.metadata.uri);
    await vscode.env.clipboard.writeText(rel);
    vscode.window.showInformationMessage(`Copied: ${rel}`);
  }

  async copyFileContents(): Promise<void> {
    if (!this.metadata.uri) { return; }
    try {
      const doc = await vscode.workspace.openTextDocument(this.metadata.uri);
      await vscode.env.clipboard.writeText(doc.getText());
      vscode.window.showInformationMessage('File contents copied to clipboard');
    } catch {
      vscode.window.showErrorMessage('Failed to copy file contents');
    }
  }

  async compareWithActive(): Promise<void> {
    if (!this.metadata.uri) { return; }
    const active = vscode.window.activeTextEditor;
    if (!active) { return; }
    await vscode.commands.executeCommand(
      'vscode.diff',
      active.document.uri,
      this.metadata.uri,
      `${path.basename(active.document.fileName)} ↔ ${this.metadata.label}`,
    );
  }

  async moveToGroup(target: vscode.ViewColumn): Promise<void> {
    if (!this.metadata.uri) { return; }
    await this.close();
    await vscode.commands.executeCommand('vscode.open', this.metadata.uri, {
      viewColumn: target,
      preview: this.state.isPreview,
    });
  }

  //:-->  Activate (focus)

  async activate(): Promise<void> {
    if (this.metadata.tabType === 'webview') {
      return this.activateWebview();
    }
    if (!this.metadata.uri) { return; }
    try {
      const doc = await vscode.workspace.openTextDocument(this.metadata.uri);
      await vscode.window.showTextDocument(doc, {
        viewColumn: this.state.viewColumn,
        preserveFocus: false,
      });
    } catch {
      await vscode.commands.executeCommand('vscode.open', this.metadata.uri, {
        viewColumn: this.state.viewColumn,
        preview: this.state.isPreview,
      });
    }
  }

  //:-->  Private helpers

  private static readonly WEBVIEW_COMMANDS: Record<string, string> = {
    settings:                 'workbench.action.openSettings2',
    extension:                'workbench.extensions.action.showInstalledExtensions',
    keyboard:                 'workbench.action.openGlobalKeybindings',
    welcome:                  'workbench.action.showWelcomePage',
    'release notes':          'update.showCurrentReleaseNotes',
    'interactive playground': 'workbench.action.showInteractivePlayground',
  };

  private async activateWebview(): Promise<void> {
    const label = this.metadata.label.toLowerCase();
    for (const [keyword, cmd] of Object.entries(SideTab.WEBVIEW_COMMANDS)) {
      if (label.includes(keyword)) {
        try { await vscode.commands.executeCommand(cmd); } catch { /* tab may be gone */ }
        return;
      }
    }
  }

  private matchesNative(t: vscode.Tab): boolean {
    if (t.input instanceof vscode.TabInputWebview) { return t.label === this.metadata.label; } // Si es webview, no URI to compare — match by label instead (e.g. "Settings", "Extensions")
    const uri = this.metadata.uri;
    if (!uri) { return false; }
    if (t.input instanceof vscode.TabInputText)     { return t.input.uri.toString() === uri.toString(); }
    if (t.input instanceof vscode.TabInputCustom)   { return t.input.uri.toString() === uri.toString(); }
    if (t.input instanceof vscode.TabInputNotebook)  { return t.input.uri.toString() === uri.toString(); }
    return false;
  }

  private findNativeTab(): vscode.Tab | undefined {
    return this.nativeGroup()?.tabs.find(t => this.matchesNative(t));
  }

  private nativeGroup(): vscode.TabGroup | undefined {
    return vscode.window.tabGroups.all.find(g => g.viewColumn === this.state.viewColumn);
  }
}
