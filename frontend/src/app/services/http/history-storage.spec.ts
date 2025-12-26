import { addToHistory, loadHistory, saveHistorySnapshot } from './history-storage';

describe('history-storage', () => {
  const makeDeps = () => {
    const store: { run?: string; dir?: string; savedResponse?: string } = {};
    const backend: any = {
      loadFileHistoryFromDir: async (_id: string, _dir: string) => store.dir || '',
      loadFileHistoryFromRunLocation: async (_id: string) => store.run || '',
      saveFileHistoryToDir: async (_id: string, json: string, _dir: string) => {
        store.dir = json;
      },
      saveFileHistoryToRunLocation: async (_id: string, json: string) => {
        store.run = json;
      },
      saveResponseFile: async (_filePath: string, json: string) => {
        store.savedResponse = json;
        return 'saved-path';
      },
      saveResponseFileToRunLocation: async (_id: string, json: string) => {
        store.savedResponse = json;
        return 'saved-run';
      }
    };

    const deps = {
      backend,
      dirname: (_p: string) => '/dir',
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

  it('saves snapshots to run location when no filePath', async () => {
    const { deps, store } = makeDeps();
    await saveHistorySnapshot('id', [], undefined, deps as any);
    expect(store.run).toBe('[]');
  });

  it('adds to history and trims to maxItems', async () => {
    const { deps, store } = makeDeps();
    store.run = JSON.stringify([{ timestamp: '2020-01-01T00:00:00.000Z' }]);

    const newItem = {
      timestamp: new Date('2020-01-02T00:00:00.000Z'),
      responseData: { status: 200 }
    } as any;

    const next = await addToHistory(
      'id',
      newItem,
      undefined,
      1,
      deps as any
    );

    expect(next).toHaveLength(1);
    const saved = JSON.parse(store.run || '[]');
    expect(saved).toHaveLength(1);
    expect(new Date(saved[0].timestamp).toISOString()).toBe((next[0] as any).timestamp.toISOString());
    expect(store.savedResponse).toContain('"status": 200');
  });
});
