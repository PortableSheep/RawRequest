import { Component, EventEmitter, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ScriptSnippetService, ScriptSnippet } from '../../services/script-snippet.service';

@Component({
  selector: 'app-script-snippet-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './script-snippet-modal.component.html',
  styleUrl: './script-snippet-modal.component.scss'
})
export class ScriptSnippetModalComponent {
  @Output() snippetSelected = new EventEmitter<{ snippet: ScriptSnippet; type: 'pre' | 'post' }>();
  @Output() closed = new EventEmitter<void>();

  isOpen = signal(false);
  searchQuery = signal('');
  selectedCategory = signal<ScriptSnippet['category'] | 'all'>('all');
  selectedSnippet = signal<ScriptSnippet | null>(null);
  previewTab = signal<'pre' | 'post'>('pre');

  constructor(public snippetService: ScriptSnippetService) {}

  open() {
    this.isOpen.set(true);
    this.searchQuery.set('');
    this.selectedCategory.set('all');
    this.selectedSnippet.set(null);
  }

  close() {
    this.isOpen.set(false);
    this.closed.emit();
  }

  get filteredSnippets(): ScriptSnippet[] {
    let snippets = this.snippetService.snippets;
    
    const category = this.selectedCategory();
    if (category !== 'all') {
      snippets = snippets.filter(s => s.category === category);
    }
    
    const query = this.searchQuery();
    if (query) {
      snippets = this.snippetService.search(query);
      if (category !== 'all') {
        snippets = snippets.filter(s => s.category === category);
      }
    }
    
    return snippets;
  }

  selectSnippet(snippet: ScriptSnippet) {
    this.selectedSnippet.set(snippet);
    // Auto-select the appropriate tab based on what's available
    if (snippet.postScript && !snippet.preScript) {
      this.previewTab.set('post');
    } else {
      this.previewTab.set('pre');
    }
  }

  insertAsPreScript() {
    const snippet = this.selectedSnippet();
    if (snippet) {
      this.snippetSelected.emit({ snippet, type: 'pre' });
      this.close();
    }
  }

  insertAsPostScript() {
    const snippet = this.selectedSnippet();
    if (snippet) {
      this.snippetSelected.emit({ snippet, type: 'post' });
      this.close();
    }
  }

  getPreviewCode(): string {
    const snippet = this.selectedSnippet();
    if (!snippet) return '';
    return this.previewTab() === 'pre' 
      ? (snippet.preScript || '// No pre-request script available')
      : (snippet.postScript || '// No post-request script available');
  }

  hasPreScript(snippet: ScriptSnippet): boolean {
    return !!snippet.preScript;
  }

  hasPostScript(snippet: ScriptSnippet): boolean {
    return !!snippet.postScript;
  }
}
