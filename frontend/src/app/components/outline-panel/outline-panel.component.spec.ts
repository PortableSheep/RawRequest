import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChangeDetectionStrategy, signal } from '@angular/core';
import { OutlinePanelComponent } from './outline-panel.component';
import { WorkspaceStateService } from '../../services/workspace-state.service';
import { PanelVisibilityService } from '../../services/panel-visibility.service';
import { RequestExecutionService } from '../../services/request-execution.service';
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

describe('OutlinePanelComponent', () => {
  let component: OutlinePanelComponent;
  let fixture: ComponentFixture<OutlinePanelComponent>;

  const mockShowOutlinePanel = signal(false);
  const mockCurrentFileView = signal<FileTab>(emptyFileView);

  const mockWs = {
    currentFileView: mockCurrentFileView,
  };
  const mockPanels = {
    showOutlinePanel: mockShowOutlinePanel,
  };
  const mockReqExec = {
    pendingRequestIndex: null as number | null,
  };

  beforeEach(async () => {
    mockShowOutlinePanel.set(false);
    mockCurrentFileView.set(emptyFileView);
    mockReqExec.pendingRequestIndex = null;

    await TestBed.configureTestingModule({
      imports: [OutlinePanelComponent],
      providers: [
        { provide: WorkspaceStateService, useValue: mockWs },
        { provide: PanelVisibilityService, useValue: mockPanels },
        { provide: RequestExecutionService, useValue: mockReqExec },
      ],
    })
    .overrideComponent(OutlinePanelComponent, { set: { changeDetection: ChangeDetectionStrategy.Default } })
    .compileComponents();

    fixture = TestBed.createComponent(OutlinePanelComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('open / close state', () => {
    it('should not have open class when closed', () => {
      const drawer = fixture.nativeElement.querySelector('.outline-drawer');
      expect(drawer?.classList.contains('outline-drawer--open')).toBe(false);
    });

    it('should have open class when showOutlinePanel is true', () => {
      mockShowOutlinePanel.set(true);
      fixture.detectChanges();

      const drawer = fixture.nativeElement.querySelector('.outline-drawer');
      expect(drawer?.classList.contains('outline-drawer--open')).toBe(true);
    });

    it('should close when close button is clicked', () => {
      mockShowOutlinePanel.set(true);
      fixture.detectChanges();

      const btn: HTMLButtonElement = fixture.nativeElement.querySelector('.outline-drawer__close');
      btn.click();

      expect(mockShowOutlinePanel()).toBe(false);
    });

    it('should close when backdrop is clicked', () => {
      mockShowOutlinePanel.set(true);
      fixture.detectChanges();

      const backdrop: HTMLElement = fixture.nativeElement.querySelector('.outline-drawer__backdrop');
      backdrop.click();

      expect(mockShowOutlinePanel()).toBe(false);
    });
  });

  describe('request list', () => {
    it('should show empty state when no requests', () => {
      const empty = fixture.nativeElement.querySelector('.outline-empty');
      expect(empty?.textContent).toContain('No requests found');
    });

    it('should render request entries', () => {
      mockCurrentFileView.set({
        ...emptyFileView,
        requests: [
          { method: 'GET', url: 'https://api.example.com/users' } as any,
          { method: 'POST', url: 'https://api.example.com/users' } as any,
        ],
      });
      fixture.detectChanges();

      const entries = fixture.nativeElement.querySelectorAll('.outline-entry');
      expect(entries.length).toBe(2);
    });

    it('should show request count', () => {
      mockCurrentFileView.set({
        ...emptyFileView,
        requests: [{ method: 'GET', url: '/test' } as any],
      });
      fixture.detectChanges();

      expect(component.requestCount()).toBe(1);
    });
  });

  describe('selectRequest', () => {
    it('should emit onRequestSelect and close panel', () => {
      mockShowOutlinePanel.set(true);
      const spy = vi.fn();
      component.onRequestSelect.subscribe(spy);

      component.selectRequest(2);

      expect(spy).toHaveBeenCalledWith(2);
      expect(mockShowOutlinePanel()).toBe(false);
    });
  });
});
