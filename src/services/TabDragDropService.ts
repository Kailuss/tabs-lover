import { TabStateService } from './TabStateService';
import { SideTab }         from '../models/SideTab';

/**
 * Servicio dedicado a la gestión de drag & drop de pestañas.
 * Maneja la lógica de reordenamiento respetando las restricciones:
 * - Las tabs pinned no se pueden mover
 * - Las tabs pinned siempre permanecen en la parte superior
 * - No se puede arrastrar una tab unpinned sobre la sección de pinned tabs
 */
export class TabDragDropService {
  constructor(private readonly stateService: TabStateService) {}

  /**
   * Reordena una tab dentro del mismo grupo.
   * @param sourceTabId - ID de la tab que se está moviendo
   * @param targetTabId - ID de la tab sobre la que se suelta
   * @param insertPosition - 'before' para insertar antes, 'after' para insertar después
   * @returns true si el reordenamiento fue exitoso, false si fue bloqueado por restricciones
   */
  reorderWithinGroup(
    sourceTabId: string,
    targetTabId: string,
    insertPosition: 'before' | 'after',
  ): boolean {
    const sourceTab = this.stateService.getTab(sourceTabId);
    const targetTab = this.stateService.getTab(targetTabId);

    if (!sourceTab || !targetTab) { return false; }
    if (sourceTab.state.groupId !== targetTab.state.groupId) { return false; }

    // Restricción: tabs pinned no se pueden mover
    if (sourceTab.state.isPinned) { return false; }

    const group = this.stateService.getGroup(sourceTab.state.groupId);
    if (!group) { return false; }

    // Calcular el índice de la última tab pinned
    const lastPinnedIndex = this.findLastPinnedIndex(group.tabs);

    // Encontrar índices actuales
    const sourceIndex = group.tabs.findIndex(t => t.metadata.id === sourceTabId);
    const targetIndex = group.tabs.findIndex(t => t.metadata.id === targetTabId);

    if (sourceIndex === -1 || targetIndex === -1) { return false; }

    // Calcular la posición de inserción final
    let insertIndex = insertPosition === 'before' ? targetIndex : targetIndex + 1;

    // Restricción: no permitir que tab unpinned se mueva sobre sección pinned
    if (!sourceTab.state.isPinned && insertIndex <= lastPinnedIndex) {
      return false;
    }

    // Si la tab target está pinned, también bloquear
    if (targetTab.state.isPinned && !sourceTab.state.isPinned) {
      return false;
    }

    // Si el movimiento es a la misma posición, no hacer nada
    if (sourceIndex === insertIndex || sourceIndex === insertIndex - 1) {
      return false;
    }

    // Realizar el reordenamiento
    group.tabs.splice(sourceIndex, 1);

    // Ajustar insertIndex si es necesario (si removimos antes del punto de inserción)
    if (sourceIndex < insertIndex) {
      insertIndex--;
    }

    group.tabs.splice(insertIndex, 0, sourceTab);

    // Actualizar indexInGroup para todas las tabs del grupo
    group.tabs.forEach((tab, idx) => {
      tab.state.indexInGroup = idx;
    });

    // Notificar cambio
    this.stateService.updateTab(sourceTab);

    return true;
  }

  /**
   * Mueve una tab de un grupo a otro.
   * @param sourceTabId - ID de la tab que se está moviendo
   * @param targetGroupId - ID del grupo destino
   * @param targetTabId - ID de la tab sobre la que se suelta (opcional)
   * @param insertPosition - 'before' o 'after' si se especifica targetTabId
   * @returns true si el movimiento fue exitoso
   */
  async moveBetweenGroups(
    sourceTabId: string,
    targetGroupId: number,
    targetTabId?: string,
    insertPosition?: 'before' | 'after',
  ): Promise<boolean> {
    const sourceTab = this.stateService.getTab(sourceTabId);
    if (!sourceTab || !sourceTab.metadata.uri) { return false; }

    // Restricción: tabs pinned no se pueden mover
    if (sourceTab.state.isPinned) { return false; }

    const targetGroup = this.stateService.getGroup(targetGroupId);
    if (!targetGroup) { return false; }

    // Si hay un target específico, verificar restricciones
    if (targetTabId) {
      const targetTab = this.stateService.getTab(targetTabId);
      if (targetTab && targetTab.state.isPinned) {
        return false; // No permitir drop sobre tabs pinned
      }
    }

    // Cerrar la tab en el grupo origen y abrirla en el destino
    // Esto cambiará el ID de la tab (porque incluye viewColumn)
    try {
      await sourceTab.moveToGroup(targetGroupId);
      return true;
    } catch (error) {
      console.error('[TabDragDrop] Failed to move tab between groups:', error);
      return false;
    }
  }

  /**
   * Verifica si un drop es válido.
   * @param sourceTabId - Tab que se está arrastrando
   * @param targetTabId - Tab sobre la que se va a soltar
   * @returns true si el drop es válido
   */
  canDrop(sourceTabId: string, targetTabId: string): boolean {
    const sourceTab = this.stateService.getTab(sourceTabId);
    const targetTab = this.stateService.getTab(targetTabId);

    if (!sourceTab || !targetTab) { return false; }

    // Tabs pinned no se pueden mover
    if (sourceTab.state.isPinned) { return false; }

    // No se puede hacer drop sobre tabs pinned
    if (targetTab.state.isPinned) { return false; }

    return true;
  }

  /**
   * Encuentra el índice de la última tab pinned en un array de tabs.
   * @returns Índice de la última tab pinned, o -1 si no hay tabs pinned
   */
  private findLastPinnedIndex(tabs: SideTab[]): number {
    let lastIndex = -1;
    for (let i = 0; i < tabs.length; i++) {
      if (tabs[i].state.isPinned) {
        lastIndex = i;
      }
    }
    return lastIndex;
  }
}
