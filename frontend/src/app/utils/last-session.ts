import type { FileTab } from '../models/http.models';

export interface LastSessionState {
  fileId?: string;
  fileName?: string;
  selectedEnv?: string;
}

export function buildLastSessionState(activeFile: FileTab): LastSessionState {
  return {
    fileId: activeFile.id,
    fileName: activeFile.name,
    selectedEnv: activeFile.selectedEnv || ''
  };
}

export function findLastSessionTargetIndex(files: FileTab[], session: LastSessionState): number {
  if (!session || (!session.fileId && !session.fileName)) {
    return -1;
  }
  return files.findIndex(file => file.id === session.fileId || file.name === session.fileName);
}

export function readLastSessionFromStorage(key: string): LastSessionState | null {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) {
      return null;
    }
    return JSON.parse(stored) as LastSessionState;
  } catch {
    return null;
  }
}

export function writeLastSessionToStorage(key: string, state: LastSessionState): void {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // Ignore write errors (quota, disabled storage)
  }
}

export function clearLastSessionInStorage(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore
  }
}
