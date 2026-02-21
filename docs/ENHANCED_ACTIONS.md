# Enhanced SideTabActions - New Features

## Overview

Las acciones de pestañas ahora incluyen soporte avanzado para:
- **ActionContext**: Contexto dinámico de visualización y edición
- **OperationState**: Seguimiento de operaciones asíncronas en progreso
- **Permissions**: Control granular de permisos de operaciones
- **Integrations**: Estado de integración con Copilot y Git
- **CustomActions**: Acciones personalizadas por usuario/extensión
- **Shortcuts**: Atajos de teclado personalizados

## 1. Action Context

El `actionContext` proporciona información dinámica sobre cómo está visualizándose y editándose la tab.

### Propiedades

```typescript
type ActionContext = {
  viewMode?: 'source' | 'preview' | 'split';
  editMode?: 'readonly' | 'editable';
  splitOrientation?: 'horizontal' | 'vertical';
  compareMode?: boolean;
  debugMode?: boolean;
}
```

### Ejemplos de Uso

```typescript
// Actualizar el modo de vista al cambiar a preview
tab.updateActionContext({ viewMode: 'preview' });

// Marcar como readonly mientras se procesa
tab.updateActionContext({ editMode: 'readonly' });

// Activar modo comparación
tab.updateActionContext({ compareMode: true });

// Verificar el contexto actual
if (tab.state.actionContext.viewMode === 'preview') {
  // Mostrar controles específicos de preview
}
```

## 2. Operation State

El `operationState` permite rastrear operaciones asíncronas en progreso y mostrar feedback al usuario.

### Propiedades

```typescript
type OperationState = {
  isProcessing: boolean;
  currentOperation?: string;
  canCancel: boolean;
  progress?: number;  // 0-100
}
```

### Ejemplos de Uso

```typescript
// Dentro de una acción personalizada
class CustomAction extends SideTabActions {
  async processLargeFile(): Promise<void> {
    this.startOperation('Processing file', true);
    
    try {
      for (let i = 0; i < 100; i++) {
        // Procesar chunk
        await processChunk(i);
        
        // Actualizar progreso
        this.updateOperationProgress(i);
      }
      
      vscode.window.showInformationMessage('Processing complete!');
    } finally {
      this.finishOperation();
    }
  }
}

// En la UI, verificar si hay operación en progreso
if (tab.state.operationState.isProcessing) {
  const op = tab.state.operationState.currentOperation;
  const progress = tab.state.operationState.progress || 0;
  console.log(`${op}: ${progress}%`);
}
```

## 3. Permissions

Los `permissions` proporcionan control granular sobre qué operaciones están permitidas.

### Propiedades

```typescript
type TabPermissions = {
  canRename: boolean;
  canDelete: boolean;
  canMove: boolean;
  canShare: boolean;
  canExport: boolean;
  restrictedActions?: string[];
}
```

### Ejemplos de Uso

```typescript
// Restringir ciertos archivos de configuración
if (tab.metadata.category === 'config') {
  tab.state.permissions = {
    ...tab.state.permissions,
    canDelete: false,
    canRename: false,
    restrictedActions: ['duplicate', 'export'],
  };
}

// Verificar permisos antes de ejecutar acción
if (!tab.state.permissions.canDelete) {
  vscode.window.showWarningMessage('Cannot delete this file');
  return;
}

// Comprobar si una acción está restringida
if (tab.isActionRestricted('export')) {
  console.log('Export action is restricted');
}
```

## 4. Integrations

Las `integrations` mantienen el estado de conexión con servicios externos.

### Propiedades

```typescript
type TabIntegrations = {
  copilot?: {
    inContext: boolean;
    lastAddedTime?: number;
  };
  git?: {
    hasUncommittedChanges: boolean;
    branch?: string;
    ahead?: number;
    behind?: number;
  };
}
```

### Ejemplos de Uso

```typescript
// Copilot Integration
tab.addToCopilotContext();
console.log(`Added to Copilot at: ${tab.state.integrations.copilot?.lastAddedTime}`);

tab.removeFromCopilotContext();

// Verificar si está en contexto
if (tab.state.integrations.copilot?.inContext) {
  // Mostrar badge en la UI
}

// Git Integration
tab.updateGitIntegration({
  hasUncommittedChanges: true,
  branch: 'feature/new-actions',
  ahead: 3,
  behind: 1,
});

// Mostrar información de Git en tooltip
const git = tab.state.integrations.git;
if (git?.branch) {
  console.log(`Branch: ${git.branch} (+${git.ahead} -${git.behind})`);
}
```

## 5. Custom Actions

Las `customActions` permiten que usuarios y extensiones añadan acciones personalizadas.

### Propiedades

```typescript
type CustomTabAction = {
  id: string;
  label: string;
  icon: string;
  tooltip: string;
  keybinding?: string;
  execute: (metadata: SideTabMetadata, state: SideTabState) => Promise<void>;
}
```

### Ejemplos de Uso

```typescript
// Registrar una acción personalizada
tab.addCustomAction({
  id: 'optimize-image',
  label: 'Optimize Image',
  icon: 'sparkle',
  tooltip: 'Compress and optimize this image',
  keybinding: 'Ctrl+Shift+O',
  execute: async (metadata, state) => {
    if (metadata.uri) {
      await optimizeImage(metadata.uri);
      vscode.window.showInformationMessage('Image optimized!');
    }
  },
});

// Ejecutar acción personalizada
await tab.executeCustomAction('optimize-image');

// Remover acción
tab.removeCustomAction('optimize-image');

// Listar todas las acciones personalizadas
const actions = tab.state.customActions || [];
for (const action of actions) {
  console.log(`${action.label} (${action.keybinding})`);
}
```

## 6. Shortcuts

Los `shortcuts` permiten definir atajos de teclado personalizados para acciones comunes.

### Propiedades

```typescript
type TabShortcuts = {
  quickPin?: string;
  quickClose?: string;
  quickDuplicate?: string;
  quickReveal?: string;
}
```

### Ejemplos de Uso

```typescript
// Configurar shortcuts personalizados
tab.state.shortcuts = {
  quickPin: 'Ctrl+Alt+P',
  quickClose: 'Ctrl+Alt+W',
  quickDuplicate: 'Ctrl+Alt+D',
  quickReveal: 'Ctrl+Alt+R',
};

// En el handler de keybindings
if (event.key === tab.state.shortcuts?.quickPin) {
  await tab.pin();
}
```

## Integration Examples

### Ejemplo Completo: Acción de Procesamiento con Feedback

```typescript
async function processWithFeedback(tab: SideTab) {
  // 1. Verificar permisos
  if (tab.isActionRestricted('process')) {
    vscode.window.showWarningMessage('Processing is restricted for this file');
    return;
  }

  // 2. Verificar capabilities
  if (!tab.state.capabilities.canEdit) {
    vscode.window.showWarningMessage('This file cannot be edited');
    return;
  }

  // 3. Iniciar operación
  tab.startOperation('Processing file', true);

  // 4. Cambiar a readonly durante procesamiento
  tab.updateActionContext({ editMode: 'readonly' });

  try {
    // 5. Procesar con progreso
    for (let i = 0; i < 100; i++) {
      await processChunk(i);
      tab.updateOperationProgress(i);
    }

    // 6. Actualizar integración Git
    tab.updateGitIntegration({
      hasUncommittedChanges: true,
    });

    vscode.window.showInformationMessage('Processing complete!');
  } catch (err) {
    vscode.window.showErrorMessage(`Processing failed: ${err}`);
  } finally {
    // 7. Limpiar
    tab.finishOperation();
    tab.updateActionContext({ editMode: 'editable' });
  }
}
```

### Ejemplo: Extensión con Acciones Personalizadas

```typescript
// En el activate() de una extensión
function registerImageOptimizer(context: vscode.ExtensionContext) {
  // Registrar comando
  context.subscriptions.push(
    vscode.commands.registerCommand('extension.optimizeImage', async (tab: SideTab) => {
      if (tab.metadata.fileExtension.match(/\.(png|jpg|jpeg)$/i)) {
        await tab.executeCustomAction('optimize-image');
      }
    })
  );

  // Añadir acción a todas las tabs de imagen
  tabStateService.onTabCreated((tab) => {
    if (tab.metadata.fileExtension.match(/\.(png|jpg|jpeg)$/i)) {
      tab.addCustomAction({
        id: 'optimize-image',
        label: 'Optimize',
        icon: 'zap',
        tooltip: 'Optimize image size',
        execute: async (metadata) => {
          if (metadata.uri) {
            await optimizeImageFile(metadata.uri);
          }
        },
      });
    }
  });
}
```

## Migration Guide

### Actualizar código existente

```typescript
// ANTES
if (tab.state.previewMode) {
  // ...
}

// DESPUÉS
if (tab.state.actionContext.viewMode === 'preview') {
  // ...
}

// ANTES - Sin feedback de operaciones
await longRunningOperation();

// DESPUÉS - Con feedback
tab.startOperation('Long operation', true);
try {
  await longRunningOperation();
} finally {
  tab.finishOperation();
}
```

## Best Practices

1. **Siempre verificar permisos antes de operaciones destructivas**
   ```typescript
   if (!tab.state.permissions.canDelete) {
     return;
   }
   ```

2. **Usar operationState para operaciones largas (>1s)**
   ```typescript
   tab.startOperation('Saving', false);
   try {
     await save();
   } finally {
     tab.finishOperation();
   }
   ```

3. **Sincronizar actionContext con el estado real**
   ```typescript
   tab.updateActionContext({
     viewMode: currentViewMode,
     editMode: isReadOnly ? 'readonly' : 'editable',
   });
   ```

4. **Mantener integrations actualizadas**
   ```typescript
   tab.updateGitIntegration({
     branch: currentBranch,
     hasUncommittedChanges: isDirty,
   });
   ```

5. **CustomActions deben ser idempotentes**
   ```typescript
   // Registrar solo una vez
   if (!tab.state.customActions?.find(a => a.id === 'my-action')) {
     tab.addCustomAction(myAction);
   }
   ```
