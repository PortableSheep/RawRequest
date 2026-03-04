import { Injectable, inject, signal, computed } from '@angular/core';
import type { FileTab, HistoryItem } from '../models/http.models';
import { generateFileId, normalizeFileTab } from '../utils/file-tab-utils';
import { WorkspaceFacadeService } from './workspace-facade.service';
import { HttpService } from './http.service';
import { HistoryStoreService } from './history-store.service';
import {
  deriveAppStateFromWorkspaceUpdate,
} from '../logic/app/workspace-update.logic';
import { decideHistorySyncForWorkspaceState } from '../logic/app/history-sync.logic';

/**
 * Centralized reactive state store for workspace data.
 * Child components inject this to access file/tab/env state
 * instead of receiving data via @Input() prop drilling.
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceStateService {
  private readonly workspace = inject(WorkspaceFacadeService);
  private readonly httpService = inject(HttpService);
  private readonly historyStore = inject(HistoryStoreService);

  readonly LAST_SESSION_KEY = 'rawrequest_last_session';

  // --- Core writable signals ---
  readonly files = signal<FileTab[]>([]);
  readonly currentFileIndex = signal<number>(0);
  readonly currentEnv = signal<string>('');
  readonly history = signal<HistoryItem[]>([]);
  readonly selectedHistoryItem = signal<HistoryItem | null>(null);

  private readonly emptyFile: FileTab = {
    id: 'empty',
    name: '',
    content: '',
    requests: [],
    environments: {},
    variables: {},
    responseData: {},
    groups: [],
    selectedEnv: '',
  };

  // --- Computed state ---
  readonly currentFileView = computed<FileTab>(() => {
    const files = this.files();
    const index = this.currentFileIndex();
    return files[index] || this.emptyFile;
  });

  readonly currentFileEnvironments = computed<string[]>(() => {
    const file = this.currentFileView();
    return Object.keys(file.environments || {});
  });

  readonly currentFileRequestNames = computed<string[]>(() => {
    const file = this.currentFileView();
    return (file.requests || []).map((r) => r.name || '');
  });

  // --- State mutations ---

  /** Apply a derived workspace state update (files, index, env). */
  applyState(next: { files: FileTab[]; currentFileIndex: number; currentEnv: string; activeFileId?: string | null }): void {
    this.files.set(next.files);
    this.currentFileIndex.set(next.currentFileIndex);
    this.currentEnv.set(next.currentEnv || '');
  }

  /** Get the current file (non-signal accessor for imperative code). */
  getCurrentFile(): FileTab {
    const files = this.files();
    const index = this.currentFileIndex();
    return files[index] || this.emptyFile;
  }

  /** Replace a single file in the files array. */
  replaceFileAtIndex(index: number, newFile: FileTab): void {
    const updated = this.workspace.replaceFileAtIndex(this.files(), index, newFile);
    this.files.set(updated);
  }

  // --- High-level workspace operations ---

  /** Load files from storage and initialize workspace. Returns true if a new tab needs to be created. */
  loadFiles(): boolean {
    const init = this.workspace.initializeFromStorage(this.LAST_SESSION_KEY);
    if (init.shouldAddNewTab) {
      this.addNewTab();
      return true;
    }

    const next = this.workspace.deriveWithEnvSync(init);
    this.applyState(next);
    this.loadHistoryForFile(next.activeFileId || undefined);
    return false;
  }

  /** Handle files changing (e.g., from request manager). */
  onFilesChange(files: FileTab[]): void {
    const normalized = this.workspace.normalizeFiles(files);
    this.files.set(normalized);

    const synced = this.workspace.syncCurrentEnvWithFile(normalized, this.currentFileIndex());
    if (synced.files !== normalized) {
      this.files.set(synced.files);
    }
    this.currentEnv.set(synced.currentEnv || '');

    const historyDecision = decideHistorySyncForWorkspaceState({
      files: this.files(),
      currentFileIndex: this.currentFileIndex(),
      getCachedHistory: (fileId) => this.historyStore.get(fileId),
    });
    this.history.set(historyDecision.history);
    if (historyDecision.fileIdToLoad) {
      this.loadHistoryForFile(historyDecision.fileIdToLoad);
    }
    this.workspace.persistSessionState(this.LAST_SESSION_KEY, this.files(), this.currentFileIndex());
  }

  /** Handle current file index changing (tab switch). */
  onCurrentFileIndexChange(index: number): void {
    this.currentFileIndex.set(index);

    const synced = this.workspace.syncCurrentEnvWithFile(this.files(), index);
    if (synced.files !== this.files()) {
      this.files.set(synced.files);
    }
    this.currentEnv.set(synced.currentEnv || '');

    const historyDecision = decideHistorySyncForWorkspaceState({
      files: this.files(),
      currentFileIndex: index,
      getCachedHistory: (fileId) => this.historyStore.get(fileId),
    });
    this.history.set(historyDecision.history);
    if (historyDecision.fileIdToLoad) {
      this.loadHistoryForFile(historyDecision.fileIdToLoad);
    }
    this.workspace.persistSessionState(this.LAST_SESSION_KEY, this.files(), this.currentFileIndex());
  }

  /** Handle environment change. */
  onCurrentEnvChange(env: string): void {
    const file = this.files()[this.currentFileIndex()];
    if (file) {
      const updatedFiles = this.workspace.replaceFileAtIndex(
        this.files(),
        this.currentFileIndex(),
        { ...file, selectedEnv: env },
      );
      this.files.set(updatedFiles);
    }
    this.currentEnv.set(env);
    this.httpService.saveFiles(this.files());
    this.workspace.persistSessionState(this.LAST_SESSION_KEY, this.files(), this.currentFileIndex());
  }

  /** Handle editor content changes with immediate raw update. */
  updateFileContent(content: string): void {
    const updated = this.workspace.updateFileContent(
      this.files(),
      this.currentFileIndex(),
      content,
    );
    this.files.set(updated.files);
    this.currentEnv.set(updated.currentEnv || '');
  }

  /** Immediately update raw content without parsing (used before debounced parse). */
  updateRawContent(content: string): void {
    const currentFile = this.files()[this.currentFileIndex()];
    if (currentFile) {
      const quickUpdate = [...this.files()];
      quickUpdate[this.currentFileIndex()] = { ...currentFile, content };
      this.files.set(quickUpdate);
      this.httpService.saveFiles(quickUpdate);
    }
  }

  /** Close a tab. */
  closeTab(index: number): void {
    const next = this.workspace.closeTabDerived(
      this.LAST_SESSION_KEY, this.files(), this.currentFileIndex(), index,
    );
    this.applyState(next);
    this.loadHistoryForFile(next.activeFileId || undefined);
  }

  /** Close all tabs except the one at keepIndex. */
  closeOtherTabs(keepIndex: number): void {
    const next = this.workspace.closeOtherTabsDerived(
      this.LAST_SESSION_KEY, this.files(), keepIndex,
    );
    this.applyState(next);
    this.loadHistoryForFile(next.activeFileId || undefined);
  }

  /** Add a new empty tab. */
  addNewTab(): void {
    const next = this.workspace.addNewTabDerived(this.LAST_SESSION_KEY, this.files());
    this.applyState(next);
    this.history.set([]);
  }

  /** Add a file from raw content (used for first-run, import). */
  addFileFromContent(fileName: string, content: string, filePath?: string): void {
    const next = this.workspace.addFileFromContentDerived(
      this.LAST_SESSION_KEY, this.files(), fileName, content, filePath,
    );
    this.applyState(next);
    this.history.set([]);
    if (next.activeFileId) {
      this.loadHistoryForFile(next.activeFileId);
    }
  }

  /** Reorder tabs via drag-and-drop. */
  reorderTabs(fromIndex: number, toIndex: number): void {
    const next = this.workspace.reorderTabsDerived(
      this.LAST_SESSION_KEY, this.files(), this.currentFileIndex(), fromIndex, toIndex,
    );
    this.applyState(next);
  }

  /** Open file(s) from disk via native dialog. Returns true if files were opened. */
  async openFilesFromDisk(): Promise<boolean> {
    const results = await this.workspace.openFilesFromDisk(
      this.LAST_SESSION_KEY, this.files(),
    );
    if (!results.length) return false;

    const lastResult = results[results.length - 1];
    this.applyState(lastResult.state);
    if (lastResult.isNewFile) {
      this.history.set([]);
    }
    this.loadHistoryForFile(lastResult.state.activeFileId || undefined);
    return true;
  }

  /** Import a Postman or Bruno collection from disk. Returns count of imported files, or 0. */
  async importCollection(type: 'postman' | 'bruno'): Promise<number> {
    const result = await this.workspace.importCollectionFromDisk(
      this.LAST_SESSION_KEY, this.files(), type,
    );
    if (!result) return 0;

    this.applyState(result.state);
    this.history.set([]);
    this.loadHistoryForFile(result.state.activeFileId || undefined);
    return result.count;
  }

  /** Open/upsert the examples tab. */
  async openExamplesFile(): Promise<void> {
    const { GetExamplesFile } = await import('@wailsjs/go/app/App');
    const result = await GetExamplesFile();
    const content = result?.content || '';
    const name = result?.filePath || 'Examples.http';

    const updated = this.workspace.upsertExamplesTab(
      this.LAST_SESSION_KEY, this.files(), content, name,
    );

    const next = deriveAppStateFromWorkspaceUpdate(updated);
    this.applyState(next);

    if (next.activeFileId === '__examples__') {
      this.history.set([]);
    }
  }

  /** Handle history updates from request execution. */
  onHistoryUpdated(event: { fileId: string; history: HistoryItem[] }): void {
    this.historyStore.set(event.fileId, event.history);
    const activeFile = this.files()[this.currentFileIndex()];
    if (activeFile && activeFile.id === event.fileId) {
      this.history.set(event.history);
    }
  }

  /** Load history for a given file ID. */
  loadHistoryForFile(fileId?: string): void {
    if (!fileId) {
      this.history.set([]);
      return;
    }

    const filePath = this.files().find((file) => file.id === fileId)?.filePath;

    const cached = this.historyStore.get(fileId);
    if (cached) {
      this.history.set(cached);
      return;
    }

    this.historyStore
      .ensureLoaded(fileId, filePath)
      .then((history) => {
        if (this.files()[this.currentFileIndex()]?.id === fileId) {
          this.history.set(history);
        }
      })
      .catch((error) =>
        console.error('Failed to load history for file', fileId, error),
      );
  }

  /** Reveal a file in the OS file manager. */
  async revealInFinder(index: number): Promise<void> {
    const file = this.files()[index];
    if (!file?.filePath) {
      throw new Error('File has not been saved to disk yet.');
    }
    const { RevealInFinder } = await import('@wailsjs/go/app/App');
    await RevealInFinder(file.filePath);
  }
}
