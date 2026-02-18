# Tabs Lover — Optimization Manual

> **Fecha:** 2026-02-17 · Análisis completo del codebase actual

Este documento es un estudio técnico del estado actual del proyecto con propuestas de optimización priorizadas. Cada sección identifica el problema, su impacto y una solución concreta.

---

## Índice

1. [Rendimiento del Webview](#1-rendimiento-del-webview)
2. [TabIconManager — I/O y Caché](#2-tabiconmanager--io-y-caché)
3. [TabSyncService — Sincronización](#3-tabsyncservice--sincronización)
4. [TabStateService — Doble almacenamiento](#4-tabstateservice--doble-almacenamiento)
5. [Drag & Drop — Script incrustado](#5-drag--drop--script-incrustado)
6. [CSS — Especificidad y rendimiento](#6-css--especificidad-y-rendimiento)
7. [Archivos muertos](#7-archivos-muertos)
8. [FileActionRegistry — Acoplamiento](#8-fileactionregistry--acoplamiento)
9. [getGitStatus — Llamada repetida](#9-getgitstatus--llamada-repetida)
10. [Tabla de prioridades](#tabla-de-prioridades)

---

## 1. Rendimiento del Webview

### Problema

`TabsLoverWebviewProvider.refresh()` reconstruye **todo el HTML** en cada cambio de estado. Aunque hay un micro-debounce con `setTimeout(0)`, cada evento de pestañas regenera todos los `<div class="tab">`, re-lee iconos de caché y vuelve a serializar el árbol completo. Con 30–50 tabs abiertas esto empieza a notarse.

```typescript
// providers/TabsLoverWebviewProvider.ts
refresh(): void {
  if (!this._view || this._refreshScheduled) { return; }
  this._refreshScheduled = true;
  setTimeout(async () => {
    // ⚠️ Reconstruye TODO el HTML
    this._view.webview.html = await this.htmlBuilder.buildHtml(...);
  }, 0);
}
```

### Impacto
- **Alto.** Renderizados redundantes al activar/desactivar tabs (solo cambia `isActive`).
- Parpadeo visual perceptible con muchas tabs.

### Solución A — Debounce más largo para cambios estructurales

```typescript
private _debounceTimer: ReturnType<typeof setTimeout> | null = null;

refresh(isSilent = false): void {
  if (!this._view) { return; }
  const delay = isSilent ? 0 : 30; // 30ms para cambios estructurales
  if (this._debounceTimer) { clearTimeout(this._debounceTimer); }
  this._debounceTimer = setTimeout(async () => {
    this._debounceTimer = null;
    // ...rebuild
  }, delay);
}
```

### Solución B — Actualizaciones parciales vía `postMessage`

En lugar de reconstruir el HTML, enviar mensajes al webview para actualizaciones puntuales:

```typescript
// En lugar de refresh() completo para isActive:
this._view.webview.postMessage({
  type: 'updateActiveTab',
  tabId: tab.metadata.id,
});

// En el script del webview:
window.addEventListener('message', e => {
  if (e.data.type === 'updateActiveTab') {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.tab[data-tabid="${e.data.tabId}"]`)?.classList.add('active');
  }
});
```

Esto evita el repintado completo para el 80% de los eventos (cambio de tab activa).

### Solución C — Virtual DOM mínimo

Mantener un snapshot del HTML anterior y hacer diff para solo actualizar nodos cambiados. Requiere más trabajo pero elimina prácticamente todos los re-renders.

---

## 2. TabIconManager — I/O y Caché

### Problema

`getFileIconAsBase64()` tiene dos capas de caché (`_iconCache` y `_iconPathCache`) pero la clave de `_iconCache` no se usa de forma consistente en `getCachedIcon()`:

```typescript
// TabIconManager.ts — buildHtml llama a:
const cached = this.iconManager.getCachedIcon(fileName);  // ← sin languageId

// Pero getFileIconAsBase64 cachea con:
const cacheKey = `${fileNameLower}|${languageId || ''}`;
```

Si `getFileIconAsBase64` guarda el resultado con clave `"extension.ts|typescript"`, `getCachedIcon("extension.ts")` busca `"extension.ts|"` y **nunca encuentra el hit**. El icono se lee de disco en cada render.

### Impacto
- **Alto.** Acceso a disco en cada refresh para archivos TypeScript/JavaScript.

### Solución

```typescript
// En TabsLoverHtmlBuilder.renderTab():
const cached = this.iconManager.getCachedIcon(fileName); // busca sin languageId

// En TabIconManager.getCachedIcon() — añadir búsqueda parcial:
getCachedIcon(fileName: string, languageId?: string): string | undefined {
  const exactKey = `${fileName.toLowerCase()}|${languageId || ''}`;
  if (this._iconCache.has(exactKey)) { return this._iconCache.get(exactKey); }

  // Búsqueda por prefijo si no hay languageId
  if (!languageId) {
    const prefix = `${fileName.toLowerCase()}|`;
    for (const [key, value] of this._iconCache) {
      if (key.startsWith(prefix)) { return value; }
    }
  }
  return undefined;
}
```

O bien, normalizar siempre la clave a solo nombre de archivo al guardar.

---

## 3. TabSyncService — Sincronización

### Problema A — Git API accedida en cada tab

`getGitStatus()` llama a `vscode.extensions.getExtension('vscode.git')` y recorre `api.repositories` en cada invocación. Con 30 tabs, esto son 30 accesos a la extensión git por sync.

```typescript
// TabSyncService.ts
private getGitStatus(uri: vscode.Uri): GitStatus {
  const gitExtension = vscode.extensions.getExtension('vscode.git'); // ← cada vez
  const gitApi = gitExtension.exports;
  const api = gitApi.getAPI(1); // ← cada vez
  // ...
}
```

### Solución

Cachear la referencia a la API de git al activar el servicio:

```typescript
private _gitApi: any | null = null;

activate(context: vscode.ExtensionContext): void {
  this._gitApi = this.resolveGitApi();
  // Escuchar si git se activa después
  vscode.extensions.onDidChange(() => {
    this._gitApi = this.resolveGitApi();
  }, undefined, this.disposables);
  // ...
}

private resolveGitApi(): any | null {
  const ext = vscode.extensions.getExtension('vscode.git');
  return ext?.exports?.getAPI(1) ?? null;
}

private getGitStatus(uri: vscode.Uri): GitStatus {
  if (!this._gitApi || this._gitApi.repositories.length === 0) { return null; }
  // ...usar this._gitApi directamente
}
```

### Problema B — `removeOrphanedTabs` es O(n²)

```typescript
private removeOrphanedTabs(): void {
  const nativeIds = new Set<string>();
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const st = this.convertToSideTab(tab); // ← convierte TODOS los tabs
      if (st) { nativeIds.add(st.metadata.id); }
    }
  }
  // Luego itera todos los tabs internos
  for (const tab of this.stateService.getAllTabs()) { ... }
}
```

`convertToSideTab()` se llama para cada tab nativo solo para obtener su ID. Se podría tener un método `generateIdOnly()` mucho más ligero.

### Solución

```typescript
private generateIdFromNativeTab(tab: vscode.Tab): string | null {
  if (tab.input instanceof vscode.TabInputText) {
    return `${tab.input.uri.toString()}-${tab.group.viewColumn}`;
  }
  if (tab.input instanceof vscode.TabInputTextDiff) {
    return `diff:${tab.input.modified.toString()}-${tab.group.viewColumn}`;
  }
  if (tab.input instanceof vscode.TabInputWebview) {
    const safe = tab.label.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    return `webview:${safe}-${tab.group.viewColumn}`;
  }
  // ... etc
  return null;
}
```

---

## 4. TabStateService — Doble almacenamiento

### Problema

Las tabs se almacenan en **dos estructuras paralelas** que deben mantenerse sincronizadas:
- `Map<string, SideTab>` — búsqueda por ID
- `SideTabGroup.tabs: SideTab[]` — array por grupo

Cada mutación (addTab, removeTab, updateTab) debe actualizar ambas. Si una falla, el estado queda inconsistente.

```typescript
addTab(tab: SideTab): void {
  this.tabs.set(tab.metadata.id, tab);        // estructura 1
  const group = this.groups.get(...);
  if (group) { group.tabs.push(tab); }        // estructura 2
}
```

### Impacto
- **Medio.** Fuente potencial de bugs de sincronización. Ya se dan casos donde una tab aparece en el mapa pero no en el grupo.

### Solución

Usar el array del grupo como única fuente de verdad y derivar el mapa bajo demanda:

```typescript
class TabStateService {
  private groups: Map<number, SideTabGroup> = new Map();

  getTab(id: string): SideTab | undefined {
    for (const group of this.groups.values()) {
      const tab = group.tabs.find(t => t.metadata.id === id);
      if (tab) { return tab; }
    }
    return undefined;
  }

  getAllTabs(): SideTab[] {
    return Array.from(this.groups.values()).flatMap(g => g.tabs);
  }
}
```

O bien, mantener el mapa como caché derivado y reconstruirlo solo cuando cambia la estructura.

---

## 5. Drag & Drop — Script incrustado

### Problema

El script de drag & drop (`getDragDropScript()`) es una cadena de template literal de ~150 líneas incrustada en TypeScript. Esto hace que:
1. No haya type-checking del JavaScript del webview.
2. El editor no ofrece syntax highlighting ni autocompletado.
3. El bundle siempre incluye el script aunque D&D esté deshabilitado.

```typescript
// TabsLoverHtmlBuilder.ts
private getDragDropScript(): string {
  return `
    // === Drag & Drop via Mouse Events ===
    const TAB_H = 43;
    // ... 150 líneas de JS sin tipo
  `;
}
```

### Impacto
- **Medio.** Mantenibilidad baja, bugs difíciles de detectar.

### Solución

Mover el script a un archivo separado `src/webview/dragDrop.js` y cargarlo como recurso del webview:

```typescript
// En buildHtml():
const dragDropUri = webview.asWebviewUri(
  vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'dragDrop.js')
);

const dragDropScript = enableDragDrop
  ? `<script src="${dragDropUri}"></script>`
  : '';
```

Opcionalmente, usar TypeScript + un segundo entry point en esbuild para el webview script.

---

## 6. CSS — Especificidad y rendimiento

### Problema A — `!important` en cascada

Hay 8 declaraciones `!important` en los colores de estado git:

```css
.tab .tab-name.modified { color: var(...) !important; }
.tab .tab-name.added    { color: var(...) !important; }
/* ... 6 más */
```

Existen porque `.tab.active` (sin `!important`) sobreescribe el color. La solución correcta es aumentar especificidad, no usar `!important`.

### Solución

```css
/* En lugar de !important: */
.tab.active .tab-name.modified { color: var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d); }
.tab.active .tab-name.added    { color: var(--vscode-gitDecoration-addedResourceForeground, #73c991); }
/* ... etc */
```

### Problema B — Reglas de drag duplicadas

Hay dos reglas relacionadas con drag que podrían consolidarse:

```css
/* Actual — separadas */
body.drag-active .tab[data-pinned="true"]:hover,
body.drag-active .tab[data-pinned="true"]:active { background: transparent; }

body.drag-active .tab[data-pinned="true"] { cursor: default !important; }
```

```css
/* Consolidado */
body.drag-active .tab[data-pinned="true"] {
  cursor     : default !important;
  background : transparent;
  pointer-events: none; /* evita :hover y :active de una vez */
}
```

Con `pointer-events: none` en las tabs pineadas durante el drag, se eliminan todos los efectos hover/active de una sola vez, sin necesidad de reglas adicionales para `.tab-actions` y `.tab-state`.

---

## 7. Archivos muertos

### Problema

Existen tres archivos que son completamente obsoletos y están en el árbol de compilación:

| Archivo | Estado |
|---------|--------|
| `src/providers/TabsLoverProvider.ts` | Solo contiene `export {}` — 2 líneas |
| `src/models/TabTreeItem.ts` | TreeItem legacy, no se usa |
| `src/constants/icons.ts` | Sin información sobre contenido |

### Impacto
- **Bajo.** Confusión para nuevos colaboradores, aumentan el tiempo de compilación mínimamente.

### Solución

```bash
# Eliminar archivos obsoletos
rm src/providers/TabsLoverProvider.ts
rm src/models/TabTreeItem.ts
```

Verificar que no hay imports antes de eliminar:
```bash
grep -r "TabsLoverProvider\|TabTreeItem" src/ --include="*.ts"
```

---

## 8. FileActionRegistry — Acoplamiento

### Problema

`FileActionRegistry` es un registro de acciones de archivo con ~230 líneas de acciones predefinidas en el mismo archivo que la clase. El registro de acciones hardcodeadas mezcla datos con lógica:

```typescript
// FileActionRegistry.ts — mezcla datos y lógica
const ACTIONS: FileAction[] = [
  { id: 'preview-md', match: byExtension('md'), ... },
  { id: 'run-py', match: byExtension('py'), ... },
  // ... 20+ acciones
];

export class FileActionRegistry { ... }
```

### Solución

Separar los datos de configuración en un archivo independiente:

```typescript
// src/constants/fileActions.ts
export const DEFAULT_FILE_ACTIONS: FileAction[] = [ ... ];

// src/services/FileActionRegistry.ts
import { DEFAULT_FILE_ACTIONS } from '../constants/fileActions';
```

Esto permite que los usuarios potencialmente sobreescriban acciones sin tocar la lógica del registro.

---

## 9. getGitStatus — Llamada repetida

### Problema

En `handleTabChanges()`, para cada tab cambiada se llama a `getGitStatus()` y `getDiagnosticSeverity()`, incluso si solo cambió `isActive`:

```typescript
// TabSyncService.ts
existing.state.gitStatus = this.getGitStatus(existing.metadata.uri);           // ← siempre
existing.state.diagnosticSeverity = this.getDiagnosticSeverity(existing.metadata.uri); // ← siempre

if (onlyActive) { this.stateService.updateTabSilent(existing); }
```

La variable `onlyActive` se calcula **antes** de llamar a `getGitStatus`, pero el status se actualiza igualmente aunque el tab solo haya cambiado su estado activo.

### Solución

```typescript
if (!onlyActive && existing.metadata.uri) {
  existing.state.gitStatus = this.getGitStatus(existing.metadata.uri);
  existing.state.diagnosticSeverity = this.getDiagnosticSeverity(existing.metadata.uri);
}
existing.state.isActive  = tab.isActive;
existing.state.isDirty   = tab.isDirty;
existing.state.isPinned  = tab.isPinned;
existing.state.isPreview = tab.isPreview;

if (onlyActive) { this.stateService.updateTabSilent(existing); }
else            { this.stateService.updateTab(existing);       }
```

---

## Tabla de Prioridades

| # | Área | Impacto | Esfuerzo | Prioridad |
|---|------|---------|----------|-----------|
| 1 | Webview partial updates (postMessage) | 🔴 Alto | 🟡 Medio | **P1** |
| 2 | IconManager cache key consistency | 🔴 Alto | 🟢 Bajo | **P1** |
| 3 | Git API singleton en SyncService | 🟡 Medio | 🟢 Bajo | **P1** |
| 4 | Skip git/diag en cambios solo-activos | 🟡 Medio | 🟢 Bajo | **P1** |
| 5 | CSS: pointer-events en pinned durante drag | 🟡 Medio | 🟢 Bajo | **P2** |
| 6 | CSS: eliminar !important con especificidad | 🟢 Bajo | 🟢 Bajo | **P2** |
| 7 | D&D script a archivo separado | 🟡 Medio | 🟡 Medio | **P2** |
| 8 | Eliminar archivos muertos | 🟢 Bajo | 🟢 Bajo | **P2** |
| 9 | TabStateService — única fuente de verdad | 🔴 Alto | 🔴 Alto | **P3** |
| 10 | FileActionRegistry — separar datos | 🟢 Bajo | 🟢 Bajo | **P3** |
| 11 | removeOrphanedTabs — generateIdOnly() | 🟡 Medio | 🟡 Medio | **P3** |

---

## Notas finales

- Las optimizaciones P1 ofrecen el mejor ratio impacto/esfuerzo y pueden implementarse de forma independiente sin riesgo de regresión.
- La Solución B del punto 1 (partial updates) es el cambio de mayor impacto en UX y debería ir acompañada de tests para los tipos de mensajes del webview.
- El punto 4 (doble almacenamiento en TabStateService) es un refactor arquitectural que debe hacerse con cobertura de tests, no de forma aislada.
