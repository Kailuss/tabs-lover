# Tabs Lover

A VS Code extension that replaces the native tab bar with a vertical, fully styled tab list in the sidebar.

## Features

- **Vertical tab list** in a dedicated sidebar panel
- **42px row height** with file name + relative path on separate lines
- **4px accent border** on the active tab (uses your theme's focus color)
- **Real file icons** from your active icon theme (Material Icons, Seti, etc.)
- **Hover actions** — Pin, Add to Copilot Chat, Close (appear on hover, no layout shift)
- **isDirty indicator** — modified dot that swaps for close button on hover
- **Git decorations** — file name color reflects git status (modified, added, deleted, conflict…)
- **Diagnostic indicators** — error/warning color on file name from language diagnostics
- **Pin support** — pinned tabs stay at the top with a badge; cannot be drag-moved
- **All tab types** — Text files, Diff, Settings, Extensions, Notebooks, Custom editors
- **Context menu** — Right-click for Close Others, Close to Right, Reveal in Explorer, Copy Path, Duplicate, Diff, Split, Move to New Window, and more
- **Copilot Chat integration** — Add files to chat context with one click
- **Multi-group support** — Groups shown with headers when multiple editor groups are open
- **Drag & drop reordering** — Mouse-based reorder within a group (unpinned tabs only)
- **File action buttons** — Contextual quick-action per file type (preview MD, run scripts, format, etc.)

## Requirements

- VS Code **1.108.0** or later

## Extension Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `tabsLover.showFilePath` | `boolean` | `true` | Show relative file path below file name |
| `tabsLover.tabHeight` | `number` | `40` | Tab row height in pixels |
| `tabsLover.iconSize` | `number` | `16` | File icon size in pixels |
| `tabsLover.enableHoverActions` | `boolean` | `true` | Show action buttons on hover |
| `tabsLover.showStateIcons` | `boolean` | `true` | Show state indicators (dirty, pinned) |
| `tabsLover.enableDragDrop` | `boolean` | `true` | Mouse-based drag & drop reordering (unpinned tabs only) |

## Commands

| Command | Description |
|---------|-------------|
| `Tabs Lover: Refresh` | Force refresh the tab list |
| `Tabs Lover: Close All` | Close all open editors |
| `Tabs Lover: Add Files to Copilot Chat…` | Multi-select files for Copilot context |

Additional commands available via context menu: Close, Close Others, Close to Right, Pin/Unpin, Reveal in Explorer View, Reveal in File Explorer, Open Timeline, Copy Relative Path, Copy Path, Copy File Contents, Duplicate File, Compare with Active Editor, Open Changes, Split Right, Move to New Window, Add to Copilot Chat.

## Drag & Drop

When `tabsLover.enableDragDrop` is enabled:

- Click and drag any **unpinned** tab to reorder it within the same group.
- **Pinned tabs cannot be moved** and will not show hover effects while dragging.
- A floating clone follows the cursor; other tabs animate to show the insertion point.
- Dropping at the boundary of the pinned section is blocked automatically.

## Architecture

The extension uses a **WebviewView** (not TreeView) for full CSS control over the tab list:

```
VS Code Tab API → TabSyncService → TabStateService → TabsLoverWebviewProvider
                                                    ↗ TabsLoverHtmlBuilder (HTML/CSS/JS)
                                                    ↗ TabIconManager (base64 icons)
                                                    ↗ FileActionRegistry (contextual buttons)
                                                    ↗ TabDragDropService (reorder logic)
```

See [INSTRUCTIONS.md](INSTRUCTIONS.md) for the complete architecture guide.
See [OPTIMIZATION.md](OPTIMIZATION.md) for the performance analysis and roadmap.

## Development

```bash
npm install
npm run watch     # esbuild + tsc in parallel
# Press F5 to launch Extension Development Host
```

```bash
npm run compile   # Full build (type-check + lint + esbuild)
npm test          # Run tests
```

## License

MIT
