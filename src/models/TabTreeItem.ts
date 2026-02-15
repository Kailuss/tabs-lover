import * as vscode from 'vscode';
import { SideTab } from './SideTab';
import { SideTabGroup } from './SideTabGroup';
import { TabsLoverConfiguration } from '../constants/styles';
import { PRODUCT_ICONS } from '../constants/icons';

/**
 * TreeItem that represents a single tab in the sidebar.
 * Handles tooltip, context value, and state icon rendering.
 */
export class TabTreeItem extends vscode.TreeItem {
  constructor(
    public readonly tab: SideTab,
    private config: TabsLoverConfiguration
  ) {
    super(tab.metadata.label, vscode.TreeItemCollapsibleState.None);

    // Use the file icon from the active theme
    this.resourceUri = tab.metadata.uri;

    // Description (relative path)
    if (config.showFilePath && tab.metadata.description) {
      this.description = tab.metadata.description;
    }

    // Tooltip
    this.tooltip = this.buildTooltip();

    // Context value (used in when-clauses)
    this.contextValue = this.buildContextValue();

    // Click command
    this.command = {
      command: 'tabsLover.openTab',
      title: 'Open Tab',
      arguments: [tab],
    };

    // State icons (priority order)
    if (config.showStateIcons) {
      if (tab.state.isPinned) {
        this.iconPath = PRODUCT_ICONS.pinned;
      } else if (tab.state.isDirty) {
        this.iconPath = PRODUCT_ICONS.modified;
      } else if (tab.state.copilotEdited) {
        this.iconPath = PRODUCT_ICONS.copilotEdited;
      }
    }
  }

  private buildTooltip(): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${this.tab.metadata.label}**\n\n`);
    md.appendMarkdown(`Path: \`${this.tab.metadata.tooltip}\`\n\n`);

    const states: string[] = [];
    if (this.tab.state.isDirty) {
      states.push('Modified');
    }
    if (this.tab.state.isPinned) {
      states.push('Pinned');
    }
    if (this.tab.state.isPreview) {
      states.push('Preview');
    }
    if (this.tab.state.copilotEdited) {
      states.push('Edited by Copilot');
    }

    if (states.length > 0) {
      md.appendMarkdown(`Status: ${states.join(', ')}\n\n`);
    }

    md.appendMarkdown('---\n\n');
    md.appendMarkdown('**Actions:**\n');
    md.appendMarkdown('- Right-click for more options\n');

    return md;
  }

  private buildContextValue(): string {
    const parts = ['tab'];

    if (this.tab.state.isPinned) {
      parts.push('pinned');
    }

    if (this.tab.state.isDirty) {
      parts.push('dirty');
    }

    if (this.tab.capabilities.canAddToChat) {
      parts.push('canAddToChat');
    }

    return parts.join('.');
  }
}

/**
 * TreeItem that represents an editor group header.
 */
export class GroupTreeItem extends vscode.TreeItem {
  constructor(public readonly group: SideTabGroup) {
    super(group.label, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'group';
    this.iconPath = PRODUCT_ICONS.group;

    if (group.isActive) {
      this.description = '● Active';
    }
  }
}
