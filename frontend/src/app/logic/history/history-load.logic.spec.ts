import { decideHistoryLoadForActiveFile } from './history-load.logic';

describe('history-load.logic', () => {
  it('returns empty history when no active file', () => {
    expect(decideHistoryLoadForActiveFile({ activeFileId: null })).toEqual({
      history: [],
      shouldLoadFromBackend: false
    });
  });

  it('uses cached history when present', () => {
    const cached: any[] = [{ timestamp: new Date(), method: 'GET' }];
    expect(decideHistoryLoadForActiveFile({ activeFileId: 'f1', cachedHistory: cached as any })).toEqual({
      history: cached as any,
      shouldLoadFromBackend: false
    });
  });

  it('clears and triggers load when no cached history', () => {
    expect(decideHistoryLoadForActiveFile({ activeFileId: 'f1', cachedHistory: undefined })).toEqual({
      history: [],
      shouldLoadFromBackend: true
    });
    expect(decideHistoryLoadForActiveFile({ activeFileId: 'f1', cachedHistory: [] as any })).toEqual({
      history: [],
      shouldLoadFromBackend: true
    });
  });
});
