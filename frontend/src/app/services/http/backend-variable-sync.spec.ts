import { syncInitialVariablesToBackend } from './backend-variable-sync';

describe('backend-variable-sync', () => {
  it('syncs all variables via provided setter', async () => {
    const calls: Array<[string, string]> = [];
    await syncInitialVariablesToBackend(
      { a: '1', b: '2' },
      async (k, v) => {
        calls.push([k, v]);
      }
    );
    expect(calls).toEqual([
      ['a', '1'],
      ['b', '2']
    ]);
  });

  it('swallows errors and warns', async () => {
    const warn = jest.fn();
    await syncInitialVariablesToBackend(
      { a: '1' },
      async () => {
        throw new Error('nope');
      },
      { warn }
    );
    expect(warn).toHaveBeenCalled();
  });
});
