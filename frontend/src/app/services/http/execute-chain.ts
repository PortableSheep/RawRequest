import { Request, ResponseData, RequestPreview } from '../../models/http.models';

export type ExecuteChainBackend = {
  executeRequests: (requests: Array<Record<string, any>>) => Promise<string>;
  executeRequestsWithID: (requestId: string, requests: Array<Record<string, any>>) => Promise<string>;
  setVariable: (key: string, value: string) => Promise<void>;
};

export type ExecuteChainDeps = {
  backend: ExecuteChainBackend;
  normalizeEnvName: (env?: string) => string;
  syncInitialVariablesToBackend: (
    variables: { [key: string]: string } | undefined,
    setVar: (key: string, value: string) => Promise<void>,
    logger?: { warn?: (...args: any[]) => void }
  ) => Promise<void>;
  prepareBackendRequestForChain: (
    req: Request,
    envName: string
  ) => Promise<{ backend: Record<string, any>; preview: RequestPreview }>;
  parseConcatenatedChainResponses: (
    responseStr: string,
    previews: RequestPreview[],
    parseGoResponse: (responseStr: string, responseTimeMs: number) => ResponseData,
    log: { log?: (...args: any[]) => void; error?: (...args: any[]) => void }
  ) => ResponseData[];
  parseGoResponse: (responseStr: string, responseTimeMs: number) => ResponseData;
  throwIfCancelled: (responseStr: string) => void;
  log?: {
    log?: (...args: any[]) => void;
    error?: (...args: any[]) => void;
    warn?: (...args: any[]) => void;
  };
};

export async function executeChain(
  requests: Request[],
  variables: { [key: string]: string } = {},
  requestId: string | undefined,
  env: string | undefined,
  deps: ExecuteChainDeps
): Promise<{ responses: ResponseData[]; requestPreviews: RequestPreview[] }> {
  try {
    deps.log?.log?.('[HTTP Service] Executing chain with', requests.length, 'requests');
    const envName = deps.normalizeEnvName(env);

    await deps.syncInitialVariablesToBackend(
      variables,
      (key, value) => deps.backend.setVariable(key, value),
      { warn: deps.log?.warn ?? (() => {}) }
    );

    const requestsData: Array<Record<string, any>> = [];
    const previews: RequestPreview[] = [];
    for (const req of requests) {
      const prepared = await deps.prepareBackendRequestForChain(req, envName);
      requestsData.push(prepared.backend);
      previews.push(prepared.preview);
    }

    deps.log?.log?.('[HTTP Service] Calling ExecuteRequests with data:', requestsData);

    const responseStr = requestId
      ? await deps.backend.executeRequestsWithID(requestId, requestsData)
      : await deps.backend.executeRequests(requestsData);

    deps.throwIfCancelled(responseStr);
    deps.log?.log?.('[HTTP Service] ExecuteRequests returned:', responseStr);

    const responses = deps.parseConcatenatedChainResponses(
      responseStr,
      previews,
      (s, t) => deps.parseGoResponse(s, t),
      { log: deps.log?.log, error: deps.log?.error }
    );

    return { responses, requestPreviews: previews };
  } catch (error: any) {
    if (error?.cancelled) {
      throw error;
    }
    deps.log?.error?.('[HTTP Service] Chain execution error:', error);
    throw {
      status: 0,
      statusText: 'Chain Execution Error',
      headers: {},
      body: error?.message || 'Failed to execute request chain',
      responseTime: 0,
    } as ResponseData;
  }
}
