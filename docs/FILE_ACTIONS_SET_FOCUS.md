# setFocus - Control de Focus en FileActions

## Descripción

La propiedad `setFocus` permite controlar si al ejecutar una **FileAction** se debe hacer focus automáticamente en la tab o no.

## Por qué es útil

Hay acciones que:
- **Deben hacer focus** (default): Abrir preview, cambiar modo de visualización, split view
- **No deben hacer focus**: Copiar al portapapeles, abrir en app externa, ejecutar en terminal

Sin esta propiedad, todas las acciones hacían focus por defecto, interrumpiendo el flujo de trabajo del usuario.

## Uso

### En FileAction

```typescript
import type { FileAction } from './types';

const myAction: FileAction = {
  id: 'copyToClipboard',
  icon: 'clippy',
  tooltip: 'Copy to Clipboard',
  // setFocus: false (por defecto, no hace focus)
  match: (fileName) => fileName.endsWith('.json'),
  execute: async (uri) => {
    const content = await vscode.workspace.fs.readFile(uri);
    await vscode.env.clipboard.writeText(content.toString());
    vscode.window.showInformationMessage('Copied to clipboard!');
  },
};
```

### En DynamicFileAction

```typescript
import type { DynamicFileAction } from './types';

const togglePreview: DynamicFileAction = {
  id: 'togglePreview',
  setFocus: true, // ← Sí hacer focus al cambiar vista
  match: (fileName) => fileName.endsWith('.md'),
  resolve: (context) => ({
    icon: context?.viewMode === 'preview' ? 'open-preview' : 'markdown',
    tooltip: context?.viewMode === 'preview' ? 'Show Source' : 'Show Preview',
    actionId: context?.viewMode === 'preview' ? 'showSource' : 'showPreview',
  }),
  execute: async (uri, context) => {
    // Toggle preview...
  },
};
```

## Comportamiento

| `setFocus` | Comportamiento |
|------------|----------------|
| `undefined` o `false` | No hace focus, mantiene el foco actual (default) |
| `true` | Hace focus en la tab después de ejecutar |

## Ejemplos de Uso

### ✅ Acciones que SÍ deben hacer focus (`setFocus: true`)

```typescript
// Abrir preview de Markdown
{
  id: 'openMarkdownPreview',
  icon: 'open-preview',
  tooltip: 'Open Preview',
  setFocus: true, // ← Hacer focus al abrir preview
  execute: async (uri) => {
    await vscode.commands.executeCommand('markdown.showPreview', uri);
  },
}

// Abrir en editor split
{
  id: 'splitRight',
  icon: 'split-horizontal',
  tooltip: 'Open to the Side',
  setFocus: true, // ← Hacer focus en el nuevo editor
  execute: async (uri) => {
    await vscode.commands.executeCommand('vscode.open', uri, {
      viewColumn: vscode.ViewColumn.Beside,
    });
  },
}

// Abrir en modo específico
{
  id: 'openAsJson',
  icon: 'json',
  tooltip: 'Open as JSON',
  setFocus: true, // ← Hacer focus al cambiar modo
  execute: async (uri) => {
    await vscode.commands.executeCommand('vscode.openWith', uri, 'json.editor');
  },
}
```

### ⛔ Acciones que NO deben hacer focus (`setFocus: false` o sin especificar)

```typescript
// Copiar contenido al portapapeles
{
  id: 'copyContent',
  icon: 'clippy',
  tooltip: 'Copy Content',
  // setFocus: false (por defecto, no hace focus)
  execute: async (uri) => {
    const content = await vscode.workspace.fs.readFile(uri);
    await vscode.env.clipboard.writeText(content.toString());
  },
}

// Abrir con aplicación externa
{
  id: 'openExternal',
  icon: 'link-external',
  tooltip: 'Open with Default App',
  // setFocus: false (por defecto, no hace focus)
  execute: async (uri) => {
    await vscode.env.openExternal(uri);
  },
}

// Ejecutar comando en terminal
{
  id: 'runScript',
  icon: 'terminal',
  tooltip: 'Run Script',
  // setFocus: false (por defecto, no hace focus)
  execute: async (uri) => {
    const terminal = vscode.window.createTerminal({ name: 'Script' });
    terminal.show();
    terminal.sendText(`node "${uri.fsPath}"`);
  },
}

// Mostrar información
{
  id: 'showInfo',
  icon: 'info',
  tooltip: 'Show File Info',
  // setFocus: false (por defecto, no hace focus)
  execute: async (uri) => {
    const stats = await vscode.workspace.fs.stat(uri);
    vscode.window.showInformationMessage(
      \`Size: \${stats.size} bytes\`
    );
  },
}

// Optimizar/formatear sin abrir
{
  id: 'optimizeImage',
  icon: 'sparkle',
  tooltip: 'Optimize Image',
  // setFocus: false (por defecto, no hace focus)
  execute: async (uri) => {
    // Optimizar imagen en background
    await optimizeImage(uri);
    vscode.window.showInformationMessage('Image optimized!');
  },
}
```

## Implementación Interna

### 1. FileActionRegistry

El método `shouldSetFocus()` determina si una acción debe hacer focus:

```typescript
shouldSetFocus(actionId: string): boolean {
  // Check dynamic actions
  const dynamicAction = this.dynamic.find(a => a.id === actionId);
  if (dynamicAction) {
    return dynamicAction.setFocus ?? false;
  }

  // Check static actions
  const action = this.custom.find(a => a.id === actionId) 
    ?? this.builtin.find(a => a.id === actionId);
  return action?.setFocus ?? false; // Default: false
}
```

### 2. WebviewProvider

El handler de mensajes respeta la propiedad:

```typescript
case 'fileAction': {
  const tab = this.stateService.getTab(msg.tabId);
  if (tab?.metadata.uri) {
    const context = { viewMode: tab.state.viewMode };
    const shouldFocus = this.fileActionRegistry.shouldSetFocus(msg.actionId);
    
    // Execute the action
    await this.fileActionRegistry.execute(msg.actionId, tab.metadata.uri, context);
    
    // Set focus if requested (default behavior)
    if (shouldFocus && !tab.state.isActive) {
      await tab.activate();
    }
  }
  break;
}
```

## Testing

Para testear una acción con `setFocus`:

```typescript
// Test: Action with setFocus: false
test('should not focus when setFocus is false', async () => {
  const action: FileAction = {
    id: 'test-no-focus',
    icon: 'test',
    tooltip: 'Test',
    setFocus: false,
    match: () => true,
    execute: async () => {},
  };

  registry.register(action);
  
  const shouldFocus = registry.shouldSetFocus('test-no-focus');
  assert.strictEqual(shouldFocus, false);
});

// Test: Action with setFocus: true (explicit)
test('should focus when setFocus is true', async () => {
  const action: FileAction = {
    id: 'test-focus',
    icon: 'test',
    tooltip: 'Test',
    setFocus: true,
    match: () => true,
    execute: async () => {},
  };

  registry.register(action);
  
  const shouldFocus = registry.shouldSetFocus('test-focus');
  assert.strictEqual(shouldFocus, true);
});

// Test: Action without setFocus (default to false)
test('should NOT focus by default when setFocus is undefined', async () => {
  const action: FileAction = {
    id: 'test-default',
    icon: 'test',
    tooltip: 'Test',
    // setFocus: undefined (not specified)
    match: () => true,
    execute: async () => {},
  };

  registry.register(action);
  
  const shouldFocus = registry.shouldSetFocus('test-default');
  assert.strictEqual(shouldFocus, false); // Default: false
});
```

## Guía de Decisión

**¿Cuándo usar `setFocus: false` (o no especificar, es el default)?**

- ✅ La acción NO modifica el contenido visible del editor
- ✅ La acción abre algo externo (terminal, app, browser)
- ✅ La acción solo copia/exporta datos
- ✅ La acción muestra información en un diálogo/notificación
- ✅ Es una operación "background" que no requiere atención inmediata

**¿Cuándo usar `setFocus: true`?**

- ✅ La acción cambia la visualización del editor
- ✅ La acción abre un preview/diff/split
- ✅ La acción cambia el modo de edición
- ✅ El usuario espera ver el resultado inmediatamente en el editor
- ✅ Es una acción de navegación (abrir, cambiar vista)

## Migración

Si ya tienes acciones definidas, el cambio es automático:

```typescript
// ANTES (con default: true, siempre hacía focus)
{
  id: 'openExternal',
  icon: 'link-external',
  tooltip: 'Open with Default App',
  execute: async (uri) => {
    await vscode.env.openExternal(uri);
  },
}
// Problema: Hacía focus innecesariamente

// DESPUÉS (con default: false, no hace focus)
{
  id: 'openExternal',
  icon: 'link-external',
  tooltip: 'Open with Default App',
  // setFocus: false (default automático)
  execute: async (uri) => {
    await vscode.env.openExternal(uri);
  },
}
// Mejora: Comportamiento correcto automáticamente
```

**Para acciones que SÍ necesitan focus, añade explícitamente:**

```typescript
// Acción que cambia visualización - necesita focus
{
  id: 'openPreview',
  icon: 'open-preview',
  tooltip: 'Open Preview',
  setFocus: true, // ← Añadir explícitamente
  execute: async (uri) => {
    await vscode.commands.executeCommand('markdown.showPreview', uri);
  },
}
```

**Breaking changes mínimos**: La mayoría de acciones NO necesitan focus, así que el nuevo default es más apropiado. Solo las acciones de navegación/visualización necesitan `setFocus: true` explícito.
