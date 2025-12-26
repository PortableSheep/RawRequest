import type { FileTab, HistoryItem, LoadTestMetrics, LoadTestResults, ResponseData } from '../../models/http.models';

export function shouldSkipDuplicateExecution(params: {
  executingRequest: boolean;
  lastExecutedRequestIndex: number | null;
  requestIndex: number;
}): boolean {
  return params.executingRequest && params.lastExecutedRequestIndex === params.requestIndex;
}

export function buildRequestId(fileId: string, requestIndex: number, nowMs: number): string {
  return `${fileId}-${requestIndex}-${nowMs}`;
}

export function applyResponseDataForRequest(
  files: FileTab[],
  fileIndex: number,
  requestIndex: number,
  response: ResponseData
): FileTab[] {
  const updatedFiles = [...files];
  updatedFiles[fileIndex].responseData[requestIndex] = response;
  return updatedFiles;
}

export function buildHistoryItem(params: {
  now: Date;
  method: string;
  fallbackUrl: string;
  response: ResponseData;
}): HistoryItem {
  return {
    timestamp: params.now,
    method: params.method,
    url: params.response.processedUrl || params.fallbackUrl,
    status: params.response.status,
    statusText: params.response.statusText,
    responseTime: params.response.responseTime,
    responseData: params.response
  };
}

export function buildFailureResponse(params: {
  error: any;
  fallbackStatusText: string;
  fallbackBody: string;
}): ResponseData {
  const error = params.error;

  const response: ResponseData = {
    status: error?.status || 0,
    statusText: error?.statusText || params.fallbackStatusText,
    headers: error?.headers || {},
    body: error?.body || error?.message || params.fallbackBody,
    responseTime: error?.responseTime || 0
  };

  if (error?.requestPreview) {
    response.requestPreview = error.requestPreview;
    response.processedUrl = error.requestPreview.url;
  }

  return response;
}

export function buildCancelledResponse(): ResponseData {
  return {
    status: 0,
    statusText: 'Cancelled',
    headers: {},
    body: 'Request was cancelled before completion.',
    responseTime: 0
  };
}

export function decideLoadTestStatusText(results: Pick<LoadTestResults, 'cancelled' | 'aborted'>): string {
  return results.cancelled
    ? 'Load Test Cancelled'
    : results.aborted
      ? 'Load Test Aborted'
      : 'Load Test Complete';
}

export function buildLoadTestSummaryResponse(params: {
  metrics: LoadTestMetrics;
  results: Pick<LoadTestResults, 'startTime' | 'endTime'>;
  statusText: string;
}): ResponseData {
  return {
    status: 200,
    statusText: params.statusText,
    headers: {},
    body: JSON.stringify(params.metrics, null, 2),
    loadTestMetrics: params.metrics,
    responseTime: params.results.endTime - params.results.startTime
  };
}
