import * as vscode from 'vscode';
import * as path from 'path';
import { TabStateService } from '../core/TabStateService';
import type { GitStatus } from '../../models/SideTab';

/**
 * Encapsula toda la sincronización con Git (status + listeners de repositorio).
 */
export class GitSyncService {
  private disposables: vscode.Disposable[] = [];
  private _gitApi: any | null = null;
  private _gitRepoListeners = new Set<string>();
  private _gitOpenRepoListenerAttached = false;

  constructor(private stateService: TabStateService) {}

  activate(context: vscode.ExtensionContext): void {
    console.log('[GitSync] 🚀 Activating GitSyncService...');
    this._gitApi = this.resolveGitApi();

    // Extension change listener (for when Git extension is installed/enabled)
    this.disposables.push(
      vscode.extensions.onDidChange(() => {
        console.log('[GitSync] 🔄 Extensions changed, re-initializing...');
        const oldApi = this._gitApi;
        this._gitApi = this.resolveGitApi();
        if (!oldApi && this._gitApi) {
          console.log('[GitSync] 🎉 Git API now available via extension change');
          this.setupGitListeners();
          this.refreshAllGitStatuses();
        }
      }),
    );

    // Try to initialize immediately if Git is ready
    if (this._gitApi && this._gitApi.repositories.length > 0) {
      console.log('[GitSync] ✅ Git API available immediately, initializing...');
      this.setupGitListeners();
      this.refreshAllGitStatuses();
    } else {
      console.log('[GitSync] ⏳ Git API not ready or no repositories, waiting for Git to open repository...');
      
      // Setup listener for when Git opens a repository
      const setupOnRepoOpen = () => {
        const gitApi = this.resolveGitApi();
        if (gitApi && !this._gitOpenRepoListenerAttached) {
          this._gitApi = gitApi;
          this._gitOpenRepoListenerAttached = true;
          console.log('[GitSync] 👂 Listening for repository open...');
          
          this.disposables.push(
            gitApi.onDidOpenRepository((repo: any) => {
              console.log('[GitSync] 🎉 Repository opened, initializing listeners...');
              this.attachGitRepoListener(repo);
              this.updateGitStatusForRepo(repo);
            }),
          );

          // If repositories already exist, setup listeners now
          if (gitApi.repositories.length > 0) {
            console.log('[GitSync] 📦 Found existing repositories, setting up...');
            this.setupGitListeners();
            this.refreshAllGitStatuses();
          }
        }
      };

      // Try immediately
      setupOnRepoOpen();

      // Retry after delays
      setTimeout(() => {
        if (!this._gitApi || this._gitApi.repositories.length === 0) {
          console.log('[GitSync] ⏳ Retry 1: Checking Git API...');
          setupOnRepoOpen();
        }
      }, 500);

      setTimeout(() => {
        if (!this._gitApi || this._gitApi.repositories.length === 0) {
          console.log('[GitSync] ⏳ Retry 2: Checking Git API...');
          setupOnRepoOpen();
        }
      }, 2000);
    }

    console.log('[GitSync] ✅ GitSyncService activated');
    context.subscriptions.push(...this.disposables);
  }

  getGitStatus(uri: vscode.Uri): GitStatus {
    try {
      const targetPath = this.normalizeFsPath(uri.fsPath);
      if (!targetPath) { return null; }

      if (!this._gitApi) { this._gitApi = this.resolveGitApi(); }
      if (!this._gitApi || this._gitApi.repositories.length === 0) { return null; }

      console.log('[GitSync] getGitStatus called for:', path.basename(uri.fsPath));

      for (const repo of this._gitApi.repositories) {
        const repoRoot = this.normalizeFsPath(repo?.rootUri?.fsPath);
        if (!repoRoot || !this.isPathInsideRepo(targetPath, repoRoot)) { continue; }

        const mergeChanges = repo.state.mergeChanges || [];
        const hasMergeConflict = mergeChanges.some((c: any) => this.changeMatchesPath(c, targetPath));
        if (hasMergeConflict) {
          return 'conflict';
        }

        const indexChanges = repo.state.indexChanges || [];
        const indexChange = indexChanges.find((c: any) => this.changeMatchesPath(c, targetPath));

        const workingTreeChanges = repo.state.workingTreeChanges || [];
        const workingChange = workingTreeChanges.find((c: any) => this.changeMatchesPath(c, targetPath));

        const indexStatus = this.mapGitApiStatus(indexChange?.status);
        const workingStatus = this.mapGitApiStatus(workingChange?.status);

        console.log('[GitSync] Status detected -', path.basename(uri.fsPath), ':', {
          indexStatus,
          workingStatus,
          indexChangeRaw: indexChange?.status,
          workingChangeRaw: workingChange?.status
        });

        if (indexStatus === 'added' && workingStatus === 'modified') {
          console.log('[GitSync] Returning "modified" for added+modified');
          return 'modified';
        }

        const finalStatus = workingStatus ?? indexStatus ?? null;
        console.log('[GitSync] Final status for', path.basename(uri.fsPath), ':', finalStatus);
        return finalStatus;
        console.log('[GitSync] Final status for', path.basename(uri.fsPath), ':', finalStatus);
        return finalStatus;
      }
    } catch {
      // Silently fail if git is not available
    }

    return null;
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
    this._gitRepoListeners.clear();
    this._gitOpenRepoListenerAttached = false;
  }

  private resolveGitApi(): any | null {
    try {
      const ext = vscode.extensions.getExtension('vscode.git');
      const api = ext?.isActive ? ext.exports?.getAPI(1) ?? null : null;
      console.log('[GitSync] Git API resolved:', api ? '✅ Available' : '❌ Not available');
      return api;
    } catch (err) {
      console.log('[GitSync] ⚠️ Error resolving Git API:', err);
      return null;
    }
  }

  private setupGitListeners(): void {
    try {
      if (!this._gitApi) { this._gitApi = this.resolveGitApi(); }
      const gitApi = this._gitApi;
      if (!gitApi) {
        console.log('[GitSync] ⚠️ Git API not available');
        return;
      }

      console.log('[GitSync] 🔧 Setting up Git listeners, repositories found:', gitApi.repositories.length);
      for (const repo of gitApi.repositories) {
        this.attachGitRepoListener(repo);
      }

      if (!this._gitOpenRepoListenerAttached) {
        this._gitOpenRepoListenerAttached = true;
        this.disposables.push(
          gitApi.onDidOpenRepository((repo: any) => {
            this.attachGitRepoListener(repo);
            this.updateGitStatusForRepo(repo);
          }),
        );
      }
    } catch {
      // Silently fail if git setup fails
    }
  }

  private attachGitRepoListener(repo: any): void {
    const repoRoot = this.normalizeFsPath(repo?.rootUri?.fsPath);
    if (!repoRoot) {
      console.log('[GitSync] ⚠️ Cannot attach listener: invalid repo root');
      return;
    }
    if (this._gitRepoListeners.has(repoRoot)) {
      console.log('[GitSync] ℹ️ Listener already attached for:', path.basename(repoRoot));
      return;
    }

    console.log('[GitSync] ✅ Attaching listener to repo:', path.basename(repoRoot));
    this._gitRepoListeners.add(repoRoot);
    this.disposables.push(
      repo.state.onDidChange(() => {
        console.log('[GitSync] 🔄 Repo state changed:', path.basename(repoRoot));
        console.log('[GitSync] Working tree changes:', repo.state.workingTreeChanges?.length || 0);
        console.log('[GitSync] Index changes:', repo.state.indexChanges?.length || 0);
        this.updateGitStatusForRepo(repo);
      }),
    );
    console.log('[GitSync] 📊 Current repo state:', {
      workingTreeChanges: repo.state.workingTreeChanges?.length || 0,
      indexChanges: repo.state.indexChanges?.length || 0,
      mergeChanges: repo.state.mergeChanges?.length || 0
    });
  }

  private refreshAllGitStatuses(): void {
    for (const tab of this.stateService.getAllTabs()) {
      const uri = tab.metadata.uri;
      if (!uri) { continue; }

      const newGitStatus = this.getGitStatus(uri);
      if (tab.state.gitStatus !== newGitStatus) {
        console.log('[GitSync] refreshAllGitStatuses - updating:', tab.metadata.label, tab.state.gitStatus, '→', newGitStatus);
        tab.state.gitStatus = newGitStatus;
        this.stateService.updateTabStateWithAnimation(tab);
      }
    }
  }

  private updateGitStatusForRepo(repo: any): void {
    const repoRoot = this.normalizeFsPath(repo?.rootUri?.fsPath);
    if (!repoRoot) { return; }

    for (const tab of this.stateService.getAllTabs()) {
      const uri = tab.metadata.uri;
      if (!uri) { continue; }
      const targetPath = this.normalizeFsPath(uri.fsPath);
      if (!targetPath || !this.isPathInsideRepo(targetPath, repoRoot)) { continue; }

      const newGitStatus = this.getGitStatus(uri);
      console.log('[GitSync] updateGitStatusForRepo -', tab.metadata.label, ':', {
        oldStatus: tab.state.gitStatus,
        newStatus: newGitStatus,
        changed: tab.state.gitStatus !== newGitStatus
      });
      if (tab.state.gitStatus !== newGitStatus) {
        tab.state.gitStatus = newGitStatus;
        console.log('[GitSync] ✅ Updating tab state with animation for:', tab.metadata.label);
        this.stateService.updateTabStateWithAnimation(tab);
      }
    }
  }

  private mapGitApiStatus(status: number | undefined): GitStatus {
    const result = this.mapGitApiStatusInternal(status);
    console.log('[GitSync] mapGitApiStatus:', status, '→', result);
    return result;
  }

  private mapGitApiStatusInternal(status: number | undefined): GitStatus {
    switch (status) {
      case 7: return 'untracked';
      case 1:
      case 9: return 'added';
      case 0:
      case 3:
      case 4:
      case 5:
      case 10:
      case 11:
        return 'modified';
      case 2:
      case 6: return 'deleted';
      case 8: return 'ignored';
      case 12:
      case 13:
      case 14:
      case 15:
      case 16:
      case 17:
      case 18:
        return 'conflict';
      default:
        return status === undefined ? null : 'modified';
    }
  }

  private changeMatchesPath(change: any, targetPath: string): boolean {
    const current = this.normalizeFsPath(change?.uri?.fsPath);
    const original = this.normalizeFsPath(change?.originalUri?.fsPath);
    return current === targetPath || original === targetPath;
  }

  private isPathInsideRepo(filePath: string, repoRoot: string): boolean {
    return filePath === repoRoot || filePath.startsWith(`${repoRoot}${path.sep}`);
  }

  private normalizeFsPath(fsPath: string | undefined): string | null {
    if (!fsPath) { return null; }
    const normalized = path.normalize(fsPath);
    return path.sep === '\\' ? normalized.toLowerCase() : normalized;
  }
}
