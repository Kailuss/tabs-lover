import * as vscode from 'vscode';
import type { SideTabMetadata, SideTabState } from './SideTab';

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
   */
  static async activateByNativeTab(
    metadata: SideTabMetadata,
    state: SideTabState
  ): Promise<void> {
    const nativeTab = SideTabHelpers.findNativeTab(metadata, state);

    // Best approach for any tab: focus its group, then open by native index.
    // This works reliably for diff tabs, webviews, unknown-input tabs, etc.
    if (nativeTab) {
      const tabIndex = nativeTab.group.tabs.indexOf(nativeTab);
      if (tabIndex !== -1) {
        try {
          await SideTabHelpers.focusGroup(state.viewColumn);
          await vscode.commands.executeCommand('workbench.action.openEditorAtIndex', tabIndex);
          return;
        } catch { /* fall through */ }
      }
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
}
