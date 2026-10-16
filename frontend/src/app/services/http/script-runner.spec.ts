import { runScript } from './script-runner';

describe('script-runner', () => {
  it('no-ops on empty script', async () => {
    const recordConsole = vi.fn();
    const assertions = await runScript('', {}, 'custom', {
      cleanScript: (s) => s,
      recordConsole,
      setVariable: async () => {}
    });
    expect(recordConsole).not.toHaveBeenCalled();
    expect(assertions).toEqual([]);
  });

  it('records console output and syncs variables', async () => {
    const logs: Array<{ level: string; source: string; message: string }> = [];
    const vars: Record<string, string> = {};

    const assertions = await runScript(
      "console.log('hi'); setVar('a', 1);",
      { request: { name: 'R', headers: {} }, variables: vars },
      'pre',
      {
        cleanScript: (s) => s,
        recordConsole: (level, source, message) => logs.push({ level, source, message }),
        setVariable: async (k, v) => {
          vars[k] = v;
        }
      }
    );

    expect(vars['a']).toBe('1');
    expect(logs.some(l => l.message.includes('hi'))).toBe(true);
    expect(logs.some(l => l.source === 'pre:R')).toBe(true);
    expect(assertions).toEqual([]);
  });

  const deps = (logs: Array<{ level: string; message: string }>, vars: Record<string, string> = {}) => ({
    cleanScript: (s: string) => s,
    recordConsole: (level: string, _source: string, message: string) => logs.push({ level, message }),
    setVariable: async (k: string, v: string) => {
      vars[k] = v;
    }
  });

  it('logs every assertion result to the console', async () => {
    const logs: Array<{ level: string; message: string }> = [];

    const assertions = await runScript(
      "assert(true, 'ok'); assert(false, 'nope')",
      { request: { method: 'GET', url: 'x', headers: {} } },
      'post',
      deps(logs)
    );

    expect(logs).toEqual([
      { level: 'info', message: '✓ ok' },
      { level: 'error', message: '✗ nope' }
    ]);
    expect(assertions).toEqual([
      { passed: true, message: 'ok', stage: 'post' },
      { passed: false, message: 'nope', stage: 'post' }
    ]);
  });

  it('keeps running after a failed assertion', async () => {
    const vars: Record<string, string> = {};

    const assertions = await runScript(
      "assert(false, 'first'); setVar('after', 'yes'); assert(true, 'second')",
      { request: { headers: {} } },
      'post',
      deps([], vars)
    );

    expect(vars['after']).toBe('yes');
    expect(assertions.map(a => a.passed)).toEqual([false, true]);
  });

  it('records a runtime error as a failed assertion', async () => {
    const logs: Array<{ level: string; message: string }> = [];
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const assertions = await runScript(
      "assert(true, 'ok'); response.missing.field",
      { request: { headers: {} }, response: {} },
      'post',
      deps(logs)
    );

    errSpy.mockRestore();
    expect(assertions.length).toBe(2);
    expect(assertions[1].passed).toBe(false);
    expect(assertions[1].message).toMatch(/^Script error: /);
    expect(logs.at(-1)?.level).toBe('error');
  });

  it('records a failed assertion when assert is called without a condition', async () => {
    const assertions = await runScript('assert()', { request: { headers: {} } }, 'pre', deps([]));
    expect(assertions).toEqual([{ passed: false, message: 'Assertion failed', stage: 'pre' }]);
  });
});
