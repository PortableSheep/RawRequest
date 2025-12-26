import type { HistoryItem } from '../../models/http.models';

export interface HistoryLoadDecision {
  history: HistoryItem[];
  shouldLoadFromBackend: boolean;
}

export function decideHistoryLoadForActiveFile(params: {
  activeFileId: string | null;
  cachedHistory?: HistoryItem[];
}): HistoryLoadDecision {
  const { activeFileId, cachedHistory } = params;
  if (!activeFileId) {
    return { history: [], shouldLoadFromBackend: false };
  }

  if (cachedHistory && cachedHistory.length > 0) {
    return { history: cachedHistory, shouldLoadFromBackend: false };
  }

  return { history: [], shouldLoadFromBackend: true };
}
