import type { ScriptSnippet } from '../script-snippet.service';

export function getSnippetsByCategory(snippets: ScriptSnippet[], category: ScriptSnippet['category']): ScriptSnippet[] {
  return snippets.filter(s => s.category === category);
}

export function getSnippetById(snippets: ScriptSnippet[], id: string): ScriptSnippet | undefined {
  return snippets.find(s => s.id === id);
}

export function searchSnippets(snippets: ScriptSnippet[], query: string): ScriptSnippet[] {
  const q = (query || '').toLowerCase();
  return snippets.filter(s =>
    s.name.toLowerCase().includes(q) ||
    s.description.toLowerCase().includes(q)
  );
}

export function getAllSnippetCategories(): ScriptSnippet['category'][] {
  return ['variables', 'assertions', 'response', 'request', 'utility'];
}

const CATEGORY_LABELS: Record<ScriptSnippet['category'], string> = {
  variables: '📦 Variables',
  assertions: '✓ Assertions',
  response: '📥 Response',
  request: '📤 Request',
  utility: '🔧 Utility'
};

export function getCategoryLabel(category: ScriptSnippet['category']): string {
  return CATEGORY_LABELS[category];
}
