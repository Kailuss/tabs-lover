// Core services - Estado y sincronización fundamentales
export { TabStateService } from './core/TabStateService';
export { TabSyncService } from './core/TabSyncService';

// UI services - Presentación e interacción visual
export { ThemeService } from './ui/ThemeService';
export { TabIconManager } from './ui/TabIconManager';
export { TabDragDropService } from './ui/TabDragDropService';

// Integration services - Conexiones con APIs externas
export { GitSyncService } from './integration/GitSyncService';
export { CopilotService } from './integration/CopilotService';

// Registry services - Extensibilidad
export { FileActionRegistry } from './registry/FileActionRegistry';
export type { FileAction, ResolvedFileAction } from './registry/FileActionRegistry';
