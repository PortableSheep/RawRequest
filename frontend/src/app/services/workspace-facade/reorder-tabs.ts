import type { FileTab } from '../../models/http.models';

export type ReorderTabsResult = {
  files: FileTab[];
  currentFileIndex: number;
  activeFileId?: string;
};

export function reorderTabsPure(
  files: FileTab[],
  currentFileIndex: number,
  fromIndex: number,
  toIndex: number
): ReorderTabsResult {
  const filesLength = files.length;
  if (!filesLength) {
    return { files, currentFileIndex };
  }

  const safeFromIndex = Math.max(0, Math.min(filesLength - 1, fromIndex));
  const safeToIndex = Math.max(0, Math.min(filesLength - 1, toIndex));
  const activeFileId = files[currentFileIndex]?.id;

  if (safeFromIndex === safeToIndex) {
    return { files, currentFileIndex, activeFileId };
  }

  const reordered = [...files];
  const [moved] = reordered.splice(safeFromIndex, 1);
  reordered.splice(safeToIndex, 0, moved);

  let nextCurrentIndex = currentFileIndex;
  if (activeFileId) {
    const idx = reordered.findIndex(file => file.id === activeFileId);
    if (idx !== -1) {
      nextCurrentIndex = idx;
    }
  }

  return { files: reordered, currentFileIndex: nextCurrentIndex, activeFileId };
}
