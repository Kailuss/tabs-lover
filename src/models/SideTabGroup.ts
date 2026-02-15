import { SideTab } from './SideTab';
import * as vscode from 'vscode';

/** Represents an editor group containing multiple tabs. */
export type SideTabGroup = {
  id         : number;
  viewColumn : vscode.ViewColumn;
  isActive   : boolean;
  tabs       : SideTab[];
  label      : string;
};

/**
 * Creates a SideTabGroup from a VS Code TabGroup.
 * Tabs are populated separately by the sync service.
 */
export function createTabGroup(group: vscode.TabGroup): SideTabGroup {
  return {
    id         : group.viewColumn,
    viewColumn : group.viewColumn,
    isActive   : group.isActive,
    tabs       : [],
    label      : `Group ${group.viewColumn}`,
  };
}
