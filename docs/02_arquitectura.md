# 2. Arquitectura y diseño

**Enlaces rápidos**
[📄 Índice general](INDEX.md) | [🏁 Introducción](01_introduccion.md) | [🎯 Acciones](03_acciones.md) | [📦 Implementación](04_implementacion.md) | [🤖 Agentes Copilot](05_agentes.md)

---

## Visión general
Tabs Lover se apoya en dos servicios internos (`TabSyncService` y `TabStateService`) que convierten la API nativa de pestañas de VS Code en un modelo propio llamado `SideTab`. La vista lateral está implementada como un **WebviewViewProvider** para máxima flexibilidad en HTML/CSS.
### Estructura del proyecto
La organización de carpetas sigue un patrón claro:
```
src/
├── extension.ts                          # Punto de entrada
├── models/                               # Tipos y lógica de pestañas
├── providers/                            # Webview y contexto
├── services/                             # Servicios (core, ui, integraciones, registry)
├── commands/                             # Comandos disponibles
├── constants/                            # Acciones, iconos, estilos
├── webview/                              # Código del lado cliente
└── utils/                                # Utilidades generales
```

#### Arquitectura de servicios
Los servicios se organizan en cuatro carpetas según su responsabilidad:

- **core**: estado y sincronización (`TabStateService`, `TabSyncService`).
- **ui**: lógica de presentación (`ThemeService`, `TabIconManager`, `TabDragDropService`).
- **integration**: integraciones opcionales (`GitSyncService`, `CopilotService`).
- **registry**: puntos de extensión como `FileActionRegistry`.

Se exportan desde `src/services/index.ts` para importación cómoda.

La gráfica anterior resume la organización principal del proyecto.

### Solución de problemas comunes
A continuación se recogen algunos problemas frecuentes y cómo resolverlos:

| Problema | Causa | Solución |
|----------|-------|----------|
| La lista de pestañas no aparece | Build obsoleto | Reinicia la tarea watch y recarga la ventana (no Ctrl+R) |
| `[UriError]` en la consola | URI falsa para pestañas webview | Asegúrate de que `uri: undefined` en `SideTabMetadata` |
| Iconos faltantes | Tema de iconos no cargado | Revisa los logs de `TabIconManager.buildIconMap()` |
| La extensión tarda 20 s en activarse | I/O de sincronización en icon manager | Asegúrate de usar `fs/promises` (sin sincronía) |
| Mensajes en español antiguos | dist/extension.js desactualizado | Mata las tareas watch, `npm run compile` y relanza |
| La extensión no se activa | Evento de activación incorrecto | Comprueba ````
VS Code Tab API → TabSyncService → TabStateService → WebviewViewProvider
```

### Modelos principales
```typescript
// src/models/SideTab.ts
type SideTabMetadata = { id: string; label: string; uri?: vscode.Uri; tabType: 'file'|'webview'|'custom'|'notebook'; /* ... */ };

type SideTabState = { isActive: boolean; isDirty: boolean; pinned: boolean; capabilities: Capabilities; actionContext: ActionContext; operationState: OperationState; permissions: TabPermissions; integrations: TabIntegrations; customActions?: CustomTabAction[]; shortcuts?: TabShortcuts; /* ... */ };
```

- **Metadatos**: inmutables (URI, tipo, etiqueta, icono).
- **Estado**: mutable, con muchos sub‑campos para soporte de nuevas funcionalidades.

### Ejemplo de creación de SideTab
```ts
import { SideTab } from '../models/SideTab';

const tab = new SideTab(
  { id: 'file:///ruta', label: 'index.ts', uri: vscode.Uri.file('index.ts'), tabType: 'file' },
  { isActive: true, isDirty: false, pinned: false, capabilities: { canClose: true },
    actionContext: {}, operationState: { isProcessing: false, canCancel: false },
    permissions: { canRename: true, canDelete: true }, integrations: {} }
);
```

`SideTab` es una clase que extiende `SideTabActions` y encapsula ambos objetos.

### Servicios clave
- **TabSyncService**: escucha `onDidChangeTabs`, `onDidChangeTabGroups` y sincroniza el estado nativo con SideTab. Soporta los 4 tipos de entrada: `Text`, `Webview`, `Custom`, `Notebook`.
- **TabStateService**: almacena un `Map<string, SideTab>` y dispara eventos `onDidChangeState` / `onDidChangeStateSilent`.
- **TabIconManager**: resuelve iconos de archivo a URI base64 tomando el tema activo.
- **CopilotService** y **GitSyncService**: integraciones opcionales que actualizan campos dentro de `SideTab.state.integrations`.

### Diseño del Webview
El HTML generado por `TabsLoverHtmlBuilder` crea filas de tabs con icono, nombre, estado y acciones, y se actualiza (debounced) en cada cambio de estado. La comunicación usa `postMessage`/`onDidReceiveMessage`.

### Decisiones importantes
- **WebviewView** en lugar de `TreeView` para controlar altura, bordes y hover buttons.
- **URI opcional**: pestañas webview no tienen URI; se usa `undefined` para evitar errores de revivir URIs.
- **Acciones modulares**: sistema de FileAction independiente y registrable.
- **Doble canal de eventos**: permite actualizaciones silenciosas sin recomponer toda la vista.

---

> Esto resume la arquitectura. Para profundizar en los tipos y helpers, consulta los archivos bajo `src/models` y `src/services`.
