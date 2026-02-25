import { buildVarCompletions, VarCompletionItem } from './editor.autocomplete';

describe('buildVarCompletions', () => {
  function call(params: Partial<Parameters<typeof buildVarCompletions>[0]> = {}): VarCompletionItem[] {
    return buildVarCompletions({
      vars: {},
      envs: {},
      currentEnv: '',
      requestNames: [],
      ...params
    });
  }

  function labels(items: VarCompletionItem[]): string[] {
    return items.map(i => i.label);
  }

  // ── Variable completions ────────────────────────────────────────────

  it('returns completions for plain variables', () => {
    const result = call({ vars: { token: 'abc123', host: 'localhost' } });
    expect(labels(result)).toEqual(expect.arrayContaining(['token', 'host']));
    const tokenItem = result.find(r => r.label === 'token')!;
    expect(tokenItem.detail).toBe('abc123');
    expect(tokenItem.apply).toBe('token}}');
    expect(tokenItem.type).toBe('variable');
  });

  it('truncates long variable values to 30 chars in detail', () => {
    const longVal = 'a'.repeat(50);
    const result = call({ vars: { key: longVal } });
    expect(result[0].detail).toBe('a'.repeat(30));
  });

  it('returns empty array when no vars, envs, or request names', () => {
    expect(call()).toEqual([]);
  });

  // ── Environment variable completions ────────────────────────────────

  it('uses bare key names for env var completions (not env.name.key)', () => {
    const result = call({
      envs: { dev: { baseUrl: 'http://dev.example.com' } },
      currentEnv: 'dev'
    });
    expect(labels(result)).toContain('baseUrl');
    expect(labels(result)).not.toContain('env.dev.baseUrl');
    expect(result.find(r => r.label === 'baseUrl')!.apply).toBe('baseUrl}}');
  });

  it('shows current env value in detail', () => {
    const result = call({
      envs: {
        dev: { baseUrl: 'http://dev.example.com' },
        prod: { baseUrl: 'http://prod.example.com' }
      },
      currentEnv: 'dev'
    });
    const item = result.find(r => r.label === 'baseUrl')!;
    expect(item.detail).toBe('http://dev.example.com');
  });

  it('falls back to another env value when key missing in current env', () => {
    const result = call({
      envs: {
        dev: { baseUrl: 'http://dev.example.com' },
        staging: { apiKey: 'stg-key-123' }
      },
      currentEnv: 'dev'
    });
    const item = result.find(r => r.label === 'apiKey')!;
    expect(item.detail).toBe('stg-key-123');
  });

  it('skips env keys that already exist in vars (deduplication)', () => {
    const result = call({
      vars: { baseUrl: 'override-value' },
      envs: { dev: { baseUrl: 'http://dev.example.com', port: '3000' } },
      currentEnv: 'dev'
    });
    // baseUrl comes from vars, not duplicated from envs
    const baseUrlItems = result.filter(r => r.label === 'baseUrl');
    expect(baseUrlItems).toHaveLength(1);
    expect(baseUrlItems[0].detail).toBe('override-value');
    // port only from envs
    expect(labels(result)).toContain('port');
  });

  it('deduplicates keys from multiple environments', () => {
    const result = call({
      envs: {
        dev: { baseUrl: 'http://dev.example.com', debug: 'true' },
        staging: { baseUrl: 'http://staging.example.com', region: 'us-east' },
        prod: { baseUrl: 'http://prod.example.com' }
      },
      currentEnv: 'dev'
    });
    const baseUrlItems = result.filter(r => r.label === 'baseUrl');
    expect(baseUrlItems).toHaveLength(1);
    expect(baseUrlItems[0].detail).toBe('http://dev.example.com');

    expect(labels(result)).toContain('debug');
    expect(labels(result)).toContain('region');
  });

  it('handles empty current env gracefully', () => {
    const result = call({
      envs: { dev: { baseUrl: 'http://dev.example.com' } },
      currentEnv: ''
    });
    const item = result.find(r => r.label === 'baseUrl')!;
    // Falls back to first env that has the key
    expect(item.detail).toBe('http://dev.example.com');
  });

  it('handles current env that does not exist in envs', () => {
    const result = call({
      envs: { dev: { baseUrl: 'http://dev.example.com' } },
      currentEnv: 'nonexistent'
    });
    const item = result.find(r => r.label === 'baseUrl')!;
    expect(item.detail).toBe('http://dev.example.com');
  });

  // ── Request reference completions ───────────────────────────────────

  it('adds body and status references per request name', () => {
    const result = call({ requestNames: ['login', 'getProfile'] });
    expect(labels(result)).toContain('request1.response.body');
    expect(labels(result)).toContain('request1.response.status');
    expect(labels(result)).toContain('request2.response.body');
    expect(labels(result)).toContain('request2.response.status');
  });

  it('shows request name in detail for references', () => {
    const result = call({ requestNames: ['login'] });
    const item = result.find(r => r.label === 'request1.response.body')!;
    expect(item.detail).toBe('login');
    expect(item.type).toBe('function');
    expect(item.apply).toBe('request1.response.body}}');
  });

  // ── Mixed scenarios ─────────────────────────────────────────────────

  it('returns vars, env vars, and request refs together', () => {
    const result = call({
      vars: { token: 'abc' },
      envs: { dev: { baseUrl: 'http://dev' } },
      currentEnv: 'dev',
      requestNames: ['login']
    });
    expect(labels(result)).toEqual([
      'token',
      'baseUrl',
      'request1.response.body',
      'request1.response.status'
    ]);
  });

  // ── closeSuffix behavior (auto-close brace handling) ─────────────────

  it('omits closing braces in apply when closeSuffix is empty', () => {
    const result = call({
      vars: { token: 'abc123' },
      closeSuffix: ''
    });
    const item = result.find(r => r.label === 'token')!;
    expect(item.apply).toBe('token');
  });

  it('omits closing braces for env vars when closeSuffix is empty', () => {
    const result = call({
      envs: { dev: { baseUrl: 'http://dev' } },
      currentEnv: 'dev',
      closeSuffix: ''
    });
    const item = result.find(r => r.label === 'baseUrl')!;
    expect(item.apply).toBe('baseUrl');
  });

  it('omits closing braces for request refs when closeSuffix is empty', () => {
    const result = call({
      requestNames: ['login'],
      closeSuffix: ''
    });
    const body = result.find(r => r.label === 'request1.response.body')!;
    expect(body.apply).toBe('request1.response.body');
    const status = result.find(r => r.label === 'request1.response.status')!;
    expect(status.apply).toBe('request1.response.status');
  });

  it('includes closing braces by default (no closeSuffix)', () => {
    const result = call({ vars: { token: 'abc' } });
    expect(result[0].apply).toBe('token}}');
  });
});
