/**
 * @deprecated Este archivo está obsoleto y pendiente de eliminación.
 * 
 * La funcionalidad de Markdown Preview ahora se maneja como estado toggle
 * (viewMode) en la tab del archivo fuente. Ver:
 * - SideTabState.viewMode
 * - MARKDOWN_TOGGLE_ACTION en fileActions/web.ts
 * - SideTabActions.activate() para activación con viewMode
 * 
 * Las tabs de Markdown Preview se filtran directamente en TabSyncService.convertToSideTab()
 * 
 * TODO: Eliminar este archivo manualmente.
 */
export {};
