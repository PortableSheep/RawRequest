import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { VersionManagerComponent } from './version-manager.component';
import { UpdateService, ReleaseInfo } from '../../services/update.service';
import { PanelVisibilityService } from '../../services/panel-visibility.service';

function createMockUpdateService() {
  return {
    appVersion: vi.fn().mockReturnValue('1.2.0'),
    availableReleases: vi.fn().mockReturnValue([
      { version: '1.3.0', name: 'Release 1.3.0', publishedAt: 'March 1, 2026', releaseUrl: '', isCurrent: false },
      { version: '1.2.0', name: 'Release 1.2.0', publishedAt: 'Feb 15, 2026', releaseUrl: '', isCurrent: true },
      { version: '1.1.0', name: 'Release 1.1.0', publishedAt: 'Jan 10, 2026', releaseUrl: '', isCurrent: false },
    ] as ReleaseInfo[]),
    isLoadingReleases: vi.fn().mockReturnValue(false),
    isUpdating: vi.fn().mockReturnValue(false),
    listReleases: vi.fn().mockResolvedValue([]),
    startInstallVersion: vi.fn().mockResolvedValue(true),
  };
}

function createMockPanels() {
  return {
    showVersionManager: signal(false),
  };
}

describe('VersionManagerComponent', () => {
  let fixture: ComponentFixture<VersionManagerComponent>;
  let component: VersionManagerComponent;
  let mockUpdateService: ReturnType<typeof createMockUpdateService>;
  let mockPanels: ReturnType<typeof createMockPanels>;

  beforeEach(async () => {
    mockUpdateService = createMockUpdateService();
    mockPanels = createMockPanels();

    await TestBed.configureTestingModule({
      imports: [VersionManagerComponent],
      providers: [
        { provide: UpdateService, useValue: mockUpdateService },
        { provide: PanelVisibilityService, useValue: mockPanels },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(VersionManagerComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should fetch releases on init', () => {
    fixture.detectChanges();
    expect(mockUpdateService.listReleases).toHaveBeenCalled();
  });

  describe('when modal is open', () => {
    beforeEach(() => {
      mockPanels.showVersionManager.set(true);
      fixture.detectChanges();
    });

    it('should render release list', () => {
      const rows = fixture.nativeElement.querySelectorAll('.version-manager__row');
      expect(rows.length).toBe(3);
    });

    it('should show current badge for current version', () => {
      const badge = fixture.nativeElement.querySelector('.version-manager__current-badge');
      expect(badge).toBeTruthy();
      expect(badge.textContent.trim()).toBe('Current');
    });

    it('should disable install button for current version', () => {
      const rows = fixture.nativeElement.querySelectorAll('.version-manager__row');
      const currentRow = rows[1]; // v1.2.0 is current
      const btn = currentRow.querySelector('button');
      expect(btn.disabled).toBe(true);
      expect(btn.textContent.trim()).toBe('Installed');
    });

    it('should enable install button for other versions', () => {
      const rows = fixture.nativeElement.querySelectorAll('.version-manager__row');
      const olderRow = rows[2]; // v1.1.0
      const btn = olderRow.querySelector('.rr-btn--primary');
      expect(btn).toBeTruthy();
      expect(btn.disabled).toBe(false);
    });

    it('should show confirmation dialog on install click', () => {
      const release = { version: '1.1.0', name: '', publishedAt: '', releaseUrl: '', isCurrent: false };
      component.promptInstall(release);
      expect(component.confirmVersion).toEqual(release);
    });

    it('should close modal on close()', () => {
      component.close();
      expect(mockPanels.showVersionManager()).toBe(false);
    });
  });

  describe('install confirmation', () => {
    it('should call startInstallVersion on confirm', async () => {
      component.confirmVersion = { version: '1.1.0', name: '', publishedAt: '', releaseUrl: '', isCurrent: false };
      mockPanels.showVersionManager.set(true);

      await component.confirmInstall();

      expect(mockUpdateService.startInstallVersion).toHaveBeenCalledWith('1.1.0');
      expect(mockPanels.showVersionManager()).toBe(false);
    });

    it('should clear confirmVersion on cancel', () => {
      component.confirmVersion = { version: '1.1.0', name: '', publishedAt: '', releaseUrl: '', isCurrent: false };
      component.cancelInstall();
      expect(component.confirmVersion).toBeNull();
    });

    it('should not call startInstallVersion when no confirmVersion', async () => {
      component.confirmVersion = null;
      await component.confirmInstall();
      expect(mockUpdateService.startInstallVersion).not.toHaveBeenCalled();
    });
  });

  describe('empty and loading states', () => {
    it('should show loading message', () => {
      mockUpdateService.isLoadingReleases.mockReturnValue(true);
      mockPanels.showVersionManager.set(true);
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Loading releases');
    });

    it('should show empty message when no releases', () => {
      mockUpdateService.availableReleases.mockReturnValue([]);
      mockUpdateService.isLoadingReleases.mockReturnValue(false);
      mockPanels.showVersionManager.set(true);
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('No releases found');
    });
  });

  it('should not render when modal is closed', () => {
    mockPanels.showVersionManager.set(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.version-manager')).toBeNull();
  });
});
