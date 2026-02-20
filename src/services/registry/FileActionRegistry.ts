import * as vscode from 'vscode';
import { FileAction, ResolvedFileAction, BUILTIN_ACTIONS } from '../../constants/fileActions';

// Re-export for consumers that import from this module
export type { FileAction, ResolvedFileAction } from '../../constants/fileActions';

// ──────────────────────────────── Registry ─────────────────────────────────────

/**
 * Registro extensible de acciones contextuales por tipo de archivo.
 *
 * **Cómo añadir una acción nueva:**
 * ```ts
 * registry.register({
 *   id      : 'myAction',
 *   icon    : 'codicon-name',
 *   tooltip : 'Do something cool',
 *   match   : (name, uri) => name.endsWith('.xyz'),
 *   execute : async (uri) => { ... },
 * });
 * ```
 *
 * Las acciones se evalúan en orden de registro; la primera cuyo `match`
 * devuelva `true` gana.  Las acciones registradas manualmente tienen
 * prioridad sobre las built-in.
 */
export class FileActionRegistry {

  /** Acciones añadidas por el usuario / otros módulos (mayor prioridad). */
  private custom: FileAction[] = [];

  /** Acciones predefinidas (menor prioridad). */
  private builtin: FileAction[] = [...BUILTIN_ACTIONS];

  /** Registra una acción personalizada (se evalúa antes que las built-in). */
  register(action: FileAction): void {
    this.custom.push(action);
  }

  /** Elimina una acción por su id. */
  unregister(id: string): void {
    this.custom  = this.custom.filter(a => a.id !== id);
    this.builtin = this.builtin.filter(a => a.id !== id);
  }

  /**
   * Resuelve la acción contextual para un archivo.
   * Devuelve la primera acción cuyo `match` sea `true`, o `null` si
   * ninguna aplica (el botón no se mostrará).
   */
  resolve(fileName: string, uri: vscode.Uri): ResolvedFileAction | null {
    // Custom first (higher priority)
    for (const action of this.custom) {
      if (action.match(fileName, uri)) {
        return { id: action.id, icon: action.icon, tooltip: action.tooltip };
      }
    }
    // Then built-in
    for (const action of this.builtin) {
      if (action.match(fileName, uri)) {
        return { id: action.id, icon: action.icon, tooltip: action.tooltip };
      }
    }
    return null;
  }

  /**
   * Ejecuta la acción asociada a un archivo (buscada por id).
   * Devuelve `true` si se ejecutó, `false` si no se encontró.
   */
  async execute(actionId: string, uri: vscode.Uri): Promise<boolean> {
    const action =
      this.custom.find(a => a.id === actionId) ??
      this.builtin.find(a => a.id === actionId);

    if (!action) { return false; }

    try {
      await action.execute(uri);
      return true;
    } catch (error) {
      console.error(`[FileAction] Failed to execute "${actionId}":`, error);
      return false;
    }
  }

  /** Devuelve todas las acciones registradas (para depuración). */
  getAll(): ReadonlyArray<FileAction> {
    return [...this.custom, ...this.builtin];
  }
}
