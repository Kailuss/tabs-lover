import * as vscode from 'vscode';
import type { SideTabMetadata, SideTabState } from '../SideTab';
import { SideTabHelpers } from '../SideTabHelpers';
import { Logger } from '../../utils/logger';
import { VSCODE_COMMANDS } from '../../constants/commands';
import { TIMINGS } from '../../constants/timings';

/**
 * Activation actions - Activar y hacer focus en tabs
 */

const MARKDOWN_EXTENSIONS = ['.md', '.mdx', '.markdown'];

export async function activate(metadata: SideTabMetadata, state: SideTabState): Promise<void> {
  return activateWithRetry(metadata, state, 0);
}

async function activateWithRetry(
  metadata: SideTabMetadata,
  state: SideTabState,
  attempt: number
): Promise<void> {
  const maxAttempts = 2;

  try {
    // MARKDOWN PREVIEW MODE: Si viewMode está en preview, abrir el preview
    if (
      state.viewMode === 'preview' &&
      metadata.uri &&
      MARKDOWN_EXTENSIONS.some((ext) => metadata.fileExtension.toLowerCase() === ext)
    ) {
      Logger.log('[TabAction] Activating in viewMode=preview: ' + metadata.label);
      await vscode.commands.executeCommand(VSCODE_COMMANDS.MARKDOWN_SHOW_PREVIEW, metadata.uri);
      return;
    }

    // Re-buscar la tab nativa en cada intento (puede haber cambiado)
    const nativeTab = SideTabHelpers.findNativeTab(metadata, state);

    if (attempt === 0) {
      Logger.log(`[TabAction] Activating tab: ${metadata.label}, isPreview: ${state.isPreview}, viewMode: ${state.viewMode}, tabType: ${metadata.tabType}, nativeTabFound: ${!!nativeTab}, uri: ${metadata.uri?.toString()}`);
    }

    // Si la tab no existe después del primer intento completo, está cerrada
    if (!nativeTab && attempt > 0) {
      throw new Error(`Tab '${metadata.label}' no longer exists (closed or replaced)`);
    }

    // Para webview, unknown, y diff tabs, siempre usar el método nativo
    if (
      metadata.tabType === 'webview' ||
      metadata.tabType === 'unknown' ||
      metadata.tabType === 'diff'
    ) {
      return await SideTabHelpers.activateByNativeTab(metadata, state);
    }

    if (!metadata.uri) {
      return;
    }

    // Si la tab nativa existe, SIEMPRE usar activación por índice
    // (más confiable que showTextDocument, especialmente con preview tabs)
    if (nativeTab) {
      // Verificar que el URI coincide
      if (
        nativeTab.input instanceof vscode.TabInputText &&
        nativeTab.input.uri.toString() === metadata.uri.toString()
      ) {
        Logger.log('[TabAction] Using native activation by index for: ' + metadata.label);
        return await SideTabHelpers.activateByNativeTab(metadata, state);
      }
      // Si el URI no coincide, la tab fue reemplazada - continuar al fallback
      Logger.log('[TabAction] URI mismatch, tab was replaced: ' + metadata.label);
    }

    // La tab no existe o fue reemplazada - abrirla de nuevo
    // Usar workbench.action.openEditorAtIndex si hay una tab en esa posición
    if (nativeTab) {
      const tabIndex = nativeTab.group.tabs.indexOf(nativeTab);
      if (tabIndex !== -1) {
        Logger.log(`[TabAction] Activating by index (fallback): ${metadata.label}, index: ${tabIndex}`);
        await SideTabHelpers.focusGroup(state.viewColumn);
        await vscode.commands.executeCommand(VSCODE_COMMANDS.OPEN_EDITOR_AT_INDEX, tabIndex);
        return;
      }
    }

    // Fallback: abrir con showTextDocument
    Logger.log('[TabAction] Opening with showTextDocument (final fallback): ' + metadata.label);
    const doc = await vscode.workspace.openTextDocument(metadata.uri);
    await vscode.window.showTextDocument(doc, {
      viewColumn: state.viewColumn,
      preserveFocus: false,
      preview: false, // Abrir como permanente cuando reactivamos una tab cerrada
    });
  } catch (err) {
    // Si falla y es un intento temprano, esperar un poco y reintentar
    // (útil para race conditions con preview tabs)
    if (attempt < TIMINGS.ACTIVATION_MAX_RETRIES) {
      Logger.log(`[TabAction] Activation failed (attempt ${attempt + 1}/${TIMINGS.ACTIVATION_MAX_RETRIES + 1}), retrying: ${metadata.label}`);
      await new Promise((resolve) => setTimeout(resolve, TIMINGS.ACTIVATION_RETRY_DELAY));
      return activateWithRetry(metadata, state, attempt + 1);
    }

    // Último intento: usar vscode.open como fallback
    if (metadata.uri) {
      try {
        Logger.log('[TabAction] Using vscode.open as last resort: ' + metadata.label);
        await vscode.commands.executeCommand(VSCODE_COMMANDS.VSCODE_OPEN, metadata.uri, {
          viewColumn: state.viewColumn,
          preview: false,
        });
      } catch (finalErr) {
        Logger.error('[TabAction] Final activation attempt failed: ' + metadata.label, finalErr);
        throw finalErr;
      }
    }
  }
}
