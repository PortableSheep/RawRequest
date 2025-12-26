import { buildConsoleMessage, buildScriptSource, ensureScriptRequest } from './script-utils';

describe('script-utils', () => {
  it('ensures request and headers exist', () => {
    const ctx: any = {};
    const req = ensureScriptRequest(ctx);
    expect(req).toBe(ctx.request);
    expect(typeof req.headers).toBe('object');

    const ctx2: any = { request: {} };
    const req2 = ensureScriptRequest(ctx2);
    expect(typeof req2.headers).toBe('object');
  });

  it('builds script source label', () => {
    expect(buildScriptSource('pre', undefined)).toBe('pre');
    expect(buildScriptSource('', undefined)).toBe('script');
    expect(buildScriptSource('post', { name: 'A', method: 'GET', url: 'x', headers: {} })).toBe('post:A');
    expect(buildScriptSource('custom', { method: 'GET', url: 'https://e', headers: {} })).toBe('custom:GET https://e');
    expect(buildScriptSource('custom', { method: 'GET', url: '', headers: {} })).toBe('custom:GET');
  });

  it('builds console message from args', () => {
    expect(buildConsoleMessage([])).toBe('');
    expect(buildConsoleMessage(['a', 1])).toBe('a 1');
    expect(buildConsoleMessage([null, undefined, 'x'])).toBe('x');
  });
});
