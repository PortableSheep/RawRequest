import type { FileTab, LoadTestMetrics, ResponseData } from '../../models/http.models';
import {
  applyResponseDataForRequest,
  buildCancelledResponse,
  buildFailureResponse,
  buildHistoryItem,
  buildLoadTestSummaryResponse,
  buildRequestId,
  decideLoadTestStatusText,
  shouldSkipDuplicateExecution
} from './request-manager.logic';

describe('request-manager.logic', () => {
  it('shouldSkipDuplicateExecution only skips same index while executing', () => {
    expect(
      shouldSkipDuplicateExecution({ executingRequest: true, lastExecutedRequestIndex: 3, requestIndex: 3 })
    ).toBe(true);
    expect(
      shouldSkipDuplicateExecution({ executingRequest: true, lastExecutedRequestIndex: 2, requestIndex: 3 })
    ).toBe(false);
    expect(
      shouldSkipDuplicateExecution({ executingRequest: false, lastExecutedRequestIndex: 3, requestIndex: 3 })
    ).toBe(false);
  });

  it('buildRequestId is stable with explicit nowMs', () => {
    expect(buildRequestId('fileA', 7, 123)).toBe('fileA-7-123');
  });

  it('applyResponseDataForRequest copies the files array and sets responseData', () => {
    const resp: ResponseData = { status: 200, statusText: 'OK', headers: {}, body: 'x', responseTime: 1 };
    const files: FileTab[] = [
      {
        id: 'f1',
        name: 'f1',
        content: '',
        requests: [],
        environments: {},
        variables: {},
        responseData: {},
        groups: []
      }
    ];

    const updated = applyResponseDataForRequest(files, 0, 2, resp);
    expect(updated).not.toBe(files);
    expect(updated[0].responseData[2]).toEqual(resp);
  });

  it('buildHistoryItem prefers processedUrl over fallbackUrl', () => {
    const resp: ResponseData = {
      status: 201,
      statusText: 'Created',
      headers: {},
      body: 'ok',
      responseTime: 10,
      processedUrl: 'https://processed.example'
    };

    const item = buildHistoryItem({
      now: new Date('2020-01-01T00:00:00.000Z'),
      method: 'GET',
      fallbackUrl: 'https://fallback.example',
      response: resp
    });

    expect(item.url).toBe('https://processed.example');
    expect(item.status).toBe(201);
  });

  it('buildFailureResponse uses fallbacks and attaches requestPreview/processedUrl', () => {
    const error = {
      message: 'boom',
      requestPreview: { method: 'GET', url: 'https://req.example', headers: {}, name: 'X' }
    };

    const resp = buildFailureResponse({ error, fallbackStatusText: 'Network Error', fallbackBody: 'Unknown error' });
    expect(resp.status).toBe(0);
    expect(resp.statusText).toBe('Network Error');
    expect(resp.body).toBe('boom');
    expect(resp.requestPreview?.url).toBe('https://req.example');
    expect(resp.processedUrl).toBe('https://req.example');
  });

  it('buildCancelledResponse matches expected shape', () => {
    const resp = buildCancelledResponse();
    expect(resp.status).toBe(0);
    expect(resp.statusText).toBe('Cancelled');
  });

  it('decideLoadTestStatusText matches cancelled/aborted/complete rules', () => {
    expect(decideLoadTestStatusText({ cancelled: true, aborted: false })).toBe('Load Test Cancelled');
    expect(decideLoadTestStatusText({ cancelled: false, aborted: true })).toBe('Load Test Aborted');
    expect(decideLoadTestStatusText({ cancelled: false, aborted: false })).toBe('Load Test Complete');
  });

  it('buildLoadTestSummaryResponse computes responseTime and JSON body', () => {
    const metrics: LoadTestMetrics = {
      totalRequests: 2,
      successfulRequests: 2,
      failedRequests: 0,
      requestsPerSecond: 1,
      averageResponseTime: 10,
      p50: 10,
      p95: 10,
      p99: 10,
      minResponseTime: 10,
      maxResponseTime: 10,
      errorRate: 0,
      duration: 2
    };

    const resp = buildLoadTestSummaryResponse({
      metrics,
      results: { startTime: 1000, endTime: 2500 },
      statusText: 'Load Test Complete'
    });

    expect(resp.status).toBe(200);
    expect(resp.responseTime).toBe(1500);
    expect(resp.body).toContain('"totalRequests"');
  });
});
