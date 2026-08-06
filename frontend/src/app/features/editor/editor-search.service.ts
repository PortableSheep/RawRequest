import { Injectable, OnDestroy, signal } from '@angular/core';
import { EditorView } from 'codemirror';
import {
  SearchQuery,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  closeSearchPanel,
  replaceAll,
  replaceNext,
  selectMatches,
  setSearchQuery
} from '@codemirror/search';

export interface SearchUiState {
  open: boolean;
  showReplace: boolean;
  query: string;
  replace: string;
  caseSensitive: boolean;
  regexp: boolean;
  wholeWord: boolean;
}

export interface EditorSearchCallbacks {
  focusFindInput: () => void;
  focusReplaceInput: () => void;
}

@Injectable()
export class EditorSearchService implements OnDestroy {
  private view: EditorView | null = null;
  private wrapperEl: HTMLElement | null = null;
  private callbacks: EditorSearchCallbacks | null = null;

  readonly searchUi = signal<SearchUiState>({
    open: false,
    showReplace: false,
    query: '',
    replace: '',
    caseSensitive: false,
    regexp: false,
    wholeWord: false
  });

  readonly searchUiStatsText = signal('');
  private searchStatsTimer: number | undefined;
  private searchFlashTimer: number | undefined;

  init(view: EditorView, wrapperEl: HTMLElement, callbacks?: EditorSearchCallbacks): void {
    this.view = view;
    this.wrapperEl = wrapperEl;
    if (callbacks) {
      this.callbacks = callbacks;
    }
  }

  registerPanelCallbacks(callbacks: EditorSearchCallbacks): void {
    this.callbacks = callbacks;
  }

  ngOnDestroy(): void {
    this.destroy();
  }

  destroy(): void {
    if (this.searchStatsTimer !== undefined) {
      clearTimeout(this.searchStatsTimer);
    }
    if (this.searchFlashTimer !== undefined) {
      clearTimeout(this.searchFlashTimer);
    }
  }

  openSearchUi(showReplace: boolean): void {
    if (!this.view) return;

    openSearchPanel(this.view);

    const current = getSearchQuery(this.view.state);
    this.searchUi.set({
      open: true,
      showReplace,
      query: current.search ?? '',
      replace: current.replace ?? '',
      caseSensitive: !!current.caseSensitive,
      regexp: !!current.regexp,
      wholeWord: !!current.wholeWord
    });

    this.scheduleSearchStatsUpdate();

    setTimeout(() => {
      this.callbacks?.focusFindInput();
    }, 0);
  }

  closeSearchUi(): void {
    this.searchUi.update(s => ({ ...s, open: false, showReplace: false }));
    this.searchUiStatsText.set('');
    if (this.view) {
      // Clear the search query so match highlight decorations are removed.
      this.view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '' })) });
      closeSearchPanel(this.view);
    }
    this.view?.focus();
  }

  toggleReplaceUi(): void {
    if (!this.searchUi().open) {
      this.openSearchUi(true);
      return;
    }
    const next = !this.searchUi().showReplace;
    this.searchUi.update(s => ({ ...s, showReplace: next }));

    if (next) {
      setTimeout(() => {
        this.callbacks?.focusReplaceInput();
      }, 0);
    }
  }

  onFindInput(event: Event): void {
    this.searchUi.update(s => ({ ...s, query: (event.target as HTMLInputElement).value }));
    this.commitSearchQuery();
  }

  onReplaceInput(event: Event): void {
    this.searchUi.update(s => ({ ...s, replace: (event.target as HTMLInputElement).value }));
    this.commitSearchQuery();
  }

  toggleCaseSensitive(): void {
    this.searchUi.update(s => ({ ...s, caseSensitive: !s.caseSensitive }));
    this.commitSearchQuery();
  }

  toggleRegexp(): void {
    this.searchUi.update(s => ({ ...s, regexp: !s.regexp }));
    this.commitSearchQuery();
  }

  toggleWholeWord(): void {
    this.searchUi.update(s => ({ ...s, wholeWord: !s.wholeWord }));
    this.commitSearchQuery();
  }

  searchNext(): void {
    if (!this.view) return;
    this.commitSearchQuery();
    findNext(this.view);
    this.scheduleSearchStatsUpdate();
    this.flashCurrentMatch();

    setTimeout(() => {
      this.callbacks?.focusFindInput();
    }, 0);
  }

  searchPrev(): void {
    if (!this.view) return;
    this.commitSearchQuery();
    findPrevious(this.view);
    this.scheduleSearchStatsUpdate();
    this.flashCurrentMatch();

    setTimeout(() => {
      this.callbacks?.focusFindInput();
    }, 0);
  }

  selectAllMatches(): void {
    if (!this.view) return;
    this.commitSearchQuery();
    selectMatches(this.view);
    this.scheduleSearchStatsUpdate();
  }

  replaceOne(): void {
    if (!this.view) return;
    this.commitSearchQuery();
    replaceNext(this.view);
    this.scheduleSearchStatsUpdate();
    this.flashCurrentMatch();
  }

  replaceEverything(): void {
    if (!this.view) return;
    this.commitSearchQuery();
    replaceAll(this.view);
    this.scheduleSearchStatsUpdate();
    this.flashCurrentMatch();
  }

  onFindKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeSearchUi();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) {
        this.searchPrev();
      } else {
        this.searchNext();
      }
      return;
    }
  }

  onReplaceKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeSearchUi();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) {
        this.replaceEverything();
      } else {
        this.replaceOne();
      }
      return;
    }
  }

  private commitSearchQuery(): void {
    if (!this.view) return;

    const ui = this.searchUi();
    const query = new SearchQuery({
      search: ui.query,
      replace: ui.replace,
      caseSensitive: ui.caseSensitive,
      regexp: ui.regexp,
      wholeWord: ui.wholeWord
    });

    this.view.dispatch({ effects: setSearchQuery.of(query) });
    this.scheduleSearchStatsUpdate();
  }

  private scheduleSearchStatsUpdate(): void {
    if (this.searchStatsTimer) {
      window.clearTimeout(this.searchStatsTimer);
    }
    this.searchStatsTimer = window.setTimeout(() => {
      this.updateSearchStatsText();
    }, 75);
  }

  private updateSearchStatsText(): void {
    if (!this.view) return;

    const ui = this.searchUi();
    if (!ui.query) {
      this.searchUiStatsText.set('');
      return;
    }

    const query = new SearchQuery({
      search: ui.query,
      replace: ui.replace,
      caseSensitive: ui.caseSensitive,
      regexp: ui.regexp,
      wholeWord: ui.wholeWord
    });

    if (!query.valid) {
      this.searchUiStatsText.set('Invalid');
      return;
    }

    const state = this.view.state;
    const selection = state.selection.main;
    const limit = 2000;
    let total = 0;
    let currentIndex = 0;
    let tooMany = false;

    const cursor = query.getCursor(state);
    for (let next = cursor.next(); !next.done; next = cursor.next()) {
      total++;
      const { from, to } = next.value;
      if (from === selection.from && to === selection.to) {
        currentIndex = total;
      }
      if (total >= limit) {
        tooMany = true;
        break;
      }
    }

    if (total === 0) {
      this.searchUiStatsText.set('0 results');
      return;
    }

    const totalText = tooMany ? `${total}+` : `${total}`;
    this.searchUiStatsText.set(`${currentIndex} of ${totalText}`);
  }

  private flashCurrentMatch(): void {
    if (this.view) {
      const from = this.view.state.selection.main.from;
      this.view.dispatch({
        effects: EditorView.scrollIntoView(from, { y: 'center' })
      });
    }

    const el = this.wrapperEl;
    if (!el) return;

    if (this.searchFlashTimer) {
      window.clearTimeout(this.searchFlashTimer);
    }

    el.classList.remove('rr-search-flash');
    // Force reflow so the animation restarts reliably.
    void el.offsetWidth;
    el.classList.add('rr-search-flash');
    this.searchFlashTimer = window.setTimeout(() => {
      el.classList.remove('rr-search-flash');
    }, 650);
  }
}
