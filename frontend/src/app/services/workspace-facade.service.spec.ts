import { Injector, inject, runInInjectionContext } from '@angular/core';
import type { FileTab } from '../models/http.models';
import { HttpService } from './http.service';
import { HistoryStoreService } from './history-store.service';
import { WorkspaceFacadeService } from './workspace-facade.service';

describe('WorkspaceFacadeService.initializeFromStorage', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('returns shouldAddNewTab=true when no saved files', () => {
    const httpMock: Pick<HttpService, 'loadFiles'> = {
      loadFiles: jest.fn().mockReturnValue([])
    };

    const injector = Injector.create({
      providers: [
        WorkspaceFacadeService,
        { provide: HttpService, useValue: httpMock },
        { provide: HistoryStoreService, useValue: {} }
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
      loadFiles: jest.fn().mockReturnValue([file])
    };

    const injector = Injector.create({
      providers: [
        WorkspaceFacadeService,
        { provide: HttpService, useValue: httpMock },
        { provide: HistoryStoreService, useValue: {} }
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
