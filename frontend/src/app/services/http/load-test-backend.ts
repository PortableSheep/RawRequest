import { Request, LoadTestResults, ActiveRunProgress } from '../../models/http.models';

export type LoadTestBackend = {
  startLoadTest: (
    requestId: string,
    method: string,
    url: string,
    headersJson: string,
    body: string,
    loadTestJson: string
  ) => Promise<void>;
};

export type EventsOnFn = (event: string, callback: (payload: any) => void) => () => void;

export type ExecuteLoadTestViaBackendDeps = {
  backend: LoadTestBackend;
  eventsOn: EventsOnFn;
  normalizeEnvName: (env?: string) => string;
  hydrateText: (text: string, variables: { [key: string]: string }, envName: string) => Promise<string>;
  hydrateHeaders: (
    headers: { [key: string]: string } | undefined,
    variables: { [key: string]: string },
    envName: string
  ) => Promise<{ [key: string]: string }>;
};

export async function executeLoadTestViaBackend(
  request: Request,
  variables: { [key: string]: string } = {},
  env: string | undefined,
  requestId: string | undefined,
  onProgress: ((progress: ActiveRunProgress) => void) | undefined,
  deps: ExecuteLoadTestViaBackendDeps
): Promise<LoadTestResults> {
  if (!requestId) {
    throw new Error('Load testing requires a requestId');
  }
  if (!request.loadTest) {
    throw new Error('No load test configuration');
  }
  if (typeof FormData !== 'undefined' && request.body instanceof FormData) {
    throw new Error('Load tests do not support FormData bodies');
  }

  const envName = deps.normalizeEnvName(env);
  const processedUrl = await deps.hydrateText(request.url, variables, envName);
  const processedHeaders = await deps.hydrateHeaders(request.headers, variables, envName);
  const processedBody = request.body ? await deps.hydrateText(String(request.body), variables, envName) : '';

  return await new Promise<LoadTestResults>(async (resolve, reject) => {
    let unsubProgress: (() => void) | null = null;
    let unsubDone: (() => void) | null = null;
    let unsubErr: (() => void) | null = null;

    const cleanup = () => {
      try {
        unsubProgress?.();
      } catch {}
      try {
        unsubDone?.();
      } catch {}
      try {
        unsubErr?.();
      } catch {}
      unsubProgress = null;
      unsubDone = null;
      unsubErr = null;
    };

    unsubProgress = deps.eventsOn('loadtest:progress', (payload: any) => {
      if (!payload || payload.requestId !== requestId) return;
      onProgress?.(payload as ActiveRunProgress);
    });

    unsubDone = deps.eventsOn('loadtest:done', (payload: any) => {
      if (!payload || payload.requestId !== requestId) return;
      cleanup();
      const r = payload.results || {};
      resolve({
        totalRequests: r.totalRequests ?? 0,
        successfulRequests: r.successfulRequests ?? 0,
        failedRequests: r.failedRequests ?? 0,
        responseTimes: Array.isArray(r.responseTimes) ? r.responseTimes : [],
        errors: Array.isArray(r.errors) ? r.errors : [],
        failureStatusCounts: r.failureStatusCounts ?? {},
        startTime: r.startTime ?? Date.now(),
        endTime: r.endTime ?? Date.now(),
        cancelled: !!r.cancelled,
        aborted: !!r.aborted,
        abortReason: r.abortReason,
        plannedDurationMs: r.plannedDurationMs ?? null,
        adaptive: r.adaptive,
      });
    });

    unsubErr = deps.eventsOn('loadtest:error', (payload: any) => {
      if (!payload || payload.requestId !== requestId) return;
      cleanup();
      reject(new Error(payload.message || 'Load test failed'));
    });

    try {
      await deps.backend.startLoadTest(
        requestId,
        request.method,
        processedUrl,
        JSON.stringify(processedHeaders || {}),
        processedBody,
        JSON.stringify(request.loadTest)
      );
    } catch (e) {
      cleanup();
      reject(e);
    }
  });
}
