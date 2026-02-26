import { SecretIndex } from '../../services/secret.service';

export type SortColumn = 'key' | 'env' | 'usage';
export type SortDirection = 'asc' | 'desc';

export interface SecretRow {
  env: string;
  key: string;
  isOverride: boolean;
  usage: number;
}

export function buildSecretRows(
  allSecrets: SecretIndex,
  usageCounts: Record<string, number>
): SecretRow[] {
  const result: SecretRow[] = [];
  const globalKeys = new Set(allSecrets['default'] || []);

  for (const env of Object.keys(allSecrets)) {
    const keys = allSecrets[env] || [];
    for (const key of keys) {
      result.push({
        env,
        key,
        isOverride: env !== 'default' && globalKeys.has(key),
        usage: usageCounts[key] || 0
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
        // 'default' always first within same direction
        if (a.env === 'default' && b.env !== 'default') return -1;
        if (b.env === 'default' && a.env !== 'default') return 1;
        return a.env.localeCompare(b.env) * dir;
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
    r.env.toLowerCase().includes(lower)
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
