import { Request, ResponseData, RequestPreview } from '../../models/http.models';

export type SendRequestBackend = {
  sendRequest: (method: string, url: string, headersJson: string, bodyStr: string) => Promise<string>;
  sendRequestWithID: (requestId: string, method: string, url: string, headersJson: string, bodyStr: string) => Promise<string>;
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
  executeScript: (script: string, context: any, stage: 'pre' | 'post' | 'custom') => Promise<void>;
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

  try {
    if (request.preScript) {
      await deps.executeScript(request.preScript, { request, variables }, 'pre');
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

    if (request.options?.timeout) {
      // Note: backend call isn't actually aborted by this, but preserve the existing side effect.
      if (typeof AbortController !== 'undefined') {
        const controller = new AbortController();
        requestOptions.signal = controller.signal;
        setTimeout(() => controller.abort(), request.options.timeout);
      }
    }

    const headersJson = JSON.stringify(processedHeaders);
    const bodyStr = requestOptions.body ? String(requestOptions.body) : '';

    deps.log?.debug?.('[HTTP Service] Sending request:', { method: request.method, url: processedUrl });

    const responseStr = requestId
      ? await deps.backend.sendRequestWithID(requestId, request.method, processedUrl, headersJson, bodyStr)
      : await deps.backend.sendRequest(request.method, processedUrl, headersJson, bodyStr);

    deps.throwIfCancelled(responseStr);

    const responseTime = now() - startTime;
    deps.log?.debug?.('[HTTP Service] Response received:', responseStr.substring(0, 200));

    const responseData = deps.parseGoResponse(responseStr, responseTime);

    if (request.postScript) {
      await deps.executeScript(request.postScript, { request, response: responseData, variables }, 'post');
    }

    return { ...responseData, processedUrl, requestPreview: requestPreview! };
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
