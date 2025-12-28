import type {
  ChainEntryPreview,
  Request,
  RequestPreview,
  ResponseData,
  ResponsePreview
} from '../../models/http.models';

export function ensureRequestPreview(request: Request, preview?: RequestPreview | null): RequestPreview {
  if (preview) {
    return {
      name: preview.name || request.name,
      method: preview.method || request.method,
      url: preview.url,
      headers: { ...preview.headers },
      body: preview.body
    };
  }

  return {
    name: request.name,
    method: request.method,
    url: request.url,
    headers: { ...request.headers },
    body: typeof request.body === 'string' ? request.body : undefined
  };
}

export function toResponsePreview(response?: ResponseData | null): ResponsePreview | null {
  if (!response) {
    return null;
  }

  return {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers || {},
    body: response.body,
    responseTime: response.responseTime,
    timing: response.timing,
    size: response.size,
    assertions: response.assertions
  };
}

export function buildChainItems(
  chain: Request[],
  previews: Array<RequestPreview | undefined | null>,
  responses: Array<ResponseData | null | undefined>,
  primaryIndex: number
): ChainEntryPreview[] {
  return chain.map((req, idx) => {
    const preview = ensureRequestPreview(req, responses[idx]?.requestPreview ?? previews[idx]);
    const responsePreview = toResponsePreview(responses[idx]);

    return {
      id: `${req.name || req.method}-${idx}`,
      label: req.name || `${req.method} ${preview.url}`.trim(),
      request: preview,
      response: responsePreview,
      isPrimary: idx === primaryIndex
    };
  });
}
