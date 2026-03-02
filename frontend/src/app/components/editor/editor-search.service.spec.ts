import { EditorSearchService } from './editor-search.service';
import {
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
import { EditorView } from 'codemirror';

vi.mock('@codemirror/search', () => ({
  SearchQuery: vi.fn().mockImplementation(function(this: any, opts: any) {
    Object.assign(this, opts);
    this.valid = true;
    this.getCursor = vi.fn().mockReturnValue({
      next: vi.fn().mockReturnValue({ done: true })
    });
  }),
  findNext: vi.fn(),
  findPrevious: vi.fn(),
  getSearchQuery: vi.fn().mockReturnValue({
    search: 'hello',
    replace: '',
    caseSensitive: false,
    regexp: false,
    wholeWord: false
  }),
  openSearchPanel: vi.fn(),
  closeSearchPanel: vi.fn(),
  replaceAll: vi.fn(),
  replaceNext: vi.fn(),
  selectMatches: vi.fn(),
  setSearchQuery: { of: vi.fn().mockReturnValue('setSearchQuery-effect') }
}));

vi.mock('codemirror', () => ({
  EditorView: {
    scrollIntoView: vi.fn().mockReturnValue('scrollIntoView-effect')
  }
}));

describe('EditorSearchService', () => {
  let service: EditorSearchService;
  let mockView: any;
  let mockWrapperEl: any;
  let mockCallbacks: any;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    service = new EditorSearchService();
    mockView = {
      state: {
        selection: { main: { from: 0, to: 0 } },
        doc: { length: 100 }
      },
      dispatch: vi.fn(),
      focus: vi.fn()
    };
    mockWrapperEl = {
      classList: {
        add: vi.fn(),
        remove: vi.fn()
      },
      offsetWidth: 100
    };
    mockCallbacks = {
      focusFindInput: vi.fn(),
      focusReplaceInput: vi.fn()
    };
    service.init(mockView, mockWrapperEl, mockCallbacks);
  });

  afterEach(() => {
    service.destroy();
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('has search UI closed by default', () => {
      const fresh = new EditorSearchService();
      expect(fresh.searchUi.open).toBe(false);
      expect(fresh.searchUi.query).toBe('');
      expect(fresh.searchUi.replace).toBe('');
      expect(fresh.searchUi.caseSensitive).toBe(false);
      expect(fresh.searchUi.regexp).toBe(false);
      expect(fresh.searchUi.wholeWord).toBe(false);
      expect(fresh.searchUiStatsText).toBe('');
    });
  });

  describe('openSearchUi', () => {
    it('opens the search panel and sets state from CodeMirror', () => {
      service.openSearchUi(false);

      expect(openSearchPanel).toHaveBeenCalledWith(mockView);
      expect(service.searchUi.open).toBe(true);
      expect(service.searchUi.showReplace).toBe(false);
      expect(service.searchUi.query).toBe('hello');
    });

    it('opens with replace visible when showReplace is true', () => {
      service.openSearchUi(true);
      expect(service.searchUi.showReplace).toBe(true);
    });

    it('focuses find input after a tick', () => {
      service.openSearchUi(false);
      vi.advanceTimersByTime(1);
      expect(mockCallbacks.focusFindInput).toHaveBeenCalled();
    });

    it('does nothing when view is not initialized', () => {
      const uninitialized = new EditorSearchService();
      uninitialized.openSearchUi(false);
      expect(openSearchPanel).not.toHaveBeenCalledTimes(2);
      expect(uninitialized.searchUi.open).toBe(false);
    });
  });

  describe('closeSearchUi', () => {
    it('closes the search panel and resets state', () => {
      service.openSearchUi(false);
      service.closeSearchUi();

      expect(service.searchUi.open).toBe(false);
      expect(service.searchUi.showReplace).toBe(false);
      expect(service.searchUiStatsText).toBe('');
      expect(closeSearchPanel).toHaveBeenCalledWith(mockView);
      expect(mockView.focus).toHaveBeenCalled();
    });
  });

  describe('toggleReplaceUi', () => {
    it('opens search UI with replace if not already open', () => {
      service.toggleReplaceUi();
      expect(service.searchUi.open).toBe(true);
      expect(service.searchUi.showReplace).toBe(true);
    });

    it('toggles replace visibility when search is open', () => {
      service.openSearchUi(false);
      expect(service.searchUi.showReplace).toBe(false);

      service.toggleReplaceUi();
      expect(service.searchUi.showReplace).toBe(true);

      vi.advanceTimersByTime(1);
      expect(mockCallbacks.focusReplaceInput).toHaveBeenCalled();
    });

    it('hides replace when toggled off', () => {
      service.openSearchUi(true);
      service.toggleReplaceUi();
      expect(service.searchUi.showReplace).toBe(false);
    });
  });

  describe('toggle options', () => {
    it('toggleCaseSensitive flips the flag', () => {
      expect(service.searchUi.caseSensitive).toBe(false);
      service.toggleCaseSensitive();
      expect(service.searchUi.caseSensitive).toBe(true);
      service.toggleCaseSensitive();
      expect(service.searchUi.caseSensitive).toBe(false);
    });

    it('toggleRegexp flips the flag', () => {
      expect(service.searchUi.regexp).toBe(false);
      service.toggleRegexp();
      expect(service.searchUi.regexp).toBe(true);
    });

    it('toggleWholeWord flips the flag', () => {
      expect(service.searchUi.wholeWord).toBe(false);
      service.toggleWholeWord();
      expect(service.searchUi.wholeWord).toBe(true);
    });

    it('dispatches search query on toggle', () => {
      service.toggleCaseSensitive();
      expect(mockView.dispatch).toHaveBeenCalled();
    });
  });

  describe('input handlers', () => {
    it('onFindInput updates query', () => {
      const event = { target: { value: 'test query' } } as unknown as Event;
      service.onFindInput(event);
      expect(service.searchUi.query).toBe('test query');
    });

    it('onReplaceInput updates replace', () => {
      const event = { target: { value: 'replacement' } } as unknown as Event;
      service.onReplaceInput(event);
      expect(service.searchUi.replace).toBe('replacement');
    });
  });

  describe('searchNext', () => {
    it('calls findNext on the view', () => {
      service.searchNext();
      expect(findNext).toHaveBeenCalledWith(mockView);
    });

    it('focuses find input after a tick', () => {
      service.searchNext();
      vi.advanceTimersByTime(1);
      expect(mockCallbacks.focusFindInput).toHaveBeenCalled();
    });

    it('triggers flash animation', () => {
      service.searchNext();
      expect(mockView.dispatch).toHaveBeenCalled();
      expect(mockWrapperEl.classList.add).toHaveBeenCalledWith('rr-search-flash');
    });
  });

  describe('searchPrev', () => {
    it('calls findPrevious on the view', () => {
      service.searchPrev();
      expect(findPrevious).toHaveBeenCalledWith(mockView);
    });

    it('focuses find input after a tick', () => {
      service.searchPrev();
      vi.advanceTimersByTime(1);
      expect(mockCallbacks.focusFindInput).toHaveBeenCalled();
    });
  });

  describe('selectAllMatches', () => {
    it('calls selectMatches on the view', () => {
      service.selectAllMatches();
      expect(selectMatches).toHaveBeenCalledWith(mockView);
    });
  });

  describe('replaceOne', () => {
    it('calls replaceNext on the view', () => {
      service.replaceOne();
      expect(replaceNext).toHaveBeenCalledWith(mockView);
    });
  });

  describe('replaceEverything', () => {
    it('calls replaceAll on the view', () => {
      service.replaceEverything();
      expect(replaceAll).toHaveBeenCalledWith(mockView);
    });
  });

  describe('onFindKeydown', () => {
    it('closes search on Escape', () => {
      service.openSearchUi(false);
      const event = new KeyboardEvent('keydown', { key: 'Escape' });
      vi.spyOn(event, 'preventDefault');

      service.onFindKeydown(event);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(service.searchUi.open).toBe(false);
    });

    it('calls searchNext on Enter', () => {
      const spy = vi.spyOn(service, 'searchNext');
      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      service.onFindKeydown(event);
      expect(spy).toHaveBeenCalled();
    });

    it('calls searchPrev on Shift+Enter', () => {
      const spy = vi.spyOn(service, 'searchPrev');
      const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true });
      service.onFindKeydown(event);
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('onReplaceKeydown', () => {
    it('closes search on Escape', () => {
      service.openSearchUi(true);
      const event = new KeyboardEvent('keydown', { key: 'Escape' });

      service.onReplaceKeydown(event);
      expect(service.searchUi.open).toBe(false);
    });

    it('calls replaceOne on Enter', () => {
      const spy = vi.spyOn(service, 'replaceOne');
      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      service.onReplaceKeydown(event);
      expect(spy).toHaveBeenCalled();
    });

    it('calls replaceEverything on Shift+Enter', () => {
      const spy = vi.spyOn(service, 'replaceEverything');
      const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true });
      service.onReplaceKeydown(event);
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('clears timers without errors', () => {
      service.searchNext(); // triggers timers
      expect(() => service.destroy()).not.toThrow();
    });

    it('is safe to call multiple times', () => {
      expect(() => {
        service.destroy();
        service.destroy();
      }).not.toThrow();
    });
  });

  describe('no-op when view not set', () => {
    let uninitialized: EditorSearchService;

    beforeEach(() => {
      uninitialized = new EditorSearchService();
    });

    afterEach(() => {
      uninitialized.destroy();
    });

    it('searchNext does nothing', () => {
      expect(() => uninitialized.searchNext()).not.toThrow();
    });

    it('searchPrev does nothing', () => {
      expect(() => uninitialized.searchPrev()).not.toThrow();
    });

    it('replaceOne does nothing', () => {
      expect(() => uninitialized.replaceOne()).not.toThrow();
    });

    it('replaceEverything does nothing', () => {
      expect(() => uninitialized.replaceEverything()).not.toThrow();
    });

    it('selectAllMatches does nothing', () => {
      expect(() => uninitialized.selectAllMatches()).not.toThrow();
    });
  });
});
