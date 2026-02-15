# Tabs Lover - Guía de Implementación Completa

Esta guía te llevará paso a paso desde la creación del proyecto hasta tener una extensión funcional de Tabs Lover para VS Code.

---

## 📋 Tabla de Contenidos

1. [Preparación del Proyecto](#1-preparación-del-proyecto)
2. [Estructura del Proyecto](#2-estructura-del-proyecto)
3. [Configuración Inicial](#3-configuración-inicial)
4. [Implementación por Fases](#4-implementación-por-fases)
5. [Testing y Debugging](#5-testing-y-debugging)
6. [Packaging y Distribución](#6-packaging-y-distribución)

---

## 1. Preparación del Proyecto

### 1.1 Requisitos Previos

```bash
# Node.js >= 18.x
node --version

# npm >= 9.x
npm --version

# VS Code >= 1.85.0
code --version
````

### 1.2 Crear el Proyecto

```bash
# Instalar generador de extensiones (si no lo tienes)
npm install -g yo generator-code

# Generar proyecto
npx --package yo --package generator-code -- yo code

# Opciones a seleccionar:
# ? What type of extension do you want to create? New Extension (TypeScript)
# ? What's the name of your extension? Tabs Lover
# ? What's the identifier of your extension? tabs-lover
# ? What's the description of your extension? Vertical tabs panel with advanced features
# ? Initialize a git repository? Yes
# ? Which package manager to use? npm

# Entrar al directorio
cd tabs-lover

# Instalar dependencias
npm install
```

### 1.3 Dependencias Adicionales

```bash
# Para manejo de UUID (opcional, pero recomendado)
npm install uuid
npm install --save-dev @types/uuid

# Para testing
npm install --save-dev @vscode/test-electron mocha @types/mocha chai @types/chai
```

---

## 2. Estructura del Proyecto

Crear la siguiente estructura de carpetas y archivos:

```
tabs-lover/
├── src/
│   ├── extension.ts                    # ✅ Entry point
│   ├── constants/
│   │   ├── icons.ts                    # ✅ Product icons y ThemeIcons
│   │   └── styles.ts                   # ✅ Constantes de estilo
│   ├── models/
│   │   ├── SideTab.ts                  # ✅ Clase principal SideTab
│   │   ├── SideTabGroup.ts             # ✅ Modelo de grupo
│   │   └── TabTreeItem.ts              # ✅ TreeItem para TreeView
│   ├── services/
│   │   ├── TabStateService.ts          # ✅ Estado centralizado
│   │   ├── TabSyncService.ts           # ✅ Sincronización con VS Code
│   │   ├── TabIconManager.ts           # ✅ Gestión de iconos (YA PROPORCIONADO)
│   │   ├── ThemeService.ts             # ✅ Manejo de temas
│   │   ├── CopilotService.ts           # ✅ Integración con Copilot
│   │   └── DragDropController.ts       # ✅ Drag & drop (Fase 3)
│   ├── providers/
│   │   └── TabsLoverProvider.ts         # ✅ TreeDataProvider principal
│   ├── commands/
│   │   ├── tabCommands.ts              # ✅ Comandos de tabs (close, pin, etc.)
│   │   ├── copilotCommands.ts          # ✅ Comandos de Copilot
│   │   └── navigationCommands.ts       # ✅ Comandos de navegación
│   └── utils/
│       ├── logger.ts                   # ✅ Logging
│       └── helpers.ts                  # ✅ Funciones auxiliares
├── resources/
│   └── icons/                          # Iconos propios de la extensión (opcional)
├── test/
│   └── suite/
│       └── extension.test.ts
├── .vscode/
│   ├── launch.json                     # Debug configuration
│   └── tasks.json
├── package.json                        # ✅ Configuración de la extensión
├── tsconfig.json
└── README.md
```

---

## 3. Configuración Inicial

### 3.1 package.json - Configuración Completa

Reemplaza el contenido de `package.json`:

```json
{
  "name": "tabs-lover",
  "displayName": "Tabs Lover",
  "description": "Vertical tabs panel with advanced features",
  "version": "0.1.0",
  "engines": {
    "vscode": "^1.85.0"
  },
  "categories": [
    "Other"
  ],
  "activationEvents": [
    "onStartupFinished"
  ],
  "main": "./out/extension.js",
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        {
          "id": "tabsLover",
          "title": "Tabs Lover",
          "icon": "$(list-tree)"
        }
      ]
    },
    "views": {
      "tabsLover": [
        {
          "id": "tabsLover",
          "name": "Open Tabs",
          "icon": "$(list-tree)",
          "contextualTitle": "Tabs Lover"
        }
      ]
    },
    "commands": [
      {
        "command": "tabsLover.refresh",
        "title": "Refresh",
        "icon": "$(refresh)"
      },
      {
        "command": "tabsLover.openTab",
        "title": "Open Tab"
      },
      {
        "command": "tabsLover.closeTab",
        "title": "Close",
        "icon": "$(close)"
      },
      {
        "command": "tabsLover.closeOthers",
        "title": "Close Others"
      },
      {
        "command": "tabsLover.closeToRight",
        "title": "Close to the Right"
      },
      {
        "command": "tabsLover.closeAll",
        "title": "Close All"
      },
      {
        "command": "tabsLover.pinTab",
        "title": "Pin",
        "icon": "$(pin)"
      },
      {
        "command": "tabsLover.unpinTab",
        "title": "Unpin",
        "icon": "$(pinned)"
      },
      {
        "command": "tabsLover.addToCopilotChat",
        "title": "Add to Copilot Chat",
        "icon": "$(sparkle)"
      },
      {
        "command": "tabsLover.addMultipleToCopilotChat",
        "title": "Add Multiple to Copilot Chat..."
      },
      {
        "command": "tabsLover.copyRelativePath",
        "title": "Copy Relative Path"
      },
      {
        "command": "tabsLover.copyFileContents",
        "title": "Copy File Contents"
      },
      {
        "command": "tabsLover.compareWithActive",
        "title": "Compare with Active File"
      },
      {
        "command": "tabsLover.moveToGroup",
        "title": "Move to Group..."
      },
      {
        "command": "tabsLover.revealInExplorer",
        "title": "Reveal in Explorer"
      }
    ],
    "menus": {
      "view/title": [
        {
          "command": "tabsLover.refresh",
          "when": "view == tabsLover",
          "group": "navigation"
        },
        {
          "command": "tabsLover.addMultipleToCopilotChat",
          "when": "view == tabsLover && tabsLover.copilotAvailable",
          "group": "navigation"
        }
      ],
      "view/item/context": [
        {
          "command": "tabsLover.closeTab",
          "when": "view == tabsLover && viewItem =~ /tab/",
          "group": "inline@1"
        },
        {
          "command": "tabsLover.pinTab",
          "when": "view == tabsLover && viewItem =~ /tab/ && viewItem !~ /pinned/",
          "group": "inline@2"
        },
        {
          "command": "tabsLover.unpinTab",
          "when": "view == tabsLover && viewItem =~ /pinned/",
          "group": "inline@2"
        },
        {
          "command": "tabsLover.addToCopilotChat",
          "when": "view == tabsLover && viewItem =~ /canAddToChat/ && tabsLover.copilotAvailable",
          "group": "inline@3"
        },
        {
          "command": "tabsLover.closeTab",
          "when": "view == tabsLover && viewItem =~ /tab/",
          "group": "1_close@1"
        },
        {
          "command": "tabsLover.closeOthers",
          "when": "view == tabsLover && viewItem =~ /tab/",
          "group": "1_close@2"
        },
        {
          "command": "tabsLover.closeToRight",
          "when": "view == tabsLover && viewItem =~ /tab/",
          "group": "1_close@3"
        },
        {
          "command": "tabsLover.closeAll",
          "when": "view == tabsLover && viewItem =~ /tab/",
          "group": "1_close@4"
        },
        {
          "command": "tabsLover.pinTab",
          "when": "view == tabsLover && viewItem =~ /tab/ && viewItem !~ /pinned/",
          "group": "2_state@1"
        },
        {
          "command": "tabsLover.unpinTab",
          "when": "view == tabsLover && viewItem =~ /pinned/",
          "group": "2_state@2"
        },
        {
          "command": "tabsLover.addToCopilotChat",
          "when": "view == tabsLover && viewItem =~ /canAddToChat/ && tabsLover.copilotAvailable",
          "group": "3_copilot@1"
        },
        {
          "command": "tabsLover.addMultipleToCopilotChat",
          "when": "view == tabsLover && viewItem =~ /tab/ && tabsLover.copilotAvailable",
          "group": "3_copilot@2"
        },
        {
          "command": "tabsLover.compareWithActive",
          "when": "view == tabsLover && viewItem =~ /tab/",
          "group": "4_compare@1"
        },
        {
          "command": "tabsLover.moveToGroup",
          "when": "view == tabsLover && viewItem =~ /tab/ && tabsLover.hasMultipleGroups",
          "group": "5_move@1"
        },
        {
          "command": "tabsLover.revealInExplorer",
          "when": "view == tabsLover && viewItem =~ /tab/",
          "group": "6_reveal@1"
        },
        {
          "command": "tabsLover.copyRelativePath",
          "when": "view == tabsLover && viewItem =~ /tab/",
          "group": "7_copy@1"
        },
        {
          "command": "tabsLover.copyFileContents",
          "when": "view == tabsLover && viewItem =~ /tab/",
          "group": "7_copy@2"
        }
      ]
    },
    "configuration": {
      "title": "Tabs Lover",
      "properties": {
        "tabsLover.showFilePath": {
          "type": "boolean",
          "default": true,
          "description": "Show file path below tab name"
        },
        "tabsLover.tabHeight": {
          "type": "number",
          "default": 28,
          "minimum": 22,
          "maximum": 48,
          "description": "Height of each tab in pixels"
        },
        "tabsLover.iconSize": {
          "type": "number",
          "default": 16,
          "minimum": 12,
          "maximum": 24,
          "description": "Size of file icons in pixels"
        },
        "tabsLover.enableHoverActions": {
          "type": "boolean",
          "default": true,
          "description": "Show pin/close icons on hover"
        },
        "tabsLover.showStateIcons": {
          "type": "boolean",
          "default": true,
          "description": "Show dirty/edited indicators"
        },
        "tabsLover.enableDragDrop": {
          "type": "boolean",
          "default": false,
          "description": "Enable experimental drag & drop reordering (may cause tabs to lose state)"
        }
      }
    }
  },
  "scripts": {
    "vscode:prepublish": "npm run compile",
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./",
    "pretest": "npm run compile && npm run lint",
    "lint": "eslint src --ext ts",
    "test": "node ./out/test/runTest.js"
  },
  "devDependencies": {
    "@types/vscode": "^1.85.0",
    "@types/node": "18.x",
    "@typescript-eslint/eslint-plugin": "^6.13.0",
    "@typescript-eslint/parser": "^6.13.0",
    "eslint": "^8.54.0",
    "typescript": "^5.3.0"
  }
}
```

---

## 4. Implementación por Fases

### FASE 1: MVP Funcional (Días 1-3)

#### Día 1: Modelos y Constantes

**Archivo: `src/constants/icons.ts`**

```typescript
import * as vscode from 'vscode';

export const PRODUCT_ICONS = {
  // Estados de tab
  modified: new vscode.ThemeIcon('circle-filled'),
  pinned: new vscode.ThemeIcon('pinned'),
  close: new vscode.ThemeIcon('close'),
  
  // Acciones
  addToContext: new vscode.ThemeIcon('add'),
  copilotEdited: new vscode.ThemeIcon('sparkle'),
  refresh: new vscode.ThemeIcon('refresh'),
  
  // Git status
  gitModified: new vscode.ThemeIcon('git-commit'),
  gitUntracked: new vscode.ThemeIcon('diff-added'),
  gitStaged: new vscode.ThemeIcon('check'),
  
  // Grupos
  splitHorizontal: new vscode.ThemeIcon('split-horizontal'),
  splitVertical: new vscode.ThemeIcon('split-vertical'),
  group: new vscode.ThemeIcon('window')
} as const;
```

**Archivo: `src/constants/styles.ts`**

```typescript
import * as vscode from 'vscode';

export const STYLE_CONSTANTS = {
  // Dimensiones de tab
  TAB_HEIGHT: 28,
  TAB_ICON_SIZE: 16,
  TAB_PADDING_LEFT: 8,
  TAB_PADDING_RIGHT: 4,
  
  // Espaciado interno
  ICON_TEXT_GAP: 8,
  STATE_ICON_SIZE: 14,
  HOVER_ICON_SIZE: 16,
  
  // Descripción (ruta)
  DESCRIPTION_FONT_SIZE: 11,
  DESCRIPTION_LINE_HEIGHT: 14,
  DESCRIPTION_OPACITY: 0.7,
  
  // Hover
  HOVER_ICON_SPACING: 4,
  
  // Colores (variables de VS Code - para referencia)
  COLORS: {
    foreground: 'foreground',
    descriptionForeground: 'descriptionForeground',
    listActiveSelectionBackground: 'list.activeSelectionBackground',
    listHoverBackground: 'list.hoverBackground',
    listInactiveSelectionBackground: 'list.inactiveSelectionBackground',
    modified: 'gitDecoration.modifiedResourceForeground',
    untracked: 'gitDecoration.untrackedResourceForeground',
    ignored: 'gitDecoration.ignoredResourceForeground',
    iconForeground: 'icon.foreground',
    editorWarningForeground: 'editorWarning.foreground',
    buttonHoverBackground: 'button.hoverBackground'
  }
} as const;

export interface TabsLoverConfiguration {
  showFilePath: boolean;
  tabHeight: number;
  iconSize: number;
  enableHoverActions: boolean;
  showStateIcons: boolean;
  enableDragDrop: boolean;
}

export function getConfiguration(): TabsLoverConfiguration {
  const config = vscode.workspace.getConfiguration('tabsLover');
  
  return {
    showFilePath: config.get('showFilePath', true),
    tabHeight: config.get('tabHeight', STYLE_CONSTANTS.TAB_HEIGHT),
    iconSize: config.get('iconSize', STYLE_CONSTANTS.TAB_ICON_SIZE),
    enableHoverActions: config.get('enableHoverActions', true),
    showStateIcons: config.get('showStateIcons', true),
    enableDragDrop: config.get('enableDragDrop', false)
  };
}
```

**Archivo: `src/models/SideTab.ts`**

```typescript
import * as vscode from 'vscode';
import * as path from 'path';

export interface SideTabMetadata {
  id: string;
  uri: vscode.Uri;
  label: string;
  description?: string;
  tooltip?: string;
  fileType: string;
}

export interface SideTabState {
  isActive: boolean;
  isDirty: boolean;
  isPinned: boolean;
  isPreview: boolean;
  groupId: number;
  viewColumn: vscode.ViewColumn;
  indexInGroup: number;
  scmStatus?: 'modified' | 'untracked' | 'staged' | 'clean';
  copilotEdited?: boolean;
  lastAccessTime: number;
}

export interface SideTabCapabilities {
  canClose: boolean;
  canPin: boolean;
  canReveal: boolean;
  canAddToChat: boolean;
  canCompare: boolean;
  canMove: boolean;
}

const DEFAULT_CAPABILITIES: SideTabCapabilities = {
  canClose: true,
  canPin: true,
  canReveal: true,
  canAddToChat: true,
  canCompare: true,
  canMove: true
};

export class SideTab {
  constructor(
    public metadata: SideTabMetadata,
    public state: SideTabState,
    public capabilities: SideTabCapabilities = DEFAULT_CAPABILITIES
  ) {}

  // === ACCIONES BÁSICAS ===
  
  async close(): Promise<void> {
    const tab = this.findVSCodeTab();
    if (tab) {
      await vscode.window.tabGroups.close(tab);
    }
  }

  async closeOthers(): Promise<void> {
    await this.activate();
    await vscode.commands.executeCommand('workbench.action.closeOtherEditors');
  }

  async closeToRight(): Promise<void> {
    const group = this.getGroup();
    if (!group) return;
    
    const tabIndex = group.tabs.findIndex(t => {
      const input = t.input as vscode.TabInputText;
      return input.uri?.toString() === this.metadata.uri.toString();
    });
    
    if (tabIndex === -1) return;
    
    const tabsToClose = group.tabs.slice(tabIndex + 1);
    for (const tab of tabsToClose) {
      await vscode.window.tabGroups.close(tab);
    }
  }

  async pin(): Promise<void> {
    await this.activate();
    await vscode.commands.executeCommand('workbench.action.pinEditor');
    this.state.isPinned = true;
  }

  async unpin(): Promise<void> {
    await this.activate();
    await vscode.commands.executeCommand('workbench.action.unpinEditor');
    this.state.isPinned = false;
  }

  async revealInExplorer(): Promise<void> {
    await vscode.commands.executeCommand('revealInExplorer', this.metadata.uri);
  }

  // === ACCIONES AVANZADAS ===

  async copyRelativePath(): Promise<void> {
    const relative = vscode.workspace.asRelativePath(this.metadata.uri);
    await vscode.env.clipboard.writeText(relative);
    vscode.window.showInformationMessage(`Copied: ${relative}`);
  }

  async copyFileContents(): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(this.metadata.uri);
      await vscode.env.clipboard.writeText(doc.getText());
      vscode.window.showInformationMessage('File contents copied to clipboard');
    } catch (error) {
      vscode.window.showErrorMessage('Failed to copy file contents');
    }
  }

  async compareWithActive(): Promise<void> {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      vscode.window.showWarningMessage('No active editor to compare with');
      return;
    }
    
    await vscode.commands.executeCommand('vscode.diff',
      activeEditor.document.uri,
      this.metadata.uri,
      `${path.basename(activeEditor.document.fileName)} ↔ ${this.metadata.label}`
    );
  }

  async moveToGroup(targetColumn: vscode.ViewColumn): Promise<void> {
    await this.close();
    const doc = await vscode.workspace.openTextDocument(this.metadata.uri);
    await vscode.window.showTextDocument(doc, {
      viewColumn: targetColumn,
      preview: this.state.isPreview,
      preserveFocus: true
    });
  }

  // === HELPERS INTERNOS ===

  async activate(): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(this.metadata.uri);
    await vscode.window.showTextDocument(doc, {
      viewColumn: this.state.viewColumn,
      preserveFocus: false
    });
  }

  private findVSCodeTab(): vscode.Tab | undefined {
    const group = vscode.window.tabGroups.all.find(
      g => g.viewColumn === this.state.viewColumn
    );
    
    return group?.tabs.find(t => {
      const input = t.input as vscode.TabInputText;
      return input.uri?.toString() === this.metadata.uri.toString();
    });
  }

  private getGroup(): vscode.TabGroup | undefined {
    return vscode.window.tabGroups.all.find(
      g => g.viewColumn === this.state.viewColumn
    );
  }
}
```

**Archivo: `src/models/SideTabGroup.ts`**

```typescript
import { SideTab } from './SideTab';
import * as vscode from 'vscode';

export interface SideTabGroup {
  id: number;
  viewColumn: vscode.ViewColumn;
  isActive: boolean;
  tabs: SideTab[];
  label: string;
}

export function createTabGroup(group: vscode.TabGroup): SideTabGroup {
  return {
    id: group.viewColumn,
    viewColumn: group.viewColumn,
    isActive: group.isActive,
    tabs: [],
    label: `Group ${group.viewColumn}`
  };
}
```

**Archivo: `src/models/TabTreeItem.ts`**

```typescript
import * as vscode from 'vscode';
import { SideTab } from './SideTab';
import { SideTabGroup } from './SideTabGroup';
import { TabsLoverConfiguration } from '../constants/styles';
import { PRODUCT_ICONS } from '../constants/icons';

export class TabTreeItem extends vscode.TreeItem {
  constructor(
    public tab: SideTab,
    private config: TabsLoverConfiguration
  ) {
    super(tab.metadata.label, vscode.TreeItemCollapsibleState.None);
    
    // Icono principal (del tema activo)
    this.resourceUri = tab.metadata.uri;
    
    // Descripción (ruta)
    if (config.showFilePath && tab.metadata.description) {
      this.description = tab.metadata.description;
    }
    
    // Tooltip
    this.tooltip = this.buildTooltip();
    
    // Context value
    this.contextValue = this.buildContextValue();
    
    // Comando al hacer click
    this.command = {
      command: 'tabsLover.openTab',
      title: 'Open Tab',
      arguments: [tab]
    };
    
    // Iconos de estado (priority order)
    if (config.showStateIcons) {
      if (tab.state.isPinned) {
        // Si está pinned, sobrescribir el icono
        this.iconPath = PRODUCT_ICONS.pinned;
      } else if (tab.state.isDirty) {
        this.iconPath = PRODUCT_ICONS.modified;
      } else if (tab.state.copilotEdited) {
        this.iconPath = PRODUCT_ICONS.copilotEdited;
      }
    }
  }
  
  private buildTooltip(): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${this.tab.metadata.label}**\n\n`);
    md.appendMarkdown(`Path: \`${this.tab.metadata.tooltip}\`\n\n`);
    
    const states: string[] = [];
    if (this.tab.state.isDirty) states.push('Modified');
    if (this.tab.state.isPinned) states.push('Pinned');
    if (this.tab.state.isPreview) states.push('Preview');
    if (this.tab.state.copilotEdited) states.push('Edited by Copilot');
    
    if (states.length > 0) {
      md.appendMarkdown(`Status: ${states.join(', ')}\n\n`);
    }
    
    md.appendMarkdown('---\n\n');
    md.appendMarkdown('**Actions:**\n');
    md.appendMarkdown('- Right-click for more options\n');
    
    return md;
  }
  
  private buildContextValue(): string {
    const parts = ['tab'];
    
    if (this.tab.state.isPinned) {
      parts.push('pinned');
    }
    
    if (this.tab.state.isDirty) {
      parts.push('dirty');
    }
    
    if (this.tab.capabilities.canAddToChat) {
      parts.push('canAddToChat');
    }
    
    return parts.join('.');
  }
}

export class GroupTreeItem extends vscode.TreeItem {
  constructor(public group: SideTabGroup) {
    super(group.label, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'group';
    this.iconPath = PRODUCT_ICONS.group;
    
    if (group.isActive) {
      this.description = '● Active';
    }
  }
}
```

#### Día 2: Servicios Core

**Archivo: `src/services/TabStateService.ts`**

```typescript
import * as vscode from 'vscode';
import { SideTab, SideTabMetadata, SideTabState } from '../models/SideTab';
import { SideTabGroup, createTabGroup } from '../models/SideTabGroup';

export class TabStateService {
  private tabs: Map<string, SideTab> = new Map();
  private groups: Map<number, SideTabGroup> = new Map();
  
  private _onDidChangeState = new vscode.EventEmitter<void>();
  readonly onDidChangeState = this._onDidChangeState.event;

  // === GESTIÓN DE TABS ===

  addTab(tab: SideTab): void {
    this.tabs.set(tab.metadata.id, tab);
    
    // Añadir a su grupo
    const group = this.groups.get(tab.state.groupId);
    if (group) {
      if (!group.tabs.find(t => t.metadata.id === tab.metadata.id)) {
        group.tabs.push(tab);
      }
    }
    
    this._onDidChangeState.fire();
  }

  removeTab(id: string): void {
    const tab = this.tabs.get(id);
    if (tab) {
      // Remover del grupo
      const group = this.groups.get(tab.state.groupId);
      if (group) {
        group.tabs = group.tabs.filter(t => t.metadata.id !== id);
      }
      
      this.tabs.delete(id);
      this._onDidChangeState.fire();
    }
  }

  updateTab(tab: SideTab): void {
    this.tabs.set(tab.metadata.id, tab);
    
    // Actualizar en el grupo
    const group = this.groups.get(tab.state.groupId);
    if (group) {
      const index = group.tabs.findIndex(t => t.metadata.id === tab.metadata.id);
      if (index !== -1) {
        group.tabs[index] = tab;
      }
    }
    
    this._onDidChangeState.fire();
  }

  getTab(id: string): SideTab | undefined {
    return this.tabs.get(id);
  }

  getAllTabs(): SideTab[] {
    return Array.from(this.tabs.values());
  }

  getTabsInGroup(groupId: number): SideTab[] {
    const group = this.groups.get(groupId);
    return group ? [...group.tabs] : [];
  }

  replaceTabs(tabs: SideTab[]): void {
    this.tabs.clear();
    
    // Limpiar tabs de todos los grupos
    this.groups.forEach(group => {
      group.tabs = [];
    });
    
    tabs.forEach(tab => this.addTab(tab));
  }

  // === GESTIÓN DE GRUPOS ===

  addGroup(group: SideTabGroup): void {
    this.groups.set(group.id, group);
    this._onDidChangeState.fire();
  }

  removeGroup(id: number): void {
    this.groups.delete(id);
    this._onDidChangeState.fire();
  }

  getGroup(id: number): SideTabGroup | undefined {
    return this.groups.get(id);
  }

  getGroups(): SideTabGroup[] {
    return Array.from(this.groups.values());
  }

  setActiveGroup(id: number): void {
    this.groups.forEach(group => {
      group.isActive = group.id === id;
    });
    this._onDidChangeState.fire();
  }

  // === BÚSQUEDA ===

  findTabByUri(uri: vscode.Uri, groupId?: number): SideTab | undefined {
    const uriString = uri.toString();
    
    for (const tab of this.tabs.values()) {
      if (tab.metadata.uri.toString() === uriString) {
        if (groupId === undefined || tab.state.groupId === groupId) {
          return tab;
        }
      }
    }
    
    return undefined;
  }

  // === UTILIDADES ===

  clear(): void {
    this.tabs.clear();
    this.groups.clear();
    this._onDidChangeState.fire();
  }

  getStats(): { tabs: number; groups: number } {
    return {
      tabs: this.tabs.size,
      groups: this.groups.size
    };
  }
}
```

**Archivo: `src/services/TabSyncService.ts`**

```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import { TabStateService } from './TabStateService';
import { SideTab, SideTabMetadata, SideTabState } from '../models/SideTab';
import { createTabGroup } from '../models/SideTabGroup';

export class TabSyncService {
  private disposables: vscode.Disposable[] = [];
  
  constructor(
    private stateService: TabStateService
  ) {}

  activate(context: vscode.ExtensionContext): void {
    // Sincronización inicial
    this.syncAll();
    
    // Listeners de cambios
    this.disposables.push(
      vscode.window.tabGroups.onDidChangeTabs(e => {
        this.handleTabChanges(e);
      })
    );
    
    this.disposables.push(
      vscode.window.tabGroups.onDidChangeTabGroups(e => {
        this.handleGroupChanges(e);
      })
    );
    
    context.subscriptions.push(...this.disposables);
  }

  private handleTabChanges(e: vscode.TabChangeEvent): void {
    // Tabs abiertos
    e.opened.forEach(tab => {
      if (tab.input instanceof vscode.TabInputText) {
        const sideTab = this.convertToSideTab(tab);
        this.stateService.addTab(sideTab);
      }
    });
    
    // Tabs cerrados
    e.closed.forEach(tab => {
      if (tab.input instanceof vscode.TabInputText) {
        const input = tab.input as vscode.TabInputText;
        const id = this.generateId(input.uri, tab.group.viewColumn);
        this.stateService.removeTab(id);
      }
    });
    
    // Tabs cambiados
    e.changed.forEach(tab => {
      if (tab.input instanceof vscode.TabInputText) {
        const sideTab = this.convertToSideTab(tab);
        this.stateService.updateTab(sideTab);
      }
    });
  }

  private handleGroupChanges(e: vscode.TabGroupChangeEvent): void {
    // Grupos abiertos
    e.opened.forEach(group => {
      this.stateService.addGroup(createTabGroup(group));
    });
    
    // Grupos cerrados
    e.closed.forEach(group => {
      this.stateService.removeGroup(group.viewColumn);
    });
    
    // Grupo activo cambió
    if (e.changed.length > 0) {
      const activeGroup = vscode.window.tabGroups.activeTabGroup;
      this.stateService.setActiveGroup(activeGroup.viewColumn);
    }
  }

  private syncAll(): void {
    // Sincronizar grupos
    vscode.window.tabGroups.all.forEach(group => {
      this.stateService.addGroup(createTabGroup(group));
    });
    
    // Sincronizar tabs
    const allTabs: SideTab[] = [];
    
    vscode.window.tabGroups.all.forEach((group, groupIndex) => {
      group.tabs.forEach((tab, tabIndex) => {
        if (tab.input instanceof vscode.TabInputText) {
          allTabs.push(this.convertToSideTab(tab, tabIndex));
        }
      });
    });
    
    this.stateService.replaceTabs(allTabs);
  }

  private convertToSideTab(tab: vscode.Tab, index?: number): SideTab {
    const input = tab.input as vscode.TabInputText;
    const uri = input.uri;
    const fileName = path.basename(uri.fsPath);
    
    const metadata: SideTabMetadata = {
      id: this.generateId(uri, tab.group.viewColumn),
      uri,
      label: fileName,
      description: vscode.workspace.asRelativePath(uri),
      tooltip: uri.fsPath,
      fileType: path.extname(uri.fsPath)
    };
    
    const state: SideTabState = {
      isActive: tab.isActive,
      isDirty: tab.isDirty,
      isPinned: tab.isPinned,
      isPreview: tab.isPreview,
      groupId: tab.group.viewColumn,
      viewColumn: tab.group.viewColumn,
      indexInGroup: index ?? 0,
      lastAccessTime: Date.now()
    };
    
    return new SideTab(metadata, state);
  }

  private generateId(uri: vscode.Uri, viewColumn: vscode.ViewColumn): string {
    return `${uri.toString()}-${viewColumn}`;
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}
```

**Archivo: `src/services/TabIconManager.ts`**

_(Usar el archivo que ya te proporcionaron - ya está completo)_

**Archivo: `src/services/ThemeService.ts`**

```typescript
import * as vscode from 'vscode';

export class ThemeService {
  private _onDidChangeTheme = new vscode.EventEmitter<void>();
  readonly onDidChangeTheme = this._onDidChangeTheme.event;
  
  activate(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('workbench.iconTheme') ||
            e.affectsConfiguration('workbench.productIconTheme') ||
            e.affectsConfiguration('workbench.colorTheme')) {
          this._onDidChangeTheme.fire();
        }
      })
    );
  }
  
  getCurrentIconTheme(): string | undefined {
    return vscode.workspace.getConfiguration('workbench').get('iconTheme');
  }
  
  getCurrentColorTheme(): string | undefined {
    return vscode.workspace.getConfiguration('workbench').get('colorTheme');
  }
}
```

**Archivo: `src/services/CopilotService.ts`**

```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import { SideTab } from '../models/SideTab';

export class CopilotService {
  private copilotExtension?: vscode.Extension<any>;
  
  constructor() {
    this.copilotExtension = vscode.extensions.getExtension('github.copilot-chat');
  }
  
  isAvailable(): boolean {
    return this.copilotExtension !== undefined;
  }
  
  async addFileToChat(uri: vscode.Uri): Promise<boolean> {
    if (!this.isAvailable()) {
      vscode.window.showWarningMessage(
        'GitHub Copilot Chat is not installed. Install it to use this feature.'
      );
      return false;
    }
    
    try {
      // Intento 1: Comando directo (puede existir o no)
      await vscode.commands.executeCommand('github.copilot.chat.addContext', { uri });
      return true;
    } catch (error) {
      // Intento 2: Workaround con clipboard
      return await this.fallbackAddToChat(uri);
    }
  }
  
  private async fallbackAddToChat(uri: vscode.Uri): Promise<boolean> {
    const relativePath = vscode.workspace.asRelativePath(uri);
    
    // Copiar referencia
    await vscode.env.clipboard.writeText(`#file:${relativePath}`);
    
    // Abrir chat
    await vscode.commands.executeCommand('workbench.action.chat.open');
    
    // Notificar
    const action = await vscode.window.showInformationMessage(
      `Reference copied: #file:${relativePath}`,
      'Paste in Chat'
    );
    
    if (action === 'Paste in Chat') {
      await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
    }
    
    return true;
  }
  
  async addMultipleFiles(tabs: SideTab[]): Promise<void> {
    const selected = await vscode.window.showQuickPick(
      tabs.map(tab => ({
        label: tab.metadata.label,
        description: tab.metadata.description,
        detail: tab.metadata.tooltip,
        tab
      })),
      {
        canPickMany: true,
        placeHolder: 'Select files to add to Copilot Chat context'
      }
    );
    
    if (!selected || selected.length === 0) return;
    
    for (const item of selected) {
      await this.addFileToChat(item.tab.metadata.uri);
    }
    
    vscode.window.showInformationMessage(
      `Added ${selected.length} file(s) to Copilot Chat context`
    );
  }
}
```

#### Día 3: Provider y Comandos

**Archivo: `src/providers/TabsLoverProvider.ts`**

```typescript
import * as vscode from 'vscode';
import { TabStateService } from '../services/TabStateService';
import { CopilotService } from '../services/CopilotService';
import { TabTreeItem, GroupTreeItem } from '../models/TabTreeItem';
import { getConfiguration } from '../constants/styles';

export class TabsLoverProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  
  constructor(
    private stateService: TabStateService,
    private copilotService: CopilotService
  ) {
    // Escuchar cambios de estado
    stateService.onDidChangeState(() => {
      this.refresh();
    });
  }
  
  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
    this.updateContextKeys();
  }
  
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }
  
  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (!element) {
      // Root: Mostrar grupos
      const groups = this.stateService.getGroups();
      
      if (groups.length === 0) {
        return [];
      }
      
      // Si solo hay un grupo, mostrar tabs directamente
      if (groups.length === 1) {
        return this.getTabsForGroup(groups[0].id);
      }
      
      // Múltiples grupos: mostrar jerarquía
      return groups.map(group => new GroupTreeItem(group));
    }
    
    if (element instanceof GroupTreeItem) {
      // Hijos del grupo: tabs
      return this.getTabsForGroup(element.group.id);
    }
    
    return [];
  }
  
  private getTabsForGroup(groupId: number): TabTreeItem[] {
    const config = getConfiguration();
    const tabs = this.stateService.getTabsInGroup(groupId);
    
    return tabs.map(tab => new TabTreeItem(tab, config));
  }
  
  private updateContextKeys(): void {
    // Context key para Copilot
    vscode.commands.executeCommand(
      'setContext',
      'tabsLover.copilotAvailable',
      this.copilotService.isAvailable()
    );
    
    // Context key para múltiples grupos
    vscode.commands.executeCommand(
      'setContext',
      'tabsLover.hasMultipleGroups',
      vscode.window.tabGroups.all.length > 1
    );
  }
}
```

**Archivo: `src/commands/tabCommands.ts`**

```typescript
import * as vscode from 'vscode';
import { SideTab } from '../models/SideTab';
import { TabTreeItem } from '../models/TabTreeItem';
import { TabStateService } from '../services/TabStateService';

export function registerTabCommands(
  context: vscode.ExtensionContext,
  stateService: TabStateService
): void {
  
  // Open Tab
  context.subscriptions.push(
    vscode.commands.registerCommand('tabsLover.openTab', async (tab: SideTab) => {
      if (tab) {
        await tab.activate();
      }
    })
  );
  
  // Close Tab
  context.subscriptions.push(
    vscode.commands.registerCommand('tabsLover.closeTab', async (item: TabTreeItem) => {
      if (item && item.tab) {
        await item.tab.close();
      }
    })
  );
  
  // Close Others
  context.subscriptions.push(
    vscode.commands.registerCommand('tabsLover.closeOthers', async (item: TabTreeItem) => {
      if (item && item.tab) {
        await item.tab.closeOthers();
      }
    })
  );
  
  // Close to Right
  context.subscriptions.push(
    vscode.commands.registerCommand('tabsLover.closeToRight', async (item: TabTreeItem) => {
      if (item && item.tab) {
        await item.tab.closeToRight();
      }
    })
  );
  
  // Close All
  context.subscriptions.push(
    vscode.commands.registerCommand('tabsLover.closeAll', async () => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    })
  );
  
  // Pin Tab
  context.subscriptions.push(
    vscode.commands.registerCommand('tabsLover.pinTab', async (item: TabTreeItem) => {
      if (item && item.tab) {
        await item.tab.pin();
      }
    })
  );
  
  // Unpin Tab
  context.subscriptions.push(
    vscode.commands.registerCommand('tabsLover.unpinTab', async (item: TabTreeItem) => {
      if (item && item.tab) {
        await item.tab.unpin();
      }
    })
  );
  
  // Reveal in Explorer
  context.subscriptions.push(
    vscode.commands.registerCommand('tabsLover.revealInExplorer', async (item: TabTreeItem) => {
      if (item && item.tab) {
        await item.tab.revealInExplorer();
      }
    })
  );
  
  // Copy Relative Path
  context.subscriptions.push(
    vscode.commands.registerCommand('tabsLover.copyRelativePath', async (item: TabTreeItem) => {
      if (item && item.tab) {
        await item.tab.copyRelativePath();
      }
    })
  );
  
  // Copy File Contents
  context.subscriptions.push(
    vscode.commands.registerCommand('tabsLover.copyFileContents', async (item: TabTreeItem) => {
      if (item && item.tab) {
        await item.tab.copyFileContents();
      }
    })
  );
  
  // Compare with Active
  context.subscriptions.push(
    vscode.commands.registerCommand('tabsLover.compareWithActive', async (item: TabTreeItem) => {
      if (item && item.tab) {
        await item.tab.compareWithActive();
      }
    })
  );
  
  // Move to Group
  context.subscriptions.push(
    vscode.commands.registerCommand('tabsLover.moveToGroup', async (item: TabTreeItem) => {
      if (!item || !item.tab) return;
      
      const groups = vscode.window.tabGroups.all;
      if (groups.length <= 1) {
        vscode.window.showInformationMessage('Only one group available');
        return;
      }
      
      const options = groups
        .filter(g => g.viewColumn !== item.tab.state.viewColumn)
        .map(g => ({
          label: `Group ${g.viewColumn}`,
          viewColumn: g.viewColumn
        }));
      
      const selected = await vscode.window.showQuickPick(options, {
        placeHolder: 'Select target group'
      });
      
      if (selected) {
        await item.tab.moveToGroup(selected.viewColumn);
      }
    })
  );
}
```

**Archivo: `src/commands/copilotCommands.ts`**

```typescript
import * as vscode from 'vscode';
import { TabTreeItem } from '../models/TabTreeItem';
import { CopilotService } from '../services/CopilotService';
import { TabStateService } from '../services/TabStateService';

export function registerCopilotCommands(
  context: vscode.ExtensionContext,
  copilotService: CopilotService,
  stateService: TabStateService
): void {
  
  // Add to Copilot Chat
  context.subscriptions.push(
    vscode.commands.registerCommand('tabsLover.addToCopilotChat', async (item: TabTreeItem) => {
      if (item && item.tab) {
        await copilotService.addFileToChat(item.tab.metadata.uri);
      }
    })
  );
  
  // Add Multiple to Copilot Chat
  context.subscriptions.push(
    vscode.commands.registerCommand('tabsLover.addMultipleToCopilotChat', async () => {
      const allTabs = stateService.getAllTabs();
      if (allTabs.length === 0) {
        vscode.window.showInformationMessage('No tabs open');
        return;
      }
      
      await copilotService.addMultipleFiles(allTabs);
    })
  );
}
```

**Archivo: `src/extension.ts`**

```typescript
import * as vscode from 'vscode';
import { TabsLoverProvider } from './providers/TabsLoverProvider';
import { TabStateService } from './services/TabStateService';
import { TabSyncService } from './services/TabSyncService';
import { TabIconManager } from './services/TabIconManager';
import { ThemeService } from './services/ThemeService';
import { CopilotService } from './services/CopilotService';
import { registerTabCommands } from './commands/tabCommands';
import { registerCopilotCommands } from './commands/copilotCommands';

export function activate(context: vscode.ExtensionContext) {
  console.log('[TabsLover] Activating extension...');
  
  // Servicios
  const stateService = new TabStateService();
  const syncService = new TabSyncService(stateService);
  const iconManager = new TabIconManager();
  const themeService = new ThemeService();
  const copilotService = new CopilotService();
  
  // Provider
  const provider = new TabsLoverProvider(stateService, copilotService);
  
  // Registrar TreeView
  const treeView = vscode.window.createTreeView('tabsLover', {
    treeDataProvider: provider,
    showCollapseAll: false
  });
  
  context.subscriptions.push(treeView);
  
  // Activar servicios
  syncService.activate(context);
  themeService.activate(context);
  iconManager.initialize(context);
  
  // Comandos
  registerTabCommands(context, stateService);
  registerCopilotCommands(context, copilotService, stateService);
  
  // Comando refresh
  context.subscriptions.push(
    vscode.commands.registerCommand('tabsLover.refresh', () => {
      provider.refresh();
    })
  );
  
  // Listener de cambios de tema
  themeService.onDidChangeTheme(() => {
    provider.refresh();
  });
  
  console.log('[TabsLover] Extension activated successfully');
}

export function deactivate() {
  console.log('[TabsLover] Deactivating extension...');
}
```

---

### FASE 2: Testing y Refinamiento (Día 4)

1. **Probar la extensión**:
    
    ```bash
    # Presiona F5 en VS Code para abrir una nueva ventana de desarrollo
    ```
    
2. **Verificar funcionalidades**:
    
    - ✅ Panel aparece en Activity Bar
    - ✅ Tabs se muestran correctamente
    - ✅ Iconos usan el tema activo
    - ✅ Click abre el archivo
    - ✅ Menú contextual funciona
    - ✅ Pin/Unpin funciona
    - ✅ Close funciona
    - ✅ Múltiples grupos se muestran
3. **Ajustar configuración**:
    
    ```json
    // settings.json (para testing)
    {
      "tabsLover.showFilePath": true,
      "tabsLover.tabHeight": 28,
      "tabsLover.iconSize": 16
    }
    ```
    

---

### FASE 3: Drag & Drop (Opcional - Día 5)

_Implementar solo si se considera necesario después de validar Fase 1-2_

**Archivo: `src/services/DragDropController.ts`**

```typescript
import * as vscode from 'vscode';
import { SideTab } from '../models/SideTab';
import { TabStateService } from './TabStateService';
import { TabsLoverProvider } from '../providers/TabsLoverProvider';

export class DragDropController implements vscode.TreeDragAndDropController<SideTab> {
  dragMimeTypes = ['application/vnd.code.tree.tabslover'];
  dropMimeTypes = ['application/vnd.code.tree.tabslover'];
  
  constructor(
    private stateService: TabStateService,
    private provider: TabsLoverProvider
  ) {}
  
  async handleDrag(
    source: readonly SideTab[],
    dataTransfer: vscode.DataTransfer
  ): Promise<void> {
    dataTransfer.set(
      'application/vnd.code.tree.tabslover',
      new vscode.DataTransferItem(JSON.stringify(source.map(s => s.metadata.id)))
    );
  }
  
  async handleDrop(
    target: SideTab | undefined,
    dataTransfer: vscode.DataTransfer
  ): Promise<void> {
    const transferItem = dataTransfer.get('application/vnd.code.tree.tabslover');
    if (!transferItem) return;
    
    const draggedIds: string[] = JSON.parse(transferItem.value as string);
    
    // Solo visual - no sincroniza con VS Code
    // Para sincronizar, descomentar syncOrderToVSCode()
    
    vscode.window.showInformationMessage(
      'Drag & drop reordering is visual only. Enable sync in settings (experimental).'
    );
    
    this.provider.refresh();
  }
}
```

---

## 5. Testing y Debugging

### 5.1 Launch Configuration

**.vscode/launch.json**:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": [
        "--extensionDevelopmentPath=${workspaceFolder}"
      ],
      "outFiles": [
        "${workspaceFolder}/out/**/*.js"
      ],
      "preLaunchTask": "${defaultBuildTask}"
    },
    {
      "name": "Extension Tests",
      "type": "extensionHost",
      "request": "launch",
      "args": [
        "--extensionDevelopmentPath=${workspaceFolder}",
        "--extensionTestsPath=${workspaceFolder}/out/test/suite/index"
      ],
      "outFiles": [
        "${workspaceFolder}/out/test/**/*.js"
      ],
      "preLaunchTask": "${defaultBuildTask}"
    }
  ]
}
```

### 5.2 Comandos de Testing

```bash
# Compilar
npm run compile

# Compilar en modo watch
npm run watch

# Ejecutar tests
npm test

# Debug: Presiona F5 para abrir ventana de desarrollo
```

### 5.3 Logging

Para debug, activar logs en la consola:

```typescript
// En cualquier archivo, descomentar logs:
console.log('[TabsLover] Tu mensaje aquí');
```

Ver logs en: `Help > Toggle Developer Tools > Console`

---

## 6. Packaging y Distribución

### 6.1 Preparar para Publicación

```bash
# Instalar vsce
npm install -g @vscode/vsce

# Empaquetar
vsce package

# Esto genera: tabs-lover-0.1.0.vsix
```

### 6.2 Instalación Local

```bash
# Instalar el .vsix generado
code --install-extension tabs-lover-0.1.0.vsix
```

### 6.3 Publicar en Marketplace

```bash
# Crear Personal Access Token en Azure DevOps
# https://dev.azure.com/

# Login
vsce login YOUR_PUBLISHER_NAME

# Publicar
vsce publish
```

---

## 7. Troubleshooting

### Problema: Los iconos no se muestran

**Solución**: Verificar que `resourceUri` está configurado en `TabTreeItem`

### Problema: La extensión no se activa

**Solución**: Verificar `activationEvents` en `package.json`

### Problema: Comandos no aparecen en menú

**Solución**: Verificar `when` clauses en `package.json > menus`

### Problema: Copilot commands no funcionan

**Solución**: Verificar que GitHub Copilot Chat está instalado

---

## 8. Roadmap Futuro

### Fase 4: UX Avanzado

- [ ] Filtrado/búsqueda de tabs
- [ ] Keyboard shortcuts personalizables
- [ ] Indicador visual de grupo activo
- [ ] Bookmarks/favoritos

### Fase 5: Optimización

- [ ] Performance con 100+ tabs
- [ ] Virtualización de lista
- [ ] Memory profiling
- [ ] Tests E2E completos

---

## 9. Recursos

- [VS Code Extension API](https://code.visualstudio.com/api)
- [TreeView API](https://code.visualstudio.com/api/extension-guides/tree-view)
- [Tab Groups API](https://code.visualstudio.com/api/references/vscode-api#window.tabGroups)
- [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)

---

**¡Listo!** Ahora tienes una guía completa para implementar Tabs Lover desde cero.

Para empezar: `F5` en VS Code → Prueba la extensión → Itera según feedback

````

---

## Archivos Adicionales de Utilidad

### utils/logger.ts

```typescript
import * as vscode from 'vscode';

export class Logger {
  private static outputChannel: vscode.OutputChannel;
  
  static initialize(): void {
    this.outputChannel = vscode.window.createOutputChannel('Tabs Lover');
  }
  
  static log(message: string): void {
    const timestamp = new Date().toISOString();
    this.outputChannel.appendLine(`[${timestamp}] ${message}`);
  }
  
  static error(message: string, error?: any): void {
    this.log(`ERROR: ${message}`);
    if (error) {
      this.log(error.toString());
      if (error.stack) {
        this.log(error.stack);
      }
    }
  }
  
  static show(): void {
    this.outputChannel.show();
  }
}
````

### utils/helpers.ts

```typescript
import * as vscode from 'vscode';

export function getFileIcon(uri: vscode.Uri): vscode.ThemeIcon {
  const ext = uri.fsPath.split('.').pop()?.toLowerCase();
  
  const iconMap: Record<string, string> = {
    'ts': 'file-code',
    'js': 'file-code',
    'json': 'json',
    'md': 'markdown',
    'css': 'file-code',
    'html': 'file-code',
    'py': 'file-code',
    'java': 'file-code'
  };
  
  return new vscode.ThemeIcon(iconMap[ext || ''] || 'file');
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
```

---

## Requirements

- VS Code >= 1.85.0
- (Optional) GitHub Copilot Chat extension for Copilot features

## Known Limitations

- Drag & drop reordering is experimental and may cause tabs to lose state
- Cannot drag tabs to other VS Code panels (architectural limitation)
- SCM status requires additional configuration

## Contributing

Contributions are welcome! Please open an issue or PR on GitHub.

## License

MIT