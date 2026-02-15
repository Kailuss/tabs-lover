import * as vscode from 'vscode';

/**
 * Centralised logger that writes to a dedicated VS Code OutputChannel.
 */
export class Logger {
  private static outputChannel: vscode.OutputChannel;

  /** Create the output channel. Call once during activation. */
  static initialize(): void {
    this.outputChannel = vscode.window.createOutputChannel('Tabs Lover');
  }

  /** Log an informational message with a timestamp. */
  static log(message: string): void {
    const timestamp = new Date().toISOString();
    this.outputChannel.appendLine(`[${timestamp}] ${message}`);
  }

  /** Log an error with optional error object details. */
  static error(message: string, error?: unknown): void {
    this.log(`ERROR: ${message}`);
    if (error instanceof Error) {
      this.log(error.message);
      if (error.stack) {
        this.log(error.stack);
      }
    }
  }

  /** Reveal the output channel in the UI. */
  static show(): void {
    this.outputChannel.show();
  }
}
