import { buildVarCompletions, VarCompletionItem } from './editor.autocomplete';

describe('buildVarCompletions', () => {
  function call(params: Partial<Parameters<typeof buildVarCompletions>[0]> = {}): VarCompletionItem[] {
    return buildVarCompletions({
      vars: {},
      envs: {},
      currentEnv: '',
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
    expect(tokenItem.section).toEqual({ name: 'Variables', rank: 0 });
  });

  it('truncates long variable values to 30 chars in detail', () => {
    const longVal = 'a'.repeat(50);
    const result = call({ vars: { key: longVal } });
    expect(result[0].detail).toBe('a'.repeat(30));
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
    expect(result.find(r => r.label === 'baseUrl')!.section).toEqual({ name: 'Environment', rank: 1 });
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

  it('adds body and status references for chained requests', () => {
    const result = call({ chainRequests: [{ index: 0, name: 'login' }, { index: 1, name: 'getProfile' }] });
    expect(labels(result)).toContain('request1.response.body');
    expect(labels(result)).toContain('request1.response.status');
    expect(labels(result)).toContain('request2.response.body');
    expect(labels(result)).toContain('request2.response.status');
  });

  it('shows request name in detail for references', () => {
    const result = call({ chainRequests: [{ index: 0, name: 'login' }] });
    const item = result.find(r => r.label === 'request1.response.body')!;
    expect(item.detail).toBe('login');
    expect(item.type).toBe('function');
    expect(item.apply).toBe('request1.response.body}}');
    expect(item.section).toEqual({ name: 'Response References', rank: 3 });
  });

  it('uses correct 1-based numbering from request index', () => {
    const result = call({ chainRequests: [{ index: 2, name: 'thirdReq' }] });
    expect(labels(result)).toContain('request3.response.body');
    expect(labels(result)).toContain('request3.response.status');
    const item = result.find(r => r.label === 'request3.response.body')!;
    expect(item.detail).toBe('thirdReq');
  });

  it('returns no response refs when chainRequests is empty', () => {
    const result = call({ vars: { token: 'abc' } });
    expect(result.some(r => r.label.startsWith('request'))).toBe(false);
  });

  // ── Secret completions ─────────────────────────────────────────────

  it('adds secret:keyName completions when secretKeys provided', () => {
    const result = call({ secretKeys: ['apiKey', 'dbPassword'] });
    expect(labels(result)).toContain('secret:apiKey');
    expect(labels(result)).toContain('secret:dbPassword');
    const item = result.find(r => r.label === 'secret:apiKey')!;
    expect(item.type).toBe('variable');
    expect(item.detail).toBe('secret');
    expect(item.apply).toBe('secret:apiKey}}');
    expect(item.section).toEqual({ name: 'Secrets', rank: 2 });
  });

  it('omits closing braces for secrets when closeSuffix is empty', () => {
    const result = call({ secretKeys: ['token'], closeSuffix: '' });
    const item = result.find(r => r.label === 'secret:token')!;
    expect(item.apply).toBe('secret:token');
  });

  it('returns empty array when no vars, envs, secrets, or request names', () => {
    expect(call()).toEqual([]);
  });

  // ── Mixed scenarios ─────────────────────────────────────────────────

  it('returns vars, env vars, secrets, and request refs together', () => {
    const result = call({
      vars: { token: 'abc' },
      envs: { dev: { baseUrl: 'http://dev' } },
      currentEnv: 'dev',
      secretKeys: ['apiKey'],
      chainRequests: [{ index: 0, name: 'login' }]
    });
    expect(labels(result)).toEqual([
      'token',
      'baseUrl',
      'secret:apiKey',
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
      chainRequests: [{ index: 0, name: 'login' }],
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
