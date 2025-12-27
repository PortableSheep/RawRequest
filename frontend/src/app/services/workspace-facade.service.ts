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

export type WorkspaceStateUpdate = {
  files: FileTab[];
  currentFileIndex: number;
  activeFileId?: string;
  currentEnv?: string;
};

export type WorkspaceInitUpdate = WorkspaceStateUpdate & {
  shouldAddNewTab: boolean;
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
}
