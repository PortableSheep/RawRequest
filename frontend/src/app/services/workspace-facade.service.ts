import { Injectable, inject } from '@angular/core';
import type { FileTab } from '../models/http.models';
import { HttpService } from './http.service';
import { HistoryStoreService } from './history-store.service';
import { parseHttpFile } from './parser/parse-http-file';
import { generateFileId, normalizeFileTab } from '../utils/file-tab-utils';
import { createNewUntitledTab } from './workspace-facade/tab-factories';
import { computeSelectedEnvAfterParse, deriveNextCurrentIndexAfterClose } from './workspace-facade/tab-selection';
import { reorderTabsPure } from './workspace-facade/reorder-tabs';
import { buildExamplesTabFromParsed, buildNewFileTabFromParsed, buildUpdatedFileTabFromParsed } from './workspace-facade/file-tab-builders';
import {
  buildLastSessionState,
  clearLastSessionInStorage,
  findLastSessionTargetIndex,
  readLastSessionFromStorage,
  writeLastSessionToStorage
} from '../utils/last-session';
import {
  deriveAppStateAfterWorkspaceUpdateWithEnvSync,
  deriveAppStateFromWorkspaceUpdate,
  type DerivedAppStateFromWorkspaceUpdate
} from '../logic/app/workspace-update.logic';
import { findExistingOpenFileIndex } from '../logic/app/app.component.logic';
import { basename } from '../utils/path';

export type WorkspaceStateUpdate = {
  files: FileTab[];
  currentFileIndex: number;
  activeFileId?: string;
  currentEnv?: string;
};

export type WorkspaceInitUpdate = WorkspaceStateUpdate & {
  shouldAddNewTab: boolean;
};

export type OpenFileResult = {
  state: DerivedAppStateFromWorkspaceUpdate;
  isNewFile: boolean;
};

export type ImportCollectionResult = {
  state: DerivedAppStateFromWorkspaceUpdate;
  count: number;
};

@Injectable({ providedIn: 'root' })
export class WorkspaceFacadeService {
  private readonly http = inject(HttpService);
  private readonly historyStore = inject(HistoryStoreService);

  normalizeFiles(files: FileTab[]): FileTab[] {
    return files.map(file => normalizeFileTab(file));
  }

  loadFromStorage(lastSessionKey: string): WorkspaceStateUpdate {
    const savedFiles = this.http.loadFiles();
    if (!savedFiles.length) {
      return { files: [], currentFileIndex: 0 };
    }

    const normalized = savedFiles.map(file => normalizeFileTab(file));

    let currentFileIndex = 0;
    const session = readLastSessionFromStorage(lastSessionKey);
    if (session) {
      const targetIndex = findLastSessionTargetIndex(normalized, session);
      if (targetIndex >= 0) {
        currentFileIndex = targetIndex;
        if (session.selectedEnv && normalized[targetIndex]?.selectedEnv !== session.selectedEnv) {
          const updated = [...normalized];
          updated[targetIndex] = { ...updated[targetIndex], selectedEnv: session.selectedEnv };
          return { files: updated, currentFileIndex };
        }
      }
    }

    return { files: normalized, currentFileIndex };
  }

  initializeFromStorage(lastSessionKey: string): WorkspaceInitUpdate {
    const initial = this.loadFromStorage(lastSessionKey);
    if (!initial.files.length) {
      return { files: [], currentFileIndex: 0, shouldAddNewTab: true };
    }

    const synced = this.syncCurrentEnvWithFile(initial.files, initial.currentFileIndex);
    this.persistSessionState(lastSessionKey, synced.files, synced.currentFileIndex);

    return { ...synced, shouldAddNewTab: false };
  }

  persistSessionState(lastSessionKey: string, files: FileTab[], currentFileIndex: number): void {
    const activeFile = files[currentFileIndex];
    if (!activeFile) {
      clearLastSessionInStorage(lastSessionKey);
      return;
    }

    writeLastSessionToStorage(lastSessionKey, buildLastSessionState(activeFile));
  }

  syncCurrentEnvWithFile(files: FileTab[], index: number): WorkspaceStateUpdate {
    const file = files[index];
    if (!file) {
      return { files, currentFileIndex: index, currentEnv: '' };
    }

    const normalized = normalizeFileTab(file);
    if (normalized !== file) {
      const updated = [...files];
      updated[index] = normalized;
      return {
        files: updated,
        currentFileIndex: index,
        currentEnv: normalized.selectedEnv || '',
        activeFileId: normalized.id
      };
    }

    return { files, currentFileIndex: index, currentEnv: normalized.selectedEnv || '', activeFileId: normalized.id };
  }

  replaceFileAtIndex(files: FileTab[], index: number, newFile: FileTab): FileTab[] {
    const updated = [...files];
    updated[index] = newFile;
    return updated;
  }

  closeTab(lastSessionKey: string, files: FileTab[], currentFileIndex: number, index: number): WorkspaceStateUpdate {
    if (files.length <= 1) {
      const removedFile = files[index] ?? files[currentFileIndex];
      if (removedFile) {
        this.historyStore.delete(removedFile.id);
      }

      const newFile = createNewUntitledTab(generateFileId, 1);

      const normalizedFile = normalizeFileTab(newFile);
      const nextFiles = [normalizedFile];

      this.historyStore.set(normalizedFile.id, []);
      this.http.saveFiles(nextFiles);
      this.persistSessionState(lastSessionKey, nextFiles, 0);

      return { files: nextFiles, currentFileIndex: 0, activeFileId: normalizedFile.id, currentEnv: '' };
    }

    const removedFile = files[index];
    if (removedFile) {
      this.historyStore.delete(removedFile.id);
    }

    const nextFiles = files.filter((_, i) => i !== index);

    const nextCurrentIndex = deriveNextCurrentIndexAfterClose(currentFileIndex, index, nextFiles.length);

    this.http.saveFiles(nextFiles);
    this.persistSessionState(lastSessionKey, nextFiles, nextCurrentIndex);

    return { files: nextFiles, currentFileIndex: nextCurrentIndex, activeFileId: nextFiles[nextCurrentIndex]?.id };
  }

  closeOtherTabs(lastSessionKey: string, files: FileTab[], keepIndex: number): WorkspaceStateUpdate {
    if (files.length <= 1) {
      return { files, currentFileIndex: 0, activeFileId: files[0]?.id };
    }

    const fileToKeep = files[keepIndex];
    if (!fileToKeep) {
      return { files, currentFileIndex: 0, activeFileId: files[0]?.id };
    }

    files.forEach((file, i) => {
      if (i !== keepIndex && file) {
        this.historyStore.delete(file.id);
      }
    });

    const nextFiles = [fileToKeep];
    this.http.saveFiles(nextFiles);
    this.persistSessionState(lastSessionKey, nextFiles, 0);

    return { files: nextFiles, currentFileIndex: 0, activeFileId: fileToKeep.id };
  }

  addNewTab(lastSessionKey: string, files: FileTab[]): WorkspaceStateUpdate {
    const newFile = createNewUntitledTab(generateFileId, files.length + 1);

    const normalizedFile = normalizeFileTab(newFile);
    const nextFiles = [...files, normalizedFile];
    const nextCurrentIndex = nextFiles.length - 1;

    this.historyStore.set(normalizedFile.id, []);
    this.http.saveFiles(nextFiles);
    this.persistSessionState(lastSessionKey, nextFiles, nextCurrentIndex);

    return { files: nextFiles, currentFileIndex: nextCurrentIndex, activeFileId: normalizedFile.id, currentEnv: '' };
  }

  addFileFromContent(
    lastSessionKey: string,
    files: FileTab[],
    fileName: string,
    content: string,
    filePath?: string
  ): WorkspaceStateUpdate {
    const parsed = parseHttpFile(content);
    const newFile = buildNewFileTabFromParsed({
      id: filePath && filePath.length ? filePath : generateFileId(),
      name: fileName,
      content,
      filePath,
      parsed
    });

    const normalizedFile = normalizeFileTab(newFile);
    const nextFiles = [...files, normalizedFile];
    const nextCurrentIndex = nextFiles.length - 1;

    this.historyStore.set(normalizedFile.id, []);
    this.http.saveFiles(nextFiles);
    this.persistSessionState(lastSessionKey, nextFiles, nextCurrentIndex);

    return {
      files: nextFiles,
      currentFileIndex: nextCurrentIndex,
      activeFileId: normalizedFile.id,
      currentEnv: normalizedFile.selectedEnv || ''
    };
  }

  reorderTabs(lastSessionKey: string, files: FileTab[], currentFileIndex: number, fromIndex: number, toIndex: number): WorkspaceStateUpdate {
    const result = reorderTabsPure(files, currentFileIndex, fromIndex, toIndex);
    this.http.saveFiles(result.files);
    this.persistSessionState(lastSessionKey, result.files, result.currentFileIndex);
    return result;
  }

  updateFileContent(files: FileTab[], fileIndex: number, content: string): WorkspaceStateUpdate {
    const previousFile = files[fileIndex];
    if (!previousFile) {
      return { files, currentFileIndex: fileIndex };
    }

    const parsed = parseHttpFile(content);
    const updatedFile = buildUpdatedFileTabFromParsed({ previousFile, content, parsed });

    const updatedFiles = [...files];
    updatedFiles[fileIndex] = updatedFile;
    this.http.saveFiles(updatedFiles);

    return {
      files: updatedFiles,
      currentFileIndex: fileIndex,
      activeFileId: updatedFile.id,
      currentEnv: updatedFile.selectedEnv || ''
    };
  }

  upsertExamplesTab(lastSessionKey: string, files: FileTab[], content: string, name: string): WorkspaceStateUpdate {
    const parsed = parseHttpFile(content);
    const examplesId = '__examples__';

    const examplesTab: FileTab = normalizeFileTab(
      buildExamplesTabFromParsed({
        name,
        content,
        parsed,
        examplesId,
        defaultDisplayName: 'Examples'
      }) as any
    );

    const existingIndex = files.findIndex(file => file.id === examplesId);
    const nextFiles = existingIndex >= 0
      ? this.replaceFileAtIndex(files, existingIndex, examplesTab)
      : [...files, examplesTab];

    const nextCurrentIndex = existingIndex >= 0 ? existingIndex : nextFiles.length - 1;

    this.historyStore.set(examplesId, []);
    this.http.saveFiles(nextFiles);
    this.persistSessionState(lastSessionKey, nextFiles, nextCurrentIndex);

    return {
      files: nextFiles,
      currentFileIndex: nextCurrentIndex,
      activeFileId: examplesId,
      currentEnv: examplesTab.selectedEnv || ''
    };
  }

  // --- Higher-level methods that combine workspace operations with env sync / derive ---

  deriveWithEnvSync(update: WorkspaceStateUpdate): DerivedAppStateFromWorkspaceUpdate {
    return deriveAppStateAfterWorkspaceUpdateWithEnvSync({
      update,
      syncCurrentEnvWithFile: (files, idx) => this.syncCurrentEnvWithFile(files, idx),
    });
  }

  closeTabDerived(lastSessionKey: string, files: FileTab[], currentFileIndex: number, index: number): DerivedAppStateFromWorkspaceUpdate {
    return this.deriveWithEnvSync(this.closeTab(lastSessionKey, files, currentFileIndex, index));
  }

  closeOtherTabsDerived(lastSessionKey: string, files: FileTab[], keepIndex: number): DerivedAppStateFromWorkspaceUpdate {
    return this.deriveWithEnvSync(this.closeOtherTabs(lastSessionKey, files, keepIndex));
  }

  addNewTabDerived(lastSessionKey: string, files: FileTab[]): DerivedAppStateFromWorkspaceUpdate {
    return this.deriveWithEnvSync(this.addNewTab(lastSessionKey, files));
  }

  addFileFromContentDerived(lastSessionKey: string, files: FileTab[], fileName: string, content: string, filePath?: string): DerivedAppStateFromWorkspaceUpdate {
    return deriveAppStateFromWorkspaceUpdate(this.addFileFromContent(lastSessionKey, files, fileName, content, filePath));
  }

  reorderTabsDerived(lastSessionKey: string, files: FileTab[], currentFileIndex: number, fromIndex: number, toIndex: number): DerivedAppStateFromWorkspaceUpdate {
    return deriveAppStateFromWorkspaceUpdate(this.reorderTabs(lastSessionKey, files, currentFileIndex, fromIndex, toIndex));
  }

  switchToFileDerived(files: FileTab[], index: number): DerivedAppStateFromWorkspaceUpdate {
    return deriveAppStateFromWorkspaceUpdate(this.syncCurrentEnvWithFile(files, index));
  }

  // --- Async I/O methods for file/import dialogs ---

  async openFilesFromDisk(lastSessionKey: string, files: FileTab[]): Promise<OpenFileResult[]> {
    const { OpenFileDialog, ReadFileContents } = await import('@wailsjs/go/main/App');
    const filePaths = await OpenFileDialog();
    if (!filePaths?.length) return [];

    let currentFiles = files;
    const results: OpenFileResult[] = [];

    for (const filePath of filePaths) {
      const existingIndex = findExistingOpenFileIndex(currentFiles, filePath);
      if (existingIndex >= 0) {
        const state = this.switchToFileDerived(currentFiles, existingIndex);
        results.push({ state, isNewFile: false });
        currentFiles = state.files;
        continue;
      }
      const content = await ReadFileContents(filePath);
      const fileName = basename(filePath) || 'Untitled.http';
      const state = this.addFileFromContentDerived(lastSessionKey, currentFiles, fileName, content, filePath);
      results.push({ state, isNewFile: true });
      currentFiles = state.files;
    }

    return results;
  }

  async importCollectionFromDisk(
    lastSessionKey: string,
    files: FileTab[],
    type: 'postman' | 'bruno'
  ): Promise<ImportCollectionResult | null> {
    let importPath: string;
    if (type === 'postman') {
      const { OpenImportFileDialog } = await import('@wailsjs/go/main/App');
      importPath = await OpenImportFileDialog();
    } else {
      const { OpenImportDirectoryDialog } = await import('@wailsjs/go/main/App');
      importPath = await OpenImportDirectoryDialog();
    }
    if (!importPath) return null;

    const { ImportFromPath } = await import('@wailsjs/go/main/App');
    const result = await ImportFromPath(importPath);
    if (!result?.Files?.length) return null;

    let currentFiles = files;
    let latestState: DerivedAppStateFromWorkspaceUpdate | null = null;

    for (const file of result.Files) {
      latestState = this.addFileFromContentDerived(lastSessionKey, currentFiles, file.Name, file.Content);
      currentFiles = latestState.files;
    }

    return latestState ? { state: latestState, count: result.Files.length } : null;
  }
}
