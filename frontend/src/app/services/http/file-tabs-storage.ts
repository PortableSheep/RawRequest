import { FileTab } from '../../models/http.models';

export type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

export type FileTabsStorageLogger = {
  error?: (...args: any[]) => void;
};

export function loadFileTabsFromStorage(
  storageKey: string,
  storage: StorageLike,
  logger: FileTabsStorageLogger = {}
): FileTab[] {
  try {
    const stored = storage.getItem(storageKey);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    logger.error?.('Error loading files:', error);
  }
  return [];
}

export function saveFileTabsToStorage(
  storageKey: string,
  files: FileTab[],
  storage: StorageLike,
  logger: FileTabsStorageLogger = {}
): void {
  try {
    storage.setItem(storageKey, JSON.stringify(files));
  } catch (error) {
    logger.error?.('Error saving files:', error);
  }
}
