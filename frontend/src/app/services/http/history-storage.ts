import { HistoryItem } from '../../models/http.models';

export type HistoryStorageBackend = {
  loadFileHistoryFromDir: (fileId: string, dir: string) => Promise<string>;
  loadFileHistoryFromRunLocation: (fileId: string) => Promise<string>;
  saveFileHistoryToDir: (fileId: string, json: string, dir: string) => Promise<void>;
  saveFileHistoryToRunLocation: (fileId: string, json: string) => Promise<void>;
  saveResponseFile: (filePath: string, json: string) => Promise<string>;
  saveResponseFileToRunLocation: (fileId: string, json: string) => Promise<string>;
};

export type HistoryStorageDeps = {
  backend: HistoryStorageBackend;
  dirname: (path: string) => string;
  now?: () => number;
  log?: {
    error?: (...args: any[]) => void;
    warn?: (...args: any[]) => void;
    debug?: (...args: any[]) => void;
  };
};

export async function loadHistory(fileId: string, filePath: string | undefined, deps: HistoryStorageDeps): Promise<HistoryItem[]> {
  if (!fileId) {
    return [];
  }

  try {
    const stored = filePath
      ? await deps.backend.loadFileHistoryFromDir(fileId, deps.dirname(filePath))
      : await deps.backend.loadFileHistoryFromRunLocation(fileId);
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed.map((item: any) => ({
        ...item,
        timestamp: new Date(item.timestamp)
      }));
    }
  } catch (error) {
    deps.log?.error?.('Error loading history for file', fileId, error);
  }

  return [];
}

export async function saveHistorySnapshot(
  fileId: string,
  history: HistoryItem[],
  filePath: string | undefined,
  deps: HistoryStorageDeps
): Promise<void> {
  if (!fileId) return;
  const json = JSON.stringify(history || []);
  try {
    if (filePath) {
      await deps.backend.saveFileHistoryToDir(fileId, json, deps.dirname(filePath));
    } else {
      await deps.backend.saveFileHistoryToRunLocation(fileId, json);
    }
  } catch (error) {
    deps.log?.error?.('Error saving history snapshot for file', fileId, error);
  }
}

export async function addToHistory(
  fileId: string,
  item: HistoryItem,
  filePath: string | undefined,
  maxItems: number,
  deps: HistoryStorageDeps
): Promise<HistoryItem[]> {
  const history = await loadHistory(fileId, filePath, deps);
  history.unshift(item);
  if (history.length > maxItems) {
    history.splice(maxItems);
  }

  try {
    if (filePath) {
      await deps.backend.saveFileHistoryToDir(fileId, JSON.stringify(history), deps.dirname(filePath));
    } else {
      await deps.backend.saveFileHistoryToRunLocation(fileId, JSON.stringify(history));
    }
  } catch (error) {
    deps.log?.error?.('Error saving history for file', fileId, error);
  }

  // If a file path was provided (file saved on disk), also save the response payload alongside the http file.
  try {
    if (filePath) {
      const saved = await deps.backend.saveResponseFile(filePath, JSON.stringify(item.responseData, null, 2));
      deps.log?.debug?.('[HTTP Service] Saved response to', saved);
    } else {
      const saved = await deps.backend.saveResponseFileToRunLocation(fileId, JSON.stringify(item.responseData, null, 2));
      deps.log?.debug?.('[HTTP Service] Saved response to', saved);
    }
  } catch (err) {
    deps.log?.warn?.('Failed to save response file:', err);
  }

  return history;
}
