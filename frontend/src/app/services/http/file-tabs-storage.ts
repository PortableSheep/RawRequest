import { FileTab } from '../../models/http.models';

export type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

export type FileTabsStorageLogger = {
  error?: (...args: any[]) => void;
  warn?: (...args: any[]) => void;
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
  const compactTabs = files.map((file) => {
    const { savedContent: _savedContent, ...rest } = file;
    return rest as FileTab;
  });

  try {
    storage.setItem(storageKey, JSON.stringify(compactTabs));
  } catch (error) {
    const isQuotaExceeded =
      typeof DOMException !== 'undefined' &&
      error instanceof DOMException &&
      (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');

    if (!isQuotaExceeded) {
      logger.error?.('Error saving files:', error);
      return;
    }

    logger.warn?.('Storage quota exceeded while saving tabs; retrying with compact payload');

    try {
      const reducedTabs = compactTabs.map((file) => ({ ...file, responseData: {} }));
      storage.setItem(storageKey, JSON.stringify(reducedTabs));
    } catch (retryError) {
      logger.error?.('Error saving files:', retryError);
    }
  }
}
