import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChangeDetectionStrategy, signal } from '@angular/core';
import { ConsoleDrawerComponent } from './console-drawer.component';
import { ScriptLogEntry } from '../../models/http.models';
import { PanelVisibilityService } from '../../services/panel-visibility.service';
import { ScriptConsoleService } from '../../services/script-console.service';

// Mock GSAP so animation calls don't break in JSDOM
jest.mock('gsap', () => {
  const tweenStub = { kill: jest.fn() };
  return {
    gsap: {
      set: jest.fn(),
      to: jest.fn((_target: unknown, vars: Record<string, unknown>) => {
        if (typeof vars?.onComplete === 'function') (vars.onComplete as () => void)();
        return tweenStub;
      }),
    },
  };
});

function makeLog(overrides: Partial<ScriptLogEntry> = {}): ScriptLogEntry {
  return {
    timestamp: '2025-01-15T10:30:00Z',
    level: 'info',
    source: 'post-script',
    message: 'hello world',
    ...overrides,
  };
}

describe('ConsoleDrawerComponent', () => {
  let component: ConsoleDrawerComponent;
  let fixture: ComponentFixture<ConsoleDrawerComponent>;

  const mockLogs = signal<ScriptLogEntry[]>([]);
  const mockConsoleOpen = signal(false);

  const mockPanels = {
    consoleOpen: mockConsoleOpen,
    toggleConsole: jest.fn(),
  };
  const mockScriptConsole = {
    logs: mockLogs,
    clear: jest.fn(),
  };

  beforeEach(async () => {
    mockLogs.set([]);
    mockConsoleOpen.set(false);
    jest.clearAllMocks();

    await TestBed.configureTestingModule({
      imports: [ConsoleDrawerComponent],
      providers: [
        { provide: PanelVisibilityService, useValue: mockPanels },
        { provide: ScriptConsoleService, useValue: mockScriptConsole },
      ],
    })
    .overrideComponent(ConsoleDrawerComponent, { set: { changeDetection: ChangeDetectionStrategy.Default } })
    .compileComponents();

    fixture = TestBed.createComponent(ConsoleDrawerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  // ── Creation ──────────────────────────────────────────────
  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // ── Open / Close state ────────────────────────────────────
  describe('open / close state', () => {
    it('should default to closed (drawer not visible)', () => {
      expect(component.isDrawerVisible()).toBe(false);
    });

    it('should show the bubble button when closed', () => {
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.console-bubble__btn')).toBeTruthy();
    });

    it('should not render the drawer shell when closed', () => {
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.console-drawer__shell')).toBeNull();
    });

    it('should render the drawer shell when open', () => {
      mockConsoleOpen.set(true);
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      expect(component.isDrawerVisible()).toBe(true);
      expect(el.querySelector('.console-drawer__shell')).toBeTruthy();
    });

    it('should hide bubble button when drawer is open', () => {
      mockConsoleOpen.set(true);
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.console-bubble__btn')).toBeNull();
    });

    it('should call panels.toggleConsole when bubble button is clicked', () => {
      const btn: HTMLButtonElement = fixture.nativeElement.querySelector('.console-bubble__btn');
      btn.click();

      expect(mockPanels.toggleConsole).toHaveBeenCalled();
    });

    it('should call panels.toggleConsole when hide-console button is clicked (via requestClose)', () => {
      mockConsoleOpen.set(true);
      fixture.detectChanges();

      const btn: HTMLButtonElement = fixture.nativeElement.querySelector('.console-panel__hide-btn');
      btn.click();

      expect(mockPanels.toggleConsole).toHaveBeenCalled();
    });
  });

  // ── Log entry rendering ───────────────────────────────────
  describe('log entry rendering', () => {
    beforeEach(() => {
      mockConsoleOpen.set(true);
      fixture.detectChanges();
    });

    it('should show empty state when no logs', () => {
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.console-empty')).toBeTruthy();
      expect(el.querySelector('.console-empty__text')?.textContent).toContain('Console is quiet');
    });

    it('should render log entries when logs are provided', () => {
      mockLogs.set([
        makeLog({ level: 'info', message: 'first' }),
        makeLog({ level: 'error', message: 'second' }),
      ]);
      fixture.detectChanges();

      const entries = fixture.nativeElement.querySelectorAll('.log-entry');
      expect(entries.length).toBe(2);
    });

    it('should display log message text', () => {
      mockLogs.set([makeLog({ message: 'test output 123' })]);
      fixture.detectChanges();

      const msg = fixture.nativeElement.querySelector('.log-message');
      expect(msg?.textContent).toContain('test output 123');
    });

    it('should display log level', () => {
      mockLogs.set([makeLog({ level: 'warn' })]);
      fixture.detectChanges();

      const level = fixture.nativeElement.querySelector('.log-level');
      expect(level?.textContent?.trim()).toBe('warn');
    });

    it('should display log source', () => {
      mockLogs.set([makeLog({ source: 'pre-script' })]);
      fixture.detectChanges();

      const source = fixture.nativeElement.querySelector('.log-source');
      expect(source?.textContent?.trim()).toBe('pre-script');
    });

    it('should apply error CSS class for error-level logs', () => {
      mockLogs.set([makeLog({ level: 'error' })]);
      fixture.detectChanges();

      const entry = fixture.nativeElement.querySelector('.log-entry');
      expect(entry?.classList.contains('log-entry--error')).toBe(true);
    });

    it('should apply warn CSS class for warn-level logs', () => {
      mockLogs.set([makeLog({ level: 'warn' })]);
      fixture.detectChanges();

      const entry = fixture.nativeElement.querySelector('.log-entry');
      expect(entry?.classList.contains('log-entry--warn')).toBe(true);
    });

    it('should apply warn CSS class for warning-level logs', () => {
      mockLogs.set([makeLog({ level: 'warning' })]);
      fixture.detectChanges();

      const entry = fixture.nativeElement.querySelector('.log-entry');
      expect(entry?.classList.contains('log-entry--warn')).toBe(true);
    });

    it('should apply info CSS class for info-level logs', () => {
      mockLogs.set([makeLog({ level: 'info' })]);
      fixture.detectChanges();

      const entry = fixture.nativeElement.querySelector('.log-entry');
      expect(entry?.classList.contains('log-entry--info')).toBe(true);
    });

    it('should apply debug CSS class for debug-level logs', () => {
      mockLogs.set([makeLog({ level: 'debug' })]);
      fixture.detectChanges();

      const entry = fixture.nativeElement.querySelector('.log-entry');
      expect(entry?.classList.contains('log-entry--debug')).toBe(true);
    });

    it('should apply log CSS class for log-level logs', () => {
      mockLogs.set([makeLog({ level: 'log' })]);
      fixture.detectChanges();

      const entry = fixture.nativeElement.querySelector('.log-entry');
      expect(entry?.classList.contains('log-entry--log')).toBe(true);
    });

    it('should set data-level attribute on log entries', () => {
      mockLogs.set([makeLog({ level: 'error' })]);
      fixture.detectChanges();

      const entry = fixture.nativeElement.querySelector('.log-entry');
      expect(entry?.getAttribute('data-level')).toBe('error');
    });

    it('should show log count in the header', () => {
      mockLogs.set([makeLog(), makeLog(), makeLog()]);
      fixture.detectChanges();

      const count = fixture.nativeElement.querySelector('.console-panel__count');
      expect(count?.textContent?.trim()).toBe('3');
    });

    it('should show "No entries yet" when no logs exist', () => {
      mockLogs.set([]);
      fixture.detectChanges();

      const meta = fixture.nativeElement.querySelector('.console-panel__meta');
      expect(meta?.textContent).toContain('No entries yet');
    });

    it('should show latest log timestamp when logs exist', () => {
      mockLogs.set([makeLog()]);
      fixture.detectChanges();

      const meta = fixture.nativeElement.querySelector('.console-panel__meta');
      expect(meta?.textContent).toContain('Last entry');
    });
  });

  // ── Clear console ─────────────────────────────────────────
  describe('clear console', () => {
    beforeEach(() => {
      mockConsoleOpen.set(true);
      fixture.detectChanges();
    });

    it('should call scriptConsole.clear when clear button is clicked', () => {
      mockLogs.set([makeLog()]);
      fixture.detectChanges();

      const btn: HTMLButtonElement = fixture.nativeElement.querySelector('.console-panel__clear-btn');
      btn.click();

      expect(mockScriptConsole.clear).toHaveBeenCalled();
    });

    it('should disable clear button when there are no logs', () => {
      mockLogs.set([]);
      fixture.detectChanges();

      const btn: HTMLButtonElement = fixture.nativeElement.querySelector('.console-panel__clear-btn');
      expect(btn.disabled).toBe(true);
    });

    it('should enable clear button when there are logs', () => {
      mockLogs.set([makeLog()]);
      fixture.detectChanges();

      const btn: HTMLButtonElement = fixture.nativeElement.querySelector('.console-panel__clear-btn');
      expect(btn.disabled).toBe(false);
    });
  });

  // ── Bubble button log count ───────────────────────────────
  describe('bubble button', () => {
    it('should show log count on bubble button', () => {
      mockLogs.set([makeLog(), makeLog()]);
      fixture.detectChanges();

      const count = fixture.nativeElement.querySelector('.console-bubble__count');
      expect(count?.textContent?.trim()).toBe('2');
    });
  });

  // ── Resize drag handle ────────────────────────────────────
  describe('resize drag handle', () => {
    beforeEach(() => {
      mockConsoleOpen.set(true);
      fixture.detectChanges();
    });

    it('should render resize handle', () => {
      const handle = fixture.nativeElement.querySelector('.resize-handle');
      expect(handle).toBeTruthy();
    });

    it('should have default panel height of 256', () => {
      expect(component.panelHeight()).toBe(256);
    });

    it('should not be resizing initially', () => {
      expect(component.isResizing()).toBe(false);
    });

    it('should set isResizing to true on mousedown', () => {
      const handle: HTMLElement = fixture.nativeElement.querySelector('.resize-handle');
      handle.dispatchEvent(new MouseEvent('mousedown', { clientY: 500, bubbles: true }));

      expect(component.isResizing()).toBe(true);
    });

    it('should update panel height on mousemove while resizing', () => {
      component.startResize(new MouseEvent('mousedown', { clientY: 500 }));

      // Drag up by 100px → height increases by 100
      component.onMouseMove(new MouseEvent('mousemove', { clientY: 400 }));

      expect(component.panelHeight()).toBe(356);
    });

    it('should not go below minimum height', () => {
      component.startResize(new MouseEvent('mousedown', { clientY: 500 }));

      // Drag down significantly to try to shrink below min
      component.onMouseMove(new MouseEvent('mousemove', { clientY: 900 }));

      expect(component.panelHeight()).toBe(150);
    });

    it('should not exceed max height', () => {
      component.startResize(new MouseEvent('mousedown', { clientY: 500 }));

      // Drag up significantly
      component.onMouseMove(new MouseEvent('mousemove', { clientY: -1000 }));

      expect(component.panelHeight()).toBeLessThanOrEqual(window.innerHeight * 0.8);
    });

    it('should stop resizing on mouseup', () => {
      component.startResize(new MouseEvent('mousedown', { clientY: 500 }));
      expect(component.isResizing()).toBe(true);

      component.onMouseUp();
      expect(component.isResizing()).toBe(false);
    });

    it('should ignore mousemove when not resizing', () => {
      const initialHeight = component.panelHeight();
      component.onMouseMove(new MouseEvent('mousemove', { clientY: 100 }));
      expect(component.panelHeight()).toBe(initialHeight);
    });

    it('should apply select-none class to viewport while resizing', () => {
      component.startResize(new MouseEvent('mousedown', { clientY: 500 }));
      fixture.detectChanges();

      const viewport = fixture.nativeElement.querySelector('.console-panel__viewport');
      expect(viewport?.classList.contains('select-none')).toBe(true);
    });

    it('should apply panel height to viewport style', () => {
      const viewport: HTMLElement = fixture.nativeElement.querySelector('.console-panel__viewport');
      expect(viewport?.style.height).toBe('256px');

      component.panelHeight.set(400);
      fixture.detectChanges();

      expect(viewport?.style.height).toBe('400px');
    });
  });

  // ── Status indicator (tone-based coloring) ────────────────
  describe('toneDotClass', () => {
    it('should return blue pulsing class for pending tone', () => {
      expect(component.toneDotClass('pending')).toBe('bg-blue-400 animate-pulse');
    });

    it('should return green class for success tone', () => {
      expect(component.toneDotClass('success')).toBe('bg-emerald-400');
    });

    it('should return amber class for warning tone', () => {
      expect(component.toneDotClass('warning')).toBe('bg-amber-400');
    });

    it('should return red class for error tone', () => {
      expect(component.toneDotClass('error')).toBe('bg-red-500');
    });

    it('should return zinc class for idle tone', () => {
      expect(component.toneDotClass('idle')).toBe('bg-zinc-500');
    });

    it('should return zinc class for undefined tone', () => {
      expect(component.toneDotClass(undefined)).toBe('bg-zinc-500');
    });
  });

  // ── trackLogEntry ─────────────────────────────────────────
  describe('trackLogEntry', () => {
    it('should return a composite tracking key', () => {
      const entry = makeLog({ timestamp: '2025-01-15T10:30:00Z', source: 'pre-script' });
      const key = component.trackLogEntry(3, entry);
      expect(key).toBe('2025-01-15T10:30:00Z-pre-script-3');
    });
  });

  // ── latestLog computed ────────────────────────────────────
  describe('latestLog', () => {
    it('should return null when no logs', () => {
      expect(component.latestLog()).toBeNull();
    });

    it('should return last entry when logs exist', () => {
      const last = makeLog({ message: 'last one' });
      mockLogs.set([makeLog(), last]);
      expect(component.latestLog()).toBe(last);
    });
  });

  // ── requestClose ──────────────────────────────────────────
  describe('requestClose', () => {
    it('should not call toggleConsole when already closed', () => {
      component.requestClose();
      expect(mockPanels.toggleConsole).not.toHaveBeenCalled();
    });
  });
});
