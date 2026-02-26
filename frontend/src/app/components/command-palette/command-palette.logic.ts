export interface PaletteItem {
  requestIndex: number;
  method: string;
  label: string;
  group: string | null;
  url: string;
}

export interface FuzzyMatch {
  item: PaletteItem;
  score: number;
  highlights: number[];
}

export function buildPaletteItems(requests: { method: string; url: string; name?: string; group?: string }[]): PaletteItem[] {
  return requests.map((r, i) => ({
    requestIndex: i,
    method: (r.method || 'GET').toUpperCase(),
    label: r.name || '',
    group: r.group || null,
    url: r.url || ''
  }));
}

export function fuzzyMatch(text: string, query: string): { score: number; highlights: number[] } | null {
  if (!query) return { score: 0, highlights: [] };
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let qi = 0;
  let score = 0;
  const highlights: number[] = [];

  for (let ti = 0; ti < lowerText.length && qi < lowerQuery.length; ti++) {
    if (lowerText[ti] === lowerQuery[qi]) {
      highlights.push(ti);
      // Bonus for consecutive matches
      if (highlights.length >= 2 && highlights[highlights.length - 2] === ti - 1) {
        score += 2;
      }
      // Bonus for matching at word start
      if (ti === 0 || /[\s/\-_.]/.test(text[ti - 1])) {
        score += 3;
      }
      score += 1;
      qi++;
    }
  }

  return qi === lowerQuery.length ? { score, highlights } : null;
}

export function searchPaletteItems(items: PaletteItem[], query: string): FuzzyMatch[] {
  if (!query.trim()) {
    return items.map(item => ({ item, score: 0, highlights: [] }));
  }

  const results: FuzzyMatch[] = [];
  for (const item of items) {
    const searchText = [item.method, item.label, item.group || '', item.url].join(' ');
    const match = fuzzyMatch(searchText, query);
    if (match) {
      results.push({ item, score: match.score, highlights: match.highlights });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}
