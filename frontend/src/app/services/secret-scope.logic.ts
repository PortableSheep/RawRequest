/**
 * File-scoped secrets live in the vault under a synthetic environment bucket
 * `@file:<env>:<absPath>` so two .http files can each define e.g.
 * `client_secret` with different values. Must stay in sync with
 * internal/secretvaultlogic/scope.go.
 */
export const FILE_SCOPE_PREFIX = '@file:';

export function normalizeEnvName(env: string | null | undefined): string {
  const trimmed = (env || '').trim();
  return trimmed.length ? trimmed : 'default';
}

export function fileScopedEnv(filePath: string | null | undefined, env: string | null | undefined): string {
  const path = (filePath || '').trim();
  if (!path) return '';
  return `${FILE_SCOPE_PREFIX}${normalizeEnvName(env)}:${path}`;
}

export function parseFileScopedEnv(bucket: string): { env: string; filePath: string } | null {
  if (!bucket || !bucket.startsWith(FILE_SCOPE_PREFIX)) return null;
  const rest = bucket.slice(FILE_SCOPE_PREFIX.length);
  const idx = rest.indexOf(':');
  if (idx <= 0) return null;
  const env = rest.slice(0, idx);
  const filePath = rest.slice(idx + 1);
  if (!filePath) return null;
  return { env, filePath };
}

export function isFileScopedEnv(bucket: string): boolean {
  return parseFileScopedEnv(bucket) !== null;
}

/** Lookup order: file+env, file+default, env, default (deduplicated). */
export function secretLookupChain(filePath: string | null | undefined, env: string | null | undefined): string[] {
  const normalized = normalizeEnvName(env);
  const chain: string[] = [];
  const push = (b: string) => {
    if (b && !chain.includes(b)) chain.push(b);
  };
  push(fileScopedEnv(filePath, normalized));
  push(fileScopedEnv(filePath, 'default'));
  push(normalized);
  push('default');
  return chain;
}

export function fileBaseName(filePath: string): string {
  const parts = (filePath || '').split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : filePath;
}
