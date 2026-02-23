# Plan de Optimización: TabSyncService

**Objetivo:** Modularizar TabSyncService (~1000 líneas) en componentes especializados y corregir bugs de jerarquía parent-child.

---

## 🎯 Problemas Actuales

### 1. **Bugs de Jerarquía**
- ❌ `hasChildren` nunca se actualiza (siempre `false`)
- ❌ `childrenCount` nunca se actualiza (siempre `0`)
- ❌ Eliminar child no actualiza parent
- ❌ `capabilities.canExpand` siempre `false`

### 2. **Complejidad Excesiva**
- TabSyncService: ~1000 líneas
- Múltiples responsabilidades:
  - Conversión de tabs (400 líneas)
  - Clasificación de diff types (80 líneas)
  - Sincronización de estado activo (120 líneas)
  - Limpieza de huérfanos (40 líneas)
  - Herencia de estado (15 líneas)
  - Gestión de parent-child (200 líneas)

### 3. **Sincronización Asíncrona Problemática**
```typescript
// ❌ ACTUAL: Child se añade antes que parent
if (st.metadata.parentId) {
  this.ensureParentExists(st, tab).then(() => { /* ... */ });
}
this.stateService.addTab(st); // ⚠️ Se ejecuta inmediatamente
```

---

## 🏗️ Nueva Arquitectura

### Estructura Propuesta

```
src/services/core/
├── TabSyncService.ts          (Orquestador - ~500 líneas)
├── TabHierarchyService.ts     (Gestión parent-child - NUEVO)
└── helpers/
    ├── tabConverter.ts        (Funciones puras - NUEVO)
    └── tabClassifier.ts       (Funciones puras - NUEVO)
```

---

## 📦 Módulos Nuevos

### 1. TabHierarchyService (CRÍTICO)

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
  
  // Heredar estado del parent (solo viewMode para MD children)
  // IMPORTANTE: NO se heredan gitStatus, diagnostics ni iconos
  inheritState(childTab: SideTab, parentTab: SideTab): void
}
```

**Impacto:** Soluciona TODOS los bugs de jerarquía.

**Características de Children:**
- ✅ Children de Markdown heredan `viewMode` del parent
- ❌ **NO** heredan `gitStatus`, `diagnosticSeverity` ni iconos de estado
- ❌ **NO** tienen tab-actions (solo botón cerrar con codicon 'dash')
- ✅ Cuando activos: parent mantiene apariencia activa, borde 5px pasa al child

### 2. helpers/tabConverter.ts

**Responsabilidad:** Funciones puras para convertir tabs nativas → SideTabs

```typescript
// Función principal de conversión
export function convertToSideTab(
  tab: vscode.Tab,
  gitService: GitSyncService,
  index?: number
): SideTab | null

// Genera ID único
export function generateId(...): string

// Obtiene severidad de diagnósticos
export function getDiagnosticSeverity(uri: vscode.Uri): DiagnosticSeverity | null
```

**Ventajas:**
- ✅ Funciones puras → fácil testear sin mocks
- ✅ Sin estado → sin efectos secundarios
- ✅ ~400 líneas bien organizadas

### 3. helpers/tabClassifier.ts

**Responsabilidad:** Funciones puras para clasificar diff types

```typescript
// Clasifica tipo de diff
export function classifyDiffType(
  label: string,
  originalUri?: vscode.Uri,
  modifiedUri?: vscode.Uri
): DiffType

// Determina parentId para diff tabs
export function determineParentId(
  diffType: DiffType,
  uri: vscode.Uri,
  viewColumn: number
): string | undefined
```

**Ventajas:**
- ✅ Lógica de clasificación centralizada
- ✅ Fácil añadir nuevos tipos de diff
- ✅ ~100 líneas simples

---

## 🔧 Cambios en Servicios Existentes

### TabStateService

**Añadir:**
```typescript
// Awareness de jerarquía
setHierarchyService(service: TabHierarchyService): void

// Al eliminar tab, desregistrar del parent
removeTab(id: string): void {
  if (tab.metadata.parentId) {
    this.hierarchyService.unregisterChild(id, tab.metadata.parentId);
  }
  // Si es parent, eliminar children primero
  if (tab.state.hasChildren) {
    const children = this.hierarchyService.getChildren(id);
    for (const child of children) {
      this.removeTabInternal(child.metadata.id);
    }
  }
  this.removeTabInternal(id);
}

// Obtener árbol jerárquico
getTabTree(groupId?: number): TabTreeNode[]
```

### TabSyncService (Refactorizado)

**De ~1000 líneas → ~500 líneas**

```typescript
import { convertToSideTab } from './helpers/tabConverter';
import { classifyDiffType } from './helpers/tabClassifier';

export class TabSyncService {
  private hierarchyService: TabHierarchyService;
  private gitSyncService: GitSyncService;

  constructor(private stateService: TabStateService) {
    this.hierarchyService = new TabHierarchyService(stateService);
    this.gitSyncService = new GitSyncService(stateService);
  }

  private async handleTabChanges(e: vscode.TabChangeEvent): Promise<void> {
    for (const tab of e.opened) {
      const st = convertToSideTab(tab, this.gitSyncService); // ✅ Función pura
      if (!st) { continue; }

      // ✅ CORREGIDO: Esperar a que parent exista antes de añadir child
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

    if (e.closed.length > 0) {
      this.removeOrphanedTabs(); // Método privado
    }

    this.syncActiveState(); // Método privado
  }

  private async syncAll(): Promise<void> {
    // ... lógica existente ...
    
    this.stateService.replaceTabs(allTabs);
    
    // ✅ NUEVO: Recalcular jerarquía después de sync completo
    this.hierarchyService.recalculateAllCounts();
  }
  
  // Métodos privados internos
  private syncActiveState(): void { /* ~120 líneas */ }
  private removeOrphanedTabs(): void { /* ~80 líneas */ }
}
```

---

## 🎨 UI: Expansión/Colapso de Children

### HTML Builder

```typescript
// Botón de expansión
let expandButton = '';
if (tab.state.hasChildren) {
  const expandIcon = tab.state.isExpanded ? 'chevron-down' : 'chevron-right';
  expandButton = `
    <button class="expand-toggle" data-action="toggleExpand" data-tabid="${id}">
      <span class="codicon codicon-${expandIcon}"></span>
    </button>
  `;
}


// Ocultar children si parent colapsado
private renderChildTab(child, parent): string {
  const hiddenClass = parent.state.isExpanded ? '' : 'hidden';
  return `<div class="tab child-tab ${hiddenClass}" ...>...</div>`;
}
```

### CSS

```css
.expand-toggle {
  width: 20px;
  height: 20px;
  margin-right: 4px;
  opacity: 0.7;
  transition: opacity 0.2s, transform 0.2s;
}

.child-tab.hidden {
  display: none;
}

@keyframes slideDown {
  from { opacity: 0; max-height: 0; transform: translateY(-4px); }
  to { opacity: 1; max-height: 40px; transform: translateY(0); }
}
```

### WebviewProvider Handler

```typescript
case 'toggleExpand': {
  this.hierarchyService.toggleExpanded(msg.tabId);
  break;
}
```

---

## 📊 Métricas de Mejora

| Métrica | Antes | Después | Mejora |
|---------|-------|---------|--------|
| Líneas TabSyncService | ~1000 | ~500 | -50% |
| Módulos independientes | 1 | 3 (1 servicio + 2 helpers) | +200% |
| Testabilidad | Baja | Alta | +++++ |
| Bugs de jerarquía | 4 | 0 | -100% |
| Complejidad ciclomática | Alta | Media | -40% |

---

## 🚀 Plan de Implementación

### Sprint 1: Fundamentos (1-2 días)
- [ ] Crear `TabHierarchyService`
- [ ] Integrar en `TabStateService`
- [ ] Tests unitarios de hierarchy
- [ ] Corregir bugs de `hasChildren`/`childrenCount`

### Sprint 2: Modularización (2 días)
- [ ] Crear helpers `tabConverter.ts` con funciones puras
- [ ] Crear helpers `tabClassifier.ts` con funciones puras
- [ ] Refactorizar `TabSyncService` para usar helpers
- [ ] Mantener `syncActiveState` y `removeOrphanedTabs` como métodos privados
- [ ] Tests de integración

### Sprint 3: Validación (1 día)
- [ ] Testing end-to-end
- [ ] Performance profiling
- [ ] Documentación
- [ ] Bug fixes

**Estimación total:** 4 días

---

## ✅ Checklist de Validación

### Funcionalidad
- [ ] `hasChildren` se actualiza al añadir/eliminar children
- [ ] `childrenCount` refleja número real de children
- [ ] Eliminar child actualiza parent correctamente
- [ ] Children heredan estado del parent

### Código
- [ ] TabSyncService < 350 líneas
- [ ] Cada módulo < 200 líneas
- [ ] Tests unitarios ≥ 80% coverage
- [ ] Sin import cíclicos
- [ ] Sin duplicación de lógica

### Performance
- [ ] Tiempo de sincronización < 50ms (< 100 tabs)
- [ ] Sin memory leaks
- [ ] Sin flickering en UI
- [ ] Animaciones a 60fps

---

## 📚 Referencias

- [Análisis Completo](./ANALISIS_PARENT_CHILD.md)
- [Arquitectura](./02_arquitectura.md)
- [Implementación](./04_implementacion.md)
- [Estilos](./06_estilos.md)

---

**Documento creado:** 22 de febrero de 2026  
**Autor:** Dr. Tabs (Copilot Agent)
