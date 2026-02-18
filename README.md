# Tabs Lover

A VS Code extension that replaces the native tab bar with a vertical, fully styled tab list in the sidebar.

## Features

- **Vertical tab list** in a dedicated sidebar panel
- **40px row height** with file name + relative path on separate lines
- **4px accent border** on the active tab (uses your theme's focus color)
- **Real file icons** from your active icon theme (Material Icons, Seti, etc.)
- **Hover actions** — Pin, Add to Copilot Chat, Close (appear on hover, no layout shift)
- **isDirty indicator** — modified dot that swaps for close button on hover
- **All tab types** — Text files, Settings, Extensions, Notebooks, Custom editors
- **Context menu** — Right-click for Close Others, Reveal in Explorer, Copy Path, Diff, etc.
- **Copilot Chat integration** — Add files to chat context with one click
- **Multi-group support** — Groups shown with headers when multiple editor groups are open

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
| `tabsLover.enableDragDrop` | `boolean` | `false` | Experimental drag & drop reordering |

## Commands

| Command | Description |
|---------|-------------|
| `Tabs Lover: Refresh` | Force refresh the tab list |
| `Tabs Lover: Close All` | Close all open editors |
| `Tabs Lover: Add Files to Copilot Chat…` | Multi-select files for Copilot context |

Additional commands available via context menu: Close, Close Others, Close to Right, Pin/Unpin, Reveal in Explorer, Copy Relative Path, Copy File Contents, Compare with Active Editor, Move to Group.

## Architecture

The extension uses a **WebviewView** (not TreeView) for full CSS control over the tab list:

```
VS Code Tab API → TabSyncService → TabStateService → TabsLoverWebviewProvider (HTML/CSS)
                                                    ↗ TabIconManager (base64 icons)
```

See [INSTRUCTIONS.md](INSTRUCTIONS.md) for the complete architecture guide.

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
