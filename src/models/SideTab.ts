import * as vscode from 'vscode';
import * as path   from 'path';

// The kind of editor input the tab represents.
export type SideTabType = 'file' | 'diff' | 'webview' | 'custom' | 'notebook' | 'unknown';

// Immutable metadata describing a tab.
export interface SideTabMetadata {

  id           : string;      // Unique identifier (uri-based for file tabs, label-based for webview tabs).
  uri?         : vscode.Uri;  // File URI. Only present for file / custom / notebook tabs.
  label        : string;      // Display name shown in the sidebar.
  description? : string;      // Relative path (description line).
  tooltip?     : string;      // Tooltip text.
  fileType     : string;      // File extension (e.g. ".ts"). Empty for non-file tabs.
  tabType      : SideTabType; // What kind of VS Code tab input this wraps.
  viewType?    : string;      // Webview / custom editor viewType (for icon mapping).

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
 * Representa una pestaña en la barra lateral de Tabs Lover.
 * En pocas palabras: guarda la información que mostramos (nombre, ruta, icono)
 * y ofrece métodos para las acciones que el usuario puede realizar (abrir, cerrar, pinear...).
 */
export class SideTab {
  constructor(
    public readonly metadata: SideTabMetadata,
    public state: SideTabState,
  ) {}

  //:--> Acciones básicas
  async close(): Promise<void> {
    const t = this.findNativeTab();
    if (t) { await vscode.window.tabGroups.close(t); }
  }

  async closeOthers(): Promise<void> {
    await this.activate();
    await vscode.commands.executeCommand('workbench.action.closeOtherEditors');
  }

  async closeGroup(): Promise<void> {
    const group = this.nativeGroup();
    if (!group) { return; }
    await vscode.window.tabGroups.close(group);
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
    // This is actually "Reveal in Explorer View" (VS Code's file explorer)
    if (this.metadata.uri) {
      await vscode.commands.executeCommand('revealInExplorer', this.metadata.uri);
    }
  }

  async revealInExplorerView(): Promise<void> {
    // VS Code's file explorer panel
    if (this.metadata.uri) {
      await vscode.commands.executeCommand('revealInExplorer', this.metadata.uri);
    }
  }

  async revealInFileExplorer(): Promise<void> {
    // OS file explorer (Finder, Explorer, etc.)
    if (this.metadata.uri) {
      await vscode.commands.executeCommand('revealFileInOS', this.metadata.uri);
    }
  }

  async openTimeline(): Promise<void> {
    if (!this.metadata.uri) { return; }
    await vscode.commands.executeCommand('timeline.focus');
    await this.activate();
  }

  async copyRelativePath(): Promise<void> {
    if (!this.metadata.uri) { return; }
    const rel = vscode.workspace.asRelativePath(this.metadata.uri);
    await vscode.env.clipboard.writeText(rel);
    vscode.window.showInformationMessage(`Copied: ${rel}`);
  }

  async copyPath(): Promise<void> {
    if (!this.metadata.uri) { return; }
    await vscode.env.clipboard.writeText(this.metadata.uri.fsPath);
    vscode.window.showInformationMessage(`Copied: ${this.metadata.uri.fsPath}`);
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

  async duplicateFile(): Promise<void> {
    if (!this.metadata.uri) { return; }
    try {
      // Read original file content
      const content = await vscode.workspace.fs.readFile(this.metadata.uri);
      
      // Generate new filename
      const dir = path.dirname(this.metadata.uri.fsPath);
      const ext = path.extname(this.metadata.uri.fsPath);
      const basename = path.basename(this.metadata.uri.fsPath, ext);
      
      // Find next available name: file-copy.ext, file-copy2.ext, etc.
      let counter = 1;
      let newName = `${basename}-copy${ext}`;
      let newPath = path.join(dir, newName);
      let newUri = vscode.Uri.file(newPath);
      
      while (true) {
        try {
          await vscode.workspace.fs.stat(newUri);
          // File exists, try next number
          counter++;
          newName = `${basename}-copy${counter}${ext}`;
          newPath = path.join(dir, newName);
          newUri = vscode.Uri.file(newPath);
        } catch {
          // File doesn't exist, use this name
          break;
        }
      }
      
      // Create the duplicate
      await vscode.workspace.fs.writeFile(newUri, content);
      
      // Open in the same view column as the original
      await vscode.window.showTextDocument(newUri, {
        viewColumn: this.state.viewColumn,
        preserveFocus: false,
      });
      
      vscode.window.showInformationMessage(`File duplicated: ${newName}`);
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to duplicate file: ${err}`);
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

  async openChanges(): Promise<void> {
    if (!this.metadata.uri) { return; }
    await vscode.commands.executeCommand('git.openChange', this.metadata.uri);
  }

  async splitRight(): Promise<void> {
    if (!this.metadata.uri) { return; }
    await vscode.commands.executeCommand('vscode.open', this.metadata.uri, {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: false,
    });
  }

  async moveToNewWindow(): Promise<void> {
    if (!this.metadata.uri) { return; }
    await vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow');
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
    if (this.metadata.tabType === 'webview' || this.metadata.tabType === 'unknown' || this.metadata.tabType === 'diff') {
      return this.activateByNativeTab();
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
   * Focuses the editor group that contains this tab.
   */
  private async focusGroup(): Promise<void> {
    const cmd = SideTab.FOCUS_GROUP_CMDS[this.state.viewColumn];
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
   */
  private async activateByNativeTab(): Promise<void> {
    const nativeTab = this.findNativeTab();

    // Best approach for any tab: focus its group, then open by native index.
    // This works reliably for diff tabs, webviews, unknown-input tabs, etc.
    if (nativeTab) {
      const tabIndex = nativeTab.group.tabs.indexOf(nativeTab);
      if (tabIndex !== -1) {
        try {
          await this.focusGroup();
          await vscode.commands.executeCommand('workbench.action.openEditorAtIndex', tabIndex);
          return;
        } catch { /* fall through */ }
      }
    }

    // Fallback for known built-in editor commands (Settings, Welcome, etc.)
    const label = this.metadata.label.toLowerCase();
    for (const [keyword, cmd] of Object.entries(SideTab.WEBVIEW_COMMANDS)) {
      if (label.includes(keyword)) {
        try { await vscode.commands.executeCommand(cmd); return; } catch { /* tab may be gone */ }
      }
    }
  }

  private matchesNative(t: vscode.Tab): boolean {
    // Webview tabs: match by label (no URI available)
    if (t.input instanceof vscode.TabInputWebview) {
      return t.label === this.metadata.label;
    }
    // Unknown-input tabs (Settings, Extensions…): also match by label
    if (!t.input) {
      return this.metadata.tabType === 'unknown' && t.label === this.metadata.label;
    }
    // Diff tabs: match by modified URI and tab type
    if (t.input instanceof vscode.TabInputTextDiff) {
      return this.metadata.tabType === 'diff'
        && this.metadata.uri?.toString() === t.input.modified.toString();
    }
    // A diff SideTab must only match TabInputTextDiff (handled above)
    if (this.metadata.tabType === 'diff') { return false; }
    // URI-based tabs
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
