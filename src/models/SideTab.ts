import * as vscode from 'vscode';
import * as path from 'path';

/** Immutable metadata describing a tab's file. */
export interface SideTabMetadata {
  id: string;
  uri: vscode.Uri;
  label: string;
  description?: string;
  tooltip?: string;
  fileType: string;
}

/** Mutable runtime state of a tab. */
export interface SideTabState {
  isActive: boolean;
  isDirty: boolean;
  isPinned: boolean;
  isPreview: boolean;
  groupId: number;
  viewColumn: vscode.ViewColumn;
  indexInGroup: number;
  scmStatus?: 'modified' | 'untracked' | 'staged' | 'clean';
  copilotEdited?: boolean;
  lastAccessTime: number;
}

/** Feature flags that control which actions are available on a tab. */
export interface SideTabCapabilities {
  canClose: boolean;
  canPin: boolean;
  canReveal: boolean;
  canAddToChat: boolean;
  canCompare: boolean;
  canMove: boolean;
}

const DEFAULT_CAPABILITIES: SideTabCapabilities = {
  canClose: true,
  canPin: true,
  canReveal: true,
  canAddToChat: true,
  canCompare: true,
  canMove: true,
};

/**
 * Represents a single tab in the Tabs Lover sidebar.
 * Wraps VS Code tab data and exposes high-level actions.
 */
export class SideTab {
  constructor(
    public metadata: SideTabMetadata,
    public state: SideTabState,
    public capabilities: SideTabCapabilities = DEFAULT_CAPABILITIES
  ) {}

  // === Basic actions ===

  /** Close this tab via the VS Code Tab API. */
  async close(): Promise<void> {
    const tab = this.findVSCodeTab();
    if (tab) {
      await vscode.window.tabGroups.close(tab);
    }
  }

  /** Activate this tab and close all other editors in the group. */
  async closeOthers(): Promise<void> {
    await this.activate();
    await vscode.commands.executeCommand('workbench.action.closeOtherEditors');
  }

  /** Close all tabs to the right of this one in the same group. */
  async closeToRight(): Promise<void> {
    const group = this.getGroup();
    if (!group) {
      return;
    }

    const tabIndex = group.tabs.findIndex(t => {
      const input = t.input as vscode.TabInputText;
      return input.uri?.toString() === this.metadata.uri.toString();
    });

    if (tabIndex === -1) {
      return;
    }

    const tabsToClose = group.tabs.slice(tabIndex + 1);
    for (const tab of tabsToClose) {
      await vscode.window.tabGroups.close(tab);
    }
  }

  /** Pin this tab in its editor group. */
  async pin(): Promise<void> {
    await this.activate();
    await vscode.commands.executeCommand('workbench.action.pinEditor');
    this.state.isPinned = true;
  }

  /** Unpin this tab in its editor group. */
  async unpin(): Promise<void> {
    await this.activate();
    await vscode.commands.executeCommand('workbench.action.unpinEditor');
    this.state.isPinned = false;
  }

  /** Reveal this file in the Explorer view. */
  async revealInExplorer(): Promise<void> {
    await vscode.commands.executeCommand('revealInExplorer', this.metadata.uri);
  }

  // === Advanced actions ===

  /** Copy the workspace-relative path to the clipboard. */
  async copyRelativePath(): Promise<void> {
    const relative = vscode.workspace.asRelativePath(this.metadata.uri);
    await vscode.env.clipboard.writeText(relative);
    vscode.window.showInformationMessage(`Copied: ${relative}`);
  }

  /** Copy the entire file contents to the clipboard. */
  async copyFileContents(): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(this.metadata.uri);
      await vscode.env.clipboard.writeText(doc.getText());
      vscode.window.showInformationMessage('File contents copied to clipboard');
    } catch {
      vscode.window.showErrorMessage('Failed to copy file contents');
    }
  }

  /** Open a diff view comparing the active editor with this file. */
  async compareWithActive(): Promise<void> {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      vscode.window.showWarningMessage('No active editor to compare with');
      return;
    }

    await vscode.commands.executeCommand(
      'vscode.diff',
      activeEditor.document.uri,
      this.metadata.uri,
      `${path.basename(activeEditor.document.fileName)} ↔ ${this.metadata.label}`
    );
  }

  /** Move this tab to a different editor group column. */
  async moveToGroup(targetColumn: vscode.ViewColumn): Promise<void> {
    await this.close();
    const doc = await vscode.workspace.openTextDocument(this.metadata.uri);
    await vscode.window.showTextDocument(doc, {
      viewColumn: targetColumn,
      preview: this.state.isPreview,
      preserveFocus: true,
    });
  }

  // === Internal helpers ===

  /** Focus this tab in the editor. */
  async activate(): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(this.metadata.uri);
    await vscode.window.showTextDocument(doc, {
      viewColumn: this.state.viewColumn,
      preserveFocus: false,
    });
  }

  private findVSCodeTab(): vscode.Tab | undefined {
    const group = vscode.window.tabGroups.all.find(
      g => g.viewColumn === this.state.viewColumn
    );

    return group?.tabs.find(t => {
      const input = t.input as vscode.TabInputText;
      return input.uri?.toString() === this.metadata.uri.toString();
    });
  }

  private getGroup(): vscode.TabGroup | undefined {
    return vscode.window.tabGroups.all.find(
      g => g.viewColumn === this.state.viewColumn
    );
  }
}
