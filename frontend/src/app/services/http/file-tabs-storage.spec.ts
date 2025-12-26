import { loadFileTabsFromStorage, saveFileTabsToStorage } from './file-tabs-storage';

describe('file-tabs-storage', () => {
  it('loads empty array when missing', () => {
    const storage = { getItem: () => null, setItem: () => {} };
    expect(loadFileTabsFromStorage('k', storage)).toEqual([]);
  });

  it('roundtrips via JSON', () => {
    let data: string | null = null;
    const storage = {
      getItem: () => data,
      setItem: (_k: string, v: string) => {
        data = v;
      }
    };

    saveFileTabsToStorage('k', [{ id: '1', name: 't', content: '', requests: [], environments: {}, variables: {}, responseData: {}, groups: [] } as any], storage);
    const loaded = loadFileTabsFromStorage('k', storage);
    expect(Array.isArray(loaded)).toBe(true);
    expect(loaded[0].id).toBe('1');
  });

  it('swallows JSON parse errors and logs', () => {
    const storage = { getItem: () => '{bad', setItem: () => {} };
    const error = jest.fn();
    expect(loadFileTabsFromStorage('k', storage, { error })).toEqual([]);
    expect(error).toHaveBeenCalled();
  });
});
