import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { RequestManagerService } from './request-manager.service';
import { HttpService } from './http.service';
import { NotificationService } from './notification.service';
import { MockServerService } from './mock-server.service';
import { WorkspaceStateService } from './workspace-state.service';
import {
  Request,
  FileTab,
  ResponseData,
  LoadTestResults,
  LoadTestMetrics,
} from '../models/http.models';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    url: 'https://example.com/api',
    headers: { Accept: 'application/json' },
    ...overrides
  };
}

function makeResponseData(overrides: Partial<ResponseData> = {}): ResponseData {
  return {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    body: '{"ok":true}',
    responseTime: 42,
    processedUrl: 'https://example.com/api',
    requestPreview: {
      method: 'GET',
      url: 'https://example.com/api',
      headers: { Accept: 'application/json' }
    },
    ...overrides
  };
}

function makeFileTab(overrides: Partial<FileTab> = {}): FileTab {
  return {
    id: 'file-1',
    name: 'test.http',
    content: 'GET https://example.com/api',
    requests: [makeRequest()],
    environments: {},
    variables: {},
    responseData: {},
    groups: [],
    ...overrides
  };
}

function makeLoadTestResults(overrides: Partial<LoadTestResults> = {}): LoadTestResults {
  return {
    totalRequests: 100,
    successfulRequests: 95,
    failedRequests: 5,
    responseTimes: [10, 20, 30],
    errors: [],
    startTime: 1000,
    endTime: 2000,
    ...overrides
  };
}

function makeLoadTestMetrics(overrides: Partial<LoadTestMetrics> = {}): LoadTestMetrics {
  return {
    totalRequests: 100,
    successfulRequests: 95,
    failedRequests: 5,
    requestsPerSecond: 100,
    averageResponseTime: 20,
    p50: 18,
    p95: 35,
    p99: 45,
    minResponseTime: 5,
    maxResponseTime: 50,
    errorRate: 0.05,
    duration: 1,
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Mock services
// ---------------------------------------------------------------------------

function createMockHttpService(): vi.Mocked<Pick<
  HttpService,
  'sendRequest' | 'executeChain' | 'executeLoadTest' | 'calculateLoadTestMetrics' | 'cancelRequest' | 'addToHistory'
>> {
  return {
    sendRequest: vi.fn().mockResolvedValue(makeResponseData()),
    executeChain: vi.fn().mockResolvedValue({
      responses: [makeResponseData()],
      requestPreviews: [{ method: 'GET', url: 'https://example.com/api', headers: {} }]
    }),
    executeLoadTest: vi.fn().mockResolvedValue(makeLoadTestResults()),
    calculateLoadTestMetrics: vi.fn().mockReturnValue(makeLoadTestMetrics()),
    cancelRequest: vi.fn().mockResolvedValue(undefined),
    addToHistory: vi.fn().mockResolvedValue([])
  };
}

function createMockNotificationService(): vi.Mocked<Pick<
  NotificationService,
  'notifyRequestComplete' | 'notifyChainComplete' | 'notifyLoadTestComplete'
>> {
  return {
    notifyRequestComplete: vi.fn().mockResolvedValue(undefined),
    notifyChainComplete: vi.fn().mockResolvedValue(undefined),
    notifyLoadTestComplete: vi.fn().mockResolvedValue(undefined)
  };
}

function createMockWorkspaceStateService(files: FileTab[], currentFileIndex = 0, currentEnv = '') {
  return {
    files: signal(files),
    currentFileIndex: signal(currentFileIndex),
    currentEnv: signal(currentEnv),
    onFilesChange: vi.fn(),
    onHistoryUpdated: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RequestManagerService', () => {
  let service: RequestManagerService;
  let mockHttp: ReturnType<typeof createMockHttpService>;
  let mockNotification: ReturnType<typeof createMockNotificationService>;
  let mockMockServer: any;
  let mockWs: ReturnType<typeof createMockWorkspaceStateService>;

  function configure(files: FileTab[], currentFileIndex = 0, currentEnv = ''): void {
    TestBed.resetTestingModule();
    mockHttp = createMockHttpService();
    mockNotification = createMockNotificationService();
    mockMockServer = {
      status: signal({ running: false, port: 8080, dbPath: '' }),
      logs: signal([])
    };
    mockWs = createMockWorkspaceStateService(files, currentFileIndex, currentEnv);

    TestBed.configureTestingModule({
      providers: [
        RequestManagerService,
        { provide: HttpService, useValue: mockHttp },
        { provide: NotificationService, useValue: mockNotification },
        { provide: MockServerService, useValue: mockMockServer },
        { provide: WorkspaceStateService, useValue: mockWs },
      ],
    });

    service = TestBed.inject(RequestManagerService);
  }

  beforeEach(() => {
    configure([makeFileTab()]);
  });

  // -----------------------------------------------------------------------
  // Creation
  // -----------------------------------------------------------------------

  it('should create', () => {
    expect(service).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // Single request execution
  // -----------------------------------------------------------------------

  describe('executeRequest', () => {
    it('should call httpService.sendRequest for a simple request', async () => {
      await service.executeRequest(0);

      expect(mockHttp.sendRequest).toHaveBeenCalledTimes(1);
      expect(mockHttp.sendRequest).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'GET', url: 'https://example.com/api' }),
        expect.any(Object),
        expect.any(String),
        expect.any(String)
      );
    });

    it('should push updated files to workspace state with response data', async () => {
      await service.executeRequest(0);

      expect(mockWs.onFilesChange).toHaveBeenCalledTimes(1);
      const updatedFiles: FileTab[] = mockWs.onFilesChange.mock.calls[0][0];
      expect(updatedFiles[0].responseData[0]).toBeDefined();
      expect(updatedFiles[0].responseData[0].status).toBe(200);
    });

    it('should emit requestExecuted with requestIndex and response', async () => {
      const spy = vi.fn();
      service.requestExecuted.subscribe(spy);

      await service.executeRequest(0);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          requestIndex: 0,
          response: expect.objectContaining({ status: 200 })
        })
      );
    });

    it('should notify on request completion', async () => {
      await service.executeRequest(0);

      expect(mockNotification.notifyRequestComplete).toHaveBeenCalledWith(
        undefined, // name from the default request
        200,
        42
      );
    });

    it('should push history entry after execution', async () => {
      await service.executeRequest(0);

      expect(mockHttp.addToHistory).toHaveBeenCalledTimes(1);
      expect(mockHttp.addToHistory).toHaveBeenCalledWith(
        'file-1',
        expect.objectContaining({ method: 'GET', status: 200 }),
        undefined,
        expect.any(Object)
      );
    });

    it('should push updated history to workspace state after execution', async () => {
      await service.executeRequest(0);

      expect(mockWs.onHistoryUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ fileId: 'file-1', history: [] })
      );
    });

    it('should not execute if already executing', async () => {
      // Start first execution (don't await)
      const first = service.executeRequest(0);
      // Attempt second while first is in progress
      const second = service.executeRequest(0);

      await Promise.all([first, second]);

      expect(mockHttp.sendRequest).toHaveBeenCalledTimes(1);
    });

    it('should return early for invalid request index', async () => {
      await service.executeRequest(99);

      expect(mockHttp.sendRequest).not.toHaveBeenCalled();
    });

    it('should return early when files array has no current file', async () => {
      configure([]);

      await service.executeRequest(0);

      expect(mockHttp.sendRequest).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Relative URLs and Mock Server Integration
  // -----------------------------------------------------------------------

  describe('relative URLs and mock server integration', () => {
    it('should prepend mock server port when mock server is running', async () => {
      configure([
        makeFileTab({
          requests: [makeRequest({ url: '/users' })]
        })
      ]);
      mockMockServer.status.set({ running: true, port: 9090, dbPath: '' });

      await service.executeRequest(0);

      expect(mockHttp.sendRequest).toHaveBeenCalledTimes(1);
      expect(mockHttp.sendRequest).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'http://localhost:9090/users' }),
        expect.any(Object),
        expect.any(String),
        expect.any(String)
      );
    });

    it('should handle mock-offline error response when mock server is offline', async () => {
      configure([
        makeFileTab({
          requests: [makeRequest({ url: '/users' })]
        })
      ]);
      mockMockServer.status.set({ running: false, port: 9090, dbPath: '' });

      await service.executeRequest(0);

      expect(mockHttp.sendRequest).not.toHaveBeenCalled();
      expect(mockWs.onFilesChange).toHaveBeenCalledTimes(1);
      const updatedFiles: FileTab[] = mockWs.onFilesChange.mock.calls[0][0];
      expect(updatedFiles[0].responseData[0]).toBeDefined();
      expect(updatedFiles[0].responseData[0].status).toBe(0);
      expect(updatedFiles[0].responseData[0].statusText).toBe('Mock Server Offline');
      expect(updatedFiles[0].responseData[0].body).toContain('requires a running mock server');
    });
  });

  // -----------------------------------------------------------------------
  // executeRequestByIndex (dedup guard)
  // -----------------------------------------------------------------------

  describe('executeRequestByIndex', () => {
    it('should delegate to executeRequest', async () => {
      const spy = vi.spyOn(service, 'executeRequest');

      await service.executeRequestByIndex(0);

      expect(spy).toHaveBeenCalledWith(0, undefined);
    });

    it('should skip duplicate execution for the same index while executing', async () => {
      const spy = vi.spyOn(service, 'executeRequest');

      const first = service.executeRequestByIndex(0);
      const second = service.executeRequestByIndex(0);

      await Promise.all([first, second]);

      // First call triggers executeRequest, second is skipped by dedup guard
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  describe('error handling', () => {
    it('should emit error response on sendRequest failure', async () => {
      mockHttp.sendRequest.mockRejectedValue(new Error('Network Error'));

      const spy = vi.fn();
      service.requestExecuted.subscribe(spy);

      await service.executeRequest(0);

      expect(spy).toHaveBeenCalledTimes(1);
      const emitted = spy.mock.calls[0][0];
      expect(emitted.response.status).toBe(0);
      expect(emitted.response.statusText).toBe('Network Error');
    });

    it('should push files with error response on failure', async () => {
      mockHttp.sendRequest.mockRejectedValue(new Error('Connection refused'));

      await service.executeRequest(0);

      expect(mockWs.onFilesChange).toHaveBeenCalledTimes(1);
      const updatedFiles: FileTab[] = mockWs.onFilesChange.mock.calls[0][0];
      expect(updatedFiles[0].responseData[0].status).toBe(0);
    });

    it('should push error history on failure', async () => {
      mockHttp.sendRequest.mockRejectedValue(new Error('Timeout'));

      await service.executeRequest(0);

      expect(mockHttp.addToHistory).toHaveBeenCalledTimes(1);
      expect(mockHttp.addToHistory).toHaveBeenCalledWith(
        'file-1',
        expect.objectContaining({ status: 0 }),
        undefined,
        expect.any(Object)
      );
    });

    it('should reset executing state after error', async () => {
      mockHttp.sendRequest.mockRejectedValue(new Error('fail'));

      await service.executeRequest(0);

      // Should be able to execute again (not stuck in executing state)
      mockHttp.sendRequest.mockResolvedValue(makeResponseData());
      await service.executeRequest(0);

      expect(mockHttp.sendRequest).toHaveBeenCalledTimes(2);
    });
  });

  // -----------------------------------------------------------------------
  // Request cancellation
  // -----------------------------------------------------------------------

  describe('cancellation', () => {
    it('should handle cancellation error gracefully', async () => {
      mockHttp.sendRequest.mockRejectedValue({ cancelled: true });

      const execSpy = vi.fn();
      service.requestExecuted.subscribe(execSpy);

      await service.executeRequest(0);

      // Should emit cancelled response
      expect(mockWs.onFilesChange).toHaveBeenCalledTimes(1);
      expect(execSpy).toHaveBeenCalledTimes(1);
      const emitted = execSpy.mock.calls[0][0];
      expect(emitted.response.statusText).toContain('Cancelled');
    });

    it('should not push history for cancelled requests', async () => {
      mockHttp.sendRequest.mockRejectedValue({ cancelled: true });

      await service.executeRequest(0);

      expect(mockHttp.addToHistory).not.toHaveBeenCalled();
    });

    it('cancelActiveRequest should call httpService.cancelRequest', async () => {
      // Start a request to set activeRequestId
      const promise = service.executeRequest(0);

      // Cancel while running
      await service.cancelActiveRequest();

      await promise;

      expect(mockHttp.cancelRequest).toHaveBeenCalled();
    });

    it('cancelActiveRequest should do nothing when no active request', async () => {
      await service.cancelActiveRequest();

      expect(mockHttp.cancelRequest).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Chained request execution
  // -----------------------------------------------------------------------

  describe('chained request execution', () => {
    beforeEach(() => {
      configure([
        makeFileTab({
          requests: [
            makeRequest({ name: 'login', method: 'POST', url: 'https://api.example.com/login' }),
            makeRequest({ name: 'getData', depends: 'login' })
          ]
        })
      ]);
    });

    it('should call executeChain for requests with depends', async () => {
      await service.executeRequest(1);

      expect(mockHttp.executeChain).toHaveBeenCalledTimes(1);
      expect(mockHttp.sendRequest).not.toHaveBeenCalled();
    });

    it('should push files with chain response', async () => {
      await service.executeRequest(1);

      expect(mockWs.onFilesChange).toHaveBeenCalledTimes(1);
      const updatedFiles: FileTab[] = mockWs.onFilesChange.mock.calls[0][0];
      expect(updatedFiles[0].responseData[1]).toBeDefined();
    });

    it('should notify chain completion', async () => {
      await service.executeRequest(1);

      expect(mockNotification.notifyChainComplete).toHaveBeenCalledWith(
        1,     // chain length (responses count)
        42,    // total duration
        true   // all successful
      );
    });

    it('should report not all successful when chain has failures', async () => {
      mockHttp.executeChain.mockResolvedValue({
        responses: [makeResponseData({ status: 500, statusText: 'Error', responseTime: 100 })],
        requestPreviews: [{ method: 'GET', url: 'https://example.com', headers: {} }]
      });

      await service.executeRequest(1);

      expect(mockNotification.notifyChainComplete).toHaveBeenCalledWith(
        1,
        100,
        false
      );
    });

    it('should handle chain execution errors', async () => {
      mockHttp.executeChain.mockRejectedValue(new Error('Chain failed'));

      const spy = vi.fn();
      service.requestExecuted.subscribe(spy);

      await service.executeRequest(1);

      expect(spy).toHaveBeenCalledTimes(1);
      const emitted = spy.mock.calls[0][0];
      expect(emitted.response.statusText).toBe('Chain Error');
    });

    it('should handle cancellation during chain execution', async () => {
      mockHttp.executeChain.mockRejectedValue({ cancelled: true });

      await service.executeRequest(1);

      expect(mockWs.onFilesChange).toHaveBeenCalledTimes(1);
      const response = mockWs.onFilesChange.mock.calls[0][0][0].responseData[1];
      expect(response.statusText).toContain('Cancelled');
    });
  });

  // -----------------------------------------------------------------------
  // Load test execution
  // -----------------------------------------------------------------------

  describe('load test execution', () => {
    beforeEach(() => {
      configure([
        makeFileTab({
          requests: [
            makeRequest({
              name: 'loadTest',
              loadTest: { duration: '10s', users: 10 }
            })
          ]
        })
      ]);
    });

    it('should call executeLoadTest for requests with loadTest config', async () => {
      await service.executeRequest(0);

      expect(mockHttp.executeLoadTest).toHaveBeenCalledTimes(1);
      expect(mockHttp.sendRequest).not.toHaveBeenCalled();
    });

    it('should calculate metrics from load test results', async () => {
      await service.executeRequest(0);

      expect(mockHttp.calculateLoadTestMetrics).toHaveBeenCalledWith(
        expect.objectContaining({ totalRequests: 100 })
      );
    });

    it('should emit requestExecuted with loadTestMetrics', async () => {
      const spy = vi.fn();
      service.requestExecuted.subscribe(spy);

      await service.executeRequest(0);

      expect(spy).toHaveBeenCalledTimes(1);
      const emitted = spy.mock.calls[0][0];
      expect(emitted.response.loadTestMetrics).toBeDefined();
      expect(emitted.response.loadTestMetrics.totalRequests).toBe(100);
    });

    it('should notify load test completion', async () => {
      await service.executeRequest(0);

      expect(mockNotification.notifyLoadTestComplete).toHaveBeenCalledWith(
        'loadTest',
        100,
        1000, // endTime - startTime
        20    // averageResponseTime
      );
    });

    it('should emit requestProgress during load test', async () => {
      const progressSpy = vi.fn();
      service.requestProgress.subscribe(progressSpy);

      // Make executeLoadTest call the progress callback
      mockHttp.executeLoadTest.mockImplementation(
        async (_req, _vars, _env, _id, onProgress) => {
          if (onProgress) {
            onProgress({
              requestId: 'test-id',
              type: 'load',
              startedAt: Date.now(),
              totalSent: 50,
              done: false
            });
          }
          return makeLoadTestResults();
        }
      );

      await service.executeRequest(0);

      expect(progressSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'load', totalSent: 50 })
      );
    });

    it('should handle load test errors', async () => {
      mockHttp.executeLoadTest.mockRejectedValue(new Error('Load test timeout'));

      const spy = vi.fn();
      service.requestExecuted.subscribe(spy);

      await service.executeRequest(0);

      expect(spy).toHaveBeenCalledTimes(1);
      const emitted = spy.mock.calls[0][0];
      expect(emitted.response.statusText).toBe('Load Test Error');
    });
  });

  // -----------------------------------------------------------------------
  // Response data handling
  // -----------------------------------------------------------------------

  describe('response data handling', () => {
    it('should include chainItems in emitted response', async () => {
      const spy = vi.fn();
      service.requestExecuted.subscribe(spy);

      await service.executeRequest(0);

      const emitted = spy.mock.calls[0][0];
      expect(emitted.response.chainItems).toBeDefined();
      expect(Array.isArray(emitted.response.chainItems)).toBe(true);
    });

    it('should use named request in notification', async () => {
      configure([
        makeFileTab({
          requests: [makeRequest({ name: 'myEndpoint' })]
        })
      ]);

      await service.executeRequest(0);

      expect(mockNotification.notifyRequestComplete).toHaveBeenCalledWith(
        'myEndpoint',
        200,
        42
      );
    });
  });

  // -----------------------------------------------------------------------
  // Environment / variable handling
  // -----------------------------------------------------------------------

  describe('environment handling', () => {
    it('should pass combined variables to sendRequest', async () => {
      configure(
        [
          makeFileTab({
            variables: { baseUrl: 'https://api.example.com' },
            environments: { dev: { host: 'localhost' } }
          })
        ],
        0,
        'dev'
      );

      await service.executeRequest(0);

      expect(mockHttp.sendRequest).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ baseUrl: 'https://api.example.com' }),
        expect.any(String),
        expect.any(String)
      );
    });
  });
});
