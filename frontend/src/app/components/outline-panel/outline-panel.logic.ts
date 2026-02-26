import type { Request } from '../../models/http.models';

export interface OutlineEntry {
  requestIndex: number;
  method: string;
  label: string;
  group: string | null;
}

export interface OutlineGroup {
  name: string | null;
  entries: OutlineEntry[];
}

export function buildOutlineEntries(requests: Request[]): OutlineEntry[] {
  return requests.map((r, i) => ({
    requestIndex: i,
    method: (r.method || 'GET').toUpperCase(),
    label: r.name || extractPathFromUrl(r.url) || r.url || '(unnamed)',
    group: r.group || null
  }));
}

export function groupOutlineEntries(entries: OutlineEntry[]): OutlineGroup[] {
  const ungrouped: OutlineEntry[] = [];
  const groupMap = new Map<string, OutlineEntry[]>();

  for (const entry of entries) {
    if (entry.group) {
      const list = groupMap.get(entry.group) || [];
      list.push(entry);
      groupMap.set(entry.group, list);
    } else {
      ungrouped.push(entry);
    }
  }

  const result: OutlineGroup[] = [];
  if (ungrouped.length) {
    result.push({ name: null, entries: ungrouped });
  }
  for (const [name, groupEntries] of groupMap) {
    result.push({ name, entries: groupEntries });
  }
  return result;
}

function extractPathFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.replace(/\{\{[^}]*\}\}/g, 'x'));
    return u.pathname !== '/' ? u.pathname : null;
  } catch {
    const match = url.match(/(?:\/[^\s?#]+)/);
    return match ? match[0] : null;
  }
}

export function filterOutlineEntries(entries: OutlineEntry[], query: string): OutlineEntry[] {
  if (!query.trim()) return entries;
  const q = query.toLowerCase();
  return entries.filter(e =>
    e.label.toLowerCase().includes(q) ||
    e.method.toLowerCase().includes(q) ||
    (e.group || '').toLowerCase().includes(q)
  );
}
