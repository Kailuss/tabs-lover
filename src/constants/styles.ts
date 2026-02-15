import * as vscode from 'vscode';

export const STYLE_CONSTANTS = {
  // Tab dimensions
  TAB_HEIGHT: 40,
  TAB_ICON_SIZE: 16,
  TAB_PADDING_LEFT: 8,
  TAB_PADDING_RIGHT: 4,

  // Internal spacing
  ICON_TEXT_GAP: 8,
  STATE_ICON_SIZE: 14,
  HOVER_ICON_SIZE: 16,

  // Description (path)
  DESCRIPTION_FONT_SIZE: 11,
  DESCRIPTION_LINE_HEIGHT: 14,
  DESCRIPTION_OPACITY: 0.7,

  // Hover
  HOVER_ICON_SPACING: 4,

  // VS Code color variables (for reference)
  COLORS: {
    foreground: 'foreground',
    descriptionForeground: 'descriptionForeground',
    listActiveSelectionBackground: 'list.activeSelectionBackground',
    listHoverBackground: 'list.hoverBackground',
    listInactiveSelectionBackground: 'list.inactiveSelectionBackground',
    modified: 'gitDecoration.modifiedResourceForeground',
    untracked: 'gitDecoration.untrackedResourceForeground',
    ignored: 'gitDecoration.ignoredResourceForeground',
    iconForeground: 'icon.foreground',
    editorWarningForeground: 'editorWarning.foreground',
    buttonHoverBackground: 'button.hoverBackground',
  },
} as const;

/** Configuration shape for tabsLover settings */
export type TabsLoverConfiguration = {
  showFilePath: boolean;
  tabHeight: number;
  iconSize: number;
  enableHoverActions: boolean;
  showStateIcons: boolean;
  enableDragDrop: boolean;
};

/**
 * Reads the current tabsLover configuration from workspace settings.
 * @returns Resolved configuration with defaults applied.
 */
export function getConfiguration(): TabsLoverConfiguration {
  const config = vscode.workspace.getConfiguration('tabsLover');

  return {
    showFilePath: config.get('showFilePath', true),
    tabHeight: config.get('tabHeight', STYLE_CONSTANTS.TAB_HEIGHT),
    iconSize: config.get('iconSize', STYLE_CONSTANTS.TAB_ICON_SIZE),
    enableHoverActions: config.get('enableHoverActions', true),
    showStateIcons: config.get('showStateIcons', true),
    enableDragDrop: config.get('enableDragDrop', false),
  };
}
