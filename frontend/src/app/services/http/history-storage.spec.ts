import { addToHistory, loadHistory } from './history-storage';

describe('history-storage', () => {
  const makeDeps = () => {
    const store: { run?: string; dir?: string; savedResponse?: string } = {};
    const backend: any = {
      loadFileHistoryFromDir: async (_id: string, _dir: string) => store.dir || '[]',
      loadFileHistoryFromRunLocation: async (_id: string) => store.run || '[]',
      saveResponseFile: async (_filePath: string, json: string) => {
        store.savedResponse = json;
        // Simulate backend adding to history after save
        const resp = JSON.parse(json);
        const historyItem = {
          timestamp: new Date().toISOString(),
          method: resp.requestPreview?.method || 'GET',
          url: resp.requestPreview?.url || resp.processedUrl || '',
          status: resp.status,
          statusText: resp.statusText,
          responseTime: resp.responseTime,
          responseData: resp
        };
        store.dir = JSON.stringify([historyItem]);
        return 'saved-path';
      },
      saveResponseFileToRunLocation: async (_id: string, json: string) => {
        store.savedResponse = json;
        // Simulate backend adding to history after save
        const resp = JSON.parse(json);
        const historyItem = {
          timestamp: new Date().toISOString(),
          method: resp.requestPreview?.method || 'GET',
          url: resp.requestPreview?.url || resp.processedUrl || '',
          status: resp.status,
          statusText: resp.statusText,
          responseTime: resp.responseTime,
          responseData: resp
        };
        store.run = JSON.stringify([historyItem]);
        return 'saved-run';
      }
    };

    const deps = {
      backend,
      dirname: (_p: string) => '/dir',
      basename: (p: string, ext?: string) => {
        const base = p.split('/').pop() || '';
        return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
      },
      log: { error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
    };

    return { deps, store };
  };

  it('loads history and converts timestamps to Date', async () => {
    const { deps, store } = makeDeps();
    store.run = JSON.stringify([{ timestamp: '2020-01-01T00:00:00.000Z', method: 'GET' }]);
    const items = await loadHistory('id', undefined, deps as any);
    expect(items).toHaveLength(1);
    expect(items[0].timestamp instanceof Date).toBe(true);
  });

  it('addToHistory saves response file and reloads history', async () => {
    const { deps, store } = makeDeps();
    store.run = JSON.stringify([]);

    const newItem = {
      timestamp: new Date('2020-01-02T00:00:00.000Z'),
      responseData: {
        status: 200,
        statusText: 'OK',
        responseTime: 100,
        requestPreview: { method: 'POST', url: 'https://example.com' }
      }
    } as any;

    const next = await addToHistory(
      'id',
      newItem,
      undefined,
      deps as any
    );

    // Should have saved response and reloaded history
    expect(next).toHaveLength(1);
    expect(store.savedResponse).toContain('"status": 200');
    expect(next[0].method).toBe('POST');
  });

  it('addToHistory with filePath saves response and uses dir-based history', async () => {
    const { deps, store } = makeDeps();
    store.dir = JSON.stringify([]);

    const newItem = {
      timestamp: new Date('2020-01-02T00:00:00.000Z'),
      responseData: {
        status: 201,
        statusText: 'Created',
        responseTime: 50,
        requestPreview: { method: 'PUT', url: 'https://example.com/update' }
      }
    } as any;

    const next = await addToHistory(
      'test',
      newItem,
      '/path/to/test.http',
      deps as any
    );

    // Should have saved response to file path location
    expect(store.savedResponse).toContain('"status": 201');
    expect(next).toHaveLength(1);
    expect(next[0].method).toBe('PUT');
  });

  it('addToHistory with noHistory=true skips saving response to disk', async () => {
    const { deps, store } = makeDeps();
    store.run = JSON.stringify([{ timestamp: '2020-01-01T00:00:00.000Z', method: 'GET' }]);

    const newItem = {
      timestamp: new Date('2020-01-02T00:00:00.000Z'),
      responseData: {
        status: 200,
        statusText: 'OK',
        responseTime: 100,
        requestPreview: { method: 'POST', url: 'https://example.com/phi-data' }
      }
    } as any;

    const next = await addToHistory(
      'id',
      newItem,
      undefined,
      deps as any,
      { noHistory: true }
    );

    // Should NOT have saved response to disk
    expect(store.savedResponse).toBeUndefined();
    // Should have logged the skip
    expect(deps.log.debug).toHaveBeenCalledWith(expect.stringContaining('Skipping history save'));
    // Should still return existing history
    expect(next).toHaveLength(1);
    expect(next[0].method).toBe('GET');
  });

  it('addToHistory with noHistory=false saves response normally', async () => {
    const { deps, store } = makeDeps();
    store.run = JSON.stringify([]);

    const newItem = {
      timestamp: new Date('2020-01-02T00:00:00.000Z'),
      responseData: {
        status: 200,
        statusText: 'OK',
        responseTime: 100,
        requestPreview: { method: 'POST', url: 'https://example.com' }
      }
    } as any;

    const next = await addToHistory(
      'id',
      newItem,
      undefined,
      deps as any,
      { noHistory: false }
    );

    // Should have saved response
    expect(store.savedResponse).toContain('"status": 200');
    expect(next).toHaveLength(1);
  });
});
