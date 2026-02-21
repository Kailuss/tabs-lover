# 5. Guía para agentes y Copilot

**Enlaces rápidos**
[📄 Índice general](INDEX.md) | [🏁 Introducción](01_introduccion.md) | [🏗️ Arquitectura](02_arquitectura.md) | [🎯 Acciones](03_acciones.md) | [📦 Implementación](04_implementacion.md)

---

Este documento está diseñado para que un agente (como un modelo Copilot) entienda el proyecto y pueda generar o modificar código con conocimiento del dominio.

## Puntos clave para el agente
1. **Estructura del repositorio**: Estar familiarizado con `src/models`, `src/services`, `src/providers`, `src/commands`, `src/constants`, `src/utils`. Cada carpeta tiene responsabilidad clara.
2. **Flujo de datos**: `TabSyncService` → `TabStateService` → `TabsLoverWebviewProvider` → Webview HTML. Muchas acciones se encuentran en `src/models/actions`.
3. **Tipado estrictamente en TypeScript**: todos los datos importantes tienen interfaces exportadas (`SideTabMetadata`, `SideTabState`, etc.). Cualquier añadido debe importar y usar estos tipos.
4. **Comunicaciones con VS Code**: comandos (`tabsLover.*`) definidos en `package.json`; evocar `vscode.commands.executeCommand` con el `tab.id` como argumento.
5. **Ejemplos como guía**: el subdirectorio `src/examples` contiene patrones de uso (operaciones, permisos, contexto). Revisarlos antes de implementar nuevas funcionalidades.
6. **Documentación auto‑referenciada**: cada MD comienza con enlaces a los demás para facilitar la navegación interna.
7. **Nombres claros**: los identificadores de acciones, permisos, etc., son literales en español/inglés, evita abreviaciones.
8. **No generar URIs falsas**: para pestañas sin archivo (webview), siempre usar `uri: undefined`.
9. **Iconos**: resueltos en `TabIconManager`; no usar `ThemeIcon` ni `resourceUri` en Webview.
10. **Eventos silenciosos vs. completos**: `updateTab` vs. `updateTabSilent` en el servicio de estado.

## Ejemplo de petición al agente
> "Añade una nueva integración con el servicio 'foo' que marque la pestaña como `fooSynced: boolean` y muestre un icono especial en el webview cuando está sincronizada. Actualiza los servicios, el modelo y añade un ejemplo de uso en `src/examples`."  
El agente debe identificar los lugares mencionados y editar o crear archivos apropiados.

### Respuesta de ejemplo del agente
```ts
// src/models/SideTab.ts
export type TabIntegrations = {
  copilot?: {...};
  git?: {...};
  foo?: { synced: boolean; lastSync?: number };
};

// src/services/integration/FooService.ts
export class FooService {
  static async sync(tab: SideTab) {
    // ... hacer sync
    tab.state.integrations.foo = { synced: true, lastSync: Date.now() };
  }
}
```

El agente también puede proponer añadir tests y actualizar el webview para mostrar un badge cuando `foo.synced` sea verdadero.

## Buenas prácticas para agentes
- Usa `grep_search` o `semantic_search` antes de proponer cambios para conocer cómo se hacen tareas similares.
- Crea pruebas unitarias en `test/` para cada nueva función o módulo; hay un archivo de ejemplo (`extension.test.ts`).
- Mantén los MD actualizados cuando introduces nuevas APIs.
- Respeta el estilo de código existente: `async/await`, preferencia por `fs/promises`, logs mínimos.

Al seguir estas indicaciones, un agente podrá trabajar con eficacia en Tabs Lover.
