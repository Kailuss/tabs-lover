import * as vscode from 'vscode';
import * as path   from 'path';
import type { SideTabMetadata, SideTabState } from './SideTab';
import { SideTabHelpers } from './SideTabHelpers';

/**
 * Métodos de acción para las operaciones disponibles sobre una pestaña.
 * Separado del modelo principal para mejor organización y mantenibilidad.
 */
export abstract class SideTabActions {
  abstract readonly metadata: SideTabMetadata;
  abstract state: SideTabState;

  //:--> Acciones básicas

  //= Close
  async close(): Promise<void> {
    if (!this.state.capabilities.canClose) {
      vscode.window.showWarningMessage('This tab cannot be closed');
      return;
    }
    const t = SideTabHelpers.findNativeTab(this.metadata, this.state);
    if (t) { await vscode.window.tabGroups.close(t); }
  }

  //= Close Others
  async closeOthers(): Promise<void> {
    await this.activate();
    await vscode.commands.executeCommand('workbench.action.closeOtherEditors');
  }

  //= Close Group
  async closeGroup(): Promise<void> {
    const group = SideTabHelpers.nativeGroup(this.state.viewColumn);
    if (!group) { return; }
    await vscode.window.tabGroups.close(group);
  }

  //= Close to Right
  async closeToRight(): Promise<void> {

    const group = SideTabHelpers.nativeGroup(this.state.viewColumn);
    if (!group) { return; }

    const idx = group.tabs.findIndex(t => SideTabHelpers.matchesNative(t, this.metadata));
    if (idx === -1) { return; }

    for (const t of group.tabs.slice(idx + 1)) {
      await vscode.window.tabGroups.close(t);
    }
  }

  //= Pin
  async pin(): Promise<void> {
    if (!this.state.capabilities.canPin) {
      vscode.window.showWarningMessage('This tab cannot be pinned');
      return;
    }
    await this.activate();
    await vscode.commands.executeCommand('workbench.action.pinEditor');
    this.state.isPinned = true;
  }

  //= Unpin
  async unpin(): Promise<void> {
    if (!this.state.capabilities.canUnpin) {
      vscode.window.showWarningMessage('This tab is not pinned');
      return;
    }
    await this.activate();
    await vscode.commands.executeCommand('workbench.action.unpinEditor');
    this.state.isPinned = false;
  }

  //= Reveal in Explorer
  async revealInExplorer(): Promise<void> {
    if (!this.state.capabilities.canRevealInExplorer) {
      vscode.window.showWarningMessage('This tab has no file to reveal');
      return;
    }
    // This is actually "Reveal in Explorer View" (VS Code's file explorer)
    if (this.metadata.uri) {
      await vscode.commands.executeCommand('revealInExplorer', this.metadata.uri);
    }
  }

  //= Reveal in Explorer View
  async revealInExplorerView(): Promise<void> {
    // VS Code's file explorer panel
    if (this.metadata.uri) {
      await vscode.commands.executeCommand('revealInExplorer', this.metadata.uri);
    }
  }

  //= Reveal in File Explorer
  async revealInFileExplorer(): Promise<void> {
    // OS file explorer (Finder, Explorer, etc.)
    if (this.metadata.uri) {
      await vscode.commands.executeCommand('revealFileInOS', this.metadata.uri);
    }
  }

  //= Open Timeline
  async openTimeline(): Promise<void> {
    if (!this.metadata.uri) { return; }
    await vscode.commands.executeCommand('timeline.focus');
    await this.activate();
  }

  //= Copy Relative Path
  async copyRelativePath(): Promise<void> {
    if (!this.state.capabilities.canCopyPath) {
      vscode.window.showWarningMessage('This tab has no path to copy');
      return;
    }
    if (!this.metadata.uri) { return; }
    const rel = vscode.workspace.asRelativePath(this.metadata.uri);
    await vscode.env.clipboard.writeText(rel);
    vscode.window.showInformationMessage(`Copied: ${rel}`);
  }

  //= Copy Path
  async copyPath(): Promise<void> {
    if (!this.state.capabilities.canCopyPath) {
      vscode.window.showWarningMessage('This tab has no path to copy');
      return;
    }
    if (!this.metadata.uri) { return; }
    await vscode.env.clipboard.writeText(this.metadata.uri.fsPath);
    vscode.window.showInformationMessage(`Copied: ${this.metadata.uri.fsPath}`);
  }

  //= Copy File Contents
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

  //= Duplicate File
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
    // Estrategia de activación robusta con retry para preview tabs
    return this.activateWithRetry(0);
  }

  /**
   * Extensiones de Markdown que soportan viewMode toggle.
   */
  private static readonly MARKDOWN_EXTENSIONS = ['.md', '.mdx', '.markdown'];

  /**
   * Activa la tab con lógica de retry para manejar race conditions
   * con preview tabs que pueden cambiar durante la activación.
   */
  private async activateWithRetry(attempt: number): Promise<void> {
    const maxAttempts = 2;
    
    try {
      // MARKDOWN PREVIEW MODE: Si viewMode está en preview, abrir el preview
      if (this.state.viewMode === 'preview' && this.metadata.uri && 
          SideTabActions.MARKDOWN_EXTENSIONS.some(ext => 
            this.metadata.fileExtension.toLowerCase() === ext
          )) {
        console.log('[TabAction] Activating in viewMode=preview:', this.metadata.label);
        await vscode.commands.executeCommand('markdown.showPreview', this.metadata.uri);
        return;
      }

      // Re-buscar la tab nativa en cada intento (puede haber cambiado)
      const nativeTab = SideTabHelpers.findNativeTab(this.metadata, this.state);
      
      if (attempt === 0) {
        console.log('[TabAction] Activating tab:', this.metadata.label, {
          isPreview: this.state.isPreview,
          viewMode: this.state.viewMode,
          tabType: this.metadata.tabType,
          nativeTabFound: !!nativeTab,
          nativeIsPreview: nativeTab?.isPreview,
          uri: this.metadata.uri?.toString()
        });
      }
      
      // Si la tab no existe después del primer intento completo, está cerrada
      if (!nativeTab && attempt > 0) {
        throw new Error(`Tab '${this.metadata.label}' no longer exists (closed or replaced)`);
      }
      
      // Para webview, unknown, y diff tabs, siempre usar el método nativo
      if (this.metadata.tabType === 'webview' || this.metadata.tabType === 'unknown' || this.metadata.tabType === 'diff') {
        return await SideTabHelpers.activateByNativeTab(this.metadata, this.state);
      }
      
      if (!this.metadata.uri) { return; }
      
      // Si la tab nativa existe, SIEMPRE usar activación por índice
      // (más confiable que showTextDocument, especialmente con preview tabs)
      if (nativeTab) {
        // Verificar que el URI coincide
        if (nativeTab.input instanceof vscode.TabInputText && 
            nativeTab.input.uri.toString() === this.metadata.uri.toString()) {
          console.log('[TabAction] Using native activation by index for:', this.metadata.label);
          return await SideTabHelpers.activateByNativeTab(this.metadata, this.state);
        }
        // Si el URI no coincide, la tab fue reemplazada - continuar al fallback
        console.log('[TabAction] URI mismatch, tab was replaced:', this.metadata.label);
      }
      
      // La tab no existe o fue reemplazada - abrirla de nuevo
      // Usar workbench.action.openEditorAtIndex si hay una tab en esa posición
      if (nativeTab) {
        const tabIndex = nativeTab.group.tabs.indexOf(nativeTab);
        if (tabIndex !== -1) {
          console.log('[TabAction] Activating by index (fallback):', this.metadata.label, 'index:', tabIndex);
          await SideTabHelpers.focusGroup(this.state.viewColumn);
          await vscode.commands.executeCommand('workbench.action.openEditorAtIndex', tabIndex);
          return;
        }
      }
      
      // Fallback: abrir con showTextDocument
      console.log('[TabAction] Opening with showTextDocument (final fallback):', this.metadata.label);
      const doc = await vscode.workspace.openTextDocument(this.metadata.uri);
      await vscode.window.showTextDocument(doc, {
        viewColumn: this.state.viewColumn,
        preserveFocus: false,
        preview: false, // Abrir como permanente cuando reactivamos una tab cerrada
      });
    } catch (err) {
      // Si falla y es un intento temprano, esperar un poco y reintentar
      // (útil para race conditions con preview tabs)
      if (attempt < maxAttempts) {
        console.log(`[TabAction] Activation failed (attempt ${attempt + 1}/${maxAttempts + 1}), retrying...`, this.metadata.label, err);
        await new Promise(resolve => setTimeout(resolve, 50));
        return this.activateWithRetry(attempt + 1);
      }
      
      // Último intento: usar vscode.open como fallback
      if (this.metadata.uri) {
        try {
          console.log('[TabAction] Using vscode.open as last resort:', this.metadata.label);
          await vscode.commands.executeCommand('vscode.open', this.metadata.uri, {
            viewColumn: this.state.viewColumn,
            preview: false,
          });
        } catch (finalErr) {
          console.error('[TabAction] Final activation attempt failed:', this.metadata.label, finalErr);
          throw finalErr;
        }
      }
    }
  }
}
