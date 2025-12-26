import { Injectable } from '@angular/core';
import {
  getAllSnippetCategories,
  getCategoryLabel,
  getSnippetById,
  getSnippetsByCategory,
  searchSnippets
} from './script-snippet/snippet-helpers';
import { SCRIPT_SNIPPETS } from './script-snippet/snippets-data';

export interface ScriptSnippet {
  id: string;
  name: string;
  description: string;
  category: 'variables' | 'assertions' | 'response' | 'request' | 'utility';
  preScript?: string;
  postScript?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ScriptSnippetService {
  readonly snippets: ScriptSnippet[] = SCRIPT_SNIPPETS;

  getByCategory(category: ScriptSnippet['category']): ScriptSnippet[] {
    return getSnippetsByCategory(this.snippets, category);
  }

  getById(id: string): ScriptSnippet | undefined {
    return getSnippetById(this.snippets, id);
  }

  search(query: string): ScriptSnippet[] {
    return searchSnippets(this.snippets, query);
  }

  getAllCategories(): ScriptSnippet['category'][] {
    return getAllSnippetCategories();
  }

  getCategoryLabel(category: ScriptSnippet['category']): string {
    return getCategoryLabel(category);
  }
}
