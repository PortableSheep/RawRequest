import { ChangeDetectionStrategy } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EditorSearchPanelComponent } from './editor-search-panel.component';
import { EditorSearchService, SearchUiState } from '../editor-search.service';

function createMockSearchService(): Partial<EditorSearchService> {
  const defaultState: SearchUiState = {
    open: true,
    showReplace: false,
    query: '',
    replace: '',
    caseSensitive: false,
    regexp: false,
    wholeWord: false
  };

  return {
    searchUi: { ...defaultState },
    searchUiStatsText: '',
    registerPanelCallbacks: jest.fn(),
    onFindInput: jest.fn(),
    onFindKeydown: jest.fn(),
    onReplaceInput: jest.fn(),
    onReplaceKeydown: jest.fn(),
    searchNext: jest.fn(),
    searchPrev: jest.fn(),
    selectAllMatches: jest.fn(),
    replaceOne: jest.fn(),
    replaceEverything: jest.fn(),
    toggleCaseSensitive: jest.fn(),
    toggleRegexp: jest.fn(),
    toggleWholeWord: jest.fn(),
    toggleReplaceUi: jest.fn(),
    closeSearchUi: jest.fn()
  };
}

describe('EditorSearchPanelComponent', () => {
  let component: EditorSearchPanelComponent;
  let fixture: ComponentFixture<EditorSearchPanelComponent>;
  let mockSearchService: Partial<EditorSearchService>;

  beforeEach(async () => {
    mockSearchService = createMockSearchService();

    await TestBed.configureTestingModule({
      imports: [EditorSearchPanelComponent]
    })
      .overrideComponent(EditorSearchPanelComponent, {
        set: {
          providers: [{ provide: EditorSearchService, useValue: mockSearchService }],
          changeDetection: ChangeDetectionStrategy.Default
        }
      })
      .compileComponents();

    fixture = TestBed.createComponent(EditorSearchPanelComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should register panel callbacks on init', () => {
    component.ngAfterViewInit();
    expect(mockSearchService.registerPanelCallbacks).toHaveBeenCalled();
  });

  it('should render the find input when search is open', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.editor-search__input')).toBeTruthy();
  });

  it('should not render anything when search is closed', () => {
    mockSearchService.searchUi = { ...mockSearchService.searchUi!, open: false };
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.editor-search')).toBeNull();
  });

  it('should call searchNext when Next button is clicked', () => {
    const btn = fixture.nativeElement.querySelectorAll('.editor-search__btn')[1];
    btn.click();
    expect(mockSearchService.searchNext).toHaveBeenCalled();
  });

  it('should call searchPrev when Prev button is clicked', () => {
    const btn = fixture.nativeElement.querySelectorAll('.editor-search__btn')[0];
    btn.click();
    expect(mockSearchService.searchPrev).toHaveBeenCalled();
  });

  it('should call closeSearchUi when close button is clicked', () => {
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('.editor-search__close');
    btn.click();
    expect(mockSearchService.closeSearchUi).toHaveBeenCalled();
  });

  it('should show replace row when showReplace is true', () => {
    mockSearchService.searchUi = { ...mockSearchService.searchUi!, showReplace: true };
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('.editor-search__row');
    expect(rows.length).toBe(2);
  });

  it('should display stats text when available', () => {
    (mockSearchService as any).searchUiStatsText = '3 of 10';
    fixture.detectChanges();
    const meta: HTMLElement = fixture.nativeElement.querySelector('.editor-search__meta');
    expect(meta?.textContent?.trim()).toBe('3 of 10');
  });

  it('should mark case-sensitive toggle as active', () => {
    mockSearchService.searchUi = { ...mockSearchService.searchUi!, caseSensitive: true };
    fixture.detectChanges();
    const toggles = fixture.nativeElement.querySelectorAll('.editor-search__toggle');
    expect(toggles[0].classList.contains('is-active')).toBe(true);
  });
});
