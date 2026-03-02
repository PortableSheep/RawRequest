import { Injector, inject, runInInjectionContext } from '@angular/core';
import { BACKEND_CLIENT, BackendClientContract } from './backend-client.contract';
import { ScriptConsoleService } from './script-console.service';
import { SecretService } from './secret.service';
import { EventTransportService } from './event-transport.service';
import { HttpService, DownloadProgress } from './http.service';
import type { Request, ResponseData, HistoryItem, LoadTestResults, FileTab } from '../models/http.models';

// ── Mocks ──────────────────────────────────────────────────────

function createBackendMock(): jest.Mocked<BackendClientContract> {
  return {
    sendRequest: jest.fn().mockResolvedValue(''),
    sendRequestWithID: jest.fn().mockResolvedValue(''),
    sendRequestWithTimeout: jest.fn().mockResolvedValue(''),
    executeRequests: jest.fn().mockResolvedValue(''),
    executeRequestsWithID: jest.fn().mockResolvedValue(''),
    cancelRequest: jest.fn().mockResolvedValue(undefined),
    startLoadTest: jest.fn().mockResolvedValue(undefined),
    setVariable: jest.fn().mockResolvedValue(undefined),
    getVariable: jest.fn().mockResolvedValue(''),
    loadFileHistoryFromDir: jest.fn().mockResolvedValue('[]'),
    loadFileHistoryFromRunLocation: jest.fn().mockResolvedValue('[]'),
    saveResponseFile: jest.fn().mockResolvedValue(''),
    saveResponseFileToRunLocation: jest.fn().mockResolvedValue(''),
    getScriptLogs: jest.fn().mockResolvedValue([]),
    clearScriptLogs: jest.fn().mockResolvedValue(undefined),
    recordScriptLog: jest.fn().mockResolvedValue(undefined),
    listSecrets: jest.fn().mockResolvedValue({}),
    saveSecret: jest.fn().mockResolvedValue({}),
    deleteSecret: jest.fn().mockResolvedValue({}),
    getSecretValue: jest.fn().mockResolvedValue(''),
    getVaultInfo: jest.fn().mockResolvedValue(null),
    hasMasterPassword: jest.fn().mockResolvedValue(false),
    setMasterPassword: jest.fn().mockResolvedValue(undefined),
    verifyMasterPassword: jest.fn().mockResolvedValue(false),
    resetVault: jest.fn().mockResolvedValue({}),
    exportSecrets: jest.fn().mockResolvedValue({}),
  };
}

function createScriptConsoleMock(): jest.Mocked<Pick<ScriptConsoleService, 'init' | 'record'>> {
  return {
    init: jest.fn().mockResolvedValue(undefined),
    record: jest.fn().mockResolvedValue(undefined),
  };
}

function createSecretServiceMock(): jest.Mocked<Pick<SecretService, 'replaceSecrets'>> {
  return {
    replaceSecrets: jest.fn().mockImplementation((input: string) => Promise.resolve(input)),
  };
}

function createEventTransportMock(): { mock: jest.Mocked<Pick<EventTransportService, 'on'>>; triggerEvent: (event: string, data: any) => void } {
  const listeners = new Map<string, Set<(data: any) => void>>();
  const mock: jest.Mocked<Pick<EventTransportService, 'on'>> = {
    on: jest.fn().mockImplementation((event: string, callback: (data: any) => void) => {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(callback);
      return () => { set!.delete(callback); };
    }),
  };
  const triggerEvent = (event: string, data: any) => {
    listeners.get(event)?.forEach(cb => cb(data));
  };
  return { mock, triggerEvent };
}

function createService() {
  const backendMock = createBackendMock();
  const scriptConsoleMock = createScriptConsoleMock();
  const secretServiceMock = createSecretServiceMock();
  const { mock: eventTransportMock, triggerEvent } = createEventTransportMock();

  const injector = Injector.create({
    providers: [
      HttpService,
      { provide: BACKEND_CLIENT, useValue: backendMock },
      { provide: ScriptConsoleService, useValue: scriptConsoleMock },
      { provide: SecretService, useValue: secretServiceMock },
      { provide: EventTransportService, useValue: eventTransportMock },
    ],
  });

  const service = runInInjectionContext(injector, () => inject(HttpService));
  return { service, backendMock, scriptConsoleMock, secretServiceMock, eventTransportMock, triggerEvent };
}

function makeRequest(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    url: 'https://example.com',
    headers: {},
    ...overrides,
  };
}

function makeGoResponse(status = 200, statusText = 'OK', body = '{"ok":true}'): string {
  return `Status: ${status} ${statusText}\nHeaders: ${JSON.stringify({ headers: { 'Content-Type': 'application/json' } })}\nBody: ${body}`;
}

// ── Tests ──────────────────────────────────────────────────────

describe('HttpService', () => {
  afterEach(() => {
    localStorage.clear();
  });

  describe('creation', () => {
    it('should create the service', () => {
      const { service } = createService();
      expect(service).toBeTruthy();
    });

    it('should initialise the script console on construction', () => {
      const { scriptConsoleMock } = createService();
      expect(scriptConsoleMock.init).toHaveBeenCalled();
    });

    it('should register a download-progress event listener on construction', () => {
      const { eventTransportMock } = createService();
      expect(eventTransportMock.on).toHaveBeenCalledWith('request:download-progress', expect.any(Function));
    });
  });

  // ── sendRequest ──────────────────────────────────────────────

  describe('sendRequest', () => {
    it('should delegate to the backend and return parsed response data', async () => {
      const { service, backendMock } = createService();
      backendMock.sendRequest.mockResolvedValue(makeGoResponse());

      const result = await service.sendRequest(makeRequest());

      expect(backendMock.sendRequest).toHaveBeenCalled();
      expect(result.status).toBe(200);
      expect(result.statusText).toBe('OK');
      expect(result.processedUrl).toBe('https://example.com');
      expect(result.requestPreview).toBeDefined();
      expect(result.requestPreview.method).toBe('GET');
    });

    it('should use sendRequestWithID when requestId is provided', async () => {
      const { service, backendMock } = createService();
      backendMock.sendRequestWithID.mockResolvedValue(makeGoResponse());

      await service.sendRequest(makeRequest(), {}, 'req-1');

      expect(backendMock.sendRequestWithID).toHaveBeenCalledWith(
        'req-1',
        'GET',
        'https://example.com',
        expect.any(String),
        ''
      );
    });

    it('should use sendRequestWithTimeout when request has a timeout option', async () => {
      const { service, backendMock } = createService();
      backendMock.sendRequestWithTimeout.mockResolvedValue(makeGoResponse());

      await service.sendRequest(
        makeRequest({ options: { timeout: 5000 } }),
        {},
        'req-1'
      );

      expect(backendMock.sendRequestWithTimeout).toHaveBeenCalledWith(
        'req-1',
        'GET',
        'https://example.com',
        expect.any(String),
        '',
        5000
      );
    });

    it('should throw a cancellation error when response is __CANCELLED__', async () => {
      const { service, backendMock } = createService();
      backendMock.sendRequest.mockResolvedValue('__CANCELLED__');

      await expect(service.sendRequest(makeRequest())).rejects.toMatchObject({
        cancelled: true,
      });
    });

    it('should return an error response when the backend throws', async () => {
      const { service, backendMock } = createService();
      backendMock.sendRequest.mockRejectedValue(new Error('Network failure'));

      await expect(service.sendRequest(makeRequest())).rejects.toMatchObject({
        status: 0,
        body: 'Network failure',
      });
    });

    it('should parse a Go error response string', async () => {
      const { service, backendMock } = createService();
      backendMock.sendRequest.mockResolvedValue('Error: connection refused');

      const result = await service.sendRequest(makeRequest());

      expect(result.status).toBe(0);
      expect(result.statusText).toBe('Request Error');
      expect(result.body).toContain('connection refused');
    });
  });

  // ── executeChain ─────────────────────────────────────────────

  describe('executeChain', () => {
    it('should call executeRequests on the backend', async () => {
      const { service, backendMock } = createService();
      const goResp = makeGoResponse(200, 'OK', '{"result":true}');
      backendMock.executeRequests.mockResolvedValue(goResp);

      const result = await service.executeChain([makeRequest({ name: 'r1' })]);

      expect(backendMock.executeRequests).toHaveBeenCalled();
      expect(result.responses).toBeDefined();
      expect(result.requestPreviews).toBeDefined();
    });

    it('should use executeRequestsWithID when requestId is provided', async () => {
      const { service, backendMock } = createService();
      backendMock.executeRequestsWithID.mockResolvedValue(makeGoResponse());

      await service.executeChain([makeRequest({ name: 'r1' })], {}, 'chain-1');

      expect(backendMock.executeRequestsWithID).toHaveBeenCalledWith('chain-1', expect.any(Array));
    });

    it('should throw a cancellation error when chain response is __CANCELLED__', async () => {
      const { service, backendMock } = createService();
      backendMock.executeRequests.mockResolvedValue('__CANCELLED__');

      await expect(
        service.executeChain([makeRequest({ name: 'r1' })])
      ).rejects.toMatchObject({ cancelled: true });
    });

    it('should throw a chain execution error response when backend fails', async () => {
      const { service, backendMock } = createService();
      backendMock.executeRequests.mockRejectedValue(new Error('chain broke'));

      await expect(
        service.executeChain([makeRequest({ name: 'r1' })])
      ).rejects.toMatchObject({
        status: 0,
        statusText: 'Chain Execution Error',
      });
    });
  });

  // ── cancelRequest ────────────────────────────────────────────

  describe('cancelRequest', () => {
    it('should call backend.cancelRequest with the request ID', async () => {
      const { service, backendMock } = createService();

      await service.cancelRequest('req-42');

      expect(backendMock.cancelRequest).toHaveBeenCalledWith('req-42');
    });

    it('should not call backend when requestId is empty', async () => {
      const { service, backendMock } = createService();

      await service.cancelRequest('');

      expect(backendMock.cancelRequest).not.toHaveBeenCalled();
    });

    it('should propagate backend errors', async () => {
      const { service, backendMock } = createService();
      backendMock.cancelRequest.mockRejectedValue(new Error('cancel failed'));

      await expect(service.cancelRequest('req-1')).rejects.toThrow('cancel failed');
    });
  });

  // ── cancelLoadTest ───────────────────────────────────────────

  describe('cancelLoadTest', () => {
    it('should call backend.cancelRequest and swallow errors', () => {
      const { service, backendMock } = createService();
      backendMock.cancelRequest.mockRejectedValue(new Error('oops'));

      // Should not throw
      expect(() => service.cancelLoadTest('lt-1')).not.toThrow();
      expect(backendMock.cancelRequest).toHaveBeenCalledWith('lt-1');
    });
  });

  // ── executeLoadTest ──────────────────────────────────────────

  describe('executeLoadTest', () => {
    it('should throw when requestId is not provided', async () => {
      const { service } = createService();

      await expect(
        service.executeLoadTest(makeRequest(), {}, 'dev', undefined)
      ).rejects.toThrow('Load testing requires a requestId');
    });

    it('should call backend.startLoadTest with hydrated values', async () => {
      const { service, backendMock, eventTransportMock } = createService();

      // The load-test helper registers event listeners for 'loadtest:done',
      // 'loadtest:progress', and 'loadtest:error'. We simulate 'loadtest:done'.
      eventTransportMock.on.mockImplementation((event: string, callback: any) => {
        if (event === 'loadtest:done') {
          setTimeout(() => callback({
            requestId: 'lt-1',
            results: {
              totalRequests: 10,
              successfulRequests: 10,
              failedRequests: 0,
              responseTimes: [100],
              errors: [],
              startTime: Date.now(),
              endTime: Date.now() + 1000,
            },
          }), 0);
        }
        return () => {};
      });

      const req = makeRequest({
        loadTest: { duration: '5s', users: 2 },
      });

      const result = await service.executeLoadTest(req, {}, 'dev', 'lt-1');

      expect(result).toBeDefined();
      expect(result.totalRequests).toBe(10);
    });
  });

  // ── calculateLoadTestMetrics ─────────────────────────────────

  describe('calculateLoadTestMetrics', () => {
    it('should compute metrics from load test results', () => {
      const { service } = createService();
      const results: LoadTestResults = {
        totalRequests: 100,
        successfulRequests: 95,
        failedRequests: 5,
        responseTimes: Array.from({ length: 100 }, (_, i) => (i + 1) * 10),
        errors: [],
        startTime: 0,
        endTime: 10000,
      };

      const metrics = service.calculateLoadTestMetrics(results);

      expect(metrics.totalRequests).toBe(100);
      expect(metrics.successfulRequests).toBe(95);
      expect(metrics.failedRequests).toBe(5);
      expect(metrics.requestsPerSecond).toBe(10); // 100 / 10s
      expect(metrics.averageResponseTime).toBeGreaterThan(0);
      expect(metrics.p50).toBeGreaterThan(0);
      expect(metrics.p95).toBeGreaterThan(0);
      expect(metrics.p99).toBeGreaterThan(0);
      expect(metrics.minResponseTime).toBe(10);
      expect(metrics.maxResponseTime).toBe(1000);
      expect(metrics.errorRate).toBeCloseTo(5, 2);
      expect(metrics.duration).toBe(10);
    });
  });

  // ── History management ───────────────────────────────────────

  describe('loadHistory', () => {
    it('should return parsed history items from the backend', async () => {
      const { service, backendMock } = createService();
      const now = new Date().toISOString();
      backendMock.loadFileHistoryFromRunLocation.mockResolvedValue(
        JSON.stringify([{ timestamp: now, method: 'GET', url: 'https://example.com', status: 200, statusText: 'OK', responseTime: 42, responseData: {} }])
      );

      const history = await service.loadHistory('file-1');

      expect(history).toHaveLength(1);
      expect(history[0].method).toBe('GET');
      expect(history[0].timestamp).toBeInstanceOf(Date);
    });

    it('should use loadFileHistoryFromDir when filePath is provided', async () => {
      const { service, backendMock } = createService();
      backendMock.loadFileHistoryFromDir.mockResolvedValue('[]');

      await service.loadHistory('file-1', '/path/to/file.http');

      expect(backendMock.loadFileHistoryFromDir).toHaveBeenCalled();
    });

    it('should return empty array for empty fileId', async () => {
      const { service } = createService();

      const history = await service.loadHistory('');

      expect(history).toEqual([]);
    });

    it('should return empty array on backend error', async () => {
      const { service, backendMock } = createService();
      backendMock.loadFileHistoryFromRunLocation.mockRejectedValue(new Error('disk error'));

      const history = await service.loadHistory('file-1');

      expect(history).toEqual([]);
    });
  });

  describe('addToHistory', () => {
    it('should save response file and reload history', async () => {
      const { service, backendMock } = createService();
      const item: HistoryItem = {
        timestamp: new Date(),
        method: 'POST',
        url: 'https://api.test',
        status: 201,
        statusText: 'Created',
        responseTime: 100,
        responseData: { status: 201, statusText: 'Created', headers: {}, body: '', responseTime: 100 },
      };
      backendMock.saveResponseFileToRunLocation.mockResolvedValue('/saved/path');
      backendMock.loadFileHistoryFromRunLocation.mockResolvedValue(JSON.stringify([item]));

      const result = await service.addToHistory('file-1', item);

      expect(backendMock.saveResponseFileToRunLocation).toHaveBeenCalled();
      expect(result).toHaveLength(1);
    });

    it('should skip history save when noHistory option is set', async () => {
      const { service, backendMock } = createService();
      backendMock.loadFileHistoryFromRunLocation.mockResolvedValue('[]');

      const item: HistoryItem = {
        timestamp: new Date(),
        method: 'GET',
        url: 'https://example.com',
        status: 200,
        statusText: 'OK',
        responseTime: 50,
        responseData: { status: 200, statusText: 'OK', headers: {}, body: '', responseTime: 50 },
      };

      await service.addToHistory('file-1', item, undefined, { noHistory: true });

      expect(backendMock.saveResponseFileToRunLocation).not.toHaveBeenCalled();
      expect(backendMock.saveResponseFile).not.toHaveBeenCalled();
    });

    it('should use saveResponseFile when filePath is provided', async () => {
      const { service, backendMock } = createService();
      backendMock.saveResponseFile.mockResolvedValue('/saved/path');
      backendMock.loadFileHistoryFromDir.mockResolvedValue('[]');

      const item: HistoryItem = {
        timestamp: new Date(),
        method: 'GET',
        url: 'https://example.com',
        status: 200,
        statusText: 'OK',
        responseTime: 50,
        responseData: { status: 200, statusText: 'OK', headers: {}, body: '', responseTime: 50 },
      };

      await service.addToHistory('file-1', item, '/path/to/file.http');

      expect(backendMock.saveResponseFile).toHaveBeenCalled();
    });
  });

  // ── File management ──────────────────────────────────────────

  describe('loadFiles / saveFiles', () => {
    it('should load files from localStorage', () => {
      const files: FileTab[] = [
        { id: 'f1', name: 'a.http', content: '', requests: [], environments: {}, variables: {}, responseData: {}, groups: [] },
      ];
      localStorage.setItem('rawrequest_files', JSON.stringify(files));

      const { service } = createService();
      const loaded = service.loadFiles();

      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe('f1');
    });

    it('should return empty array when nothing stored', () => {
      const { service } = createService();
      const loaded = service.loadFiles();

      expect(loaded).toEqual([]);
    });

    it('should save files to localStorage', () => {
      const { service } = createService();
      const files = [{ id: 'f1', name: 'b.http', content: 'GET /api', requests: [], environments: {}, variables: {}, responseData: {}, groups: [] }] as FileTab[];

      service.saveFiles(files);

      const stored = JSON.parse(localStorage.getItem('rawrequest_files') || '[]');
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe('f1');
    });
  });

  // ── Download progress ────────────────────────────────────────

  describe('downloadProgress$', () => {
    it('should emit download progress events from the event transport', () => {
      const { service, triggerEvent } = createService();
      const events: DownloadProgress[] = [];
      service.downloadProgress$.subscribe(e => events.push(e));

      triggerEvent('request:download-progress', { requestId: 'dl-1', downloaded: 500, total: 1000 });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ requestId: 'dl-1', downloaded: 500, total: 1000 });
    });

    it('should default total to -1 when not provided', () => {
      const { service, triggerEvent } = createService();
      const events: DownloadProgress[] = [];
      service.downloadProgress$.subscribe(e => events.push(e));

      triggerEvent('request:download-progress', { requestId: 'dl-2', downloaded: 100 });

      expect(events[0].total).toBe(-1);
    });

    it('should default downloaded to 0 when not provided', () => {
      const { service, triggerEvent } = createService();
      const events: DownloadProgress[] = [];
      service.downloadProgress$.subscribe(e => events.push(e));

      triggerEvent('request:download-progress', { requestId: 'dl-3' });

      expect(events[0].downloaded).toBe(0);
    });

    it('should ignore events without a requestId', () => {
      const { service, triggerEvent } = createService();
      const events: DownloadProgress[] = [];
      service.downloadProgress$.subscribe(e => events.push(e));

      triggerEvent('request:download-progress', { downloaded: 100 });
      triggerEvent('request:download-progress', null);
      triggerEvent('request:download-progress', undefined);

      expect(events).toHaveLength(0);
    });
  });

  // ── Variable / secret hydration (integration through sendRequest) ──

  describe('variable and secret hydration', () => {
    it('should hydrate variables in URL and headers via sendRequest', async () => {
      const { service, backendMock, secretServiceMock } = createService();
      secretServiceMock.replaceSecrets.mockImplementation((input: string) => Promise.resolve(input));
      backendMock.sendRequest.mockResolvedValue(makeGoResponse());

      const req = makeRequest({
        url: 'https://{{host}}/api',
        headers: { Authorization: 'Bearer {{token}}' },
      });

      const result = await service.sendRequest(req, { host: 'api.test', token: 'abc123' });

      expect(result.processedUrl).toBe('https://api.test/api');
      expect(result.requestPreview.headers['Authorization']).toBe('Bearer abc123');
    });

    it('should hydrate secrets via SecretService through sendRequest', async () => {
      const { service, backendMock, secretServiceMock } = createService();
      secretServiceMock.replaceSecrets.mockImplementation((input: string) =>
        Promise.resolve(input.replace('{{secret:api_key}}', 'SECRET_VAL'))
      );
      backendMock.sendRequest.mockResolvedValue(makeGoResponse());

      const req = makeRequest({
        url: 'https://api.test/data',
        headers: { 'X-API-Key': '{{secret:api_key}}' },
      });

      const result = await service.sendRequest(req, {});

      expect(result.requestPreview.headers['X-API-Key']).toBe('SECRET_VAL');
      expect(secretServiceMock.replaceSecrets).toHaveBeenCalled();
    });
  });
});
