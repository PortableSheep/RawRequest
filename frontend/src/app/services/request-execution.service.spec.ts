import { TestBed } from '@angular/core/testing';
import { ChangeDetectorRef } from '@angular/core';
import { Subject } from 'rxjs';
import { RequestExecutionService, RequestExecutionDelegate } from './request-execution.service';
import { HttpService } from './http.service';
import { SecretService } from './secret.service';
import { ToastService } from './toast.service';
import { LoadTestVisualizationService } from './load-test-visualization.service';
import { PanelVisibilityService } from './panel-visibility.service';
import type { FileTab, ResponseData, ActiveRunProgress, ChainEntryPreview } from '../models/http.models';

function makeFileTab(overrides: Partial<FileTab> = {}): FileTab {
  return {
    id: 'test-file',
    name: 'test.http',
    content: '',
    requests: [],
    environments: {},
    variables: {},
    responseData: {},
    groups: [],
    selectedEnv: '',
    ...overrides,
  };
}

function makeRequest(overrides: any = {}) {
  return {
    method: 'GET',
    url: 'https://example.com',
    headers: [],
    body: '',
    name: '',
    ...overrides,
  };
}

function makeDelegate(): { [K in keyof RequestExecutionDelegate]: jest.Mock } {
  return {
    executeRequestByIndex: jest.fn(),
    cancelActiveRequest: jest.fn(),
  };
}

function makeCdr(): { detectChanges: jest.Mock } {
  return { detectChanges: jest.fn() };
}

describe('RequestExecutionService', () => {
  let service: RequestExecutionService;
  let toast: { info: jest.Mock; error: jest.Mock; success: jest.Mock };
  let loadTestViz: {
    initializeLoadRun: jest.Mock;
    startActiveRunTick: jest.Mock;
    stopActiveRunTick: jest.Mock;
    applyResetPatch: jest.Mock;
    pushLoadUsersSample: jest.Mock;
    activeRunNowMs: number;
    activeRunProgress: any;
    loadTestMetrics: any;
  };
  let panels: PanelVisibilityService;
  let httpService: { downloadProgress$: Subject<any> };

  beforeEach(() => {
    const downloadProgress$ = new Subject<any>();

    TestBed.configureTestingModule({
      providers: [
        RequestExecutionService,
        {
          provide: HttpService,
          useValue: { downloadProgress$ },
        },
        {
          provide: SecretService,
          useValue: { replaceSecrets: jest.fn().mockResolvedValue('resolved') },
        },
        {
          provide: ToastService,
          useValue: { info: jest.fn(), error: jest.fn(), success: jest.fn() },
        },
        {
          provide: LoadTestVisualizationService,
          useValue: {
            initializeLoadRun: jest.fn(),
            startActiveRunTick: jest.fn(),
            stopActiveRunTick: jest.fn(),
            applyResetPatch: jest.fn(),
            pushLoadUsersSample: jest.fn(),
            activeRunNowMs: Date.now(),
            activeRunProgress: null,
            loadTestMetrics: null,
          },
        },
        PanelVisibilityService,
      ],
    });

    service = TestBed.inject(RequestExecutionService);
    toast = TestBed.inject(ToastService) as any;
    loadTestViz = TestBed.inject(LoadTestVisualizationService) as any;
    panels = TestBed.inject(PanelVisibilityService);
    httpService = TestBed.inject(HttpService) as any;
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('initial state', () => {
    it('should have no request running', () => {
      expect(service.isRequestRunning).toBe(false);
      expect(service.isRequestRunningSignal()).toBe(false);
    });

    it('should have no pending request', () => {
      expect(service.pendingRequestIndex).toBeNull();
      expect(service.pendingRequestIndexSignal()).toBeNull();
    });

    it('should have no last executed request', () => {
      expect(service.lastExecutedRequestIndex).toBeNull();
      expect(service.lastExecutedRequestIndexSignal()).toBeNull();
    });

    it('should have no download progress', () => {
      expect(service.downloadProgressSignal()).toBeNull();
    });

    it('should have no active request info', () => {
      expect(service.activeRequestInfo).toBeNull();
    });

    it('should not be cancelling', () => {
      expect(service.isCancellingActiveRequest).toBe(false);
    });
  });

  describe('onRequestExecute', () => {
    it('should queue request when one is already running', () => {
      service.isRequestRunning = true;
      const delegate = makeDelegate();
      service.setDelegate(delegate);

      service.onRequestExecute(1, [makeFileTab()], 0, '', makeCdr());

      expect(delegate.executeRequestByIndex).not.toHaveBeenCalled();
    });

    it('should not execute when file has no requests', () => {
      const delegate = makeDelegate();
      service.setDelegate(delegate);

      service.onRequestExecute(0, [makeFileTab()], 0, '', makeCdr());

      expect(delegate.executeRequestByIndex).not.toHaveBeenCalled();
    });

    it('should not execute without a delegate', () => {
      const file = makeFileTab({ requests: [makeRequest()] });
      // No delegate set
      service.onRequestExecute(0, [file], 0, '', makeCdr());

      expect(service.isRequestRunning).toBe(false);
    });

    it('should set running state and delegate execution', () => {
      const delegate = makeDelegate();
      delegate.executeRequestByIndex.mockResolvedValue(undefined);
      service.setDelegate(delegate);

      const file = makeFileTab({ requests: [makeRequest()] });
      service.onRequestExecute(0, [file], 0, '', makeCdr());

      expect(service.isRequestRunning).toBe(true);
      expect(service.isRequestRunningSignal()).toBe(true);
      expect(service.pendingRequestIndex).toBe(0);
      expect(service.pendingRequestIndexSignal()).toBe(0);
      expect(service.activeRequestInfo).toBeTruthy();
      expect(service.isCancellingActiveRequest).toBe(false);
      expect(delegate.executeRequestByIndex).toHaveBeenCalledWith(0, expect.any(String));
    });

    it('should clear last executed request index', () => {
      const delegate = makeDelegate();
      delegate.executeRequestByIndex.mockResolvedValue(undefined);
      service.setDelegate(delegate);
      service.lastExecutedRequestIndex = 2;
      service.lastExecutedRequestIndexSignal.set(2);

      const file = makeFileTab({ requests: [makeRequest()] });
      service.onRequestExecute(0, [file], 0, '', makeCdr());

      expect(service.lastExecutedRequestIndex).toBeNull();
      expect(service.lastExecutedRequestIndexSignal()).toBeNull();
    });

    it('should clear download progress on new request', () => {
      const delegate = makeDelegate();
      delegate.executeRequestByIndex.mockResolvedValue(undefined);
      service.setDelegate(delegate);
      service.downloadProgressSignal.set({ downloaded: 100, total: 200 });

      const file = makeFileTab({ requests: [makeRequest()] });
      service.onRequestExecute(0, [file], 0, '', makeCdr());

      expect(service.downloadProgressSignal()).toBeNull();
    });

    it('should initialize load test visualization', () => {
      const delegate = makeDelegate();
      delegate.executeRequestByIndex.mockResolvedValue(undefined);
      service.setDelegate(delegate);

      const file = makeFileTab({ requests: [makeRequest()] });
      service.onRequestExecute(0, [file], 0, '', makeCdr());

      expect(loadTestViz.initializeLoadRun).toHaveBeenCalled();
      expect(loadTestViz.startActiveRunTick).toHaveBeenCalled();
    });
  });

  describe('onRequestExecuted', () => {
    it('should set last executed index and reset running state', () => {
      // Simulate running state
      service.isRequestRunning = true;
      service.isRequestRunningSignal.set(true);
      service.pendingRequestIndex = 0;
      service.pendingRequestIndexSignal.set(0);

      const response = { status: 200 } as unknown as ResponseData;
      service.onRequestExecuted({ requestIndex: 0, response });

      expect(service.lastExecutedRequestIndex).toBe(0);
      expect(service.lastExecutedRequestIndexSignal()).toBe(0);
      expect(service.isRequestRunning).toBe(false);
      expect(service.isRequestRunningSignal()).toBe(false);
    });

    it('should show load test results when response contains metrics', () => {
      const response = { status: 200, loadTestMetrics: { totalRequests: 100 } } as any;
      service.onRequestExecuted({ requestIndex: 0, response });

      expect(loadTestViz.loadTestMetrics).toEqual({ totalRequests: 100 });
      expect(panels.showLoadTestResults()).toBe(true);
    });
  });

  describe('onRequestProgress', () => {
    it('should ignore progress when no active request', () => {
      const progress = { requestId: 'abc', type: 'load' } as any;
      service.onRequestProgress(progress);
      // No error thrown
    });

    it('should ignore progress for different request id', () => {
      service.activeRequestInfo = {
        id: 'xyz',
        label: 'test',
        requestIndex: 0,
        canCancel: true,
        type: 'single',
        startedAt: Date.now(),
      };

      const progress = { requestId: 'abc', type: 'load' } as any;
      service.onRequestProgress(progress);

      expect(loadTestViz.pushLoadUsersSample).not.toHaveBeenCalled();
    });

    it('should update load test viz for matching progress', () => {
      service.activeRequestInfo = {
        id: 'abc',
        label: 'test',
        requestIndex: 0,
        canCancel: true,
        type: 'load',
        startedAt: Date.now(),
      };

      const progress: ActiveRunProgress = {
        requestId: 'abc',
        type: 'load',
        activeUsers: 10,
      } as any;
      service.onRequestProgress(progress);

      expect(loadTestViz.activeRunProgress).toEqual(progress);
      expect(loadTestViz.pushLoadUsersSample).toHaveBeenCalledWith(10);
    });
  });

  describe('onReplayRequest', () => {
    it('should replay primary entry by last executed index', () => {
      const delegate = makeDelegate();
      delegate.executeRequestByIndex.mockResolvedValue(undefined);
      service.setDelegate(delegate);
      service.lastExecutedRequestIndexSignal.set(0);

      const file = makeFileTab({ requests: [makeRequest()] });
      const entry: ChainEntryPreview = {
        isPrimary: true,
        request: makeRequest(),
      } as any;

      service.onReplayRequest(entry, [file], 0, '', makeCdr());

      expect(delegate.executeRequestByIndex).toHaveBeenCalled();
    });

    it('should find request by name for non-primary entry', () => {
      const delegate = makeDelegate();
      delegate.executeRequestByIndex.mockResolvedValue(undefined);
      service.setDelegate(delegate);

      const file = makeFileTab({
        requests: [makeRequest({ name: 'login' }), makeRequest({ name: 'getData' })],
      });
      const entry: ChainEntryPreview = {
        isPrimary: false,
        request: makeRequest({ name: 'getData' }),
      } as any;

      service.onReplayRequest(entry, [file], 0, '', makeCdr());

      expect(delegate.executeRequestByIndex).toHaveBeenCalled();
    });

    it('should toast when request not found', () => {
      const delegate = makeDelegate();
      service.setDelegate(delegate);

      const file = makeFileTab({ requests: [makeRequest({ name: 'login' })] });
      const entry: ChainEntryPreview = {
        isPrimary: false,
        request: makeRequest({ name: 'nonexistent', method: 'DELETE', url: 'http://nope' }),
      } as any;

      service.onReplayRequest(entry, [file], 0, '', makeCdr());

      expect(toast.info).toHaveBeenCalledWith('Request not found in editor; cannot replay.');
      expect(delegate.executeRequestByIndex).not.toHaveBeenCalled();
    });
  });

  describe('getActiveRequestDetails', () => {
    it('should return null when no active request', () => {
      const file = makeFileTab({ requests: [makeRequest()] });
      expect(service.getActiveRequestDetails(file)).toBeNull();
    });

    it('should return request at active index', () => {
      const req = makeRequest({ name: 'test' });
      service.activeRequestInfo = {
        id: 'abc',
        label: 'test',
        requestIndex: 0,
        canCancel: true,
        type: 'single',
        startedAt: Date.now(),
      };

      const file = makeFileTab({ requests: [req] });
      expect(service.getActiveRequestDetails(file)).toEqual(req);
    });
  });

  describe('cancelActiveRequest', () => {
    it('should not cancel when no active request', async () => {
      const delegate = makeDelegate();
      service.setDelegate(delegate);

      await service.cancelActiveRequest();

      expect(delegate.cancelActiveRequest).not.toHaveBeenCalled();
    });

    it('should cancel and toast on success', async () => {
      const delegate = makeDelegate();
      delegate.cancelActiveRequest.mockResolvedValue(undefined);
      service.setDelegate(delegate);

      service.activeRequestInfo = {
        id: 'abc',
        label: 'test',
        requestIndex: 0,
        canCancel: true,
        type: 'single',
        startedAt: Date.now(),
      };

      await service.cancelActiveRequest();

      expect(service.isCancellingActiveRequest).toBe(true);
      expect(delegate.cancelActiveRequest).toHaveBeenCalled();
      expect(toast.info).toHaveBeenCalledWith('Request cancelled');
    });

    it('should toast error on cancel failure', async () => {
      const delegate = makeDelegate();
      delegate.cancelActiveRequest.mockRejectedValue(new Error('fail'));
      service.setDelegate(delegate);

      service.activeRequestInfo = {
        id: 'abc',
        label: 'test',
        requestIndex: 0,
        canCancel: true,
        type: 'single',
        startedAt: Date.now(),
      };

      await service.cancelActiveRequest();

      expect(toast.error).toHaveBeenCalledWith('Failed to cancel request');
      expect(service.isCancellingActiveRequest).toBe(false);
    });

    it('should not cancel when already cancelling', async () => {
      const delegate = makeDelegate();
      service.setDelegate(delegate);

      service.activeRequestInfo = {
        id: 'abc',
        label: 'test',
        requestIndex: 0,
        canCancel: true,
        type: 'single',
        startedAt: Date.now(),
      };
      service.isCancellingActiveRequest = true;

      await service.cancelActiveRequest();

      expect(delegate.cancelActiveRequest).not.toHaveBeenCalled();
    });
  });

  describe('subscribeToDownloadProgress', () => {
    it('should update download progress for matching request', () => {
      const destroy$ = new Subject<void>();
      service.activeRequestInfo = {
        id: 'req-1',
        label: 'test',
        requestIndex: 0,
        canCancel: true,
        type: 'single',
        startedAt: Date.now(),
      };

      service.subscribeToDownloadProgress(destroy$);

      httpService.downloadProgress$.next({
        requestId: 'req-1',
        downloaded: 500,
        total: 1000,
      });

      expect(service.downloadProgress).toEqual({ downloaded: 500, total: 1000 });
      expect(service.downloadProgressSignal()).toEqual({ downloaded: 500, total: 1000 });

      destroy$.next();
      destroy$.complete();
    });

    it('should ignore download progress for different request', () => {
      const destroy$ = new Subject<void>();
      service.activeRequestInfo = {
        id: 'req-1',
        label: 'test',
        requestIndex: 0,
        canCancel: true,
        type: 'single',
        startedAt: Date.now(),
      };

      service.subscribeToDownloadProgress(destroy$);

      httpService.downloadProgress$.next({
        requestId: 'req-other',
        downloaded: 500,
        total: 1000,
      });

      expect(service.downloadProgress).toBeNull();
      expect(service.downloadProgressSignal()).toBeNull();

      destroy$.next();
      destroy$.complete();
    });
  });

  describe('queuedExecutionRequested', () => {
    it('should emit queued request index after execution completes', () => {
      const delegate = makeDelegate();
      delegate.executeRequestByIndex.mockResolvedValue(undefined);
      service.setDelegate(delegate);

      // Start a request
      const file = makeFileTab({
        requests: [makeRequest(), makeRequest({ name: 'second' })],
      });
      service.onRequestExecute(0, [file], 0, '', makeCdr());

      // Queue another
      service.onRequestExecute(1, [file], 0, '', makeCdr());

      let emittedIndex: number | null = null;
      service.queuedExecutionRequested.subscribe((idx) => {
        emittedIndex = idx;
      });

      // Complete the first request
      service.onRequestExecuted({
        requestIndex: 0,
        response: { status: 200 } as unknown as ResponseData,
      });

      expect(emittedIndex).toBe(1);
    });
  });
});
