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

  it('does not persist savedContent duplicates', () => {
    let data: string | null = null;
    const storage = {
      getItem: () => data,
      setItem: (_k: string, v: string) => {
        data = v;
      }
    };

    saveFileTabsToStorage(
      'k',
      [{
        id: '1',
        name: 't',
        content: 'GET https://example.com',
        savedContent: 'GET https://example.com',
        requests: [],
        environments: {},
        variables: {},
        responseData: {},
        groups: []
      } as any],
      storage
    );

    const payload = JSON.parse(data || '[]');
    expect(payload[0].savedContent).toBeUndefined();
  });

  it('retries with empty responseData when quota is exceeded', () => {
    let saved: string | null = null;
    let attempts = 0;
    const storage = {
      getItem: () => saved,
      setItem: (_k: string, v: string) => {
        attempts += 1;
        if (attempts === 1) {
          throw new DOMException('quota exceeded', 'QuotaExceededError');
        }
        saved = v;
      }
    };

    const warn = vi.fn();
    saveFileTabsToStorage(
      'k',
      [{
        id: '1',
        name: 't',
        content: '',
        requests: [],
        environments: {},
        variables: {},
        responseData: { 0: { body: 'very large' } },
        groups: []
      } as any],
      storage,
      { warn }
    );

    expect(attempts).toBe(2);
    expect(warn).toHaveBeenCalled();
    const payload = JSON.parse(saved || '[]');
    expect(payload[0].responseData).toEqual({});
  });

  it('swallows JSON parse errors and logs', () => {
    const storage = { getItem: () => '{bad', setItem: () => {} };
    const error = vi.fn();
    expect(loadFileTabsFromStorage('k', storage, { error })).toEqual([]);
    expect(error).toHaveBeenCalled();
  });
});
