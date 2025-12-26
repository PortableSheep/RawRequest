import { runScript } from './script-runner';

describe('script-runner', () => {
  it('no-ops on empty script', async () => {
    const recordConsole = jest.fn();
    await runScript('', {}, 'custom', {
      cleanScript: (s) => s,
      recordConsole,
      setVariable: async () => {}
    });
    expect(recordConsole).not.toHaveBeenCalled();
  });

  it('records console output and syncs variables', async () => {
    const logs: Array<{ level: string; source: string; message: string }> = [];
    const vars: Record<string, string> = {};

    await runScript(
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
  });

  it('records runtime errors', async () => {
    const logs: Array<{ level: string; message: string }> = [];

    await runScript(
      "assert(false, 'nope')",
      { request: { method: 'GET', url: 'x', headers: {} } },
      'post',
      {
        cleanScript: (s) => s,
        recordConsole: (level, _source, message) => logs.push({ level, message }),
        setVariable: async () => {}
      }
    );

    expect(logs.some(l => l.level === 'error' && l.message.includes('runtime error'))).toBe(true);
  });
});
