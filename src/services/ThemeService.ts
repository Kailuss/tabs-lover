import * as vscode from 'vscode';

/**
 * Listens for icon-theme, color-theme, and product-icon-theme changes
 * so the tree view can refresh its icons accordingly.
 */
export class ThemeService {
  private _onDidChangeTheme = new vscode.EventEmitter<void>();
  readonly onDidChangeTheme = this._onDidChangeTheme.event;

  /** Register configuration listeners. Call once during activation. */
  activate(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (
          e.affectsConfiguration('workbench.iconTheme') ||
          e.affectsConfiguration('workbench.productIconTheme') ||
          e.affectsConfiguration('workbench.colorTheme')
        ) {
          this._onDidChangeTheme.fire();
        }
      })
    );
  }

  getCurrentIconTheme(): string | undefined {
    return vscode.workspace.getConfiguration('workbench').get('iconTheme');
  }

  getCurrentColorTheme(): string | undefined {
    return vscode.workspace.getConfiguration('workbench').get('colorTheme');
  }
}
