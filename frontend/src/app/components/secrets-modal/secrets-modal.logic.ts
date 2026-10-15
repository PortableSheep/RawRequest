import { SecretIndex } from '../../services/secret.service';
import { fileBaseName, parseFileScopedEnv } from '../../services/secret-scope.logic';

export type SortColumn = 'key' | 'env' | 'usage';
export type SortDirection = 'asc' | 'desc';

export interface SecretRow {
  /** Raw vault bucket (e.g. "default", "dev", "@file:dev:/abs/path.http"). */
  env: string;
  key: string;
  isOverride: boolean;
  usage: number;
  /** Environment name with any file scope stripped. */
  displayEnv: string;
  /** Set when the secret is scoped to a single .http file. */
  filePath?: string;
  /** File-scoped secret whose file no longer exists. */
  isOrphan: boolean;
}

/** Human-readable label for a vault bucket, e.g. "Global", "dev", "dev · api.http". */
export function describeSecretBucket(bucket: string): string {
  const scoped = parseFileScopedEnv(bucket);
  const envLabel = (env: string) => (env === 'default' ? 'Global' : env);
  if (scoped) {
    return `${envLabel(scoped.env)} · ${fileBaseName(scoped.filePath)}`;
  }
  return envLabel(bucket);
}

export function buildSecretRows(
  allSecrets: SecretIndex,
  usageCounts: Record<string, number>,
  orphanedFiles: readonly string[] = [],
): SecretRow[] {
  const result: SecretRow[] = [];
  const globalKeys = new Set(allSecrets['default'] || []);
  const orphans = new Set(orphanedFiles);

  for (const env of Object.keys(allSecrets)) {
    const keys = allSecrets[env] || [];
    const scoped = parseFileScopedEnv(env);
    for (const key of keys) {
      const shadowsUnscoped = scoped
        ? globalKeys.has(key) || (allSecrets[scoped.env] || []).includes(key)
        : env !== 'default' && globalKeys.has(key);
      result.push({
        env,
        key,
        isOverride: shadowsUnscoped,
        usage: usageCounts[key] || 0,
        displayEnv: scoped ? scoped.env : env,
        filePath: scoped?.filePath,
        isOrphan: !!scoped && orphans.has(scoped.filePath),
      });
    }
  }
  return result;
}

export function sortSecretRows(
  rows: SecretRow[],
  column: SortColumn,
  direction: SortDirection
): SecretRow[] {
  const sorted = [...rows];
  const dir = direction === 'asc' ? 1 : -1;

  sorted.sort((a, b) => {
    switch (column) {
      case 'key':
        return a.key.localeCompare(b.key) * dir;
      case 'env': {
        // 'default' always first within same direction; unscoped before file-scoped
        if (a.displayEnv === 'default' && b.displayEnv !== 'default') return -1;
        if (b.displayEnv === 'default' && a.displayEnv !== 'default') return 1;
        const byEnv = a.displayEnv.localeCompare(b.displayEnv);
        if (byEnv !== 0) return byEnv * dir;
        if (!a.filePath !== !b.filePath) return a.filePath ? 1 : -1;
        return (a.filePath ?? '').localeCompare(b.filePath ?? '') * dir;
      }
      case 'usage':
        return (a.usage - b.usage) * dir;
      default:
        return 0;
    }
  });

  return sorted;
}

export function filterSecretRows(rows: SecretRow[], query: string): SecretRow[] {
  if (!query.trim()) return rows;
  const lower = query.toLowerCase();
  return rows.filter(r =>
    r.key.toLowerCase().includes(lower) ||
    r.displayEnv.toLowerCase().includes(lower) ||
    (r.filePath ?? '').toLowerCase().includes(lower)
  );
}

export function countSecretUsage(content: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const regex = /\{\{secret:([^}]+)\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const key = match[1].trim();
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export function toggleSort(
  currentColumn: SortColumn,
  currentDirection: SortDirection,
  clickedColumn: SortColumn
): { column: SortColumn; direction: SortDirection } {
  if (currentColumn === clickedColumn) {
    return { column: clickedColumn, direction: currentDirection === 'asc' ? 'desc' : 'asc' };
  }
  return { column: clickedColumn, direction: 'asc' };
}
