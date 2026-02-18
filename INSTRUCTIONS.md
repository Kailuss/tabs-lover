# Tabs Lover — Architecture & Implementation Guide

> **Last updated:** 2026-02-17 · WebviewView architecture · VS Code ≥ 1.108.0

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
│   ├── TabsLoverWebviewProvider.ts     # WebviewViewProvider — lifecycle + message handling
│   └── TabsLoverHtmlBuilder.ts         # HTML/CSS/JS generation — separated for clarity
├── services/
│   ├── TabStateService.ts              # In-memory store (Map) + change events
│   ├── TabSyncService.ts               # Mirrors VS Code Tab API → state
│   ├── TabDragDropService.ts           # Drag & drop reorder logic (backend)
│   ├── TabIconManager.ts               # Loads file icons from active icon theme (base64)
│   ├── FileActionRegistry.ts           # Per-filetype contextual action buttons
│   ├── ThemeService.ts                 # Listens for theme changes
│   └── CopilotService.ts              # Optional Copilot Chat integration
├── commands/
│   ├── tabCommands.ts                  # Tab commands (open, close, pin, move…)
│   └── copilotCommands.ts              # Copilot commands
├── constants/
│   ├── styles.ts                       # STYLE_CONSTANTS + getConfiguration()
│   └── icons.ts                        # (legacy — not actively used)
├── styles/
│   └── webview.css                     # Webview stylesheet (loaded as external file)
└── utils/
    ├── helpers.ts                      # formatFilePath, getFileIcon, formatFileSize
    └── logger.ts                       # OutputChannel logger
```

> **Dead files** (safe to ignore or delete):
> - `src/providers/TabsLoverProvider.ts` — stub, replaced by WebviewProvider
> - `src/models/TabTreeItem.ts` — legacy TreeItem, not used

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
         │   (sync layer)        │  Handles all 5 tab input types
         │                       │  Reads git status + diagnostics
         └───────────┬───────────┘
                     │ addTab / removeTab / updateTab / updateTabSilent
                     ▼
         ┌───────────────────────┐
         │   TabStateService     │  In-memory Map<id, SideTab>
         │   (state store)       │  Fires onDidChangeState / onDidChangeStateSilent
         └───────────┬───────────┘
                     │ events
                     ▼
    ┌────────────────────────────────────────────┐
    │  TabsLoverWebviewProvider                  │
    │  (WebviewViewProvider)                     │
    │  ┌──────────────────────────────────────┐  │
    │  │  TabsLoverHtmlBuilder.buildHtml()    │  │
    │  │  - Tab rows as HTML divs             │  │
    │  │  - File icons via base64             │  │
    │  │  - webview.css loaded externally     │  │
    │  │  - Inline JS: click/close/context    │  │
    │  │  - Optional: getDragDropScript()     │  │
    │  └──────────────────────────────────────┘  │
    │  handleMessage() ← webview postMessage    │
    │  showContextMenu() ← right-click         │
    └────────────────────────────────────────────┘
         ▲              ▲              ▲
         │              │              │
   ┌─────┴──────┐  ┌───┴──────────┐  ┌┴──────────────────┐
   │ IconManager │  │ DragDrop     │  │ FileActionRegistry │
   │ (base64)    │  │ Service      │  │ (contextual btns)  │
   └─────────────┘  └─────────────┘  └────────────────────┘
                          ▲
                          │
                   ┌──────┴──────────┐
                   │  CopilotService │
                   │  (optional)     │
                   └─────────────────┘
```

---

## Key Design Decisions

### 1. WebviewView instead of TreeView

TreeView's `TreeItem` API can't control row height, left borders, or hover buttons.
WebviewView gives full HTML/CSS control for the tab list UI.

- **View type:** `"webview"` in `package.json`
- **Provider:** `TabsLoverWebviewProvider` implements `vscode.WebviewViewProvider`
- **Rendering:** Full HTML rebuilt on each state change (micro-debounced with `setTimeout(0)`)
- **CSS:** Loaded as an external file (`src/styles/webview.css`) via `webview.asWebviewUri`

### 2. Optional URI (`uri?: vscode.Uri`)

Webview tabs (Settings, Extensions, Welcome) have **no real file URI**.
Creating fake URIs (`untitled:`, `tabslover://`, etc.) causes `[UriError]` in VS Code's
internal URI revival system.

**Solution:** `SideTabMetadata.uri` is optional. Webview tabs have `uri: undefined`.

- **ID generation:** File tabs use `${uri}-${viewColumn}`, Webview tabs use `webview:${sanitized-label}-${viewColumn}`
- **Actions:** File-only actions (Reveal, Copy Path, Compare) are guarded with `if (this.metadata.uri)`
- **Context menu:** Hides file-only actions for webview tabs

### 3. Tab type support

All five VS Code tab input types are handled:

| Type | Class | Has URI | Tab Type |
|------|-------|---------|----------|
| Text files | `TabInputText` | ✅ | `'file'` |
| Diff editors | `TabInputTextDiff` | ✅ (modified side) | `'diff'` |
| Webviews | `TabInputWebview` | ❌ | `'webview'` |
| Custom editors | `TabInputCustom` | ✅ | `'custom'` |
| Notebooks | `TabInputNotebook` | ✅ | `'notebook'` |
| Built-in (Settings…) | `undefined` input | ❌ | `'unknown'` |

### 4. Icon system

`TabIconManager` loads the active icon theme's JSON manifest, builds a lookup map
(`name:` / `ext:` / `lang:` keys → icon IDs), and resolves icons as base64 data URIs
embedded directly in the HTML `<img>` tags.

- Reads from disk with `fs/promises` (async, non-blocking)
- Caches resolved icons in `_iconCache` (base64) and `_iconPathCache` (resolved path)
- Falls back to a minimal inline SVG for unknown files
- Rebuilds on `workbench.iconTheme` configuration change
- Background preload available via `preloadIconsInBackground()`

### 5. Two event channels

`TabStateService` fires two separate events:

- **`onDidChangeState`** — structural changes (tab opened/closed/moved, dirty, pinned, git status)
- **`onDidChangeStateSilent`** — active-tab-only changes (avoids unnecessary full re-render)

Both trigger a webview refresh, but the sync service routes changes appropriately.

### 6. Drag & Drop (mouse-based)

Drag & drop uses **mouse events** (not the HTML5 Drag API) for fine-grained control:

- `mousedown` — captures source tab and start position
- `mousemove` — creates a floating clone and shifts sibling tabs via CSS `translateY`
- `mouseup` — commits the drop by posting a `dropTab` message to the extension host
- Pinned tabs are excluded from dragging (both as source and as visual drop target)
- During drag, pinned tabs show `cursor: default` and no hover effects (`pointer-events: none` equivalent via CSS)

Backend validation in `TabDragDropService.reorderWithinGroup()` enforces:
- Pinned tabs cannot be moved
- Unpinned tabs cannot be dropped into the pinned section

### 7. FileActionRegistry

Per-filetype contextual buttons rendered inline on each tab row.

- Actions are registered with a `match` function (by extension, name, or regex pattern)
- `resolve(fileName, uri)` returns the first matching action or `null`
- `execute(actionId, uri)` runs the associated VS Code command
- Adding a new action only requires registering a `FileAction` — no other files need changing

### 8. Git & Diagnostic decorations

`TabSyncService` reads:
- **Git status** via the `vscode.git` extension API (working tree + index + merge changes)
- **Diagnostic severity** via `vscode.languages.getDiagnostics(uri)`

Both are stored in `SideTabState` and reflected as CSS classes on `.tab-name`:
`modified`, `added`, `deleted`, `untracked`, `ignored`, `conflict`, `warning`, `error`.

---

## Models

### SideTabMetadata (immutable)

```typescript
interface SideTabMetadata {
  id: string;           // Unique per tab (uri-based or label-based)
  uri?: vscode.Uri;     // Only present for file/custom/notebook/diff tabs
  label: string;        // Display name
  description?: string; // Relative file path (shown below name)
  tooltip?: string;     // Full path
  fileType: string;     // Extension (e.g. ".ts")
  tabType: SideTabType; // 'file' | 'diff' | 'webview' | 'custom' | 'notebook' | 'unknown'
  viewType?: string;    // Webview/custom editor viewType (for icon mapping)
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
  gitStatus: GitStatus;                        // 'modified' | 'added' | 'deleted' | ... | null
  diagnosticSeverity: vscode.DiagnosticSeverity | null;  // Error > Warning > null
}
```

### SideTab (class)

Actions: `close()`, `closeOthers()`, `closeToRight()`, `closeGroup()`, `pin()`, `unpin()`,
`revealInExplorerView()`, `revealInFileExplorer()`, `openTimeline()`,
`copyRelativePath()`, `copyPath()`, `copyFileContents()`, `duplicateFile()`,
`compareWithActive()`, `openChanges()`, `splitRight()`, `moveToNewWindow()`,
`moveToGroup()`, `activate()`

Webview/diff/unknown activation delegates to `activateByNativeTab()` which uses
`focusGroup()` + `workbench.action.openEditorAtIndex`.

---

## Services

### TabStateService

- **Store:** `Map<string, SideTab>` + `Map<number, SideTabGroup>`
- **API:** `addTab()`, `removeTab()`, `updateTab()`, `updateTabSilent()`, `replaceTabs()`
- **Search:** `getTab(id)`, `getAllTabs()`, `getTabsInGroup(groupId)`, `findTabByUri(uri)`
- **Pin reorder:** `reorderOnPin(tabId)`, `reorderOnUnpin(tabId)`

### TabSyncService

- **Listeners:** `onDidChangeTabs`, `onDidChangeTabGroups`, `onDidChangeActiveTextEditor`, `onDidChangeDiagnostics`
- **`convertToSideTab()`**: Handles all 6 input types, generates stable IDs
- **`syncAll()`**: Full sync on activation
- **`syncActiveState()`**: Lightweight active-only sync on editor change
- **`removeOrphanedTabs()`**: Removes tabs whose native counterpart no longer exists
- **`updateTabDiagnostics(uri)`**: Targeted diagnostic update on `onDidChangeDiagnostics`

### TabIconManager

- **`buildIconMap()`**: Reads icon theme JSON, builds `iconMap` (name/ext/lang → icon ID)
- **`getFileIconAsBase64()`**: Resolves fileName → iconId → iconPath → base64 data URI
- **Priority:** exact name → compound ext → simple ext → language ID → inferred language → `_file`
- **`getCachedIcon()`**: Synchronous cache lookup (no I/O)
- **`preloadIconsInBackground()`**: Batch preload for all open tabs (5 at a time)
- **`clearCache()`**: Called on theme change

### TabDragDropService

- **`reorderWithinGroup(sourceId, targetId, position)`**: Reorders within same group; enforces pinned restrictions
- **`moveBetweenGroups(sourceId, targetGroupId, targetId?, position?)`**: Moves tab across groups via VS Code API
- **`canDrop(sourceId, targetId)`**: Validation check (pinned source or target → false)
- **`findLastPinnedIndex(tabs)`**: Helper to locate the pinned/unpinned boundary

### FileActionRegistry

- **`register(action)`**: Adds a `FileAction` to the registry
- **`resolve(fileName, uri)`**: Returns `ResolvedFileAction | null` for the given file
- **`execute(actionId, uri)`**: Runs the associated VS Code command

### ThemeService

Listens for `workbench.iconTheme`, `workbench.colorTheme`, `workbench.productIconTheme` changes.
Fires `onDidChangeTheme` event → triggers full webview refresh.

### CopilotService

- **`isAvailable()`**: Checks if `github.copilot-chat` extension is installed
- **`addFileToChat(uri)`**: Opens Copilot Chat with the file attached as context
- **`addMultipleFiles(tabs)`**: QuickPick filtered to file tabs only

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
| `tabsLover.enableDragDrop` | boolean | `true` | Mouse-based drag & drop reordering |

---

## Webview HTML Structure

Each tab is rendered as a `.tab` div:

```html
<div class="tab active" data-tabid="file:///path-1" data-pinned="false" data-groupid="1">
  <span class="tab-icon"><img src="data:image/svg+xml;base64,…" alt="" /></span>
  <div class="tab-text">
    <div class="tab-name modified">
      extension.ts
      <span class="pin-badge codicon codicon-pinned"></span>  <!-- if pinned -->
    </div>
    <div class="tab-path">● • src</div>
  </div>
  <span class="tab-state">
    <span class="codicon codicon-close-dirty"></span>  <!-- if dirty -->
  </span>
  <span class="tab-actions">
    <button data-action="fileAction" data-tabid="…" data-actionid="preview-md">…</button>
    <button data-action="addToChat"  data-tabid="…">…</button>
    <button data-action="closeTab"   data-tabid="…">…</button>
  </span>
</div>
```

**Layout:** Fixed 5px left border (accent on active) → 28px icon area → flex text → 22px state → action buttons.

**Data attributes:**
- `data-tabid` — unique tab ID for message routing
- `data-pinned` — `"true"` / `"false"` — used by D&D CSS and drag script
- `data-groupid` — editor group (viewColumn) — used by D&D script for group boundary

**Communication:** `acquireVsCodeApi().postMessage({ type, tabId })` → `handleMessage()`.

Message types: `openTab`, `closeTab`, `pinTab`, `unpinTab`, `contextMenu`, `dropTab`, `fileAction`, `addToChat`.

---

## Drag & Drop CSS States

```
body.drag-active                    ← set when drag starts
  .tab.drag-clone                   ← floating clone (fixed position)
  .tab.drag-placeholder             ← invisible ghost at original position
  .tab.drag-shifting                ← siblings that animate to make room
  .tab[data-pinned="true"]          ← pinned tabs: cursor:default, no hover
```

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
| Old logs appear | `dist/extension.js` is stale | Kill watch tasks, `npm run compile`, relaunch |
| Pinned tabs show hover during drag | CSS specificity issue | Ensure `body.drag-active .tab[data-pinned="true"]` rules are present in webview.css |

---

## Agent Instructions (for AI coding assistants)

When working on this codebase:

1. **Never create fake URIs** for webview tabs — keep `uri: undefined`
2. **All tab input types** must be handled: Text, Diff, Webview, Custom, Notebook, Unknown
3. **Icons are base64** data URIs in HTML — no `ThemeIcon` or `resourceUri`
4. **Commands receive string tab IDs** — not TreeItems or SideTab instances
5. **File-only actions** must check `if (tab.metadata.uri)` before proceeding
6. **Use `fs/promises`** for all file I/O — never blocking `fs.readFileSync`
7. **Minimize Logger calls** — only log activation and errors
8. **Webview refreshes are debounced** — don't add extra `setTimeout` wrappers
9. **Dead code files exist** (`TabTreeItem`, `TabsLoverProvider`) — ignore them, do not import from them
10. **Drag & drop backend is `TabDragDropService`** — the webview script only posts `dropTab` messages; reorder logic lives server-side
11. **CSS for drag states** — use `body.drag-active` + `data-pinned`/`data-groupid` attributes already present on tab elements
12. **`data-pinned` and `data-groupid`** are rendered on every `.tab` div — rely on them for CSS and JS targeting
13. See [OPTIMIZATION.md](OPTIMIZATION.md) for known performance issues before adding new features

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