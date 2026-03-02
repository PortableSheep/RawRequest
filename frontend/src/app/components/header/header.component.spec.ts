import { ChangeDetectionStrategy } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HeaderComponent } from './header.component';
import { ThemeService } from '../../services/theme.service';
import { WorkspaceStateService } from '../../services/workspace-state.service';
import { PanelVisibilityService } from '../../services/panel-visibility.service';
import { FileSaveService } from '../../services/file-save.service';
import { ToastService } from '../../services/toast.service';
import { StartupService } from '../../services/startup.service';
import { FileTab } from '../../models/http.models';

// jsdom doesn't provide DragEvent; create a minimal stand-in.
if (typeof globalThis.DragEvent === 'undefined') {
  (globalThis as any).DragEvent = class DragEvent extends MouseEvent {
    dataTransfer: DataTransfer | null;
    constructor(type: string, init?: any) {
      super(type, init);
      this.dataTransfer = init?.dataTransfer ?? null;
    }
  };
}

function makeTab(overrides: Partial<FileTab> = {}): FileTab {
  return {
    id: 'tab-1',
    name: 'Untitled.http',
    content: '',
    requests: [],
    environments: {},
    variables: {},
    responseData: {},
    groups: [],
    ...overrides,
  };
}

describe('HeaderComponent', () => {
  let component: HeaderComponent;
  let fixture: ComponentFixture<HeaderComponent>;
  let themeService: vi.Mocked<ThemeService>;

  let mockWs: any;
  let mockPanels: any;
  let mockFileSave: any;
  let mockToast: any;
  let mockStartup: any;

  beforeEach(async () => {
    const themeMock = {
      toggle: vi.fn(),
      resolvedTheme: vi.fn().mockReturnValue('dark'),
    } as unknown as vi.Mocked<ThemeService>;

    mockWs = {
      files: vi.fn().mockReturnValue([]),
      currentFileIndex: vi.fn().mockReturnValue(0),
      currentFileEnvironments: vi.fn().mockReturnValue([]),
      currentEnv: vi.fn().mockReturnValue(''),
      currentFileRequestNames: vi.fn().mockReturnValue([]),
      onCurrentFileIndexChange: vi.fn(),
      addNewTab: vi.fn(),
      closeTab: vi.fn(),
      closeOtherTabs: vi.fn(),
      reorderTabs: vi.fn(),
      onCurrentEnvChange: vi.fn(),
      openFilesFromDisk: vi.fn().mockResolvedValue(undefined),
      addFileFromContent: vi.fn(),
      importCollection: vi.fn().mockResolvedValue(0),
      openExamplesFile: vi.fn().mockResolvedValue(undefined),
      revealInFinder: vi.fn().mockResolvedValue(undefined),
    };
    mockPanels = {
      openSecretsModal: vi.fn(),
      showDonationModal: { set: vi.fn() },
      toggleHistory: vi.fn(),
      toggleOutlinePanel: vi.fn(),
      toggleCommandPalette: vi.fn(),
    };
    mockFileSave = {
      saveCurrentFile: vi.fn().mockResolvedValue(undefined),
      saveCurrentFileAs: vi.fn().mockResolvedValue(undefined),
    };
    mockToast = {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    };
    mockStartup = {
      updateService: { appVersion: vi.fn().mockReturnValue('') },
    };

    await TestBed.configureTestingModule({
      imports: [HeaderComponent],
      providers: [
        { provide: ThemeService, useValue: themeMock },
        { provide: WorkspaceStateService, useValue: mockWs },
        { provide: PanelVisibilityService, useValue: mockPanels },
        { provide: FileSaveService, useValue: mockFileSave },
        { provide: ToastService, useValue: mockToast },
        { provide: StartupService, useValue: mockStartup },
      ],
    })
    .overrideComponent(HeaderComponent, {
      set: { changeDetection: ChangeDetectionStrategy.Default },
    })
    .compileComponents();

    themeService = TestBed.inject(ThemeService) as vi.Mocked<ThemeService>;
    fixture = TestBed.createComponent(HeaderComponent);
    component = fixture.componentInstance;

    // Wrap detectChanges to always markForCheck first (needed for OnPush)
    const origDetectChanges = fixture.detectChanges.bind(fixture);
    fixture.detectChanges = () => {
      fixture.changeDetectorRef.markForCheck();
      origDetectChanges();
    };

    fixture.detectChanges();
  });

  // ── Component creation ──────────────────────────────────────────────

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // ── Tab rendering ───────────────────────────────────────────────────

  it('should render file tabs', () => {
    mockWs.files.mockReturnValue([
      makeTab({ id: '1', name: 'one.http' }),
      makeTab({ id: '2', name: 'two.http' }),
    ]);
    fixture.detectChanges();

    const tabs = fixture.nativeElement.querySelectorAll('.rr-tab');
    expect(tabs.length).toBe(2);
  });

  it('should display tab name', () => {
    mockWs.files.mockReturnValue([makeTab({ id: '1', name: 'requests.http' })]);
    fixture.detectChanges();

    const title: HTMLElement = fixture.nativeElement.querySelector('.rr-tab__title');
    expect(title.textContent?.trim()).toBe('requests.http');
  });

  it('should prefer displayName over name', () => {
    mockWs.files.mockReturnValue([
      makeTab({ id: '1', name: 'file.http', displayName: 'My Requests' }),
    ]);
    fixture.detectChanges();

    const title: HTMLElement = fixture.nativeElement.querySelector('.rr-tab__title');
    expect(title.textContent?.trim()).toBe('My Requests');
  });

  it('should mark the active tab', () => {
    mockWs.files.mockReturnValue([
      makeTab({ id: '1', name: 'a.http' }),
      makeTab({ id: '2', name: 'b.http' }),
    ]);
    mockWs.currentFileIndex.mockReturnValue(1);
    fixture.detectChanges();

    const tabs = fixture.nativeElement.querySelectorAll('.rr-tab');
    expect(tabs[0].classList.contains('rr-tab--active')).toBe(false);
    expect(tabs[1].classList.contains('rr-tab--active')).toBe(true);
  });

  // ── Tab click / file select ─────────────────────────────────────────

  it('should call ws.onCurrentFileIndexChange when a tab link is clicked', () => {
    mockWs.files.mockReturnValue([
      makeTab({ id: '1', name: 'a.http' }),
      makeTab({ id: '2', name: 'b.http' }),
    ]);
    fixture.detectChanges();

    const links = fixture.nativeElement.querySelectorAll('.rr-tab__link') as NodeListOf<HTMLAnchorElement>;
    links[1].click();

    expect(mockWs.onCurrentFileIndexChange).toHaveBeenCalledWith(1);
  });

  // ── Close tab button ────────────────────────────────────────────────

  it('should call ws.closeTab when close button is clicked', () => {
    mockWs.files.mockReturnValue([
      makeTab({ id: '1', name: 'a.http' }),
      makeTab({ id: '2', name: 'b.http' }),
    ]);
    fixture.detectChanges();

    const closeButtons = fixture.nativeElement.querySelectorAll('.rr-icon-btn--danger') as NodeListOf<HTMLButtonElement>;
    closeButtons[1].click();

    expect(mockWs.closeTab).toHaveBeenCalledWith(1);
  });

  // ── Context menu ────────────────────────────────────────────────────

  it('should open context menu on right-click of a tab', () => {
    mockWs.files.mockReturnValue([
      makeTab({ id: '1', name: 'a.http', filePath: '/path/a.http' }),
    ]);
    fixture.detectChanges();

    const tab: HTMLElement = fixture.nativeElement.querySelector('.rr-tab');
    tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 50 }));
    fixture.detectChanges();

    expect(component.contextMenu.show).toBe(true);
    expect(component.contextMenu.tabIndex).toBe(0);
    const contextMenuEl = fixture.nativeElement.querySelector('.rr-menu--context');
    expect(contextMenuEl).toBeTruthy();
  });

  it('should show "Reveal in Finder" when file has a filePath', () => {
    mockWs.files.mockReturnValue([
      makeTab({ id: '1', name: 'a.http', filePath: '/some/path.http' }),
    ]);
    fixture.detectChanges();

    const tab: HTMLElement = fixture.nativeElement.querySelector('.rr-tab');
    tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 50 }));
    fixture.detectChanges();

    const items = fixture.nativeElement.querySelectorAll('.rr-menu--context .rr-menu__item');
    const labels = Array.from(items).map((el: any) => el.textContent?.trim());
    expect(labels).toContain('Reveal in Finder');
  });

  it('should show "File not saved" note when file has no filePath', () => {
    mockWs.files.mockReturnValue([
      makeTab({ id: '1', name: 'a.http' }),
    ]);
    fixture.detectChanges();

    const tab: HTMLElement = fixture.nativeElement.querySelector('.rr-tab');
    tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 50 }));
    fixture.detectChanges();

    const note = fixture.nativeElement.querySelector('.rr-menu--context .rr-menu__note');
    expect(note?.textContent?.trim()).toBe('File not saved to disk');
  });

  it('should call ws.closeTab via context menu "Close Tab"', () => {
    mockWs.files.mockReturnValue([
      makeTab({ id: '1', name: 'a.http' }),
    ]);
    fixture.detectChanges();

    component.contextMenu = { show: true, x: 0, y: 0, tabIndex: 0, filePath: '' };
    fixture.detectChanges();

    const items = fixture.nativeElement.querySelectorAll('.rr-menu--context .rr-menu__item') as NodeListOf<HTMLButtonElement>;
    const closeBtn = Array.from(items).find((el) => el.textContent?.trim() === 'Close Tab')!;
    closeBtn.click();

    expect(mockWs.closeTab).toHaveBeenCalledWith(0);
    expect(component.contextMenu.show).toBe(false);
  });

  it('should call ws.closeOtherTabs via context menu "Close Other Tabs"', () => {
    mockWs.files.mockReturnValue([
      makeTab({ id: '1', name: 'a.http' }),
      makeTab({ id: '2', name: 'b.http' }),
    ]);
    fixture.detectChanges();

    component.contextMenu = { show: true, x: 0, y: 0, tabIndex: 0, filePath: '' };
    fixture.detectChanges();

    const items = fixture.nativeElement.querySelectorAll('.rr-menu--context .rr-menu__item') as NodeListOf<HTMLButtonElement>;
    const btn = Array.from(items).find((el) => el.textContent?.trim() === 'Close Other Tabs')!;
    btn.click();

    expect(mockWs.closeOtherTabs).toHaveBeenCalledWith(0);
    expect(component.contextMenu.show).toBe(false);
  });

  it('should call ws.revealInFinder via context menu', () => {
    component.contextMenu = { show: true, x: 0, y: 0, tabIndex: 2, filePath: '/some/file.http' };
    fixture.detectChanges();

    const items = fixture.nativeElement.querySelectorAll('.rr-menu--context .rr-menu__item') as NodeListOf<HTMLButtonElement>;
    const btn = Array.from(items).find((el) => el.textContent?.trim() === 'Reveal in Finder')!;
    btn.click();

    expect(mockWs.revealInFinder).toHaveBeenCalledWith(2);
    expect(component.contextMenu.show).toBe(false);
  });

  it('should close context menu on escape key', () => {
    component.contextMenu = { show: true, x: 0, y: 0, tabIndex: 0, filePath: '' };
    fixture.detectChanges();

    component.handleEscape();
    fixture.detectChanges();

    expect(component.contextMenu.show).toBe(false);
  });

  // ── Environment selector ────────────────────────────────────────────

  it('should render environment options when environments are provided', () => {
    mockWs.currentFileEnvironments.mockReturnValue(['dev', 'staging', 'prod']);
    mockWs.currentEnv.mockReturnValue('dev');
    fixture.detectChanges();

    const select: HTMLSelectElement = fixture.nativeElement.querySelector('.rr-select');
    expect(select).toBeTruthy();

    const options = select.querySelectorAll('option');
    expect(options.length).toBe(3);
    expect(options[0].textContent?.trim()).toBe('dev');
    expect(options[1].textContent?.trim()).toBe('staging');
    expect(options[2].textContent?.trim()).toBe('prod');
  });

  it('should show "No Environments" badge when no environments', () => {
    mockWs.currentFileEnvironments.mockReturnValue([]);
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector('.rr-select');
    expect(select).toBeNull();

    const badge: HTMLElement = fixture.nativeElement.querySelector('.rr-select-wrap .rr-badge');
    expect(badge?.textContent?.trim()).toBe('No Environments');
  });

  it('should call ws.onCurrentEnvChange when environment is changed', () => {
    mockWs.currentFileEnvironments.mockReturnValue(['dev', 'staging']);
    mockWs.currentEnv.mockReturnValue('dev');
    fixture.detectChanges();

    const select: HTMLSelectElement = fixture.nativeElement.querySelector('.rr-select');
    select.value = 'staging';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(mockWs.onCurrentEnvChange).toHaveBeenCalled();
  });

  // ── App version badge ───────────────────────────────────────────────

  it('should display version badge when appVersion is set', () => {
    mockStartup.updateService.appVersion.mockReturnValue('1.2.3');
    fixture.detectChanges();

    const badges = fixture.nativeElement.querySelectorAll('.rr-badge');
    const versionBadge = Array.from(badges).find((b: any) => b.textContent?.includes('v1.2.3'));
    expect(versionBadge).toBeTruthy();
  });

  it('should not display version badge when appVersion is empty', () => {
    mockStartup.updateService.appVersion.mockReturnValue('');
    fixture.detectChanges();

    const badges: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.rr-topbar__right > .rr-badge');
    expect(badges.length).toBe(0);
  });

  // ── New / Open / Save buttons ───────────────────────────────────────

  it('should call ws.addNewTab when New button is clicked', () => {
    const btn = fixture.nativeElement.querySelector('[aria-label="Create new file"]') as HTMLButtonElement;
    btn.click();
    expect(mockWs.addNewTab).toHaveBeenCalled();
  });

  it('should call openFile when Open button is clicked', () => {
    const btn = fixture.nativeElement.querySelector('[aria-label="Open existing file"]') as HTMLButtonElement;
    btn.click();
    expect(mockWs.openFilesFromDisk).toHaveBeenCalled();
  });

  it('should call fileSave.saveCurrentFile when Save button is clicked', () => {
    const btn = fixture.nativeElement.querySelector('[aria-label="Save file"]') as HTMLButtonElement;
    btn.click();
    expect(mockFileSave.saveCurrentFile).toHaveBeenCalled();
  });

  // ── Save menu (split button) ────────────────────────────────────────

  it('should open save menu when toggle button is clicked', () => {
    const toggle = fixture.nativeElement.querySelector('[aria-label="More save options"]') as HTMLButtonElement;
    toggle.click();
    fixture.detectChanges();

    expect(component.saveMenu.show).toBe(true);
    const menu = fixture.nativeElement.querySelector('.rr-menu--save');
    expect(menu).toBeTruthy();
  });

  it('should call fileSave.saveCurrentFileAs when "Save As…" is clicked', () => {
    component.saveMenu = { show: true, x: 0, y: 0 };
    fixture.detectChanges();

    const item = fixture.nativeElement.querySelector('.rr-menu--save .rr-menu__item') as HTMLButtonElement;
    item.click();

    expect(mockFileSave.saveCurrentFileAs).toHaveBeenCalled();
    expect(component.saveMenu.show).toBe(false);
  });

  it('should close save menu on second toggle click', () => {
    const toggle = fixture.nativeElement.querySelector('[aria-label="More save options"]') as HTMLButtonElement;
    toggle.click();
    fixture.detectChanges();
    expect(component.saveMenu.show).toBe(true);

    toggle.click();
    fixture.detectChanges();
    expect(component.saveMenu.show).toBe(false);
  });

  // ── More menu (kebab) ───────────────────────────────────────────────

  it('should open more menu when kebab button is clicked', () => {
    const kebab = fixture.nativeElement.querySelector('.rr-kebab') as HTMLButtonElement;
    kebab.click();
    fixture.detectChanges();

    expect(component.moreMenu.show).toBe(true);
    const menu = fixture.nativeElement.querySelector('.rr-menu--more');
    expect(menu).toBeTruthy();
  });

  it('should call ws.openExamplesFile from more menu', () => {
    component.moreMenu = { show: true, x: 0, y: 0 };
    fixture.detectChanges();

    const items = fixture.nativeElement.querySelectorAll('.rr-menu--more .rr-menu__item') as NodeListOf<HTMLButtonElement>;
    const btn = Array.from(items).find((el) => el.textContent?.includes('Open Examples'))!;
    btn.click();

    expect(mockWs.openExamplesFile).toHaveBeenCalled();
    expect(component.moreMenu.show).toBe(false);
  });

  it('should call panels.showDonationModal.set from more menu', () => {
    component.moreMenu = { show: true, x: 0, y: 0 };
    fixture.detectChanges();

    const items = fixture.nativeElement.querySelectorAll('.rr-menu--more .rr-menu__item') as NodeListOf<HTMLButtonElement>;
    const btn = Array.from(items).find((el) => el.textContent?.includes('Support Development'))!;
    btn.click();

    expect(mockPanels.showDonationModal.set).toHaveBeenCalledWith(true);
    expect(component.moreMenu.show).toBe(false);
  });

  it('should call ws.importCollection("postman") from more menu', () => {
    component.moreMenu = { show: true, x: 0, y: 0 };
    fixture.detectChanges();

    const items = fixture.nativeElement.querySelectorAll('.rr-menu--more .rr-menu__item') as NodeListOf<HTMLButtonElement>;
    const btn = Array.from(items).find((el) => el.textContent?.includes('Import Postman'))!;
    btn.click();

    expect(mockWs.importCollection).toHaveBeenCalledWith('postman');
    expect(component.moreMenu.show).toBe(false);
  });

  it('should call ws.importCollection("bruno") from more menu', () => {
    component.moreMenu = { show: true, x: 0, y: 0 };
    fixture.detectChanges();

    const items = fixture.nativeElement.querySelectorAll('.rr-menu--more .rr-menu__item') as NodeListOf<HTMLButtonElement>;
    const btn = Array.from(items).find((el) => el.textContent?.includes('Import Bruno'))!;
    btn.click();

    expect(mockWs.importCollection).toHaveBeenCalledWith('bruno');
    expect(component.moreMenu.show).toBe(false);
  });

  it('should call panels.openSecretsModal from more menu', () => {
    component.moreMenu = { show: true, x: 0, y: 0 };
    fixture.detectChanges();

    const items = fixture.nativeElement.querySelectorAll('.rr-menu--more .rr-menu__item') as NodeListOf<HTMLButtonElement>;
    const btn = Array.from(items).find((el) => el.textContent?.includes('Secrets'))!;
    btn.click();

    expect(mockPanels.openSecretsModal).toHaveBeenCalled();
    expect(component.moreMenu.show).toBe(false);
  });

  it('should call panels.toggleHistory from more menu', () => {
    component.moreMenu = { show: true, x: 0, y: 0 };
    fixture.detectChanges();

    const items = fixture.nativeElement.querySelectorAll('.rr-menu--more .rr-menu__item') as NodeListOf<HTMLButtonElement>;
    const btn = Array.from(items).find((el) => el.textContent?.includes('History'))!;
    btn.click();

    expect(mockPanels.toggleHistory).toHaveBeenCalled();
    expect(component.moreMenu.show).toBe(false);
  });

  it('should call panels.toggleOutlinePanel from more menu', () => {
    component.moreMenu = { show: true, x: 0, y: 0 };
    fixture.detectChanges();

    const items = fixture.nativeElement.querySelectorAll('.rr-menu--more .rr-menu__item') as NodeListOf<HTMLButtonElement>;
    const btn = Array.from(items).find((el) => el.textContent?.includes('Outline'))!;
    btn.click();

    expect(mockPanels.toggleOutlinePanel).toHaveBeenCalled();
    expect(component.moreMenu.show).toBe(false);
  });

  it('should call panels.toggleCommandPalette from more menu', () => {
    component.moreMenu = { show: true, x: 0, y: 0 };
    fixture.detectChanges();

    const items = fixture.nativeElement.querySelectorAll('.rr-menu--more .rr-menu__item') as NodeListOf<HTMLButtonElement>;
    const btn = Array.from(items).find((el) => el.textContent?.includes('Search Requests'))!;
    btn.click();

    expect(mockPanels.toggleCommandPalette).toHaveBeenCalled();
    expect(component.moreMenu.show).toBe(false);
  });

  it('should toggle theme from more menu', () => {
    component.moreMenu = { show: true, x: 0, y: 0 };
    fixture.detectChanges();

    const items = fixture.nativeElement.querySelectorAll('.rr-menu--more .rr-menu__item') as NodeListOf<HTMLButtonElement>;
    const btn = Array.from(items).find((el) => el.textContent?.includes('Switch to'))!;
    btn.click();

    expect(themeService.toggle).toHaveBeenCalled();
    expect(component.moreMenu.show).toBe(false);
  });

  it('should close more menu on escape key', () => {
    component.moreMenu = { show: true, x: 0, y: 0 };
    component.handleEscape();
    expect(component.moreMenu.show).toBe(false);
  });

  // ── Menu mutual exclusion ──────────────────────────────────────────

  it('should close other menus when opening save menu', () => {
    component.moreMenu = { show: true, x: 0, y: 0 };
    component.contextMenu = { show: true, x: 0, y: 0, tabIndex: 0, filePath: '' };

    const toggle = fixture.nativeElement.querySelector('[aria-label="More save options"]') as HTMLButtonElement;
    toggle.click();
    fixture.detectChanges();

    expect(component.saveMenu.show).toBe(true);
    expect(component.moreMenu.show).toBe(false);
    expect(component.contextMenu.show).toBe(false);
  });

  it('should close other menus when opening more menu', () => {
    component.saveMenu = { show: true, x: 0, y: 0 };
    component.contextMenu = { show: true, x: 0, y: 0, tabIndex: 0, filePath: '' };

    const kebab = fixture.nativeElement.querySelector('.rr-kebab') as HTMLButtonElement;
    kebab.click();
    fixture.detectChanges();

    expect(component.moreMenu.show).toBe(true);
    expect(component.saveMenu.show).toBe(false);
    expect(component.contextMenu.show).toBe(false);
  });

  // ── Drag and drop ──────────────────────────────────────────────────

  it('should call ws.reorderTabs on tab drop', () => {
    mockWs.files.mockReturnValue([
      makeTab({ id: '1', name: 'a.http' }),
      makeTab({ id: '2', name: 'b.http' }),
    ]);
    fixture.detectChanges();

    component.draggingIndex = 0;
    const dropEvent = new DragEvent('drop', { bubbles: true });
    Object.defineProperty(dropEvent, 'preventDefault', { value: vi.fn() });
    component.handleTabDrop(dropEvent, 1);

    expect(mockWs.reorderTabs).toHaveBeenCalledWith(0, 1);
    expect(component.draggingIndex).toBeNull();
  });

  it('should not call ws.reorderTabs when dropping on same index', () => {
    component.draggingIndex = 0;
    const dropEvent = new DragEvent('drop', { bubbles: true });
    Object.defineProperty(dropEvent, 'preventDefault', { value: vi.fn() });
    component.handleTabDrop(dropEvent, 0);

    expect(mockWs.reorderTabs).not.toHaveBeenCalled();
  });

  it('should reset drag state on drag end', () => {
    component.draggingIndex = 1;
    component.dragOverIndex = 2;
    component.handleTabDragEnd();

    expect(component.draggingIndex).toBeNull();
    expect(component.dragOverIndex).toBeNull();
  });

  // ── isDarkTheme ─────────────────────────────────────────────────────

  it('should delegate isDarkTheme to ThemeService', () => {
    expect(component.isDarkTheme()).toBe(true);

    themeService.resolvedTheme.mockReturnValue('light' as any);
    expect(component.isDarkTheme()).toBe(false);
  });
});
