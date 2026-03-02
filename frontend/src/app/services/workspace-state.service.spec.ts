import { TestBed } from '@angular/core/testing';
import { WorkspaceStateService } from './workspace-state.service';
import { WorkspaceFacadeService } from './workspace-facade.service';
import { HttpService } from './http.service';
import { HistoryStoreService } from './history-store.service';
import type { FileTab, HistoryItem } from '../models/http.models';

function makeFileTab(overrides: Partial<FileTab> = {}): FileTab {
  return {
    id: 'file1',
    name: 'Test.http',
    content: 'GET http://example.com',
    requests: [{ method: 'GET', url: 'http://example.com', headers: {} }],
    environments: { dev: { baseUrl: 'http://dev.example.com' } },
    variables: {},
    responseData: {},
    groups: [],
    selectedEnv: 'dev',
    ...overrides,
  };
}

describe('WorkspaceStateService', () => {
  let service: WorkspaceStateService;
  let workspaceFacade: jest.Mocked<Partial<WorkspaceFacadeService>>;
  let httpService: jest.Mocked<Partial<HttpService>>;
  let historyStore: jest.Mocked<Partial<HistoryStoreService>>;

  beforeEach(() => {
    workspaceFacade = {
      normalizeFiles: jest.fn((files) => files),
      syncCurrentEnvWithFile: jest.fn((files, idx) => ({
        files,
        currentFileIndex: idx,
        currentEnv: files[idx]?.selectedEnv || '',
        activeFileId: files[idx]?.id,
      })),
      replaceFileAtIndex: jest.fn((files, idx, newFile) => {
        const updated = [...files];
        updated[idx] = newFile;
        return updated;
      }),
      persistSessionState: jest.fn(),
      initializeFromStorage: jest.fn(),
      deriveWithEnvSync: jest.fn(),
      closeTabDerived: jest.fn(),
      closeOtherTabsDerived: jest.fn(),
      addNewTabDerived: jest.fn(),
      addFileFromContentDerived: jest.fn(),
      reorderTabsDerived: jest.fn(),
      updateFileContent: jest.fn(),
      upsertExamplesTab: jest.fn(),
    };

    httpService = {
      saveFiles: jest.fn(),
    };

    historyStore = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      ensureLoaded: jest.fn().mockResolvedValue([]),
    };

    TestBed.configureTestingModule({
      providers: [
        WorkspaceStateService,
        { provide: WorkspaceFacadeService, useValue: workspaceFacade },
        { provide: HttpService, useValue: httpService },
        { provide: HistoryStoreService, useValue: historyStore },
      ],
    });

    service = TestBed.inject(WorkspaceStateService);
  });

  describe('initial state', () => {
    it('starts with empty files', () => {
      expect(service.files()).toEqual([]);
      expect(service.currentFileIndex()).toBe(0);
      expect(service.currentEnv()).toBe('');
      expect(service.history()).toEqual([]);
    });

    it('currentFileView returns emptyFile when no files', () => {
      const view = service.currentFileView();
      expect(view.id).toBe('empty');
      expect(view.content).toBe('');
    });

    it('currentFileEnvironments returns empty when no files', () => {
      expect(service.currentFileEnvironments()).toEqual([]);
    });

    it('currentFileRequestNames returns empty when no files', () => {
      expect(service.currentFileRequestNames()).toEqual([]);
    });
  });

  describe('applyState', () => {
    it('updates all signals', () => {
      const file = makeFileTab();
      service.applyState({ files: [file], currentFileIndex: 0, currentEnv: 'dev' });

      expect(service.files()).toEqual([file]);
      expect(service.currentFileIndex()).toBe(0);
      expect(service.currentEnv()).toBe('dev');
    });
  });

  describe('computed state', () => {
    it('currentFileView returns active file', () => {
      const file = makeFileTab();
      service.applyState({ files: [file], currentFileIndex: 0, currentEnv: 'dev' });

      expect(service.currentFileView().id).toBe('file1');
      expect(service.currentFileView().content).toBe('GET http://example.com');
    });

    it('currentFileEnvironments returns env keys', () => {
      const file = makeFileTab({ environments: { dev: {}, staging: {}, prod: {} } });
      service.applyState({ files: [file], currentFileIndex: 0, currentEnv: 'dev' });

      expect(service.currentFileEnvironments()).toEqual(['dev', 'staging', 'prod']);
    });

    it('currentFileRequestNames returns request names', () => {
      const file = makeFileTab({
        requests: [
          { method: 'GET', url: '/a', headers: {}, name: 'getA' },
          { method: 'POST', url: '/b', headers: {}, name: 'postB' },
          { method: 'PUT', url: '/c', headers: {} },
        ],
      });
      service.applyState({ files: [file], currentFileIndex: 0, currentEnv: '' });

      expect(service.currentFileRequestNames()).toEqual(['getA', 'postB', '']);
    });
  });

  describe('getCurrentFile', () => {
    it('returns the active file', () => {
      const file = makeFileTab();
      service.applyState({ files: [file], currentFileIndex: 0, currentEnv: '' });
      expect(service.getCurrentFile().id).toBe('file1');
    });

    it('returns empty file when index out of bounds', () => {
      expect(service.getCurrentFile().id).toBe('empty');
    });
  });

  describe('replaceFileAtIndex', () => {
    it('replaces a file and updates signal', () => {
      const file = makeFileTab();
      service.applyState({ files: [file], currentFileIndex: 0, currentEnv: '' });

      const updated = makeFileTab({ id: 'file1', name: 'Updated.http' });
      service.replaceFileAtIndex(0, updated);

      expect(service.files()[0].name).toBe('Updated.http');
      expect(workspaceFacade.replaceFileAtIndex).toHaveBeenCalledWith([file], 0, updated);
    });
  });

  describe('onFilesChange', () => {
    it('normalizes files and syncs env', () => {
      const files = [makeFileTab()];
      service.onFilesChange(files);

      expect(workspaceFacade.normalizeFiles).toHaveBeenCalledWith(files);
      expect(workspaceFacade.syncCurrentEnvWithFile).toHaveBeenCalled();
      expect(workspaceFacade.persistSessionState).toHaveBeenCalled();
    });
  });

  describe('onCurrentFileIndexChange', () => {
    it('updates index and syncs env', () => {
      const files = [makeFileTab(), makeFileTab({ id: 'file2', selectedEnv: 'prod' })];
      service.applyState({ files, currentFileIndex: 0, currentEnv: 'dev' });

      service.onCurrentFileIndexChange(1);

      expect(service.currentFileIndex()).toBe(1);
      expect(workspaceFacade.syncCurrentEnvWithFile).toHaveBeenCalledWith(files, 1);
    });
  });

  describe('onCurrentEnvChange', () => {
    it('updates env and persists', () => {
      const file = makeFileTab();
      service.applyState({ files: [file], currentFileIndex: 0, currentEnv: 'dev' });

      service.onCurrentEnvChange('prod');

      expect(service.currentEnv()).toBe('prod');
      expect(httpService.saveFiles).toHaveBeenCalled();
      expect(workspaceFacade.persistSessionState).toHaveBeenCalled();
    });
  });

  describe('updateRawContent', () => {
    it('updates file content without parsing', () => {
      const file = makeFileTab();
      service.applyState({ files: [file], currentFileIndex: 0, currentEnv: '' });

      service.updateRawContent('POST http://new.example.com');

      expect(service.files()[0].content).toBe('POST http://new.example.com');
      expect(httpService.saveFiles).toHaveBeenCalled();
    });

    it('does nothing when no current file', () => {
      service.updateRawContent('POST http://new.example.com');
      expect(httpService.saveFiles).not.toHaveBeenCalled();
    });
  });

  describe('updateFileContent', () => {
    it('delegates to workspace facade', () => {
      const file = makeFileTab();
      service.applyState({ files: [file], currentFileIndex: 0, currentEnv: '' });

      (workspaceFacade.updateFileContent as jest.Mock).mockReturnValue({
        files: [{ ...file, content: 'updated' }],
        currentFileIndex: 0,
        currentEnv: 'dev',
      });

      service.updateFileContent('updated');

      expect(workspaceFacade.updateFileContent).toHaveBeenCalledWith([file], 0, 'updated');
      expect(service.files()[0].content).toBe('updated');
    });
  });

  describe('tab operations', () => {
    const derivedState = {
      files: [makeFileTab({ id: 'remaining' })],
      currentFileIndex: 0,
      currentEnv: '',
      activeFileId: 'remaining',
    };

    it('closeTab delegates and applies state', () => {
      (workspaceFacade.closeTabDerived as jest.Mock).mockReturnValue(derivedState);
      const file = makeFileTab();
      service.applyState({ files: [file, makeFileTab({ id: 'f2' })], currentFileIndex: 0, currentEnv: '' });

      service.closeTab(1);

      expect(workspaceFacade.closeTabDerived).toHaveBeenCalled();
      expect(service.files()).toEqual(derivedState.files);
    });

    it('addNewTab delegates and clears history', () => {
      (workspaceFacade.addNewTabDerived as jest.Mock).mockReturnValue(derivedState);

      service.addNewTab();

      expect(workspaceFacade.addNewTabDerived).toHaveBeenCalled();
      expect(service.history()).toEqual([]);
    });

    it('closeOtherTabs delegates', () => {
      (workspaceFacade.closeOtherTabsDerived as jest.Mock).mockReturnValue(derivedState);

      service.closeOtherTabs(0);

      expect(workspaceFacade.closeOtherTabsDerived).toHaveBeenCalled();
    });

    it('reorderTabs delegates', () => {
      (workspaceFacade.reorderTabsDerived as jest.Mock).mockReturnValue(derivedState);
      service.applyState({ files: [makeFileTab()], currentFileIndex: 0, currentEnv: '' });

      service.reorderTabs(0, 1);

      expect(workspaceFacade.reorderTabsDerived).toHaveBeenCalled();
    });
  });

  describe('onHistoryUpdated', () => {
    it('updates history when active file matches', () => {
      const file = makeFileTab({ id: 'abc' });
      service.applyState({ files: [file], currentFileIndex: 0, currentEnv: '' });

      const historyItems: HistoryItem[] = [
        { timestamp: new Date(), method: 'GET', url: 'http://example.com', status: 200, statusText: 'OK', responseTime: 100, responseData: {} as any },
      ];

      service.onHistoryUpdated({ fileId: 'abc', history: historyItems });

      expect(historyStore.set).toHaveBeenCalledWith('abc', historyItems);
      expect(service.history()).toEqual(historyItems);
    });

    it('does not update history when file id does not match', () => {
      const file = makeFileTab({ id: 'abc' });
      service.applyState({ files: [file], currentFileIndex: 0, currentEnv: '' });

      service.onHistoryUpdated({ fileId: 'xyz', history: [] });

      expect(historyStore.set).toHaveBeenCalledWith('xyz', []);
      // history stays as whatever it was
    });
  });

  describe('selectedHistoryItem', () => {
    it('starts null and can be set', () => {
      expect(service.selectedHistoryItem()).toBeNull();
      const item: HistoryItem = {
        timestamp: new Date(), method: 'GET', url: '/', status: 200,
        statusText: 'OK', responseTime: 50, responseData: {} as any,
      };
      service.selectedHistoryItem.set(item);
      expect(service.selectedHistoryItem()).toBe(item);
    });
  });
});
