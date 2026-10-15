import { describe, expect, it } from 'vitest';
import {
  fileBaseName,
  fileScopedEnv,
  isFileScopedEnv,
  parseFileScopedEnv,
  secretLookupChain,
} from './secret-scope.logic';

describe('secret-scope.logic', () => {
  it('builds file scoped env buckets', () => {
    expect(fileScopedEnv('/a/b.http', 'dev')).toBe('@file:dev:/a/b.http');
    expect(fileScopedEnv('/a/b.http', '')).toBe('@file:default:/a/b.http');
    expect(fileScopedEnv('', 'dev')).toBe('');
  });

  it('parses file scoped env buckets including windows paths', () => {
    expect(parseFileScopedEnv('@file:dev:/a/b.http')).toEqual({ env: 'dev', filePath: '/a/b.http' });
    expect(parseFileScopedEnv('@file:default:C:\\x\\y.http')).toEqual({ env: 'default', filePath: 'C:\\x\\y.http' });
    expect(parseFileScopedEnv('dev')).toBeNull();
    expect(parseFileScopedEnv('@file:dev:')).toBeNull();
    expect(isFileScopedEnv('@file:dev:/a')).toBe(true);
  });

  it('produces deduplicated lookup chain', () => {
    expect(secretLookupChain('/a.http', 'dev')).toEqual([
      '@file:dev:/a.http',
      '@file:default:/a.http',
      'dev',
      'default',
    ]);
    expect(secretLookupChain('/a.http', 'default')).toEqual(['@file:default:/a.http', 'default']);
    expect(secretLookupChain(undefined, 'dev')).toEqual(['dev', 'default']);
  });

  it('extracts base names', () => {
    expect(fileBaseName('/a/b/c.http')).toBe('c.http');
    expect(fileBaseName('C:\\a\\c.http')).toBe('c.http');
  });
});
