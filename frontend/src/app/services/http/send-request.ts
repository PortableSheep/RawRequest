import { AssertionResult, Request, ResponseData, RequestPreview } from '../../models/http.models';

export type SendRequestBackend = {
  sendRequest: (method: string, url: string, headersJson: string, bodyStr: string) => Promise<string>;
  sendRequestWithID: (requestId: string, method: string, url: string, headersJson: string, bodyStr: string) => Promise<string>;
  sendRequestWithTimeout: (
    requestId: string,
    method: string,
    url: string,
    headersJson: string,
    bodyStr: string,
    timeoutMs: number
  ) => Promise<string>;
};

export type SendRequestDeps = {
  backend: SendRequestBackend;
  now?: () => number;
  normalizeEnvName: (env?: string) => string;
  hydrateText: (value: string, variables: { [key: string]: string }, envName: string) => Promise<string>;
  hydrateHeaders: (
    headers: { [key: string]: string } | undefined,
    variables: { [key: string]: string },
    envName: string
  ) => Promise<{ [key: string]: string }>;
  executeScript: (script: string, context: any, stage: 'pre' | 'post' | 'custom') => Promise<AssertionResult[]>;
  parseGoResponse: (responseStr: string, responseTimeMs: number) => ResponseData;
  throwIfCancelled: (responseStr: string) => void;
  log?: {
    debug?: (...args: any[]) => void;
  };
};

export async function sendRequest(
  request: Request,
  variables: { [key: string]: string } = {},
  requestId: string | undefined,
  env: string | undefined,
  deps: SendRequestDeps
): Promise<ResponseData & { processedUrl: string; requestPreview: RequestPreview }> {
  const now = deps.now ?? (() => Date.now());
  const startTime = now();

  const envName = deps.normalizeEnvName(env);
  let processedUrl = request.url;
  let processedHeaders: { [key: string]: string } = { ...(request.headers || {}) };
  let processedBody: string | undefined;
  let requestPreview: RequestPreview | null = null;
  let bodyPlaceholder: string | undefined;
  const assertions: AssertionResult[] = [];
  const scriptContext: any = { request, variables, assertions };

  try {
    if (request.preScript) {
      assertions.push(...await deps.executeScript(request.preScript, scriptContext, 'pre'));
    }

    processedUrl = await deps.hydrateText(request.url, variables, envName);
    processedHeaders = await deps.hydrateHeaders(request.headers, variables, envName);

    const hasFormData = typeof FormData !== 'undefined' && request.body instanceof FormData;
    if (request.body && !hasFormData) {
      processedBody = await deps.hydrateText(String(request.body), variables, envName);
    } else if (hasFormData) {
      bodyPlaceholder = '[FormData]';
    }

    const requestOptions: RequestInit = {
      method: request.method,
      headers: processedHeaders,
    };

    if (request.body) {
      if (hasFormData) {
        requestOptions.body = request.body as any;
        delete processedHeaders['Content-Type'];
      } else {
        requestOptions.body = processedBody ?? '';
      }
    }

    requestPreview = {
      name: request.name,
      method: request.method,
      url: processedUrl,
      headers: { ...processedHeaders },
      body: processedBody ?? bodyPlaceholder,
    };

    const headersJson = JSON.stringify(processedHeaders);
    const bodyStr = requestOptions.body ? String(requestOptions.body) : '';

    deps.log?.debug?.('[HTTP Service] Sending request:', { method: request.method, url: processedUrl });

    const timeoutMs = request.options?.timeout;
    const responseStr = typeof timeoutMs === 'number' && timeoutMs > 0
      ? await deps.backend.sendRequestWithTimeout(requestId ?? '', request.method, processedUrl, headersJson, bodyStr, timeoutMs)
      : requestId
        ? await deps.backend.sendRequestWithID(requestId, request.method, processedUrl, headersJson, bodyStr)
        : await deps.backend.sendRequest(request.method, processedUrl, headersJson, bodyStr);

    deps.throwIfCancelled(responseStr);

    const responseTime = now() - startTime;
    deps.log?.debug?.('[HTTP Service] Response received:', responseStr.substring(0, 200));

    const responseData = deps.parseGoResponse(responseStr, responseTime);

    if (request.postScript) {
      scriptContext.response = responseData;
      assertions.push(...await deps.executeScript(request.postScript, scriptContext, 'post'));
    }

    const withAssertions = assertions.length ? { ...responseData, assertions } : responseData;
    return { ...(withAssertions as any), processedUrl, requestPreview: requestPreview! };
  } catch (error: any) {
    if (error?.cancelled) {
      throw error;
    }
    const responseTime = now() - startTime;
    const fallback: ResponseData = {
      status: 0,
      statusText: error?.name || 'Network Error',
      headers: {},
      body: error?.message || 'Unknown error occurred',
      responseTime,
    };
    if (requestPreview) {
      (fallback as any).processedUrl = requestPreview.url;
      (fallback as any).requestPreview = requestPreview;
    }
    throw fallback;
  }
}
