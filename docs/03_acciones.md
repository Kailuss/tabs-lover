# 3. Acciones y extensiones

**Enlaces rápidos**
[📄 Índice general](INDEX.md) | [🏁 Introducción](01_introduccion.md) | [🏗️ Arquitectura](02_arquitectura.md) | [📦 Implementación](04_implementacion.md) | [🤖 Agentes Copilot](05_agentes.md)

---

## Sistema de FileActions
Las acciones sobre archivos se definen en `src/constants/fileActions`. Hay dos tipos:

- `FileAction`: estáticos, coinciden por nombre, extensión, o patrón.
- `DynamicFileAction`: se resuelven en tiempo de ejecución según `context`.

Los módulos se agrupan por categoría (`media`, `web`, `development`, `configuration`, `data`, `docker`) y se exportan desde `index.ts` en orden de precedencia.

### `setFocus` en acciones de archivo
Por defecto las acciones **no enfocan** la pestaña. La propiedad `setFocus` indica que, al ejecutarse, la pestaña debe activarse. Esto evita cambios de foco innecesarios (por ejemplo, copiar al portapapeles no recoge la pestaña).

| Propiedad | Comportamiento |
|-----------|----------------|
| `true` | Hace foco después de ejecutar |
| `false`/`undefined` | Mantiene foco actual (default) |


## Acciones mejoradas (Enhanced Actions)
Además del sistema de FileActions, el modelo `SideTab` incorpora funcionalidades avanzadas:

### 1. ActionContext
Contexto dinámico que describe modo de vista (`source`, `preview`, `split`), edición (`readonly`/`editable`), orientación de split, `compareMode`, `debugMode`. Se actualiza con `tab.updateActionContext()`.

### 2. OperationState
Introduce seguimiento de operaciones asíncronas (spinner, progreso, cancelación) con métodos:
```ts
startOperation(msg:string, canCancel:boolean)
updateOperationProgress(p:number)
finishOperation()
```

### 3. Permissions
`TabPermissions` controla si la pestaña puede renombrarse, borrarse, moverse, etc. Además admite un array `restrictedActions` para bloquear identificadores concretos.

### 4. Integrations
Estado de integraciones externas:
- **Copilot**: `inContext`, `lastAddedTime`.
- **Git**: cambios pendientes, rama, `ahead/behind`.

Servicios como `CopilotService` y `GitSyncService` actualizan automáticamente estos campos.

### 5. CustomActions
Los usuarios/extensiones pueden añadir acciones personalizadas con un esquema:
```ts
type CustomTabAction = { id:string; label:string; icon:string; tooltip:string; execute: (m,s)=>Promise<void> };
```
Se almacenan en `tab.state.customActions` y se ejecutan con `tab.executeCustomAction(id)`.

### 6. Shortcuts
Atajos personalizables (`quickPin`, `quickClose`, etc.) en `tab.state.shortcuts`.

## Ejemplos prácticos
Los ejemplos de uso se encuentran en `src/examples/` (p.ej. `image-optimizer.example.ts`) y muestran cómo emplear `OperationState`, permisos y `ActionContext`.

### Ejemplo avanzado: operación con feedback y permisos
```typescript
async function processWithFeedback(tab: SideTab) {
  if (tab.isActionRestricted('process')) {
    vscode.window.showWarningMessage('Processing is restricted for this file');
    return;
  }

  if (!tab.state.capabilities.canEdit) {
    vscode.window.showWarningMessage('This file cannot be edited');
    return;
  }

  tab.startOperation('Processing file', true);
  tab.updateActionContext({ editMode: 'readonly' });

  try {
    for (let i = 0; i < 100; i++) {
      await processChunk(i);
      tab.updateOperationProgress(i);
    }
    tab.updateGitIntegration({ hasUncommittedChanges: true });
    vscode.window.showInformationMessage('Processing complete!');
  } catch (err) {
    vscode.window.showErrorMessage(`Processing failed: ${err}`);
  } finally {
    tab.finishOperation();
    tab.updateActionContext({ editMode: 'editable' });
  }
}
```

> Esta sección debe ser consultada cuando se añadan nuevas acciones o se extienda el registro. Los APIs están documentados con JSDoc y son fuertemente tipados.

### Migración de código antiguo
```typescript
// ANTES
if (tab.state.previewMode) {
  // ...
}

// DESPUÉS
if (tab.state.actionContext.viewMode === 'preview') {
  // ...
}

// ANTES - sin feedback de operaciones
await longRunningOperation();

// DESPUÉS - con feedback
tab.startOperation('Long operation', true);
try {
  await longRunningOperation();
} finally {
  tab.finishOperation();
}
```

### Buenas prácticas rápidas
1. Verificar permisos antes de operaciones destructivas.
2. Usar `operationState` para procesos largos (>1s).
3. Mantener `actionContext` sincronizado con la UI.
4. Actualizar las integraciones (Git/Copilot) tras cambios de estado.
5. Registrar `customActions` de forma idempotente.
