# SideTab Actions Modular Architecture

## Overview

The `SideTabActions` class has been refactored from a 476-line monolithic file into a **compositional architecture** using pure functions organized by responsibility.

## Structure

```
src/models/
├── SideTabActions.ts        (171 lines) - Compositional wrapper class
├── SideTab.ts               - Type definitions
├── SideTabHelpers.ts        - Static helpers
└── actions/                 - Modular action functions
    ├── index.ts             - Barrel export
    ├── closeActions.ts      (~45 lines) - close, closeOthers, closeGroup, closeToRight
    ├── pinActions.ts        (~30 lines) - pin, unpin
    ├── revealActions.ts     (~40 lines) - reveal in different explorers, openTimeline
    ├── copyActions.ts       (~35 lines) - copyRelativePath, copyPath, copyFileContents
    ├── fileActions.ts       (~120 lines) - duplicate, compare, split, move operations
    ├── activationActions.ts (~95 lines) - activate with retry logic, markdown preview
    ├── stateActions.ts      (~70 lines) - operations state, context, integrations
    └── customActions.ts     (~50 lines) - custom action registration/execution
```

## Design Principles

### Pure Functions
All action modules export **pure functions** that:
- Accept `metadata` (immutable) and `state` (mutable) as parameters
- Mutate `state` in place (same as before)
- Return `Promise<void>` for async operations or `void` for sync operations
- Have NO side dependencies on class instances

### Composition over Inheritance
`SideTabActions` is now a **thin wrapper** that:
- Delegates to module functions
- Maintains backward compatibility (same API surface)
- Passes `this.metadata` and `this.state` to delegated functions
- Injects dependencies (like `() => this.activate()`) when needed

### Single Responsibility
Each module handles one concern:
- **closeActions**: Closing tabs and groups
- **pinActions**: Pin/unpin operations
- **revealActions**: Revealing files in explorers
- **copyActions**: Copying paths and content
- **fileActions**: File manipulation (duplicate, compare, split, move)
- **activationActions**: Tab activation with retry logic
- **stateActions**: State management (operations, context, integrations)
- **customActions**: Custom action lifecycle

## Benefits

### ✅ Maintainability
- **476 lines → 171 lines** in main file (64% reduction)
- Each module is focused and ~30-120 lines
- Easier to locate and modify specific functionality

### ✅ Testability
- Pure functions are easy to test
- No need to mock entire class instances
- Can test functions in isolation:
  ```typescript
  import { close } from './actions/closeActions';
  
  test('close action respects capabilities', async () => {
    const metadata = { ... };
    const state = { capabilities: { canClose: false } };
    await close(metadata, state);
    // Assert warning was shown, tab not closed
  });
  ```

### ✅ Reusability
- Functions can be imported individually:
  ```typescript
  import { duplicateFile } from './actions/fileActions';
  // Use without instantiating SideTabActions
  await duplicateFile(metadata, state);
  ```

### ✅ Discoverability
- Clear module organization by feature
- Barrel export in `actions/index.ts` for convenience
- IDE autocomplete shows related functions together

### ✅ Type Safety
- Strong typing preserved throughout
- `metadata: SideTabMetadata` and `state: SideTabState` are explicit
- No loss of type checking compared to class methods

## Migration Guide

### For Existing Code (No Changes Needed)
The public API remains **100% unchanged**:
```typescript
const tab: SideTab = ...;
await tab.close();              // ✅ Still works
await tab.duplicateFile();      // ✅ Still works
tab.startOperation('build');    // ✅ Still works
```

### For New Code (Direct Function Import)
You can now use functions directly:
```typescript
import * as tabActions from './actions';

// Use pure functions
await tabActions.close(metadata, state);
await tabActions.duplicateFile(metadata, state);
tabActions.startOperation(state, 'build', false);
```

### For Testing
Test pure functions without mocking:
```typescript
import { startOperation, finishOperation } from './actions';

test('operation lifecycle', () => {
  const state = createDefaultState();
  
  startOperation(state, 'test-op', true);
  expect(state.operationState.isProcessing).toBe(true);
  expect(state.operationState.canCancel).toBe(true);
  
  finishOperation(state);
  expect(state.operationState.isProcessing).toBe(false);
});
```

## Implementation Details

### Delegation Pattern
```typescript
// Before (monolithic)
export abstract class SideTabActions {
  async close(): Promise<void> {
    if (!this.state.capabilities.canClose) {
      vscode.window.showWarningMessage('This tab cannot be closed');
      return;
    }
    const t = SideTabHelpers.findNativeTab(this.metadata, this.state);
    if (t) {
      await vscode.window.tabGroups.close(t);
    }
  }
}

// After (compositional)
// In actions/closeActions.ts
export async function close(metadata: SideTabMetadata, state: SideTabState): Promise<void> {
  if (!state.capabilities.canClose) {
    vscode.window.showWarningMessage('This tab cannot be closed');
    return;
  }
  const t = SideTabHelpers.findNativeTab(metadata, state);
  if (t) {
    await vscode.window.tabGroups.close(t);
  }
}

// In SideTabActions.ts
export abstract class SideTabActions {
  async close(): Promise<void> {
    return actions.close(this.metadata, this.state);
  }
}
```

### Dependency Injection
For actions that need to call other actions, dependencies are injected:
```typescript
// closeOthers needs to activate first
export async function closeOthers(
  metadata: SideTabMetadata,
  state: SideTabState,
  activateFn: () => Promise<void>  // ← Injected dependency
): Promise<void> {
  await activateFn();
  await vscode.commands.executeCommand('workbench.action.closeOtherEditors');
}

// Wrapper injects this.activate
async closeOthers(): Promise<void> {
  return actions.closeOthers(this.metadata, this.state, () => this.activate());
}
```

## Future Enhancements

### Potential Improvements
1. **Move to React Hooks-style**: Could extract state management into hooks
2. **Add Middleware**: Intercept actions for logging, analytics, undo/redo
3. **Command Pattern**: Convert to command objects for better history tracking
4. **Event Sourcing**: Record all state changes as events
5. **Split More**: Could split `fileActions.ts` (~120 lines) into smaller modules

### No Planned Changes
- ❌ Won't change public API (backward compatibility guaranteed)
- ❌ Won't convert to class-based again (composition is superior)
- ❌ Won't remove `SideTabActions` wrapper (needed for inheritance chain)

## Metrics

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Main file lines | 476 | 171 | **-64%** |
| Largest module | 476 | 120 | **-75%** |
| Average module size | 476 | ~55 | **-88%** |
| Modules | 1 | 9 | **+800%** |
| Test coverage potential | Low | High | **Easier to test** |

## Related Documentation

- [SideTab Types](./SideTab.ts) - Type definitions
- [SideTabHelpers](./SideTabHelpers.ts) - Static helper functions
- [Enhanced Actions](./ENHANCED_ACTIONS.md) - New action attributes documentation
- [File Actions](../../constants/fileActions/types.ts) - FileAction type system

---

**Created**: [Current Date]  
**Author**: Inspector Gadget (VS Code Extension Specialist)  
**Architecture**: Compositional pattern with pure functions
