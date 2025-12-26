import type { FileTab } from '../../models/http.models';
import type { ParsedHttpFile } from '../parser.service';
import {
  buildExamplesTabFromParsed,
  buildNewFileTabFromParsed,
  buildUpdatedFileTabFromParsed,
  deriveFileDisplayName
} from './file-tab-builders';

describe('workspace-facade/file-tab-builders', () => {
  it('deriveFileDisplayName prefers trimmed parsed value then fallback', () => {
    expect(deriveFileDisplayName('  My Tab  ', 'Fallback')).toBe('My Tab');
    expect(deriveFileDisplayName('   ', '  Fallback  ')).toBe('Fallback');
    expect(deriveFileDisplayName(undefined, '   ')).toBeUndefined();
  });

  it('buildNewFileTabFromParsed maps parsed fields and sets first env', () => {
    const parsed: ParsedHttpFile = {
      requests: [] as any,
      environments: { dev: { a: '1' }, prod: {} },
      variables: { x: 'y' },
      groups: ['G'],
      fileDisplayName: '  Display  '
    };

    const tab = buildNewFileTabFromParsed({
      id: 'id1',
      name: 'n',
      content: 'c',
      filePath: '/tmp/a.http',
      parsed
    });

    expect(tab.id).toBe('id1');
    expect(tab.filePath).toBe('/tmp/a.http');
    expect(tab.variables).toEqual({ x: 'y' });
    expect(tab.selectedEnv).toBe('dev');
    expect(tab.displayName).toBe('Display');
  });

  it('buildUpdatedFileTabFromParsed preserves previous fields and computes selected env', () => {
    const previous: FileTab = {
      id: 'id1',
      name: 'n',
      content: 'old',
      requests: [] as any,
      environments: { dev: {} },
      variables: {},
      responseData: {},
      groups: [],
      selectedEnv: 'prod',
      displayName: 'Old',
      filePath: '/tmp/a.http'
    };

    const parsed: ParsedHttpFile = {
      requests: [] as any,
      environments: { dev: {} },
      variables: {},
      groups: [],
      fileDisplayName: '  '
    };

    const updated = buildUpdatedFileTabFromParsed({ previousFile: previous, content: 'new', parsed });
    expect(updated.filePath).toBe('/tmp/a.http');
    expect(updated.content).toBe('new');
    expect(updated.selectedEnv).toBe('dev');
    expect(updated.displayName).toBeUndefined();
  });

  it('buildExamplesTabFromParsed uses fallback display name when missing', () => {
    const parsed: ParsedHttpFile = {
      requests: [] as any,
      environments: {},
      variables: {},
      groups: [],
      fileDisplayName: ' '
    };

    const tab = buildExamplesTabFromParsed({
      name: 'Examples.http',
      content: 'c',
      parsed,
      examplesId: '__examples__',
      defaultDisplayName: 'Examples'
    });

    expect(tab.id).toBe('__examples__');
    expect(tab.displayName).toBe('Examples');
  });
});
