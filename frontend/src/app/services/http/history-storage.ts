import { HistoryItem } from '../../models/http.models';

export type HistoryStorageBackend = {
  loadFileHistoryFromDir: (fileId: string, dir: string) => Promise<string>;
  loadFileHistoryFromRunLocation: (fileId: string) => Promise<string>;
  saveResponseFile: (filePath: string, json: string) => Promise<string>;
  saveResponseFileToRunLocation: (fileId: string, json: string) => Promise<string>;
};

export type HistoryStorageDeps = {
  backend: HistoryStorageBackend;
  dirname: (path: string) => string;
  basename: (path: string, ext?: string) => string;
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
      ? await deps.backend.loadFileHistoryFromDir(deps.basename(filePath, '.http'), deps.dirname(filePath))
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

export async function addToHistory(
  fileId: string,
  item: HistoryItem,
  filePath: string | undefined,
  deps: HistoryStorageDeps
): Promise<HistoryItem[]> {
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

  return await loadHistory(fileId, filePath, deps);
}
