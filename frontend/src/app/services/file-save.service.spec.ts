import { TestBed } from '@angular/core/testing';
import { FileSaveService } from './file-save.service';
import { WorkspaceStateService } from './workspace-state.service';
import { HttpService } from './http.service';
import { HistoryStoreService } from './history-store.service';
import { WorkspaceFacadeService } from './workspace-facade.service';

// Mock Wails imports
const mockSaveFileContents = jest.fn();
const mockShowSaveDialog = jest.fn();
const mockMigrateResponses = jest.fn();

jest.mock('@wailsjs/go/main/App', () => ({
  SaveFileContents: (...args: any[]) => mockSaveFileContents(...args),
  ShowSaveDialog: (...args: any[]) => mockShowSaveDialog(...args),
  MigrateResponsesFromRunLocationToHttpFile: (...args: any[]) => mockMigrateResponses(...args),
}));

describe('FileSaveService', () => {
  let service: FileSaveService;
  let mockState: any;
  let mockHttp: any;
  let mockHistoryStore: any;

  beforeEach(() => {
    mockState = {
      getCurrentFile: jest.fn(),
      currentFileIndex: jest.fn().mockReturnValue(0),
      files: jest.fn().mockReturnValue([]),
      replaceFileAtIndex: jest.fn(),
      history: { set: jest.fn() },
    };
    mockHttp = {
      saveFiles: jest.fn(),
      loadHistory: jest.fn().mockResolvedValue([]),
    };
    mockHistoryStore = {
      delete: jest.fn(),
      set: jest.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        FileSaveService,
        { provide: WorkspaceStateService, useValue: mockState },
        { provide: HttpService, useValue: mockHttp },
        { provide: HistoryStoreService, useValue: mockHistoryStore },
        { provide: WorkspaceFacadeService, useValue: {} },
      ],
    });
    service = TestBed.inject(FileSaveService);

    jest.clearAllMocks();
  });

  describe('saveCurrentFile', () => {
    it('should do nothing if no current file', async () => {
      mockState.getCurrentFile.mockReturnValue(null);
      await service.saveCurrentFile();
      expect(mockSaveFileContents).not.toHaveBeenCalled();
    });

    it('should save to existing path without dialog', async () => {
      mockState.getCurrentFile.mockReturnValue({
        id: 'file1',
        filePath: '/test/file.http',
        content: 'GET /api',
        name: 'file.http',
      });
      mockSaveFileContents.mockResolvedValue(undefined);

      await service.saveCurrentFile();

      expect(mockSaveFileContents).toHaveBeenCalledWith('/test/file.http', 'GET /api');
      expect(mockShowSaveDialog).not.toHaveBeenCalled();
    });

    it('should show save dialog for new files', async () => {
      mockState.getCurrentFile.mockReturnValue({
        id: 'unsaved-1',
        filePath: '',
        content: 'POST /api',
        name: 'Untitled',
      });
      mockShowSaveDialog.mockResolvedValue('/new/path.http');
      mockSaveFileContents.mockResolvedValue(undefined);
      mockMigrateResponses.mockResolvedValue(undefined);
      mockState.files.mockReturnValue([{ id: 'new-id' }]);

      await service.saveCurrentFile();

      expect(mockShowSaveDialog).toHaveBeenCalled();
      expect(mockSaveFileContents).toHaveBeenCalledWith('/new/path.http', 'POST /api');
    });

    it('should not save if dialog is cancelled', async () => {
      mockState.getCurrentFile.mockReturnValue({
        id: 'unsaved-1',
        filePath: '',
        content: 'POST /api',
        name: 'Untitled',
      });
      mockShowSaveDialog.mockResolvedValue('');

      await service.saveCurrentFile();

      expect(mockSaveFileContents).not.toHaveBeenCalled();
    });

    it('should handle save errors gracefully', async () => {
      mockState.getCurrentFile.mockReturnValue({
        id: 'file1',
        filePath: '/test/file.http',
        content: 'GET /api',
        name: 'file.http',
      });
      mockSaveFileContents.mockRejectedValue(new Error('disk full'));
      const spy = jest.spyOn(console, 'error').mockImplementation();

      await service.saveCurrentFile();

      expect(spy).toHaveBeenCalledWith('Failed to save file:', expect.any(Error));
      spy.mockRestore();
    });
  });

  describe('saveCurrentFileAs', () => {
    it('should do nothing if no current file', async () => {
      mockState.getCurrentFile.mockReturnValue(null);
      await service.saveCurrentFileAs();
      expect(mockShowSaveDialog).not.toHaveBeenCalled();
    });

    it('should show dialog and save to new path', async () => {
      mockState.getCurrentFile.mockReturnValue({
        id: 'file1',
        filePath: '/old/path.http',
        content: 'GET /api',
        name: 'path.http',
      });
      mockShowSaveDialog.mockResolvedValue('/new/path.http');
      mockSaveFileContents.mockResolvedValue(undefined);
      mockState.files.mockReturnValue([{ id: 'new-id' }]);
      mockHttp.loadHistory.mockResolvedValue([]);

      await service.saveCurrentFileAs();

      expect(mockShowSaveDialog).toHaveBeenCalled();
      expect(mockSaveFileContents).toHaveBeenCalledWith('/new/path.http', 'GET /api');
      expect(mockState.replaceFileAtIndex).toHaveBeenCalled();
      expect(mockHttp.saveFiles).toHaveBeenCalled();
    });

    it('should not save if dialog is cancelled', async () => {
      mockState.getCurrentFile.mockReturnValue({
        id: 'file1',
        filePath: '/old/path.http',
        content: 'GET /api',
        name: 'path.http',
      });
      mockShowSaveDialog.mockResolvedValue('');

      await service.saveCurrentFileAs();

      expect(mockSaveFileContents).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      mockState.getCurrentFile.mockReturnValue({
        id: 'file1',
        filePath: '/old/path.http',
        content: 'GET /api',
        name: 'path.http',
      });
      mockShowSaveDialog.mockRejectedValue(new Error('dialog error'));
      const spy = jest.spyOn(console, 'error').mockImplementation();

      await service.saveCurrentFileAs();

      expect(spy).toHaveBeenCalledWith('Failed to save file as:', expect.any(Error));
      spy.mockRestore();
    });
  });
});
