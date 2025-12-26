import type { FileTab, HistoryItem } from '../../models/http.models';
import { decideHistorySyncForWorkspaceState } from './history-sync.logic';

describe('history-sync.logic', () => {
  it('returns empty history when no active file', () => {
    const files: FileTab[] = [];
    const result = decideHistorySyncForWorkspaceState({
      files,
      currentFileIndex: 0,
      getCachedHistory: () => {
        throw new Error('should not be called');
      }
    });

    expect(result).toEqual({
      activeFileId: null,
      history: [],
      shouldLoadFromBackend: false,
      fileIdToLoad: null
    });
  });

  it('uses cached history when present and does not load', () => {
    const files = [{ id: 'f1' } as any as FileTab];
    const cached: HistoryItem[] = [{ id: 'h1' } as any];

    const result = decideHistorySyncForWorkspaceState({
      files,
      currentFileIndex: 0,
      getCachedHistory: (id) => (id === 'f1' ? cached : undefined)
    });

    expect(result.activeFileId).toBe('f1');
    expect(result.history).toBe(cached);
    expect(result.shouldLoadFromBackend).toBe(false);
    expect(result.fileIdToLoad).toBe(null);
  });

  it('returns load instruction when no cached history', () => {
    const files = [{ id: 'f1' } as any as FileTab];
    const result = decideHistorySyncForWorkspaceState({
      files,
      currentFileIndex: 0,
      getCachedHistory: () => undefined
    });

    expect(result).toEqual({
      activeFileId: 'f1',
      history: [],
      shouldLoadFromBackend: true,
      fileIdToLoad: 'f1'
    });
  });
});
