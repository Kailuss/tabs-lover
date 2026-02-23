# Análisis: Relación Parent-Child en SideTabs

**Fecha:** 23 de febrero de 2026  
**Filosofía Base:** Un SideTab = Un Documento

---

## 🎯 Filosofía de Diseño

### Principio Fundamental
En Tabs Lover, **cada SideTab representa un documento único**. Las tabs nativas de VS Code pueden tener múltiples visualizaciones del mismo documento (diff, compare, snapshot, changes), pero en nuestra extensión consolidamos todo en una estructura jerárquica:

- **Parent Tab** → El documento en sí (archivo fuente)
- **Child Tabs** → Diferentes visualizaciones del mismo documento (Working Tree, Staged, Snapshot, etc.)

### Ejemplo Práctico
```
📄 TabSyncService.ts (Parent)
  ├── 🔄 Working Tree (Child - cambios sin guardar)
  ├── 📦 Staged Changes (Child - cambios preparados)
  └── 📸 Snapshot 14:30 (Child - versión histórica)
```

Cada child se identifica con:
- **Icono específico** según su `diffType`
- **Label descriptivo** (Working Tree, Staged, Snapshot...)
- **Estadísticas** (líneas añadidas/removidas, timestamp)
- **Estado heredado** del parent (git status, diagnósticos)

---

## ✨ Sincronización de Posición de Cursor (NUEVO)

### Funcionalidad
Desde la versión 0.3.3, Tabs Lover soporta la **sincronización automática de la posición del cursor** entre tabs parent y sus children. Cuando esta funcionalidad está habilitada:

- Al mover el cursor en un parent tab, todos sus children se actualizan a la misma línea/columna
- Al mover el cursor en un child tab, el parent y todos los siblings se sincronizan
- Al cambiar a una tab de una familia parent-child, se sincroniza la posición actual

### Configuración
```json
{
  "tabsLover.syncCursorPosition": false  // Default: deshabilitado
}
```

### Casos de Uso
- **Comparación de versiones**: Ver la misma línea en Working Tree, Staged y el archivo original
- **Revisión de cambios**: Navegar por diffs manteniendo el contexto
- **Debugging multi-versión**: Comparar implementaciones en diferentes snapshots

### Implementación Técnica
- **Estado**: `SideTabState.cursorLine` y `cursorColumn` (1-based)
- **Listener**: `onDidChangeTextEditorSelection` en `TabSyncService`
- **Sincronización**: `TabHierarchyService.syncCursorPosition()`
- **Performance**: Solo actualiza editores visibles, sin overhead innecesario

---

## 📊 Estado Actual de Implementación

### ✅ Lo que funciona bien

#### 1. Identificación de Relaciones
```typescript
// TabSyncService.ts líneas 708-735
let parentId: string | undefined;
let diffType: DiffType | undefined;

if (tabType === 'diff' && uri) {
  diffType = this.classifyDiffType(label, originalUri, modifiedUri);
  
  if (diffType === 'snapshot' || 
      diffType === 'working-tree' || 
      diffType === 'staged' || 
      diffType === 'merge-conflict') {
    parentId = `${uri.toString()}-${viewColumn}`;
  }
}
```

**Evaluación:** ✅ Correcto. Los child tabs se vinculan correctamente al parent usando el URI + viewColumn.

**Características de Children:**
- ✅ Identificados mediante `parentId` y `diffType`
- ✅ Children de Markdown heredan `viewMode` del parent
- ❌ **NO** heredan `gitStatus`, `diagnosticSeverity` ni iconos de estado
- ❌ **NO** tienen tab-actions completas (solo botón cerrar con codicon 'dash')
- ✅ Cuando activos, el parent mantiene apariencia activa pero sin borde izquierdo de 5px

#### 2. Herencia de Estado
```typescript
// TabSyncService.ts líneas 344-358
private inheritParentState(childTab: SideTab, parentTab: SideTab): void {
  // Solo children de Markdown heredan viewMode
  if (parentTab.metadata.fileExtension === '.md' && childTab.metadata.diffType) {
    childTab.state.viewMode = parentTab.state.viewMode;
  }
  this.calculateDiffStats(childTab);
}
```

**Evaluación:** ✅ Correcto. Los child tabs de Markdown heredan viewMode del parent.
**IMPORTANTE:** Los children NO heredan gitStatus, diagnosticSeverity ni iconos de estado.

#### 3. Renderizado Jerárquico
```typescript
// TabsLoverHtmlBuilder.ts líneas 146-186
const parentTabs = tabs.filter(t => !t.metadata.parentId);
const childTabs = tabs.filter(t => t.metadata.parentId);

const childrenByParent = new Map<string, SideTab[]>();
// Agrupa children por parent...

for (const parent of sortedParents) {
  const children = childrenByParent.get(parent.metadata.id) || [];
  block += await this.renderTab(parent, ...);
  for (const child of children) {
    block += await this.renderChildTab(child, ...);
  }
}
```

**Evaluación:** ✅ Correcto. Los children se renderizan dentro del bloque del parent.

#### 4. Manejo de Parents Faltantes
```typescript
// TabSyncService.ts líneas 189-262
private async ensureParentExists(childTab: SideTab, nativeChildTab: vscode.Tab): Promise<void> {
  const parentId = childTab.metadata.parentId;
  if (!parentId) { return; }
  
  if (this.stateService.getTab(parentId)) {
    return; // Parent exists
  }
  
  // Search for parent in native tabs
  // If not found, open it automatically
  const doc = await vscode.workspace.openTextDocument(childUri);
  await vscode.window.showTextDocument(doc, {
    viewColumn: group.viewColumn,
    preview: false,
    preserveFocus: true,
  });
}
```

**Evaluación:** ✅ Correcto. Si el parent no existe, se abre automáticamente.

---

## ⚠️ Problemas Identificados

### 1. **NO SE ACTUALIZA `hasChildren` ni `childrenCount`**

**Problema:** Los campos `hasChildren` y `childrenCount` en `SideTabState` se inicializan en `false` y `0`, pero **nunca se actualizan** cuando se añaden child tabs.

```typescript
// TabSyncService.ts líneas 806-809
state: SideTabState = {
  // ...
  hasChildren: false, // ❌ Nunca se actualiza
  isChild: tabType === 'diff',
  isExpanded: false,
  childrenCount: 0,  // ❌ Nunca se actualiza
}
```

**Impacto:**
- No se puede implementar lógica de expansión/colapso
- Las capabilities `canExpand` no funcionan correctamente

**Ubicaciones afectadas:**
- `TabSyncService.convertToSideTab()` - inicialización
- `TabStateService.addTab()` - no actualiza parent
- `TabStateService.removeTab()` - no actualiza parent

### 2. **Sincronización Asíncrona Inconsistente**

**Problema:** En `handleTabChanges`, la llamada a `ensureParentExists` es asíncrona pero no se espera:

```typescript
// TabSyncService.ts líneas 70-81
if (st.metadata.parentId) {
  this.ensureParentExists(st, tab).then(() => {
    const parentTab = this.stateService.getTab(st.metadata.parentId!);
    if (parentTab) {
      this.inheritParentState(st, parentTab);
      this.stateService.updateTab(st);
    }
  });
}

// Se añade el child ANTES de que el parent exista
this.stateService.addTab(st);
```

**Impacto:**
- El child puede añadirse antes que el parent
- Renderizado temporal de "orphan child tabs"
- Posibles errores de referencia

### 3. **No hay método centralizado para gestionar la jerarquía**

**Problema:** La lógica de parent-child está dispersa:
- `TabSyncService` maneja la creación y herencia
- `TabStateService` almacena sin conocer la jerarquía
- `TabsLoverHtmlBuilder` agrupa para renderizar

**Impacto:**
- Difícil mantener consistencia
- Lógica duplicada
- No hay un punto único de verdad

### 4. **Eliminación de Children No Actualiza Parent**

**Problema:** Cuando se cierra un child tab, el parent no se actualiza:

```typescript
// TabStateService.ts líneas 58-68
removeTab(id: string): void {
  const tab = this.tabs.get(id);
  if (tab) {
    const group = this.groups.get(tab.state.groupId);
    if (group) {
      group.tabs = group.tabs.filter(t => t.metadata.id !== id);
    }
    this.tabs.delete(id);
    this._onDidChangeState.fire();
  }
  // ❌ No actualiza el parent si era un child
}
```

**Impacto:**
- El contador de children queda desincronizado
- El parent puede mostrar `hasChildren: true` sin children reales

### 5. **Capacidades No Reflejan Estado Real**

**Problema:** Las capabilities se calculan una vez en `convertToSideTab`:

```typescript
// SideTabHelpers.ts líneas 348-400
canExpand: state.hasChildren || false,
```

Pero como `hasChildren` nunca se actualiza, `canExpand` siempre es `false`.

---

## 🎯 Plan de Optimización y Modularización

### Fase 1: Módulo de Jerarquía de Tabs

**Objetivo:** Centralizar toda la lógica de parent-child en un módulo dedicado.

#### Crear: `src/services/core/TabHierarchyService.ts`

```typescript
/**
 * Gestiona la relación jerárquica entre tabs padre e hijas.
 * Mantiene el conteo de children, herencia de estado, y sincronización.
 */
export class TabHierarchyService {
  constructor(private stateService: TabStateService) {}

  /**
   * Registra un child tab bajo su parent.
   * Actualiza hasChildren, childrenCount en el parent.
   */
  registerChild(childId: string, parentId: string): void {
    const parent = this.stateService.getTab(parentId);
    if (!parent) { return; }

    parent.state.hasChildren = true;
    parent.state.childrenCount++;
    
    // Recalcular capabilities
    parent.state.capabilities.canExpand = true;
    
    this.stateService.updateTab(parent);
  }

  /**
   * Desregistra un child tab de su parent.
   * Actualiza contadores y estado del parent.
   */
  unregisterChild(childId: string, parentId: string): void {
    const parent = this.stateService.getTab(parentId);
    if (!parent) { return; }

    parent.state.childrenCount = Math.max(0, parent.state.childrenCount - 1);
    parent.state.hasChildren = parent.state.childrenCount > 0;
    
    if (!parent.state.hasChildren) {
      parent.state.capabilities.canExpand = false;
      parent.state.isExpanded = false;
    }
    
    this.stateService.updateTab(parent);
  }

  /**
   * Obtiene todos los children de un parent.
   */
  getChildren(parentId: string): SideTab[] {
    return this.stateService.getAllTabs()
      .filter(tab => tab.metadata.parentId === parentId)
      .sort((a, b) => a.state.indexInGroup - b.state.indexInGroup);
  }

  /**
   * Verifica si una tab tiene children.
   */
  hasChildren(tabId: string): boolean {
    return this.stateService.getAllTabs()
      .some(tab => tab.metadata.parentId === tabId);
  }

  /**
   * Actualiza el conteo de children para todos los parents.
   * Útil después de syncAll o cambios masivos.
   */
  recalculateAllCounts(): void {
    const parents = this.stateService.getAllTabs()
      .filter(tab => !tab.metadata.parentId);

    for (const parent of parents) {
      const children = this.getChildren(parent.metadata.id);
      parent.state.childrenCount = children.length;
      parent.state.hasChildren = children.length > 0;
      parent.state.capabilities.canExpand = children.length > 0;
      
      if (!parent.state.hasChildren) {
        parent.state.isExpanded = false;
      }
    }
  }

  /**
   * Hereda estado del parent al child.
   * IMPORTANTE: Solo children de Markdown heredan viewMode del parent.
   * Los children NO heredan gitStatus, diagnosticSeverity ni iconos de estado.
   */
  inheritState(childTab: SideTab, parentTab: SideTab): void {
    // Solo para children de Markdown: heredar viewMode
    if (parentTab.metadata.fileExtension === '.md' && childTab.metadata.diffType) {
      childTab.state.viewMode = parentTab.state.viewMode;
    }
  }
}
```

### Fase 2: Refactorizar `TabSyncService`

**Objetivo:** Extraer submódulos y reducir complejidad.

#### Estructura Propuesta

```
src/services/core/
├── TabSyncService.ts          (Orquestador - ~500 líneas)
├── TabHierarchyService.ts     (Gestión parent-child) ✅ NUEVO
└── helpers/
    ├── tabConverter.ts        (Funciones puras) ✅ NUEVO
    └── tabClassifier.ts       (Funciones puras) ✅ NUEVO
```

#### Módulo 1: `TabHierarchyService` (SERVICIO)

**Responsabilidad:** Gestión centralizada de relaciones parent-child

```typescript
export class TabHierarchyService {
  // Registrar child bajo parent (actualiza hasChildren, childrenCount)
  registerChild(childId: string, parentId: string): void
  
  // Desregistrar child (actualiza contadores del parent)
  unregisterChild(childId: string, parentId: string): void
  
  // Obtener todos los children de un parent
  getChildren(parentId: string): SideTab[]
  
  // Recalcular contadores de todos los parents
  recalculateAllCounts(): void
  
  // Heredar estado (solo viewMode para MD children)
  // IMPORTANTE: NO se heredan gitStatus, diagnostics ni iconos
  inheritState(childTab: SideTab, parentTab: SideTab): void
}
```

**Impacto:** Soluciona TODOS los bugs de jerarquía.

#### Módulo 2: `helpers/tabConverter.ts` (FUNCIONES PURAS)

**Responsabilidad:** Convertir tabs nativas a SideTabs

```typescript
/**
 * Convierte una tab nativa de VS Code a SideTab
 * @returns SideTab o null si el tipo no es soportado
 */
export function convertToSideTab(
  tab: vscode.Tab,
  gitService: GitSyncService,
  index?: number
): SideTab | null {
  // ~400 líneas de lógica de conversión
}

/**
 * Genera ID único para una tab
 */
export function generateId(
  label: string,
  uri: vscode.Uri | undefined,
  viewColumn: vscode.ViewColumn,
  tabType: SideTabType
): string {
  // Lógica de generación de ID
}

/**
 * Obtiene severidad de diagnósticos para un archivo
 */
export function getDiagnosticSeverity(
  uri: vscode.Uri
): vscode.DiagnosticSeverity | null {
  // Lógica de diagnósticos
}
```

**Ventaja:** Funciones puras → fácil testear sin mocks

#### Módulo 3: `helpers/tabClassifier.ts` (FUNCIONES PURAS)

**Responsabilidad:** Clasificar tipos de diff y asignar parentId

```typescript
/**
 * Clasifica el tipo de diff basándose en label y URIs
 */
export function classifyDiffType(
  label: string,
  originalUri?: vscode.Uri,
  modifiedUri?: vscode.Uri
): DiffType {
  // Lógica de clasificación (~80 líneas)
}

/**
 * Determina el parentId para una tab diff
 */
export function determineParentId(
  diffType: DiffType,
  uri: vscode.Uri,
  viewColumn: number,
  originalUri?: vscode.Uri,
  modifiedUri?: vscode.Uri
): string | undefined {
  // Lógica de asignación de parentId (~30 líneas)
}
```

**Ventaja:** Sin estado → funciones simples y predecibles

#### TabSyncService Refactorizado:

```typescript
import { convertToSideTab, generateId } from './helpers/tabConverter';
import { classifyDiffType, determineParentId } from './helpers/tabClassifier';

export class TabSyncService {
  private disposables: vscode.Disposable[] = [];
  private gitSyncService: GitSyncService;
  private hierarchyService: TabHierarchyService;

  constructor(private stateService: TabStateService) {
    this.gitSyncService = new GitSyncService(stateService);
    this.hierarchyService = new TabHierarchyService(stateService);
  }

  activate(context: vscode.ExtensionContext): void {
    this.syncAll();
    
    // Registrar listeners
    this.disposables.push(
      vscode.window.tabGroups.onDidChangeTabs(e => this.handleTabChanges(e)),
      vscode.window.tabGroups.onDidChangeTabGroups(e => this.handleGroupChanges(e)),
      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) { this.syncActiveState(); }
      }),
      vscode.languages.onDidChangeDiagnostics(e => {
        for (const uri of e.uris) {
          this.updateTabDiagnostics(uri);
        }
      }),
    );

    this.gitSyncService.activate(context);
    context.subscriptions.push(...this.disposables);
  }

  private async handleTabChanges(e: vscode.TabChangeEvent): Promise<void> {
    // Procesar opened tabs
    for (const tab of e.opened) {
      const st = convertToSideTab(tab, this.gitSyncService); // ✅ Función pura
      if (!st) { continue; }

      // Si es child, asegurar parent y registrar
      if (st.metadata.parentId) {
        await this.ensureParentExists(st, tab);
        const parent = this.stateService.getTab(st.metadata.parentId);
        if (parent) {
          this.hierarchyService.inheritState(st, parent);
          this.hierarchyService.registerChild(st.metadata.id, st.metadata.parentId);
        }
      }

      this.stateService.addTab(st);
    }

    // Procesar closed tabs
    if (e.closed.length > 0) {
      this.removeOrphanedTabs(); // Método privado
    }

    // Procesar changed tabs
    for (const tab of e.changed) {
      const st = convertToSideTab(tab, this.gitSyncService);
      if (!st) { continue; }

      const existing = this.stateService.getTab(st.metadata.id);
      if (!existing) {
        this.stateService.updateTab(st);
        continue;
      }

      // Actualizar propiedades
      this.updateTabProperties(existing, st);
    }

    // Sincronizar estado activo
    this.syncActiveState(); // Método privado
  }

  private async syncAll(): Promise<void> {
    // Añadir grupos
    for (const group of vscode.window.tabGroups.all) {
      this.stateService.addGroup(createTabGroup(group));
    }

    const allTabs: SideTab[] = [];
    const childTabs: Array<{ sideTab: SideTab; nativeTab: vscode.Tab }> = [];
    
    // Primera pasada: parents
    for (const group of vscode.window.tabGroups.all) {
      group.tabs.forEach((tab, idx) => {
        const st = convertToSideTab(tab, this.gitSyncService, idx); // ✅ Función pura
        if (st) {
          if (st.metadata.parentId) {
            childTabs.push({ sideTab: st, nativeTab: tab });
          } else {
            allTabs.push(st);
          }
        }
      });
    }
    
    // Segunda pasada: children (con parents garantizados)
    for (const { sideTab, nativeTab } of childTabs) {
      await this.ensureParentExistsForSync(sideTab, nativeTab, allTabs);
      allTabs.push(sideTab);
    }
    
    this.stateService.replaceTabs(allTabs);
    
    // Recalcular jerarquía completa
    this.hierarchyService.recalculateAllCounts();
  }

  // Métodos privados (~200 líneas totales)
  private syncActiveState(): void { /* ~120 líneas */ }
  private removeOrphanedTabs(): void { /* ~80 líneas */ }
  private updateTabDiagnostics(uri: vscode.Uri): void { /* ... */ }
  // ... otros métodos auxiliares ...
}
```

**Resultado:**
- TabSyncService: ~500 líneas (más realista)
- 1 servicio nuevo (TabHierarchyService)
- 2 archivos de helpers (funciones puras)
- Métodos privados para lógica interna
- Menos inyección de dependencias
- Igual de mantenible

### Fase 3: Mejorar `TabStateService`

**Objetivo:** Integrar awareness de jerarquía.

```typescript
export class TabStateService {
  private tabs: Map<string, SideTab> = new Map();
  private groups: Map<number, SideTabGroup> = new Map();
  private hierarchyService?: TabHierarchyService; // Inyección circular controlada

  setHierarchyService(service: TabHierarchyService): void {
    this.hierarchyService = service;
  }

  removeTab(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab) { return; }

    // Si es child, desregistrar del parent
    if (tab.metadata.parentId && this.hierarchyService) {
      this.hierarchyService.unregisterChild(id, tab.metadata.parentId);
    }

    // Si es parent con children, eliminar children primero
    if (tab.state.hasChildren && this.hierarchyService) {
      const children = this.hierarchyService.getChildren(id);
      for (const child of children) {
        this.removeTabInternal(child.metadata.id);
      }
    }

    this.removeTabInternal(id);
  }

  private removeTabInternal(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab) { return; }

    const group = this.groups.get(tab.state.groupId);
    if (group) {
      group.tabs = group.tabs.filter(t => t.metadata.id !== id);
    }

    this.tabs.delete(id);
    this._onDidChangeState.fire();
  }

  // Nuevo método: obtener árbol jerárquico
  getTabTree(groupId?: number): TabTreeNode[] {
    const tabs = groupId 
      ? this.getTabsInGroup(groupId)
      : this.getAllTabs();

    const parents = tabs.filter(t => !t.metadata.parentId);
    
    return parents.map(parent => ({
      tab: parent,
      children: tabs
        .filter(t => t.metadata.parentId === parent.metadata.id)
        .map(child => ({ tab: child, children: [] })),
    }));
  }
}

type TabTreeNode = {
  tab: SideTab;
  children: TabTreeNode[];
};
```

---

## 📋 Resumen de Cambios

### Archivos Nuevos
1. ✨ `src/services/core/TabHierarchyService.ts` - Gestión centralizada de jerarquía (~200 líneas)
2. ✨ `src/services/core/helpers/tabConverter.ts` - Funciones de conversión (~400 líneas)
3. ✨ `src/services/core/helpers/tabClassifier.ts` - Funciones de clasificación (~100 líneas)

### Archivos Modificados
1. 🔧 `src/services/core/TabSyncService.ts` - Refactorizado, de ~1000 → ~300 líneas
2. 🔧 `src/services/core/TabStateService.ts` - Añadir awareness de jerarquía
3. 🔧 `src/providers/TabsLoverHtmlBuilder.ts` - Renderizado de jerarquía parent-child

### Beneficios

#### 📐 Modularidad
- Código dividido en módulos con responsabilidades claras
- Fácil de testear unitariamente
- Reduce acoplamiento entre componentes

#### 🐛 Corrección de Bugs
- `hasChildren` y `childrenCount` siempre sincronizados
- Eliminación de children actualiza parent
- Capabilities reflejan estado real

#### 🎨 Mejoras de UX
- Jerarquía visual clara de parent-child
- Menos clutter visual

#### 🚀 Performance
- Menos recálculos innecesarios
- Sincronización más eficiente
- Mejor cache de estado

#### 🧪 Testabilidad
- Módulos pequeños y puros
- Fácil mockear dependencias
- Tests unitarios por módulo

---

## 🔄 Orden de Implementación

### Sprint 1: Fundamentos (1-2 días)
1. Crear `TabHierarchyService` con métodos básicos
2. Integrar en `TabStateService`
3. Actualizar `addTab`/`removeTab` para usar hierarchy service
4. Tests unitarios de hierarchy service

### Sprint 2: Refactoring de TabSyncService (2 días)
1. Crear helpers `tabConverter.ts` y `tabClassifier.ts` con funciones puras
2. Refactorizar `TabSyncService` para usar helpers y hierarchy service
3. Mantener `syncActiveState` y `removeOrphanedTabs` como métodos privados
4. Tests de integración

### Sprint 3: Validación y Pulido (1 día)
1. Testing end-to-end
2. Documentación
3. Performance profiling
4. Bug fixes

**Total estimado:** 4 días de desarrollo

---

## 🎓 Lecciones Aprendidas

1. **Separación de Responsabilidades:** TabSyncService hacía demasiado (conversión, clasificación, sincronización, limpieza). Dividir en módulos especializados mejora mantenibilidad.

2. **Estado Derivado:** `hasChildren` y `childrenCount` son estado derivado que debe recalcularse, no inicializarse una vez.

3. **Jerarquía como Ciudadano de Primera Clase:** La relación parent-child es fundamental y merece su propio servicio.

4. **Sincronización Asíncrona:** Operaciones async en event handlers requieren cuidado especial para evitar race conditions.

5. **UI = Reflejo del Estado:** La UI debe ser una proyección directa del estado interno, no tener lógica propia de jerarquía.

---

**Documento creado por:** Dr. Tabs (Copilot Agent)  
**Repositorio:** [Kailuss/tabs-lover](https://github.com/Kailuss/tabs-lover)
