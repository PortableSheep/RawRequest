import { Injectable, inject } from '@angular/core';
import type { FileTab } from '../models/http.models';
import { ParserService } from './parser.service';
import { HttpService } from './http.service';
import { HistoryStoreService } from './history-store.service';
import { generateFileId, normalizeFileTab } from '../utils/file-tab-utils';
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

@Injectable({ providedIn: 'root' })
export class WorkspaceFacadeService {
  private readonly http = inject(HttpService);
  private readonly parser = inject(ParserService);
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

      const newFile: FileTab = {
        id: generateFileId(),
        name: 'Untitled-1.http',
        content: '',
        requests: [],
        environments: {},
        variables: {},
        responseData: {},
        groups: [],
        selectedEnv: ''
      };

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

    let nextCurrentIndex = currentFileIndex;
    if (nextCurrentIndex >= nextFiles.length) {
      nextCurrentIndex = nextFiles.length - 1;
    } else if (nextCurrentIndex > index) {
      nextCurrentIndex--;
    }

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
    const newFile: FileTab = {
      id: generateFileId(),
      name: `Untitled-${files.length + 1}.http`,
      content: '',
      requests: [],
      environments: {},
      variables: {},
      responseData: {},
      groups: [],
      selectedEnv: ''
    };

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
    const parsed = this.parser.parseHttpFile(content);
    const envNames = Object.keys(parsed.environments || {});
    const fileDisplayName = parsed.fileDisplayName?.trim() || undefined;

    const newFile: FileTab = {
      id: filePath && filePath.length ? filePath : generateFileId(),
      name: fileName,
      content,
      requests: parsed.requests,
      environments: parsed.environments,
      variables: parsed.variables,
      responseData: {},
      groups: parsed.groups,
      selectedEnv: envNames[0] || '',
      displayName: fileDisplayName,
      filePath
    };

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
    const filesLength = files.length;
    if (!filesLength) {
      return { files, currentFileIndex };
    }

    const safeFromIndex = Math.max(0, Math.min(filesLength - 1, fromIndex));
    const safeToIndex = Math.max(0, Math.min(filesLength - 1, toIndex));
    if (safeFromIndex === safeToIndex) {
      return { files, currentFileIndex, activeFileId: files[currentFileIndex]?.id };
    }

    const reordered = [...files];
    const [moved] = reordered.splice(safeFromIndex, 1);
    reordered.splice(safeToIndex, 0, moved);

    const activeFileId = files[currentFileIndex]?.id;
    let nextCurrentIndex = currentFileIndex;
    if (activeFileId) {
      const idx = reordered.findIndex(file => file.id === activeFileId);
      if (idx !== -1) {
        nextCurrentIndex = idx;
      }
    }

    this.http.saveFiles(reordered);
    this.persistSessionState(lastSessionKey, reordered, nextCurrentIndex);

    return { files: reordered, currentFileIndex: nextCurrentIndex, activeFileId };
  }

  updateFileContent(files: FileTab[], fileIndex: number, content: string): WorkspaceStateUpdate {
    const previousFile = files[fileIndex];
    if (!previousFile) {
      return { files, currentFileIndex: fileIndex };
    }

    const parsed = this.parser.parseHttpFile(content);
    const fileDisplayName = parsed.fileDisplayName?.trim() || undefined;

    const envNames = Object.keys(parsed.environments || {});
    let selectedEnv = previousFile.selectedEnv || '';
    if (selectedEnv && !envNames.includes(selectedEnv)) {
      selectedEnv = envNames[0] || '';
    } else if (!selectedEnv && envNames.length > 0) {
      selectedEnv = envNames[0];
    }

    const updatedFile: FileTab = {
      ...previousFile,
      content,
      requests: parsed.requests,
      environments: parsed.environments,
      variables: parsed.variables,
      groups: parsed.groups,
      selectedEnv,
      displayName: fileDisplayName
    };

    const updatedFiles = [...files];
    updatedFiles[fileIndex] = updatedFile;
    this.http.saveFiles(updatedFiles);

    return {
      files: updatedFiles,
      currentFileIndex: fileIndex,
      activeFileId: updatedFile.id,
      currentEnv: selectedEnv
    };
  }

  upsertExamplesTab(lastSessionKey: string, files: FileTab[], content: string, name: string): WorkspaceStateUpdate {
    const parsed = this.parser.parseHttpFile(content);
    const envNames = Object.keys(parsed.environments || {});
    const fileDisplayName = parsed.fileDisplayName?.trim() || 'Examples';
    const examplesId = '__examples__';

    const examplesTab: FileTab = normalizeFileTab({
      id: examplesId,
      name,
      content,
      requests: parsed.requests,
      environments: parsed.environments,
      variables: parsed.variables,
      responseData: {},
      groups: parsed.groups,
      selectedEnv: envNames[0] || '',
      displayName: fileDisplayName
    } as any);

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
