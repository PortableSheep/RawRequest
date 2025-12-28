import { runScript } from './script-runner';

describe('script-runner', () => {
  it('no-ops on empty script', async () => {
    const recordConsole = jest.fn();
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

  it('returns assertion failures without logging them', async () => {
    const logs: Array<{ level: string; message: string }> = [];

    const assertions = await runScript(
      "assert(false, 'nope')",
      { request: { method: 'GET', url: 'x', headers: {} } },
      'post',
      {
        cleanScript: (s) => s,
        recordConsole: (level, _source, message) => logs.push({ level, message }),
        setVariable: async () => {}
      }
    );

    expect(logs.length).toBe(0);
    expect(assertions).toEqual([{ passed: false, message: 'nope', stage: 'post' }]);
  });
});
