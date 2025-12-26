import { Request, RequestPreview } from '../../models/http.models';

export type BackendRequestPrepResult = { backend: Record<string, any>; preview: RequestPreview };

export type RequestPrepDeps = {
  hydrateText: (value: string, variables: { [key: string]: string }, env: string) => Promise<string>;
  hydrateHeaders: (
    headers: { [key: string]: string } | undefined,
    variables: { [key: string]: string },
    env: string
  ) => Promise<{ [key: string]: string }>;
};

export type RequestPrepChainDeps = {
  hydrateTextSecretsOnly: (value: string, env: string) => Promise<string>;
  hydrateHeadersSecretsOnly: (
    headers: { [key: string]: string } | undefined,
    env: string
  ) => Promise<{ [key: string]: string }>;
};

export async function prepareBackendRequest(
  req: Request,
  variables: { [key: string]: string },
  env: string,
  deps: RequestPrepDeps
): Promise<BackendRequestPrepResult> {
  const url = await deps.hydrateText(req.url, variables, env);
  const headers = await deps.hydrateHeaders(req.headers, variables, env);
  let body = '';
  let bodyPlaceholder: string | undefined;
  if (req.body && !(req.body instanceof FormData)) {
    body = await deps.hydrateText(String(req.body), variables, env);
  } else if (req.body instanceof FormData) {
    bodyPlaceholder = '[FormData]';
  }

  const backend = {
    method: req.method,
    url,
    headers,
    body,
    preScript: req.preScript,
    postScript: req.postScript
  };

  const preview: RequestPreview = {
    name: req.name,
    method: req.method,
    url,
    headers: { ...headers },
    body: body || bodyPlaceholder
  };

  return { backend, preview };
}

export async function prepareBackendRequestForChain(
  req: Request,
  env: string,
  deps: RequestPrepChainDeps
): Promise<BackendRequestPrepResult> {
  const url = await deps.hydrateTextSecretsOnly(req.url, env);
  const headers = await deps.hydrateHeadersSecretsOnly(req.headers, env);
  let body = '';
  let bodyPlaceholder: string | undefined;
  if (req.body && !(req.body instanceof FormData)) {
    body = await deps.hydrateTextSecretsOnly(String(req.body), env);
  } else if (req.body instanceof FormData) {
    bodyPlaceholder = '[FormData]';
  }

  const backend = {
    method: req.method,
    url,
    headers,
    body,
    preScript: req.preScript,
    postScript: req.postScript,
    options: req.options || undefined,
  };

  const preview: RequestPreview = {
    name: req.name,
    method: req.method,
    url,
    headers: { ...headers },
    body: body || bodyPlaceholder,
  };

  return { backend, preview };
}
