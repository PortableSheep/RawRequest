import type { FileTab, HistoryItem, LoadTestMetrics, LoadTestResults, RequestPreview, ResponseData } from '../../models/http.models';

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

/**
 * Writes a response into the file that owns the run (by id), not whichever
 * tab is current, so results can't land in the wrong file. No-op if the file
 * was closed mid-run.
 */
export function applyResponseDataForFileId(
  files: FileTab[],
  fileId: string,
  requestIndex: number,
  response: ResponseData
): FileTab[] {
  const index = files.findIndex((f) => f.id === fileId);
  if (index === -1) return files;
  const updatedFiles = [...files];
  const file = updatedFiles[index];
  updatedFiles[index] = {
    ...file,
    responseData: { ...(file.responseData || {}), [requestIndex]: response },
  };
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
  method: string;
  url: string;
  name?: string;
}): ResponseData {
  const requestPreview: RequestPreview = {
    name: params.name,
    method: params.method + ' (Load Test)',
    url: params.url,
    headers: {}
  };
  return {
    status: 200,
    statusText: params.statusText,
    headers: {},
    body: JSON.stringify(params.metrics, null, 2),
    loadTestMetrics: params.metrics,
    responseTime: params.results.endTime - params.results.startTime,
    requestPreview,
    processedUrl: params.url
  };
}
