import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChangeDetectionStrategy, signal } from '@angular/core';
import { HistorySidebarComponent } from './history-sidebar.component';
import { WorkspaceStateService } from '../../services/workspace-state.service';
import { PanelVisibilityService } from '../../services/panel-visibility.service';
import type { HistoryItem } from '../../models/http.models';

function makeHistoryItem(overrides: Partial<HistoryItem> = {}): HistoryItem {
  return {
    timestamp: new Date('2025-01-15T10:30:00Z'),
    method: 'GET',
    url: 'https://api.example.com/users',
    status: 200,
    statusText: 'OK',
    responseTime: 42,
    responseData: {} as any,
    ...overrides,
  };
}

describe('HistorySidebarComponent', () => {
  let component: HistorySidebarComponent;
  let fixture: ComponentFixture<HistorySidebarComponent>;

  const mockHistory = signal<HistoryItem[]>([]);
  const mockSelectedHistoryItem = signal<HistoryItem | null>(null);
  const mockShowHistory = signal(false);
  const mockShowHistoryModal = signal(false);

  const mockWs = {
    history: mockHistory,
    selectedHistoryItem: mockSelectedHistoryItem,
  };
  const mockPanels = {
    showHistory: mockShowHistory,
    showHistoryModal: mockShowHistoryModal,
  };

  beforeEach(async () => {
    mockHistory.set([]);
    mockSelectedHistoryItem.set(null);
    mockShowHistory.set(false);
    mockShowHistoryModal.set(false);
    vi.clearAllMocks();

    await TestBed.configureTestingModule({
      imports: [HistorySidebarComponent],
      providers: [
        { provide: WorkspaceStateService, useValue: mockWs },
        { provide: PanelVisibilityService, useValue: mockPanels },
      ],
    })
    .overrideComponent(HistorySidebarComponent, { set: { changeDetection: ChangeDetectionStrategy.Default } })
    .compileComponents();

    fixture = TestBed.createComponent(HistorySidebarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('open / close state', () => {
    it('should have closed class when showHistory is false', () => {
      const el: HTMLElement = fixture.nativeElement;
      const drawer = el.querySelector('.history-drawer');
      expect(drawer?.classList.contains('history-drawer--closed')).toBe(true);
    });

    it('should have open class when showHistory is true', () => {
      mockShowHistory.set(true);
      fixture.detectChanges();

      const drawer: HTMLElement = fixture.nativeElement.querySelector('.history-drawer');
      expect(drawer?.classList.contains('history-drawer--open')).toBe(true);
    });

    it('should show backdrop when open', () => {
      mockShowHistory.set(true);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.history-drawer__backdrop')).toBeTruthy();
    });

    it('should not show backdrop when closed', () => {
      expect(fixture.nativeElement.querySelector('.history-drawer__backdrop')).toBeNull();
    });

    it('should close when close button is clicked', () => {
      mockShowHistory.set(true);
      fixture.detectChanges();

      const btn: HTMLButtonElement = fixture.nativeElement.querySelector('.history-drawer__close');
      btn.click();

      expect(mockShowHistory()).toBe(false);
    });

    it('should close when backdrop is clicked', () => {
      mockShowHistory.set(true);
      fixture.detectChanges();

      const backdrop: HTMLElement = fixture.nativeElement.querySelector('.history-drawer__backdrop');
      backdrop.click();

      expect(mockShowHistory()).toBe(false);
    });
  });

  describe('history list', () => {
    it('should show empty state when no history', () => {
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.history-empty')).toBeTruthy();
    });

    it('should render history items', () => {
      mockHistory.set([makeHistoryItem(), makeHistoryItem({ url: 'https://api.example.com/posts' })]);
      fixture.detectChanges();

      const items = fixture.nativeElement.querySelectorAll('.history-item');
      expect(items.length).toBe(2);
    });

    it('should display method and status', () => {
      mockHistory.set([makeHistoryItem({ method: 'POST', status: 201 })]);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.history-item__method')?.textContent?.trim()).toBe('POST');
      expect(fixture.nativeElement.querySelector('.history-item__status')?.textContent?.trim()).toBe('201');
    });

    it('should show entry count', () => {
      mockHistory.set([makeHistoryItem(), makeHistoryItem()]);
      fixture.detectChanges();

      const subtitle = fixture.nativeElement.querySelector('.history-drawer__subtitle');
      expect(subtitle?.textContent).toContain('2 entries');
    });
  });

  describe('viewHistory', () => {
    it('should set selected item and open modal', () => {
      const item = makeHistoryItem();
      component.viewHistory(item);

      expect(mockSelectedHistoryItem()).toBe(item);
      expect(mockShowHistoryModal()).toBe(true);
    });

    it('should be called when a history item is clicked', () => {
      const item = makeHistoryItem();
      mockHistory.set([item]);
      fixture.detectChanges();

      vi.spyOn(component, 'viewHistory');
      const el: HTMLElement = fixture.nativeElement.querySelector('.history-item');
      el.click();

      expect(component.viewHistory).toHaveBeenCalledWith(item);
    });
  });

  describe('formatTime', () => {
    it('should format recent timestamps', () => {
      const result = component.formatTime(new Date());
      expect(result).toContain('ago');
    });
  });
});
