import { TestBed } from '@angular/core/testing';
import { SplitPaneService } from './split-pane.service';
import { DEFAULT_LEFT_PX, SPLIT_LAYOUT_BREAKPOINT_PX } from '../utils/split-layout';

describe('SplitPaneService', () => {
  let service: SplitPaneService;
  let mockStorage: Record<string, string>;
  const STORAGE_KEY = 'rawrequest_editor_pane_width_px';

  beforeEach(() => {
    mockStorage = {};
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(
      (key: string) => mockStorage[key] ?? null,
    );
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(
      (key: string, value: string) => { mockStorage[key] = value; },
    );

    TestBed.configureTestingModule({});
    service = TestBed.inject(SplitPaneService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });

  it('should be created with default values', () => {
    expect(service).toBeTruthy();
    expect(service.isSplitLayout).toBe(false);
    expect(service.editorPaneWidthPx).toBe(DEFAULT_LEFT_PX);
    expect(service.splitGridTemplateColumns).toBeNull();
  });

  describe('restoreSplitState', () => {
    it('should restore width from localStorage', () => {
      mockStorage[STORAGE_KEY] = '700';
      service.restoreSplitState();
      expect(service.editorPaneWidthPx).toBe(700);
    });

    it('should keep default when localStorage has no value', () => {
      service.restoreSplitState();
      expect(service.editorPaneWidthPx).toBe(DEFAULT_LEFT_PX);
    });

    it('should keep default when localStorage has invalid value', () => {
      mockStorage[STORAGE_KEY] = 'abc';
      service.restoreSplitState();
      expect(service.editorPaneWidthPx).toBe(DEFAULT_LEFT_PX);
    });
  });

  describe('refreshSplitLayoutState', () => {
    it('should set isSplitLayout to true when window is wide enough', () => {
      Object.defineProperty(window, 'innerWidth', { value: SPLIT_LAYOUT_BREAKPOINT_PX, configurable: true });
      service.refreshSplitLayoutState();
      expect(service.isSplitLayout).toBe(true);
      expect(service.splitGridTemplateColumns).not.toBeNull();
    });

    it('should set isSplitLayout to false when window is narrow', () => {
      Object.defineProperty(window, 'innerWidth', { value: SPLIT_LAYOUT_BREAKPOINT_PX - 1, configurable: true });
      service.refreshSplitLayoutState();
      expect(service.isSplitLayout).toBe(false);
      expect(service.splitGridTemplateColumns).toBeNull();
    });
  });

  describe('onWindowResize', () => {
    it('should refresh layout state', () => {
      Object.defineProperty(window, 'innerWidth', { value: SPLIT_LAYOUT_BREAKPOINT_PX, configurable: true });
      service.onWindowResize(undefined);
      expect(service.isSplitLayout).toBe(true);
    });

    it('should clamp width when container is provided', () => {
      Object.defineProperty(window, 'innerWidth', { value: SPLIT_LAYOUT_BREAKPOINT_PX, configurable: true });
      service.editorPaneWidthPx = 9999;
      const container = { getBoundingClientRect: () => ({ width: 800 }) } as HTMLElement;
      service.onWindowResize(container);
      expect(service.editorPaneWidthPx).toBeLessThan(9999);
    });
  });

  describe('onSplitMouseDown', () => {
    it('should start dragging when in split layout', () => {
      service.isSplitLayout = true;
      const event = { clientX: 500, preventDefault: vi.fn() } as unknown as MouseEvent;
      service.onSplitMouseDown(event);
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it('should not start dragging when not in split layout', () => {
      service.isSplitLayout = false;
      const event = { clientX: 500, preventDefault: vi.fn() } as unknown as MouseEvent;
      service.onSplitMouseDown(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe('onMouseMove', () => {
    it('should return false when not dragging', () => {
      const event = { clientX: 600, preventDefault: vi.fn() } as unknown as MouseEvent;
      const result = service.onMouseMove(event, undefined);
      expect(result).toBe(false);
    });

    it('should update width during drag', () => {
      service.isSplitLayout = true;
      const downEvent = { clientX: 500, preventDefault: vi.fn() } as unknown as MouseEvent;
      service.onSplitMouseDown(downEvent);

      const container = { getBoundingClientRect: () => ({ width: 1200 }) } as HTMLElement;
      const moveEvent = { clientX: 550, preventDefault: vi.fn() } as unknown as MouseEvent;
      const result = service.onMouseMove(moveEvent, container);
      expect(result).toBe(true);
      expect(service.editorPaneWidthPx).toBe(DEFAULT_LEFT_PX + 50);
      expect(service.splitGridTemplateColumns).not.toBeNull();
    });

    it('should return false when not in split layout', () => {
      service.isSplitLayout = true;
      const downEvent = { clientX: 500, preventDefault: vi.fn() } as unknown as MouseEvent;
      service.onSplitMouseDown(downEvent);

      service.isSplitLayout = false;
      const moveEvent = { clientX: 550, preventDefault: vi.fn() } as unknown as MouseEvent;
      const result = service.onMouseMove(moveEvent, undefined);
      expect(result).toBe(false);
    });
  });

  describe('onMouseUp', () => {
    it('should stop dragging and persist width', () => {
      service.isSplitLayout = true;
      const downEvent = { clientX: 500, preventDefault: vi.fn() } as unknown as MouseEvent;
      service.onSplitMouseDown(downEvent);

      const container = { getBoundingClientRect: () => ({ width: 1200 }) } as HTMLElement;
      const moveEvent = { clientX: 550, preventDefault: vi.fn() } as unknown as MouseEvent;
      service.onMouseMove(moveEvent, container);

      service.onMouseUp();
      expect(document.body.style.cursor).toBe('');
      expect(document.body.style.userSelect).toBe('');
      expect(mockStorage[STORAGE_KEY]).toBe(String(service.editorPaneWidthPx));
    });

    it('should do nothing when not dragging', () => {
      service.onMouseUp();
      expect(mockStorage[STORAGE_KEY]).toBeUndefined();
    });
  });

  describe('resetSplit', () => {
    it('should reset width to default and persist', () => {
      service.isSplitLayout = true;
      service.editorPaneWidthPx = 800;
      service.resetSplit();
      expect(service.editorPaneWidthPx).toBe(DEFAULT_LEFT_PX);
      expect(mockStorage[STORAGE_KEY]).toBe(String(DEFAULT_LEFT_PX));
    });
  });

  describe('clampSplitWidthToContainer', () => {
    it('should do nothing when not in split layout', () => {
      service.isSplitLayout = false;
      service.editorPaneWidthPx = 9999;
      service.clampSplitWidthToContainer(undefined);
      expect(service.editorPaneWidthPx).toBe(9999);
    });

    it('should clamp width when exceeding container', () => {
      service.isSplitLayout = true;
      service.editorPaneWidthPx = 9999;
      const container = { getBoundingClientRect: () => ({ width: 800 }) } as HTMLElement;
      service.clampSplitWidthToContainer(container);
      expect(service.editorPaneWidthPx).toBeLessThan(9999);
    });

    it('should not change width when within bounds', () => {
      service.isSplitLayout = true;
      service.editorPaneWidthPx = 400;
      const container = { getBoundingClientRect: () => ({ width: 1200 }) } as HTMLElement;
      service.clampSplitWidthToContainer(container);
      expect(service.editorPaneWidthPx).toBe(400);
    });
  });
});
