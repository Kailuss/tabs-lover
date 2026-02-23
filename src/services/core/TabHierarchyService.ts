import * as vscode from 'vscode';
import type { SideTab, DiffStats } from '../../models/SideTab';
import type { TabStateService } from './TabStateService';
import type { DocumentManager } from './DocumentManager';
import { Logger } from '../../utils/logger';

/**
 * Gestiona la relación jerárquica entre tabs padre e hijas.
 * 
 * Responsabilidades:
 * - Registrar/desregistrar children bajo parents
 * - Mantener sincronizados hasChildren y childrenCount
 * - Heredar estado del parent al child (solo viewMode para Markdown)
 * - Recalcular contadores cuando sea necesario
 * - Delegar metadata de documentos a DocumentManager
 * 
 * IMPORTANTE:
 * - Children de Markdown heredan SOLO viewMode del parent
 * - NO se heredan gitStatus, diagnosticSeverity ni iconos de estado
 * - Children NO tienen tab-actions (solo botón cerrar)
 * - Cuando un child está activo, el parent mantiene apariencia activa
 * - DocumentManager es la fuente de verdad para metadata de documentos
 * 
 * @see docs/ANALISIS_PARENT_CHILD.md
 * @see docs/PLAN_OPTIMIZACION_TABSYNC.md
 * @see DocumentManager for document metadata management
 */
export class TabHierarchyService {
  constructor(
    private stateService: TabStateService,
    private documentManager?: DocumentManager
  ) {}

  /**
   * Registra un child tab bajo su parent.
   * Actualiza hasChildren y childrenCount del parent.
   * 
   * @param childId ID del child tab
   * @param parentId ID del parent tab
   */
  registerChild(childId: string, parentId: string): void {
    const parent = this.stateService.getTab(parentId);
    if (!parent) {
      Logger.log(`[TabHierarchy] Cannot register child: parent not found (${parentId})`);
      return;
    }

    const child = this.stateService.getTab(childId);
    if (!child) {
      Logger.log(`[TabHierarchy] Cannot register child: child not found (${childId})`);
      return;
    }

    // Update parent state
    parent.state.hasChildren = true;
    parent.state.childrenCount++;
    
    // Update capabilities to allow expansion
    parent.state.capabilities.canExpand = true;

    this.stateService.updateTab(parent);
    
    Logger.log(`[TabHierarchy] Registered child: ${child.metadata.label} → ${parent.metadata.label} (count: ${parent.state.childrenCount})`);
  }

  /**
   * Desregistra un child tab de su parent.
   * Actualiza hasChildren y childrenCount del parent.
   * 
   * @param childId ID del child tab
   * @param parentId ID del parent tab
   */
  unregisterChild(childId: string, parentId: string): void {
    const parent = this.stateService.getTab(parentId);
    if (!parent) {
      Logger.log(`[TabHierarchy] Cannot unregister child: parent not found (${parentId})`);
      return;
    }

    // Decrement counter
    parent.state.childrenCount = Math.max(0, parent.state.childrenCount - 1);
    
    // Update hasChildren if no more children
    if (parent.state.childrenCount === 0) {
      parent.state.hasChildren = false;
      parent.state.capabilities.canExpand = false;
    }

    this.stateService.updateTab(parent);
    
    Logger.log(`[TabHierarchy] Unregistered child from ${parent.metadata.label} (remaining: ${parent.state.childrenCount})`);
  }

  /**
   * Obtiene todos los children de un parent.
   * 
   * @param parentId ID del parent tab
   * @returns Array de child tabs
   */
  getChildren(parentId: string): SideTab[] {
    return this.stateService.getAllTabs()
      .filter(tab => tab.metadata.parentId === parentId);
  }

  /**
   * Verifica si una tab tiene children.
   * 
   * @param tabId ID de la tab
   * @returns true si tiene children
   */
  hasChildren(tabId: string): boolean {
    return this.stateService.getAllTabs()
      .some(tab => tab.metadata.parentId === tabId);
  }

  /**
   * Recalcula el conteo de children para todos los parents.
   * Útil después de una sincronización completa o cuando hay inconsistencias.
   */
  recalculateAllCounts(): void {
    const allTabs = this.stateService.getAllTabs();
    const parents = allTabs.filter(tab => !tab.metadata.parentId);
    
    let updated = 0;
    for (const parent of parents) {
      const children = allTabs.filter(tab => tab.metadata.parentId === parent.metadata.id);
      const actualCount = children.length;
      
      if (parent.state.childrenCount !== actualCount || 
          parent.state.hasChildren !== (actualCount > 0)) {
        parent.state.childrenCount = actualCount;
        parent.state.hasChildren = actualCount > 0;
        parent.state.capabilities.canExpand = actualCount > 0;
        
        this.stateService.updateTab(parent);
        updated++;
      }
    }
    
    if (updated > 0) {
      Logger.log(`[TabHierarchy] Recalculated counts for ${updated} parents`);
    }
  }

  /**
   * Hereda estado del parent al child.
   * 
   * IMPORTANTE:
   * - Solo children de Markdown heredan viewMode
   * - NO se heredan gitStatus, diagnosticSeverity ni iconos
   * - Esto es por diseño para mantener children simples
   * - Stats de diff se delegan a DocumentManager si está disponible
   * 
   * @param childTab Child tab que hereda
   * @param parentTab Parent tab del que heredar
   */
  inheritState(childTab: SideTab, parentTab: SideTab): void {
    // Solo children de Markdown heredan viewMode
    if (parentTab.metadata.fileExtension === '.md' && childTab.metadata.diffType) {
      childTab.state.viewMode = parentTab.state.viewMode;
      Logger.log(`[TabHierarchy] Child inherited viewMode: ${childTab.metadata.label} ← ${parentTab.state.viewMode}`);
    }
    
    // Calculate diff stats for the child (pass parent for DocumentManager lookup)
    if (childTab.metadata.diffType) {
      this.calculateDiffStatsWithParent(childTab, parentTab);
    }
  }



  /**
   * Calcula estadísticas de diff para un child tab basándose en su tipo.
   * 
   * Si DocumentManager está disponible, intenta obtener las stats desde allí.
   * Para working-tree y staged: intenta obtener líneas desde VS Code diff.
   * Para snapshots: usa información de timestamp.
   * 
   * @param childTab Child tab para calcular stats
   * @param parentTab Parent tab (para obtener baseUri)
   */
  private calculateDiffStatsWithParent(childTab: SideTab, parentTab: SideTab): void {
    if (!childTab.metadata.diffType) { return; }
    
    const diffType = childTab.metadata.diffType;
    
    // Si ya tiene diffStats (ej: extraídas en tabConverter), no sobrescribir
    if (childTab.state.diffStats) { return; }
    
    // Intentar obtener stats desde DocumentManager si está disponible
    if (this.documentManager && parentTab.metadata.uri) {
      const stats = this.getStatsFromDocumentManager(parentTab.metadata.uri, childTab);
      if (stats) {
        childTab.state.diffStats = stats;
        return;
      }
    }
    
    // Fallback: calcular stats localmente
    this.calculateLocalDiffStats(childTab, diffType);
  }
  
  /**
   * Intenta obtener las stats desde DocumentManager.
   * 
   * @param baseUri URI base del documento parent
   * @param childTab Child tab
   * @returns DiffStats o undefined
   */
  private getStatsFromDocumentManager(baseUri: vscode.Uri, childTab: SideTab): DiffStats | undefined {
    if (!this.documentManager) {
      return undefined;
    }
    
    // Get document by URI
    const document = this.documentManager.getDocumentByUri(baseUri);
    if (!document) {
      return undefined;
    }
    
    // Get all versions for this diff type
    const versions = this.documentManager.getVersionsByType(
      document.documentId,
      childTab.metadata.diffType!
    );
    
    // Find version matching this tab
    const matchingVersion = versions.find((v: any) => v.relatedTabId === childTab.metadata.id);
    
    return matchingVersion?.stats;
  }
  
  /**
   * Calcula stats localmente cuando DocumentManager no está disponible.
   * 
   * @param childTab Child tab
   * @param diffType Tipo de diff
   */
  private calculateLocalDiffStats(childTab: SideTab, diffType: string): void {
    // Para working-tree, staged y ediciones, establecemos stats placeholder
    // En una implementación real, parsearías el contenido del diff
    if (diffType === 'working-tree' || diffType === 'staged' || diffType === 'edit') {
      // Para ediciones de Copilot, intentar extraer stats del label
      if (diffType === 'edit') {
        const statsMatch = childTab.metadata.label.match(/[+](\d+)[-](\d+)/);
        if (statsMatch) {
          childTab.state.diffStats = {
            linesAdded: parseInt(statsMatch[1], 10),
            linesRemoved: parseInt(statsMatch[2], 10),
          };
          return;
        }
      }
      // TODO: Implementar parseo real de diff cuando VS Code API lo soporte
      // Por ahora, mostrar stats placeholder
      childTab.state.diffStats = {
        linesAdded: 0,
        linesRemoved: 0,
      };
    } else if (diffType === 'snapshot' || diffType === 'commit') {
      // Para snapshots y commits, usar tiempo actual como placeholder
      childTab.state.diffStats = {
        timestamp: Date.now(),
        snapshotName: childTab.metadata.label,
      };
    } else if (diffType === 'merge-conflict') {
      // Para conflictos de merge, el conteo necesitaría parsear el archivo
      childTab.state.diffStats = {
        conflictSections: 0, // Placeholder
      };
    }
  }
  
  /**
   * Obtiene estadísticas de documento desde DocumentManager.
   * 
   * @param tabId ID de la tab parent
   * @returns Estadísticas agregadas o undefined
   */
  getDocumentStats(tabId: string): ReturnType<NonNullable<typeof this.documentManager>['getDocumentStats']> | undefined {
    const tab = this.stateService.getTab(tabId);
    if (!tab?.metadata.uri || !this.documentManager) {
      return undefined;
    }
    
    const document = this.documentManager.getDocumentByUri(tab.metadata.uri);
    if (!document) {
      return undefined;
    }
    
    return this.documentManager.getDocumentStats(document.documentId);
  }

  /**
   * Obtiene el árbol jerárquico de tabs (parents con sus children).
   * Útil para renderizado y navegación.
   * 
   * @param groupId Opcional: filtrar por grupo
   * @returns Árbol de tabs
   */
  getTabTree(groupId?: number): TabTreeNode[] {
    const allTabs = groupId 
      ? this.stateService.getTabsInGroup(groupId)
      : this.stateService.getAllTabs();
    
    const parents = allTabs.filter((tab: SideTab) => !tab.metadata.parentId);
    
    return parents.map((parent: SideTab) => ({
      tab: parent,
      children: this.buildChildrenTree(parent.metadata.id, allTabs),
    }));
  }

  /**
   * Construye recursivamente el árbol de children.
   * 
   * @param parentId ID del parent
   * @param allTabs Todas las tabs disponibles
   * @returns Array de nodos hijos
   */
  private buildChildrenTree(parentId: string, allTabs: SideTab[]): TabTreeNode[] {
    const children = allTabs.filter((tab: SideTab) => tab.metadata.parentId === parentId);
    
    return children.map((child: SideTab) => ({
      tab: child,
      children: this.buildChildrenTree(child.metadata.id, allTabs),
    }));
  }

  /**
   * Sincroniza la posición del cursor (línea y columna) entre un parent tab y todos sus children.
   * Si la configuración syncCursorPosition está habilitada, actualiza todos los editores relacionados.
   * 
   * @param tabId ID de la tab que cambió su posición de cursor
   * @param line Línea del cursor (1-based)
   * @param column Columna del cursor (1-based)
   */
  async syncCursorPosition(tabId: string, line: number, column: number): Promise<void> {
    const config = vscode.workspace.getConfiguration('tabsLover');
    if (!config.get('syncCursorPosition', false)) {
      return; // Feature disabled
    }

    const tab = this.stateService.getTab(tabId);
    if (!tab) {
      return;
    }

    // Actualizar posición en la tab actual
    tab.state.cursorLine = line;
    tab.state.cursorColumn = column;

    // Determinar familia de tabs (parent + children o solo children si es parent)
    const family: SideTab[] = [];
    let parentTab: SideTab | undefined;

    if (tab.metadata.parentId) {
      // Es un child, buscar parent y siblings
      parentTab = this.stateService.getTab(tab.metadata.parentId);
      if (parentTab) {
        family.push(parentTab);
        family.push(...this.getChildren(tab.metadata.parentId));
      }
    } else {
      // Es un parent, buscar sus children
      family.push(...this.getChildren(tab.metadata.id));
    }

    // Actualizar posición en todos los miembros de la familia
    for (const familyTab of family) {
      if (familyTab.metadata.id === tabId) {
        continue; // Skip self
      }

      // Actualizar estado
      familyTab.state.cursorLine = line;
      familyTab.state.cursorColumn = column;

      // Si el tab tiene URI, intentar actualizar el editor si está abierto
      if (familyTab.metadata.uri) {
        await this.updateEditorCursor(familyTab.metadata.uri, line, column);
      }
    }

    Logger.log(`[TabHierarchy] Synced cursor position: line ${line}, col ${column} (${family.length} tabs affected)`);
  }

  /**
   * Actualiza la posición del cursor en un editor abierto.
   * 
   * @param uri URI del documento
   * @param line Línea (1-based)
   * @param column Columna (1-based)
   */
  private async updateEditorCursor(uri: vscode.Uri, line: number, column: number): Promise<void> {
    // Buscar editor que coincida con el URI
    const editor = vscode.window.visibleTextEditors.find(
      e => e.document.uri.toString() === uri.toString()
    );

    if (!editor) {
      return; // Editor no visible, no podemos actualizar
    }

    // Convertir a 0-based para VS Code API
    const position = new vscode.Position(line - 1, column - 1);
    const selection = new vscode.Selection(position, position);

    // Actualizar selección sin cambiar el foco
    editor.selection = selection;

    // Revelar la posición en el centro (opcional)
    editor.revealRange(
      new vscode.Range(position, position),
      vscode.TextEditorRevealType.InCenterIfOutsideViewport
    );
  }
}

/**
 * Nodo en el árbol jerárquico de tabs.
 */
export type TabTreeNode = {
  tab: SideTab;
  children: TabTreeNode[];
};

