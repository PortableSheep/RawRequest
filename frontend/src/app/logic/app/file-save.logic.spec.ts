import type { FileTab, HistoryItem } from '../../models/http.models';
import {
  buildFileAfterSave,
  buildFirstSaveDefaultName,
  buildSaveAsDefaultName,
  decideFirstSaveHistoryMigration,
  decideSaveAsHistoryMigration
} from './file-save.logic';

describe('file-save.logic', () => {
  it('buildFirstSaveDefaultName prefers name then displayName', () => {
    expect(buildFirstSaveDefaultName({ name: 'a.http', displayName: 'x' })).toBe('a.http');
    expect(buildFirstSaveDefaultName({ name: '', displayName: 'x.http' })).toBe('x.http');
    expect(buildFirstSaveDefaultName({ name: '' })).toBe('untitled.http');
  });

  it('buildSaveAsDefaultName uses basename fallback chain', () => {
    expect(buildSaveAsDefaultName({ filePath: '/tmp/a.http' })).toBe('a.http');
    expect(buildSaveAsDefaultName({ filePath: '', name: 'b.http' })).toBe('b.http');
    expect(buildSaveAsDefaultName({ name: '', displayName: 'c.http' })).toBe('c.http');
    expect(buildSaveAsDefaultName({})).toBe('untitled.http');
  });

  it('buildFileAfterSave updates id, filePath, and name', () => {
    const file = {
      id: 'temp',
      name: 'temp.http',
      content: 'GET https://example.com',
      requests: [],
      environments: {},
      variables: {},
      responseData: {},
      groups: [],
      selectedEnv: ''
    } as unknown as FileTab;

    const updated = buildFileAfterSave(file, '/Users/me/test.http');
    expect(updated.filePath).toBe('/Users/me/test.http');
    expect(updated.id).toBe('/Users/me/test.http');
    expect(updated.name).toBe('test.http');
  });

  it('decideFirstSaveHistoryMigration only migrates non-empty history', () => {
    const previousId = 'temp';
    const newId = '/Users/me/test.http';

    expect(
      decideFirstSaveHistoryMigration({ previousId, newId, priorHistory: [], activeFileId: newId })
    ).toEqual({ shouldMigrate: false });

    const history: HistoryItem[] = [{ id: 'h1' } as any];
    expect(
      decideFirstSaveHistoryMigration({ previousId, newId, priorHistory: history, activeFileId: newId })
    ).toEqual({
      shouldMigrate: true,
      oldId: previousId,
      newId,
      newHistory: history,
      activeHistory: history
    });

    expect(
      decideFirstSaveHistoryMigration({ previousId, newId, priorHistory: history, activeFileId: 'other' })
    ).toEqual({
      shouldMigrate: true,
      oldId: previousId,
      newId,
      newHistory: history,
      activeHistory: null
    });
  });

  it('decideSaveAsHistoryMigration always returns a patch (empty history allowed)', () => {
    const previousId = 'old';
    const newId = 'new';

    expect(decideSaveAsHistoryMigration({ previousId, newId, priorHistory: undefined, activeFileId: newId })).toEqual({
      oldId: previousId,
      newId,
      newHistory: [],
      activeHistory: []
    });
  });
});
