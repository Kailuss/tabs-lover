import * as vscode from 'vscode';
import * as path from 'path';
import { TabStateService } from './TabStateService';
import { SideTab, SideTabMetadata, SideTabState, SideTabType } from '../models/SideTab';
import { createTabGroup } from '../models/SideTabGroup';

/**
 * Keeps the in-memory TabStateService in sync with VS Code's
 * native Tab API by listening to tab and group change events.
 */
export class TabSyncService {
  private disposables: vscode.Disposable[] = [];

  constructor(private stateService: TabStateService) {}

  /** Register listeners and perform initial sync. */
  activate(context: vscode.ExtensionContext): void {
    this.syncAll();

    this.disposables.push(
      vscode.window.tabGroups.onDidChangeTabs(e => this.handleTabChanges(e)),
    );

    this.disposables.push(
      vscode.window.tabGroups.onDidChangeTabGroups(e => this.handleGroupChanges(e)),
    );

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) { this.updateActiveTab(editor.document.uri); }
      }),
    );

    context.subscriptions.push(...this.disposables);
  }

  /* ------------------------------------------------------------------ */
  /*  Event handlers                                                     */
  /* ------------------------------------------------------------------ */

  private handleTabChanges(e: vscode.TabChangeEvent): void {
    for (const tab of e.opened) {
      const st = this.convertToSideTab(tab);
      if (st) { this.stateService.addTab(st); }
    }

    for (const tab of e.closed) {
      const st = this.convertToSideTab(tab);
      if (st) { this.stateService.removeTab(st.metadata.id); }
    }

    for (const tab of e.changed) {
      const st = this.convertToSideTab(tab);
      if (!st) { continue; }

      const existing = this.stateService.getTab(st.metadata.id);
      if (!existing) {
        this.stateService.updateTab(st);
        continue;
      }

      const onlyActive =
        existing.state.isDirty   === tab.isDirty   &&
        existing.state.isPinned  === tab.isPinned  &&
        existing.state.isPreview === tab.isPreview  &&
        existing.state.isActive  !== tab.isActive;

      existing.state.isActive  = tab.isActive;
      existing.state.isDirty   = tab.isDirty;
      existing.state.isPinned  = tab.isPinned;
      existing.state.isPreview = tab.isPreview;

      if (onlyActive) {
        this.stateService.updateTabSilent(existing);
      } else {
        this.stateService.updateTab(existing);
      }
    }
  }

  private handleGroupChanges(e: vscode.TabGroupChangeEvent): void {
    for (const g of e.opened)  { this.stateService.addGroup(createTabGroup(g)); }
    for (const g of e.closed)  { this.stateService.removeGroup(g.viewColumn); }

    if (e.changed.length > 0) {
      this.stateService.setActiveGroup(vscode.window.tabGroups.activeTabGroup.viewColumn);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Full sync                                                          */
  /* ------------------------------------------------------------------ */

  private syncAll(): void {
    for (const group of vscode.window.tabGroups.all) {
      this.stateService.addGroup(createTabGroup(group));
    }

    const allTabs: SideTab[] = [];
    for (const group of vscode.window.tabGroups.all) {
      group.tabs.forEach((tab, idx) => {
        const st = this.convertToSideTab(tab, idx);
        if (st) { allTabs.push(st); }
      });
    }
    this.stateService.replaceTabs(allTabs);
  }

  /* ------------------------------------------------------------------ */
  /*  Active-tab tracker                                                 */
  /* ------------------------------------------------------------------ */

  private updateActiveTab(activeUri: vscode.Uri): void {
    const activeStr = activeUri.toString();

    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const st = this.convertToSideTab(tab);
        if (!st) { continue; }

        const existing = this.stateService.getTab(st.metadata.id);
        if (!existing) { continue; }

        const isNowActive = st.metadata.uri?.toString() === activeStr;
        if (existing.state.isActive !== isNowActive) {
          existing.state.isActive = isNowActive;
          this.stateService.updateTabSilent(existing);
        }
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Convert native → SideTab                                           */
  /* ------------------------------------------------------------------ */

  private convertToSideTab(tab: vscode.Tab, index?: number): SideTab | null {
    let uri         : vscode.Uri | undefined;
    let label       : string;
    let description : string | undefined;
    let tooltip     : string;
    let fileType    : string = '';
    let tabType     : SideTabType = 'file';

    if (tab.input instanceof vscode.TabInputText) {
      uri         = tab.input.uri;
      label       = path.basename(uri.fsPath);
      description = vscode.workspace.asRelativePath(uri);
      tooltip     = uri.fsPath;
      fileType    = path.extname(uri.fsPath);
      tabType     = 'file';
    } else if (tab.input instanceof vscode.TabInputWebview) {
      // No URI — webview tabs (Settings, Extensions, Welcome…)
      uri         = undefined;
      label       = tab.label;
      description = undefined;
      tooltip     = tab.label;
      tabType     = 'webview';
    } else if (tab.input instanceof vscode.TabInputCustom) {
      uri         = tab.input.uri;
      label       = path.basename(uri.fsPath) || tab.label || 'Custom';
      description = vscode.workspace.asRelativePath(uri);
      tooltip     = uri.fsPath;
      fileType    = path.extname(uri.fsPath);
      tabType     = 'custom';
    } else if (tab.input instanceof vscode.TabInputNotebook) {
      uri         = tab.input.uri;
      label       = path.basename(uri.fsPath);
      description = vscode.workspace.asRelativePath(uri);
      tooltip     = uri.fsPath;
      fileType    = path.extname(uri.fsPath);
      tabType     = 'notebook';
    } else {
      return null;
    }

    const viewColumn = tab.group.viewColumn;

    const metadata: SideTabMetadata = {
      id: this.generateId(label, uri, viewColumn, tabType),
      uri,
      label,
      description,
      tooltip,
      fileType,
      tabType,
    };

    const state: SideTabState = {
      isActive:       tab.isActive,
      isDirty:        tab.isDirty,
      isPinned:       tab.isPinned,
      isPreview:      tab.isPreview,
      groupId:        viewColumn,
      viewColumn,
      indexInGroup:   index ?? 0,
      lastAccessTime: Date.now(),
    };

    return new SideTab(metadata, state);
  }

  /** Stable, unique ID for a tab.  URI-based for files, label-based for webviews. */
  private generateId(
    label: string,
    uri: vscode.Uri | undefined,
    viewColumn: vscode.ViewColumn,
    tabType: SideTabType,
  ): string {
    if (uri) {
      return `${uri.toString()}-${viewColumn}`;
    }
    // Webview tabs have no URI — use a sanitised label
    const safe = label.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    return `${tabType}:${safe}-${viewColumn}`;
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}
