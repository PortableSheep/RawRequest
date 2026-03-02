import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChangeDetectionStrategy, signal } from '@angular/core';
import { CommandPaletteComponent } from './command-palette.component';
import { WorkspaceStateService } from '../../services/workspace-state.service';
import { PanelVisibilityService } from '../../services/panel-visibility.service';
import type { FileTab } from '../../models/http.models';

const emptyFileView: FileTab = {
  id: 'test',
  name: 'test.http',
  content: '',
  requests: [],
  environments: {},
  variables: {},
  responseData: {},
  groups: [],
  selectedEnv: '',
};

describe('CommandPaletteComponent', () => {
  let component: CommandPaletteComponent;
  let fixture: ComponentFixture<CommandPaletteComponent>;

  const mockShowCommandPalette = signal(false);
  const mockCurrentFileView = signal<FileTab>(emptyFileView);

  const mockWs = {
    currentFileView: mockCurrentFileView,
  };
  const mockPanels = {
    showCommandPalette: mockShowCommandPalette,
  };

  beforeEach(async () => {
    mockShowCommandPalette.set(false);
    mockCurrentFileView.set(emptyFileView);

    await TestBed.configureTestingModule({
      imports: [CommandPaletteComponent],
      providers: [
        { provide: WorkspaceStateService, useValue: mockWs },
        { provide: PanelVisibilityService, useValue: mockPanels },
      ],
    })
    .overrideComponent(CommandPaletteComponent, { set: { changeDetection: ChangeDetectionStrategy.Default } })
    .compileComponents();

    fixture = TestBed.createComponent(CommandPaletteComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('open / close state', () => {
    it('should not render overlay when closed', () => {
      expect(fixture.nativeElement.querySelector('.rr-palette-overlay')).toBeNull();
    });

    it('should render overlay when open', () => {
      mockShowCommandPalette.set(true);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.rr-palette-overlay')).toBeTruthy();
    });

    it('should close when overlay is clicked', () => {
      mockShowCommandPalette.set(true);
      fixture.detectChanges();

      const overlay: HTMLElement = fixture.nativeElement.querySelector('.rr-palette-overlay');
      overlay.click();

      expect(mockShowCommandPalette()).toBe(false);
    });

    it('should close on Escape key', () => {
      mockShowCommandPalette.set(true);
      fixture.detectChanges();

      const dialog: HTMLElement = fixture.nativeElement.querySelector('.rr-palette-dialog');
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(mockShowCommandPalette()).toBe(false);
    });
  });

  describe('search and selection', () => {
    it('should show empty state when no requests match', () => {
      mockShowCommandPalette.set(true);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.rr-palette-empty')).toBeTruthy();
    });

    it('should render request items when requests exist', () => {
      mockCurrentFileView.set({
        ...emptyFileView,
        requests: [
          { method: 'GET', url: 'https://api.example.com/users' } as any,
          { method: 'POST', url: 'https://api.example.com/users' } as any,
        ],
      });
      mockShowCommandPalette.set(true);
      fixture.detectChanges();

      const items = fixture.nativeElement.querySelectorAll('.rr-palette-item');
      expect(items.length).toBe(2);
    });

    it('should emit onRequestSelect and close when item is selected', () => {
      mockCurrentFileView.set({
        ...emptyFileView,
        requests: [{ method: 'GET', url: '/test' } as any],
      });
      mockShowCommandPalette.set(true);
      fixture.detectChanges();

      const spy = jest.fn();
      component.onRequestSelect.subscribe(spy);

      const item: HTMLElement = fixture.nativeElement.querySelector('.rr-palette-item');
      item.click();

      expect(spy).toHaveBeenCalledWith(0);
      expect(mockShowCommandPalette()).toBe(false);
    });
  });

  describe('onQueryChange', () => {
    it('should update query and reset selected index', () => {
      component.selectedIndex.set(3);
      component.onQueryChange('test');

      expect(component.query()).toBe('test');
      expect(component.selectedIndex()).toBe(0);
    });
  });

  describe('keyboard navigation', () => {
    beforeEach(() => {
      mockCurrentFileView.set({
        ...emptyFileView,
        requests: [
          { method: 'GET', url: '/a' } as any,
          { method: 'POST', url: '/b' } as any,
          { method: 'PUT', url: '/c' } as any,
        ],
      });
      mockShowCommandPalette.set(true);
      fixture.detectChanges();
    });

    it('should move selection down on ArrowDown', () => {
      component.onKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      expect(component.selectedIndex()).toBe(1);
    });

    it('should move selection up on ArrowUp', () => {
      component.selectedIndex.set(2);
      component.onKeydown(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
      expect(component.selectedIndex()).toBe(1);
    });

    it('should not go below 0', () => {
      component.selectedIndex.set(0);
      component.onKeydown(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
      expect(component.selectedIndex()).toBe(0);
    });
  });

  describe('getMethodClass', () => {
    it('should return lowercase method class', () => {
      expect(component.getMethodClass('GET')).toBe('rr-palette-method rr-palette-method--get');
    });
  });
});
