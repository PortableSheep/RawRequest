import { parseSplitWidthPx } from '../app/app.component.logic';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function readSplitWidthPxFromStorage(storage: StorageLike, key: string): number | null {
  try {
    const raw = storage.getItem(key);
    return parseSplitWidthPx(raw);
  } catch {
    return null;
  }
}

export function writeSplitWidthPxToStorage(storage: StorageLike, key: string, widthPx: number): void {
  try {
    storage.setItem(key, String(widthPx));
  } catch {
    // ignore (quota, disabled storage)
  }
}
