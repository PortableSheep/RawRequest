export const BACKEND_BASE_URL_STORAGE_KEY = 'rawrequest_backend_base_url';
export const DEFAULT_SERVICE_BACKEND_BASE_URL = 'http://127.0.0.1:7345';

export type StorageLike = Pick<Storage, 'getItem'> | null | undefined;

type GlobalLike = {
  __RAWREQUEST_BACKEND_BASE_URL?: unknown;
};

function normalizeBaseUrl(raw: string | null | undefined): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed.length) {
    return null;
  }
  return trimmed.replace(/\/+$/, '');
}

export function resolveServiceBackendBaseUrl(globalLike: GlobalLike, storage: StorageLike): string {
  if (typeof globalLike?.__RAWREQUEST_BACKEND_BASE_URL === 'string') {
    const normalized = normalizeBaseUrl(globalLike.__RAWREQUEST_BACKEND_BASE_URL);
    if (normalized) {
      return normalized;
    }
  }

  try {
    if (storage) {
      const normalized = normalizeBaseUrl(storage.getItem(BACKEND_BASE_URL_STORAGE_KEY));
      if (normalized) {
        return normalized;
      }
    }
  } catch {
  }

  return DEFAULT_SERVICE_BACKEND_BASE_URL;
}
