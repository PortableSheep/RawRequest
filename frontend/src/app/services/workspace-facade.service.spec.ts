import { Injector, inject, runInInjectionContext } from '@angular/core';
import type { FileTab } from '../models/http.models';
import { HttpService } from './http.service';
import { HistoryStoreService } from './history-store.service';
import { WorkspaceFacadeService } from './workspace-facade.service';
import { APP_BRIDGE, type AppBridgeContract } from './app-bridge.contract';

function makeFile(overrides: Partial<FileTab> & { id: string }): FileTab {
  return {
    name: overrides.id + '.http',
    content: '',
    requests: [],
    environments: {},
    variables: {},
    responseData: {},
    groups: [],
    selectedEnv: '',
    ...overrides,
  } as FileTab;
}

function createService(savedFiles: FileTab[] = []) {
  const httpMock = {
    loadFiles: vi.fn().mockReturnValue(savedFiles),
    saveFiles: vi.fn(),
  };
  const historyMock = {
    set: vi.fn(),
    get: vi.fn().mockReturnValue(undefined),
    delete: vi.fn(),
  };
  const appBridgeMock: vi.Mocked<Partial<AppBridgeContract>> = {
    openFileDialog: vi.fn(),
    readFileContents: vi.fn(),
    openImportFileDialog: vi.fn(),
    openImportDirectoryDialog: vi.fn(),
    importFromPath: vi.fn(),
  };

  const injector = Injector.create({
    providers: [
      WorkspaceFacadeService,
      { provide: HttpService, useValue: httpMock },
      { provide: HistoryStoreService, useValue: historyMock },
      { provide: APP_BRIDGE, useValue: appBridgeMock },
    ],
  });

  const service = runInInjectionContext(injector, () => inject(WorkspaceFacadeService));
  return { service, httpMock, historyMock, appBridgeMock };
}

describe('WorkspaceFacadeService.initializeFromStorage', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('returns shouldAddNewTab=true when no saved files', () => {
    const httpMock: Pick<HttpService, 'loadFiles'> = {
      loadFiles: vi.fn().mockReturnValue([])
    };

    const injector = Injector.create({
      providers: [
        WorkspaceFacadeService,
        { provide: HttpService, useValue: httpMock },
        { provide: HistoryStoreService, useValue: {} },
        { provide: APP_BRIDGE, useValue: {} }
      ]
    });

    const service = runInInjectionContext(injector, () => inject(WorkspaceFacadeService));
    const res = service.initializeFromStorage('last_session_key');

    expect(res.shouldAddNewTab).toBe(true);
    expect(res.files).toEqual([]);
    expect(res.currentFileIndex).toBe(0);
  });

  it('applies session-selected env and persists session state', () => {
    const file: FileTab = {
      id: 'file1',
      name: 'a.http',
      content: '',
      environments: { dev: {}, prod: {} },
      selectedEnv: 'dev'
    } as any;

    localStorage.setItem('last_session_key', JSON.stringify({ fileId: 'file1', selectedEnv: 'prod' }));

    const httpMock: Pick<HttpService, 'loadFiles'> = {
      loadFiles: vi.fn().mockReturnValue([file])
    };

    const injector = Injector.create({
      providers: [
        WorkspaceFacadeService,
        { provide: HttpService, useValue: httpMock },
        { provide: HistoryStoreService, useValue: {} },
        { provide: APP_BRIDGE, useValue: {} }
      ]
    });

    const service = runInInjectionContext(injector, () => inject(WorkspaceFacadeService));
    const res = service.initializeFromStorage('last_session_key');

    expect(res.shouldAddNewTab).toBe(false);
    expect(res.currentFileIndex).toBe(0);
    expect(res.files[0]?.selectedEnv).toBe('prod');
    expect(res.currentEnv).toBe('prod');
    expect(res.activeFileId).toBe('file1');

    const persisted = JSON.parse(localStorage.getItem('last_session_key') || '{}');
    expect(persisted.selectedEnv).toBe('prod');
    expect(persisted.fileId).toBe('file1');
  });
});

describe('WorkspaceFacadeService derived methods', () => {
  afterEach(() => {
    localStorage.clear();
  });

  describe('closeTabDerived', () => {
    it('removes the tab and returns derived state with correct index', () => {
      const files = [makeFile({ id: 'a' }), makeFile({ id: 'b' }), makeFile({ id: 'c' })];
      const { service } = createService();

      const result = service.closeTabDerived('key', files, 1, 1);

      expect(result.files).toHaveLength(2);
      expect(result.files.map(f => f.id)).toEqual(['a', 'c']);
      expect(result.currentFileIndex).toBeLessThan(2);
      expect(result.currentEnv).toBeDefined();
    });

    it('creates a new untitled tab when closing the last tab', () => {
      const files = [makeFile({ id: 'only' })];
      const { service } = createService();

      const result = service.closeTabDerived('key', files, 0, 0);

      expect(result.files).toHaveLength(1);
      expect(result.files[0].id).not.toBe('only');
      expect(result.currentFileIndex).toBe(0);
    });
  });

  describe('closeOtherTabsDerived', () => {
    it('keeps only the specified tab', () => {
      const files = [makeFile({ id: 'a' }), makeFile({ id: 'b' }), makeFile({ id: 'c' })];
      const { service } = createService();

      const result = service.closeOtherTabsDerived('key', files, 1);

      expect(result.files).toHaveLength(1);
      expect(result.files[0].id).toBe('b');
      expect(result.currentFileIndex).toBe(0);
      expect(result.activeFileId).toBe('b');
    });

    it('returns unchanged state when only one tab exists', () => {
      const files = [makeFile({ id: 'only' })];
      const { service } = createService();

      const result = service.closeOtherTabsDerived('key', files, 0);

      expect(result.files).toHaveLength(1);
      expect(result.activeFileId).toBe('only');
    });
  });

  describe('addNewTabDerived', () => {
    it('appends a new tab and sets it as current', () => {
      const files = [makeFile({ id: 'a' })];
      const { service } = createService();

      const result = service.addNewTabDerived('key', files);

      expect(result.files).toHaveLength(2);
      expect(result.currentFileIndex).toBe(1);
      expect(result.currentEnv).toBe('');
    });
  });

  describe('addFileFromContentDerived', () => {
    it('adds a file with parsed content', () => {
      const files = [makeFile({ id: 'a' })];
      const { service } = createService();

      const result = service.addFileFromContentDerived('key', files, 'test.http', 'GET https://example.com');

      expect(result.files).toHaveLength(2);
      expect(result.currentFileIndex).toBe(1);
      expect(result.files[1].name).toBe('test.http');
      expect(result.activeFileId).toBe(result.files[1].id);
    });

    it('uses filePath as id when provided', () => {
      const files = [makeFile({ id: 'a' })];
      const { service } = createService();

      const result = service.addFileFromContentDerived('key', files, 'test.http', '', '/path/to/test.http');

      expect(result.files[1].id).toBe('/path/to/test.http');
    });
  });

  describe('reorderTabsDerived', () => {
    it('reorders tabs and tracks current file index', () => {
      const files = [makeFile({ id: 'a' }), makeFile({ id: 'b' }), makeFile({ id: 'c' })];
      const { service } = createService();

      const result = service.reorderTabsDerived('key', files, 0, 0, 2);

      expect(result.files.map(f => f.id)).toEqual(['b', 'c', 'a']);
      expect(result.activeFileId).toBe('a');
      expect(result.currentFileIndex).toBe(2);
    });
  });

  describe('switchToFileDerived', () => {
    it('returns derived state for the target file', () => {
      const files = [
        makeFile({ id: 'a', selectedEnv: 'dev', environments: { dev: {} } }),
        makeFile({ id: 'b', selectedEnv: 'prod', environments: { prod: {} } }),
      ];
      const { service } = createService();

      const result = service.switchToFileDerived(files, 1);

      expect(result.currentFileIndex).toBe(1);
      expect(result.activeFileId).toBe('b');
      expect(result.currentEnv).toBe('prod');
    });
  });

  describe('deriveWithEnvSync', () => {
    it('syncs current env with the file at the target index', () => {
      const files = [
        makeFile({ id: 'a', selectedEnv: 'staging', environments: { staging: {} } }),
      ];
      const { service } = createService();

      const result = service.deriveWithEnvSync({
        files,
        currentFileIndex: 0,
        activeFileId: 'a',
      });

      expect(result.currentEnv).toBe('staging');
      expect(result.activeFileId).toBe('a');
    });
  });
});

describe('WorkspaceFacadeService utility methods', () => {
  describe('normalizeFiles', () => {
    it('normalises each file in the array', () => {
      const { service } = createService();
      const files = [makeFile({ id: 'a' }), makeFile({ id: 'b' })];

      const result = service.normalizeFiles(files);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('a');
      expect(result[1].id).toBe('b');
    });

    it('returns empty array for empty input', () => {
      const { service } = createService();

      expect(service.normalizeFiles([])).toEqual([]);
    });
  });

  describe('replaceFileAtIndex', () => {
    it('replaces the file at the given index without mutating the original', () => {
      const { service } = createService();
      const files = [makeFile({ id: 'a' }), makeFile({ id: 'b' })];
      const replacement = makeFile({ id: 'c' });

      const result = service.replaceFileAtIndex(files, 1, replacement);

      expect(result[1].id).toBe('c');
      expect(result[0].id).toBe('a');
      expect(files[1].id).toBe('b'); // original unchanged
    });
  });
});

describe('WorkspaceFacadeService.loadFromStorage', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('returns empty files when nothing is stored', () => {
    const { service } = createService([]);

    const result = service.loadFromStorage('session_key');

    expect(result.files).toEqual([]);
    expect(result.currentFileIndex).toBe(0);
  });

  it('returns normalised saved files with default index', () => {
    const files = [makeFile({ id: 'x' }), makeFile({ id: 'y' })];
    const { service } = createService(files);

    const result = service.loadFromStorage('session_key');

    expect(result.files).toHaveLength(2);
    expect(result.currentFileIndex).toBe(0);
  });

  it('restores index and env from last-session storage', () => {
    const files = [makeFile({ id: 'f1', selectedEnv: 'dev' }), makeFile({ id: 'f2', selectedEnv: 'prod' })];
    localStorage.setItem('session_key', JSON.stringify({ fileId: 'f2', selectedEnv: 'staging' }));
    const { service } = createService(files);

    const result = service.loadFromStorage('session_key');

    expect(result.currentFileIndex).toBe(1);
    expect(result.files[1].selectedEnv).toBe('staging');
  });
});

describe('WorkspaceFacadeService.persistSessionState', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('persists the active file state to localStorage', () => {
    const { service } = createService();
    const files = [makeFile({ id: 'p1', selectedEnv: 'prod' })];

    service.persistSessionState('persist_key', files, 0);

    const stored = JSON.parse(localStorage.getItem('persist_key') || '{}');
    expect(stored.fileId).toBe('p1');
  });

  it('clears session state when active file is undefined', () => {
    const { service } = createService();
    localStorage.setItem('persist_key', JSON.stringify({ fileId: 'old' }));

    service.persistSessionState('persist_key', [], 0);

    expect(localStorage.getItem('persist_key')).toBeNull();
  });
});

describe('WorkspaceFacadeService.updateFileContent', () => {
  it('parses and updates the file content at the given index', () => {
    const files = [makeFile({ id: 'u1', content: '' })];
    const { service, httpMock } = createService();

    const result = service.updateFileContent(files, 0, 'GET https://example.com');

    expect(result.files[0].content).toBe('GET https://example.com');
    expect(result.currentFileIndex).toBe(0);
    expect(result.activeFileId).toBe('u1');
    expect(httpMock.saveFiles).toHaveBeenCalledWith(result.files);
  });

  it('parses requests from the content', () => {
    const files = [makeFile({ id: 'u2', content: '' })];
    const { service } = createService();

    const result = service.updateFileContent(files, 0, 'GET https://api.test/users\n\n###\n\nPOST https://api.test/users');

    expect(result.files[0].requests.length).toBeGreaterThanOrEqual(1);
  });

  it('returns unchanged state when fileIndex is out of bounds', () => {
    const files = [makeFile({ id: 'u3' })];
    const { service, httpMock } = createService();

    const result = service.updateFileContent(files, 5, 'GET /api');

    expect(result.files).toBe(files);
    expect(result.currentFileIndex).toBe(5);
    expect(httpMock.saveFiles).not.toHaveBeenCalled();
  });
});

describe('WorkspaceFacadeService.upsertExamplesTab', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('inserts a new examples tab when none exists', () => {
    const files = [makeFile({ id: 'a' })];
    const { service, httpMock, historyMock } = createService();

    const result = service.upsertExamplesTab('key', files, 'GET https://example.com', 'My Examples');

    expect(result.files).toHaveLength(2);
    expect(result.files[1].id).toBe('__examples__');
    expect(result.currentFileIndex).toBe(1);
    expect(result.activeFileId).toBe('__examples__');
    expect(httpMock.saveFiles).toHaveBeenCalled();
    expect(historyMock.set).toHaveBeenCalledWith('__examples__', []);
  });

  it('replaces an existing examples tab in-place', () => {
    const existingExamples = makeFile({ id: '__examples__', content: 'old' });
    const files = [makeFile({ id: 'a' }), existingExamples, makeFile({ id: 'b' })];
    const { service } = createService();

    const result = service.upsertExamplesTab('key', files, 'GET https://new.com', 'Updated Examples');

    expect(result.files).toHaveLength(3);
    expect(result.files[1].id).toBe('__examples__');
    expect(result.files[1].content).toBe('GET https://new.com');
    expect(result.currentFileIndex).toBe(1);
  });
});

describe('WorkspaceFacadeService.openFilesFromDisk', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('returns an empty array when the dialog is cancelled', async () => {
    const { service, appBridgeMock } = createService();
    (appBridgeMock.openFileDialog as vi.Mock).mockResolvedValue([]);

    const result = await service.openFilesFromDisk('key', []);

    expect(result).toEqual([]);
    expect(appBridgeMock.readFileContents).not.toHaveBeenCalled();
  });

  it('reads and adds newly opened files via the app bridge', async () => {
    const { service, appBridgeMock, httpMock } = createService();
    (appBridgeMock.openFileDialog as vi.Mock).mockResolvedValue(['/tmp/new.http']);
    (appBridgeMock.readFileContents as vi.Mock).mockResolvedValue('GET https://example.com');

    const results = await service.openFilesFromDisk('key', []);

    expect(appBridgeMock.readFileContents).toHaveBeenCalledWith('/tmp/new.http');
    expect(results).toHaveLength(1);
    expect(results[0].isNewFile).toBe(true);
    expect(results[0].state.files[0].filePath).toBe('/tmp/new.http');
    expect(httpMock.saveFiles).toHaveBeenCalled();
  });

  it('switches to an already-open file instead of re-reading it', async () => {
    const existing = makeFile({ id: '/tmp/existing.http', filePath: '/tmp/existing.http' });
    const { service, appBridgeMock } = createService();
    (appBridgeMock.openFileDialog as vi.Mock).mockResolvedValue(['/tmp/existing.http']);

    const results = await service.openFilesFromDisk('key', [existing]);

    expect(appBridgeMock.readFileContents).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0].isNewFile).toBe(false);
  });
});

describe('WorkspaceFacadeService.importCollectionFromDisk', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('uses the file dialog for postman imports', async () => {
    const { service, appBridgeMock } = createService();
    (appBridgeMock.openImportFileDialog as vi.Mock).mockResolvedValue('/tmp/collection.json');
    (appBridgeMock.importFromPath as vi.Mock).mockResolvedValue({
      Files: [{ Name: 'imported.http', Content: 'GET https://example.com' }],
    });

    const result = await service.importCollectionFromDisk('key', [], 'postman');

    expect(appBridgeMock.openImportFileDialog).toHaveBeenCalled();
    expect(appBridgeMock.openImportDirectoryDialog).not.toHaveBeenCalled();
    expect(appBridgeMock.importFromPath).toHaveBeenCalledWith('/tmp/collection.json');
    expect(result?.count).toBe(1);
    expect(result?.state.files.some((f) => f.name === 'imported.http')).toBe(true);
  });

  it('uses the directory dialog for bruno imports', async () => {
    const { service, appBridgeMock } = createService();
    (appBridgeMock.openImportDirectoryDialog as vi.Mock).mockResolvedValue('/tmp/bruno-collection');
    (appBridgeMock.importFromPath as vi.Mock).mockResolvedValue({
      Files: [{ Name: 'a.http', Content: 'GET /a' }, { Name: 'b.http', Content: 'GET /b' }],
    });

    const result = await service.importCollectionFromDisk('key', [], 'bruno');

    expect(appBridgeMock.openImportDirectoryDialog).toHaveBeenCalled();
    expect(appBridgeMock.openImportFileDialog).not.toHaveBeenCalled();
    expect(appBridgeMock.importFromPath).toHaveBeenCalledWith('/tmp/bruno-collection');
    expect(result?.count).toBe(2);
  });

  it('returns null when the dialog is cancelled', async () => {
    const { service, appBridgeMock } = createService();
    (appBridgeMock.openImportFileDialog as vi.Mock).mockResolvedValue('');

    const result = await service.importCollectionFromDisk('key', [], 'postman');

    expect(result).toBeNull();
    expect(appBridgeMock.importFromPath).not.toHaveBeenCalled();
  });

  it('returns null when the import produces no files', async () => {
    const { service, appBridgeMock } = createService();
    (appBridgeMock.openImportFileDialog as vi.Mock).mockResolvedValue('/tmp/empty.json');
    (appBridgeMock.importFromPath as vi.Mock).mockResolvedValue({ Files: [] });

    const result = await service.importCollectionFromDisk('key', [], 'postman');

    expect(result).toBeNull();
  });
});
