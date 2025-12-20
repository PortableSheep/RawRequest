import type { FileTab } from '../models/http.models';
import { normalizeFileTab } from './file-tab-utils';

describe('file-tab-utils', () => {
  it('uses filePath as id when present', () => {
    const tab = normalizeFileTab({
      id: 'temp',
      name: 'x',
      content: '',
      requests: [],
      environments: {},
      variables: {},
      responseData: {},
      groups: [],
      selectedEnv: '',
      filePath: '/tmp/test.http'
    } as FileTab);

    expect(tab.id).toBe('/tmp/test.http');
  });

  it('normalizes selectedEnv to first env if missing/invalid', () => {
    const tab = normalizeFileTab({
      id: 'a',
      name: 'x',
      content: '',
      requests: [],
      environments: { dev: {}, prod: {} } as any,
      variables: {},
      responseData: {},
      groups: [],
      selectedEnv: 'missing'
    } as FileTab);

    expect(tab.selectedEnv).toBeTruthy();
    expect(['dev', 'prod']).toContain(tab.selectedEnv as string);
  });

  it('trims displayName and converts empty to undefined', () => {
    const tab = normalizeFileTab({
      id: 'a',
      name: 'x',
      content: '',
      requests: [],
      environments: {},
      variables: {},
      responseData: {},
      groups: [],
      selectedEnv: '',
      displayName: '   '
    } as FileTab);

    expect(tab.displayName).toBeUndefined();
  });
});
