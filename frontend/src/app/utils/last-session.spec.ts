import type { FileTab } from '../models/http.models';
import { buildLastSessionState, findLastSessionTargetIndex } from './last-session';

describe('last-session utils', () => {
  it('builds session state from active file', () => {
    const state = buildLastSessionState({
      id: 'id1',
      name: 'file1.http',
      content: '',
      requests: [],
      environments: {},
      variables: {},
      responseData: {},
      groups: [],
      selectedEnv: 'dev'
    } as FileTab);

    expect(state.fileId).toBe('id1');
    expect(state.fileName).toBe('file1.http');
    expect(state.selectedEnv).toBe('dev');
  });

  it('finds by id first, then name', () => {
    const files = [
      { id: 'a', name: 'a.http' } as FileTab,
      { id: 'b', name: 'b.http' } as FileTab
    ];

    expect(findLastSessionTargetIndex(files, { fileId: 'b' })).toBe(1);
    expect(findLastSessionTargetIndex(files, { fileName: 'a.http' })).toBe(0);
    expect(findLastSessionTargetIndex(files, { fileId: 'missing', fileName: 'missing.http' })).toBe(-1);
  });
});
