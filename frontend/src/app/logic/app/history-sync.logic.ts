import type { FileTab, HistoryItem } from '../../models/http.models';
import { decideHistoryLoadForActiveFile } from '../history/history-load.logic';

export type HistoryStoreGetFn = (fileId: string) => HistoryItem[] | undefined;

export function decideHistorySyncForWorkspaceState(args: {
  files: FileTab[];
  currentFileIndex: number;
  getCachedHistory: HistoryStoreGetFn;
}): {
  activeFileId: string | null;
  history: HistoryItem[];
  shouldLoadFromBackend: boolean;
  fileIdToLoad: string | null;
} {
  const activeFile = args.files[args.currentFileIndex];
  const activeFileId = activeFile?.id ?? null;
  const cachedHistory = activeFileId ? args.getCachedHistory(activeFileId) : undefined;

  const decision = decideHistoryLoadForActiveFile({ activeFileId, cachedHistory });
  return {
    activeFileId,
    history: decision.history,
    shouldLoadFromBackend: decision.shouldLoadFromBackend,
    fileIdToLoad: decision.shouldLoadFromBackend && activeFileId ? activeFileId : null
  };
}
