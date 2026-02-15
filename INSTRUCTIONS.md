# Tabs Lover — Architecture & Implementation Guide

> **Last updated:** 2026-02-15 · WebviewView architecture · VS Code ≥ 1.108.0

---

## Quick Start

```bash
npm install
npm run compile   # or: npm run watch
# Press F5 to launch Extension Development Host
```

---

## Project Layout

```
src/
├── extension.ts                        # Entry point — wires services + provider
├── models/
│   ├── SideTab.ts                      # Tab model + actions (close, pin, activate…)
│   └── SideTabGroup.ts                 # Group type + factory
├── providers/
│   └── TabsLoverWebviewProvider.ts     # WebviewViewProvider — renders HTML/CSS
├── services/
│   ├── TabStateService.ts              # In-memory store (Map) + change events
│   ├── TabSyncService.ts              # Mirrors VS Code Tab API → state
│   ├── TabIconManager.ts             # Loads file icons from active icon theme
│   ├── ThemeService.ts                # Listens for theme changes
│   └── CopilotService.ts             # Optional Copilot Chat integration
├── commands/
│   ├── tabCommands.ts                  # Tab commands (open, close, pin…)
│   └── copilotCommands.ts             # Copilot commands
├── constants/
│   └── styles.ts                       # STYLE_CONSTANTS + getConfiguration()
└── utils/
    └── logger.ts                       # OutputChannel logger
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  VS Code Native Tab API                                 │
│  (tabGroups, onDidChangeTabs, onDidChangeTabGroups)     │
└────────────────────┬────────────────────────────────────┘
                     │ events
                     ▼
         ┌───────────────────────┐
         │   TabSyncService      │  Converts native tabs → SideTab
         │   (sync layer)        │  Handles all 4 tab input types
         └───────────┬───────────┘
                     │ addTab / removeTab / updateTab
                     ▼
         ┌───────────────────────┐
         │   TabStateService     │  In-memory Map<id, SideTab>
         │   (state store)       │  Fires onDidChangeState
         └───────────┬───────────┘
                     │ events
                     ▼
    ┌────────────────────────────────────┐
    │  TabsLoverWebviewProvider          │
    │  (WebviewViewProvider)             │
    │  ┌──────────────────────────────┐  │
    │  │  buildHtml()                 │  │
    │  │  - Renders tab rows as HTML  │  │
    │  │  - File icons via base64     │  │
    │  │  - CSS: 40px rows, borders   │  │
    │  │  - JS: click/close/context   │  │
    │  └──────────────────────────────┘  │
    │  handleMessage() ← webview posts  │
    │  showContextMenu() ← right-click  │
    └────────────────────────────────────┘
         ▲                          ▲
         │                          │
   ┌─────┴──────┐           ┌──────┴──────────┐
   │ IconManager │           │  CopilotService │
   │ (base64)    │           │  (optional)     │
   └─────────────┘           └─────────────────┘
```

---

## Key Design Decisions

### 1. WebviewView instead of TreeView

TreeView's `TreeItem` API can't control row height, left borders, or hover buttons.
WebviewView gives full HTML/CSS control for the tab list UI.

- **View type:** `"webview"` in `package.json`
- **Provider:** `TabsLoverWebviewProvider` implements `vscode.WebviewViewProvider`
- **Rendering:** Full HTML rebuilt on each state change (micro-debounced)

### 2. Optional URI (`uri?: vscode.Uri`)

Webview tabs (Settings, Extensions, Welcome) have **no real file URI**.
Creating fake URIs (`untitled:`, `tabslover://`, etc.) causes `[UriError]` in VS Code's
internal URI revival system.

**Solution:** `SideTabMetadata.uri` is optional. Webview tabs have `uri: undefined`.

- **ID generation:** File tabs use `${uri}-${viewColumn}`, Webview tabs use `webview:${sanitized-label}-${viewColumn}`
- **Actions:** File-only actions (Reveal, Copy Path, Compare) are guarded with `if (this.metadata.uri)`
- **Context menu:** Hides file-only actions for webview tabs

### 3. Tab type support

All four VS Code tab input types are handled:

| Type | Class | Has URI | Tab Type |
|------|-------|---------|----------|
| Text files | `TabInputText` | ✅ | `'file'` |
| Webviews | `TabInputWebview` | ❌ | `'webview'` |
| Custom editors | `TabInputCustom` | ✅ | `'custom'` |
| Notebooks | `TabInputNotebook` | ✅ | `'notebook'` |

### 4. Icon system

`TabIconManager` loads the active icon theme's JSON manifest, builds a lookup map
(`name:` / `ext:` / `lang:` keys → icon IDs), and resolves icons as base64 data URIs
embedded directly in the HTML `<img>` tags.

- Reads from disk with `fs/promises` (async, non-blocking)
- Caches resolved icons in `_iconCache` and `_iconPathCache`
- Falls back to a minimal inline SVG for unknown files
- Rebuilds on `workbench.iconTheme` configuration change

### 5. Two event channels

`TabStateService` fires two separate events:

- **`onDidChangeState`** — structural changes (tab opened/closed/moved, dirty, pinned)
- **`onDidChangeStateSilent`** — active-tab-only changes (no progress bar flicker)

Both trigger a webview refresh, but the sync service routes changes appropriately.

---

## Models

### SideTabMetadata (immutable)

```typescript
interface SideTabMetadata {
  id: string;           // Unique per tab (uri-based or label-based)
  uri?: vscode.Uri;     // Only present for file/custom/notebook tabs
  label: string;        // Display name
  description?: string; // Relative file path
  tooltip?: string;     // Full path
  fileType: string;     // Extension (e.g. ".ts")
  tabType: SideTabType; // 'file' | 'webview' | 'custom' | 'notebook'
}
```

### SideTabState (mutable)

```typescript
interface SideTabState {
  isActive: boolean;
  isDirty: boolean;
  isPinned: boolean;
  isPreview: boolean;
  groupId: number;
  viewColumn: vscode.ViewColumn;
  indexInGroup: number;
  lastAccessTime: number;
}
```

### SideTab (class)

Actions: `close()`, `closeOthers()`, `closeToRight()`, `pin()`, `unpin()`,
`revealInExplorer()`, `copyRelativePath()`, `copyFileContents()`,
`compareWithActive()`, `moveToGroup()`, `activate()`

Webview activation maps labels to workbench commands via `WEBVIEW_COMMANDS` lookup table.

---

## Services

### TabStateService

- **Store:** `Map<string, SideTab>` + `Map<number, SideTabGroup>`
- **API:** `addTab()`, `removeTab()`, `updateTab()`, `updateTabSilent()`, `replaceTabs()`
- **Search:** `getTab(id)`, `getAllTabs()`, `getTabsInGroup(groupId)`, `findTabByUri(uri)`

### TabSyncService

- **Listeners:** `onDidChangeTabs`, `onDidChangeTabGroups`, `onDidChangeActiveTextEditor`
- **`convertToSideTab()`**: Handles all 4 input types, generates stable IDs
- **`syncAll()`**: Full sync on activation
- **`updateActiveTab()`**: Lightweight active-only sync on editor change

### TabIconManager

- **`buildIconMap()`**: Reads icon theme JSON, builds `iconMap` (3000+ entries for material-icon-theme)
- **`getFileIconAsBase64()`**: Resolves fileName → iconId → iconPath → base64 data URI
- **Priority:** exact name → extension → language ID → inferred language → default `_file`
- **`getCachedIcon()`**: Synchronous cache lookup (no I/O)
- **`clearCache()`**: Called on theme change

### ThemeService

Listens for `workbench.iconTheme`, `workbench.colorTheme`, `workbench.productIconTheme` changes.
Fires `onDidChangeTheme` event.

### CopilotService

- **`isAvailable()`**: Checks if `github.copilot-chat` extension is installed
- **`addFileToChat(uri)`**: Accepts `Uri | undefined`, warns for non-file tabs
- **`addMultipleFiles(tabs)`**: QuickPick filtered to file tabs only
- **Fallback:** Copies `#file:path` to clipboard + opens chat

---

## Commands

All commands receive a **tab ID string** from the webview (not a TreeItem).
Resolved via `stateService.getTab(id)`.

| Command | Description |
|---------|-------------|
| `tabsLover.openTab` | Activate (focus) a tab |
| `tabsLover.closeTab` | Close a tab |
| `tabsLover.closeOthers` | Close all other tabs in group |
| `tabsLover.closeToRight` | Close tabs to the right |
| `tabsLover.closeAll` | Close all editors |
| `tabsLover.pinTab` | Pin a tab |
| `tabsLover.unpinTab` | Unpin a tab |
| `tabsLover.revealInExplorer` | Show file in Explorer |
| `tabsLover.copyRelativePath` | Copy relative path to clipboard |
| `tabsLover.copyFileContents` | Copy file contents to clipboard |
| `tabsLover.compareWithActive` | Diff with active editor |
| `tabsLover.moveToGroup` | Move tab to another editor group |
| `tabsLover.refresh` | Force refresh the webview |
| `tabsLover.addToCopilotChat` | Add file to Copilot Chat context |
| `tabsLover.addMultipleToCopilotChat` | Multi-select files for Copilot |

---

## Configuration

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `tabsLover.showFilePath` | boolean | `true` | Show relative path below file name |
| `tabsLover.tabHeight` | number | `40` | Tab row height in pixels |
| `tabsLover.iconSize` | number | `16` | File icon size in pixels |
| `tabsLover.enableHoverActions` | boolean | `true` | Show action buttons on hover |
| `tabsLover.showStateIcons` | boolean | `true` | Show state indicators |
| `tabsLover.enableDragDrop` | boolean | `false` | Experimental drag & drop |

---

## Webview HTML Structure

Each tab is rendered as a `.tab` div:

```html
<div class="tab active" data-tabid="file:///path-1">
  <span class="tab-icon"><img src="data:image/svg+xml;base64,…" /></span>
  <div class="tab-text">
    <div class="tab-name">extension.ts<span class="pin-badge">📌</span></div>
    <div class="tab-path">src/extension.ts</div>
  </div>
  <span class="tab-state">●</span>
  <span class="tab-actions">
    <button data-action="pinTab" data-tabid="…">📌</button>
    <button data-action="addToChat" data-tabid="…">✚</button>
    <button data-action="closeTab" data-tabid="…">✕</button>
  </span>
</div>
```

**Layout:** Fixed 4px left border (accent on active) → 28px icon area → flex text → 22px state/actions.

**Communication:** `acquireVsCodeApi().postMessage({ type, tabId })` → `handleMessage()`.

---

## Build & Debug

```bash
npm run compile          # Build once (type-check + lint + esbuild)
npm run watch            # Watch mode (esbuild + tsc in parallel)
npm test                 # Run Mocha tests
```

- Press **F5** to launch Extension Development Host
- Output: `dist/extension.js` (esbuild bundle)
- Type-checking: `tsc --noEmit` (watch mode)
- Logs: **Output** panel → "Tabs Lover" channel

### Package & Install

```bash
npm install -g @vscode/vsce
vsce package
code --install-extension tabs-lover-*.vsix
```

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| Tabs don't appear | Stale build | Restart watch tasks, full reload (not Ctrl+R) |
| `[UriError]` in console | Fake URI for webview tabs | Ensure `uri: undefined` for webview tabs |
| Icons missing | Icon theme not loaded | Check `TabIconManager.buildIconMap()` logs |
| Extension not activating | Activation event | Check `"onStartupFinished"` in `package.json` |
| 20s activation | Sync I/O in icon manager | Ensure `fs/promises` (async) is used |
| Old Spanish logs appear | dist/extension.js is stale | Kill watch tasks, `npm run compile`, relaunch |

---

## Agent Instructions (for AI coding assistants)

When working on this codebase:

1. **Never create fake URIs** for webview tabs — keep `uri: undefined`
2. **All tab input types** must be handled: Text, Webview, Custom, Notebook
3. **Icons are base64** data URIs in HTML — no `ThemeIcon` or `resourceUri`
4. **Commands receive string tab IDs** — not TreeItems or SideTab instances
5. **File-only actions** must check `if (tab.metadata.uri)` before proceeding
6. **Use `fs/promises`** for all file I/O — never blocking `fs.readFileSync`
7. **Minimize Logger calls** — only log activation and errors
8. **Webview refreshes are debounced** — don't add extra setTimeout wrappers
9. **Dead code files exist** (TabTreeItem, TabsLoverProvider, ActiveTabDecorationProvider) — ignore them