import type { ScriptSnippet } from '../script-snippet.service';
import {
  getAllSnippetCategories,
  getCategoryLabel,
  getSnippetById,
  getSnippetsByCategory,
  searchSnippets
} from './snippet-helpers';

describe('script-snippet helpers', () => {
  const snippets: ScriptSnippet[] = [
    { id: 'a', name: 'One', description: 'first', category: 'variables' },
    { id: 'b', name: 'Two', description: 'second thing', category: 'utility' }
  ];

  it('filters by category', () => {
    expect(getSnippetsByCategory(snippets, 'variables').map(s => s.id)).toEqual(['a']);
  });

  it('gets by id', () => {
    expect(getSnippetById(snippets, 'b')?.name).toBe('Two');
    expect(getSnippetById(snippets, 'missing')).toBeUndefined();
  });

  it('searches name and description case-insensitively', () => {
    expect(searchSnippets(snippets, 'one').map(s => s.id)).toEqual(['a']);
    expect(searchSnippets(snippets, 'SECOND').map(s => s.id)).toEqual(['b']);
  });

  it('returns categories in expected order', () => {
    expect(getAllSnippetCategories()).toEqual(['variables', 'assertions', 'response', 'request', 'utility']);
  });

  it('returns stable category labels', () => {
    expect(getCategoryLabel('variables')).toContain('Variables');
    expect(getCategoryLabel('utility')).toContain('Utility');
  });
});
