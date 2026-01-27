import { ChainEntryPreview, Request, RequestPreview, ResponseData, ResponsePreview } from '../../models/http.models';

export type EntryTab = 'response' | 'request';

export function getChainItemsForResponsePanel(
  responseData: ResponseData | null,
  request: Request | null
): ChainEntryPreview[] {
  if (responseData?.chainItems?.length) {
    return responseData.chainItems;
  }

  if (!request) {
    const preview = responseData?.requestPreview;
    if (!preview) {
      return [];
    }

    return [
      {
        id: preview.name || preview.url || `${preview.method}-request`,
        label: preview.name || `${preview.method} ${preview.url}`.trim(),
        request: cloneRequestPreview(preview),
        response: responseData ? buildResponsePreview(responseData) : null,
        isPrimary: true
      }
    ];
  }

  return [
    {
      id: request.name || request.url || `${request.method}-request`,
      label: request.name || `${request.method} ${request.url}`.trim(),
      request: buildFallbackRequestPreview(request),
      response: responseData ? buildResponsePreview(responseData) : null,
      isPrimary: true
    }
  ];
}

export function getStatusClassForEntry(entry: ChainEntryPreview): string {
  if (!entry.response) {
    return 'rr-status rr-status--pending';
  }
  const status = entry.response.status;
  if (status >= 200 && status < 300) {
    return 'rr-status rr-status--success';
  }
  if (status >= 400 || status === 0) {
    return 'rr-status rr-status--error';
  }
  if (status >= 300 && status < 400) {
    return 'rr-status rr-status--warning';
  }
  return 'rr-status rr-status--neutral';
}

export function getStatusLabelForEntry(entry: ChainEntryPreview): string {
  if (!entry.response) {
    return 'Pending';
  }
  return `${entry.response.status} ${entry.response.statusText}`.trim();
}

export function formatBytesForResponsePanel(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = bytes / Math.pow(k, i);
  return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function buildFallbackRequestPreview(request: Request): RequestPreview {
  return {
    name: request.name,
    method: request.method,
    url: request.url,
    headers: { ...request.headers },
    body: typeof request.body === 'string' ? request.body : undefined
  };
}

function cloneRequestPreview(preview: RequestPreview): RequestPreview {
  return {
    name: preview.name,
    method: preview.method,
    url: preview.url,
    headers: { ...preview.headers },
    body: preview.body
  };
}

function buildResponsePreview(response: ResponseData): ResponsePreview {
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
