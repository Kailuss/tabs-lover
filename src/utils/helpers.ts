import * as vscode from 'vscode';

/**
 * Returns a generic ThemeIcon based on file extension.
 * Used only as a fallback when the icon theme cannot resolve an icon.
 */
export function getFileIcon(uri: vscode.Uri): vscode.ThemeIcon {
  const ext = uri.fsPath.split('.').pop()?.toLowerCase();

  const iconMap: Record<string, string> = {
    ts: 'file-code',
    js: 'file-code',
    json: 'json',
    md: 'markdown',
    css: 'file-code',
    html: 'file-code',
    py: 'file-code',
    java: 'file-code',
  };

  return new vscode.ThemeIcon(iconMap[ext || ''] || 'file');
}

/**
 * Formats a byte count into a human-readable string (B / KB / MB).
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
