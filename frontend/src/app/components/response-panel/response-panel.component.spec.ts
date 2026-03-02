import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, input, signal, WritableSignal } from '@angular/core';
import { ResponsePanelComponent, DownloadProgress } from './response-panel.component';
import { ChainEntryPreview, ResponseData, Request, AssertionResult, FileTab } from '../../models/http.models';
import { VirtualResponseBodyComponent } from '../virtual-response-body/virtual-response-body.component';
import { WorkspaceStateService } from '../../services/workspace-state.service';
import { RequestExecutionService } from '../../services/request-execution.service';

// Lightweight stub so we don't pull in the real virtual-response-body tree.
@Component({
  selector: 'app-virtual-response-body',
  standalone: true,
  template: '<div class="mock-body">{{ body() }}</div>',
})
class VirtualResponseBodyStubComponent {
  body = input<string>('');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<ChainEntryPreview> = {}): ChainEntryPreview {
  return {
    id: 'entry-1',
    label: 'GET /api',
    request: { method: 'GET', url: 'https://example.com', headers: {} },
    response: {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: '{"ok":true}',
      responseTime: 42,
    },
    isPrimary: true,
    ...overrides,
  };
}

function makeResponseData(overrides: Partial<ResponseData> = {}): ResponseData {
  return {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    body: '{"ok":true}',
    responseTime: 42,
    chainItems: [makeEntry()],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock services (using signals for reactive tracking)
// ---------------------------------------------------------------------------

const emptyFile = { requests: [] as any[], responseData: {} as Record<number, ResponseData> };

function createMockWs(fileData: any = {}) {
  const fileValue = { ...emptyFile, ...fileData };
  const fileSignal = signal(fileValue);
  return {
    currentFileView: fileSignal as WritableSignal<any>,
    getCurrentFile: jest.fn(() => fileSignal()),
  };
}

function createMockReqExec(overrides: any = {}) {
  return {
    lastExecutedRequestIndexSignal: signal<number | null>(overrides.lastIdx ?? null),
    isRequestRunningSignal: signal<boolean>(overrides.isLoading ?? false),
    downloadProgressSignal: signal<DownloadProgress | null>(overrides.downloadProgress ?? null),
    isCancellingActiveRequest: overrides.isCancelling ?? false,
    activeRequestInfo: overrides.activeRequestInfo ?? null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ResponsePanelComponent', () => {
  let fixture: ComponentFixture<ResponsePanelComponent>;
  let component: ResponsePanelComponent;
  let mockWs: ReturnType<typeof createMockWs>;
  let mockReqExec: ReturnType<typeof createMockReqExec>;

  function setup(fileData: any = {}, reqExecOverrides: any = {}) {
    mockWs = createMockWs(fileData);
    mockReqExec = createMockReqExec(reqExecOverrides);

    TestBed.configureTestingModule({
      imports: [ResponsePanelComponent],
    })
      .overrideComponent(ResponsePanelComponent, {
        remove: { imports: [VirtualResponseBodyComponent] },
        add: { imports: [VirtualResponseBodyStubComponent] },
      })
      .overrideProvider(WorkspaceStateService, { useValue: mockWs })
      .overrideProvider(RequestExecutionService, { useValue: mockReqExec })
      .compileComponents();

    fixture = TestBed.createComponent(ResponsePanelComponent);
    component = fixture.componentInstance;
  }

  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  // -----------------------------------------------------------------------
  // Creation
  // -----------------------------------------------------------------------

  it('should create', () => {
    setup();
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should render idle state when there is no response data', () => {
    setup();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.response-panel__state--idle')).toBeTruthy();
    expect(el.textContent).toContain('Waiting for a request to run.');
  });

  // -----------------------------------------------------------------------
  // Chain entry expand / collapse
  // -----------------------------------------------------------------------

  describe('chain entry expand/collapse', () => {
    beforeEach(() => {
      const rd = makeResponseData();
      setup(
        { requests: [{}], responseData: { 0: rd } },
        { lastIdx: 0 },
      );
      fixture.detectChanges();
    });

    it('should auto-expand the last chain entry', () => {
      expect(component.expandedEntryId()).toBe('entry-1');
    });

    it('should render the entry as open', () => {
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.response-entry--open')).toBeTruthy();
      expect(el.querySelector('.response-entry__details')).toBeTruthy();
    });

    it('should collapse when toggling the expanded entry', () => {
      component.toggleEntry('entry-1');
      fixture.detectChanges();

      expect(component.expandedEntryId()).toBeNull();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.response-entry--open')).toBeNull();
      expect(el.querySelector('.response-entry__details')).toBeNull();
    });

    it('should toggle between entries', () => {
      const entries = [
        makeEntry({ id: 'a', label: 'A' }),
        makeEntry({ id: 'b', label: 'B' }),
      ];
      const rd = makeResponseData({ chainItems: entries });
      mockWs.currentFileView.set({ requests: [{}], responseData: { 0: rd } });
      fixture.detectChanges();

      // Last entry is auto-expanded
      expect(component.expandedEntryId()).toBe('b');

      component.toggleEntry('a');
      fixture.detectChanges();

      expect(component.expandedEntryId()).toBe('a');

      const el: HTMLElement = fixture.nativeElement;
      const openEntries = el.querySelectorAll('.response-entry--open');
      expect(openEntries.length).toBe(1);
    });

    it('should collapse entry on click of the header', () => {
      const el: HTMLElement = fixture.nativeElement;
      const header = el.querySelector('.response-entry__header') as HTMLElement;
      header.click();
      fixture.detectChanges();

      expect(component.expandedEntryId()).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Tab switching (request / response sections)
  // -----------------------------------------------------------------------

  describe('tab switching (request/response views)', () => {
    it('should default entry tab to response', () => {
      const rd = makeResponseData();
      setup(
        { requests: [{}], responseData: { 0: rd } },
        { lastIdx: 0 },
      );
      fixture.detectChanges();

      expect(component.getEntryTab('entry-1')).toBe('response');
    });

    it('should switch tab via setEntryTab', () => {
      const rd = makeResponseData();
      setup(
        { requests: [{}], responseData: { 0: rd } },
        { lastIdx: 0 },
      );
      fixture.detectChanges();

      component.setEntryTab('entry-1', 'request');
      expect(component.getEntryTab('entry-1')).toBe('request');

      component.setEntryTab('entry-1', 'response');
      expect(component.getEntryTab('entry-1')).toBe('response');
    });

    it('should initialise tabs for all chain entries', () => {
      const entries = [
        makeEntry({ id: 'x' }),
        makeEntry({ id: 'y' }),
      ];
      const rd = makeResponseData({ chainItems: entries });
      setup(
        { requests: [{}], responseData: { 0: rd } },
        { lastIdx: 0 },
      );
      fixture.detectChanges();

      expect(component.getEntryTab('x')).toBe('response');
      expect(component.getEntryTab('y')).toBe('response');
    });
  });

  // -----------------------------------------------------------------------
  // Request details collapsible section
  // -----------------------------------------------------------------------

  describe('request details section', () => {
    it('should default to collapsed', () => {
      setup();
      expect(component.isRequestCollapsed('entry-1')).toBe(true);
    });

    it('should toggle the request section', () => {
      setup();
      component.toggleRequestSection('entry-1');
      expect(component.isRequestCollapsed('entry-1')).toBe(false);

      component.toggleRequestSection('entry-1');
      expect(component.isRequestCollapsed('entry-1')).toBe(true);
    });

    it('should show request details when expanded', () => {
      const rd = makeResponseData({
        chainItems: [makeEntry({
          request: {
            method: 'POST',
            url: 'https://example.com/api',
            headers: { Authorization: 'Bearer tok' },
            body: '{"input":1}',
          },
        })],
      });
      setup(
        { requests: [{}], responseData: { 0: rd } },
        { lastIdx: 0 },
      );
      fixture.detectChanges();

      // Expand request details section
      component.toggleRequestSection('entry-1');
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      expect(el.textContent).toContain('Request Details');
      expect(el.textContent).toContain('Authorization');
    });
  });

  // -----------------------------------------------------------------------
  // Copy-to-clipboard
  // -----------------------------------------------------------------------

  describe('copy-to-clipboard', () => {
    let writeTextSpy: jest.Mock;

    beforeEach(() => {
      setup();
      writeTextSpy = jest.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextSpy },
        writable: true,
        configurable: true,
      });
    });

    it('should be idle by default', () => {
      expect(component.getCopyState('entry-1')).toBe('idle');
    });

    it('should copy body to clipboard and set state to copied', async () => {
      await component.copyResponseBody('entry-1', '{"ok":true}');

      expect(writeTextSpy).toHaveBeenCalledWith('{"ok":true}');
      expect(component.getCopyState('entry-1')).toBe('copied');
    });

    it('should not copy when body is empty or null', async () => {
      await component.copyResponseBody('entry-1', null);
      expect(writeTextSpy).not.toHaveBeenCalled();
      expect(component.getCopyState('entry-1')).toBe('idle');

      await component.copyResponseBody('entry-1', '');
      expect(writeTextSpy).not.toHaveBeenCalled();
    });

    it('should set error state when clipboard write fails', async () => {
      writeTextSpy.mockRejectedValue(new Error('Permission denied'));
      jest.spyOn(console, 'error').mockImplementation(() => {});

      await component.copyResponseBody('entry-1', 'body');

      expect(component.getCopyState('entry-1')).toBe('error');
    });

    it('should set error state when clipboard API is unavailable', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: undefined,
        writable: true,
        configurable: true,
      });

      await component.copyResponseBody('entry-1', 'body');
      expect(component.getCopyState('entry-1')).toBe('error');
    });

    it('should reset copy state to idle after timeout', async () => {
      jest.useFakeTimers();

      await component.copyResponseBody('entry-1', 'body');
      expect(component.getCopyState('entry-1')).toBe('copied');

      jest.advanceTimersByTime(1500);
      expect(component.getCopyState('entry-1')).toBe('idle');

      jest.useRealTimers();
    });

    it('should render copy button with correct data-state attribute', async () => {
      const rd = makeResponseData();
      mockWs.currentFileView.set({ requests: [{}], responseData: { 0: rd } });
      mockReqExec.lastExecutedRequestIndexSignal.set(0);
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      const copyBtn = el.querySelector('.response-entry__copy') as HTMLElement;
      expect(copyBtn).toBeTruthy();
      expect(copyBtn.getAttribute('data-state')).toBe('idle');
      expect(copyBtn.textContent).toContain('Copy');

      await component.copyResponseBody('entry-1', '{"ok":true}');
      fixture.detectChanges();

      expect(copyBtn.getAttribute('data-state')).toBe('copied');
      expect(copyBtn.textContent).toContain('Copied');
    });
  });

  // -----------------------------------------------------------------------
  // Download progress display
  // -----------------------------------------------------------------------

  describe('download progress display', () => {
    it('should show "Executing request" spinner when loading without progress', () => {
      setup({}, { isLoading: true });
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.spinner')).toBeTruthy();
      expect(el.textContent).toContain('Executing request');
    });

    it('should show download progress when total is known', () => {
      setup({}, { isLoading: true, downloadProgress: { downloaded: 512, total: 1024 } });
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      expect(el.textContent).toContain('Downloading response');
      expect(el.querySelector('.response-panel__progress-fill')).toBeTruthy();
      // Should show both downloaded and total
      expect(el.textContent).toContain('/');
    });

    it('should show indeterminate progress when total is unknown', () => {
      setup({}, { isLoading: true, downloadProgress: { downloaded: 256, total: 0 } });
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      expect(el.textContent).toContain('downloaded');
      const fill = el.querySelector('.response-panel__progress-fill') as HTMLElement;
      expect(fill.classList.contains('response-panel__progress-fill--pulse')).toBe(true);
    });

    it('should not show download progress when downloaded is 0', () => {
      setup({}, { isLoading: true, downloadProgress: { downloaded: 0, total: 0 } });
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      expect(el.textContent).toContain('Executing request');
      expect(el.querySelector('.response-panel__progress')).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Assertion count display
  // -----------------------------------------------------------------------

  describe('assertion count display', () => {
    beforeEach(() => {
      setup();
    });

    it('countAssertionsPassed returns correct count', () => {
      const assertions: AssertionResult[] = [
        { passed: true, message: 'ok' },
        { passed: false, message: 'fail' },
        { passed: true, message: 'ok2' },
      ];
      expect(component.countAssertionsPassed(assertions)).toBe(2);
    });

    it('countAssertionsFailed returns correct count', () => {
      const assertions: AssertionResult[] = [
        { passed: true, message: 'ok' },
        { passed: false, message: 'fail' },
        { passed: false, message: 'fail2' },
      ];
      expect(component.countAssertionsFailed(assertions)).toBe(2);
    });

    it('returns 0 for null or empty assertions', () => {
      expect(component.countAssertionsPassed(null)).toBe(0);
      expect(component.countAssertionsPassed(undefined)).toBe(0);
      expect(component.countAssertionsPassed([])).toBe(0);
      expect(component.countAssertionsFailed(null)).toBe(0);
      expect(component.countAssertionsFailed(undefined)).toBe(0);
      expect(component.countAssertionsFailed([])).toBe(0);
    });

    it('should render assertion summary in the DOM', () => {
      const assertions: AssertionResult[] = [
        { passed: true, message: 'Status is 200', stage: 'post' },
        { passed: false, message: 'Body contains key', stage: 'post' },
        { passed: true, message: 'Has header', stage: 'post' },
      ];
      const rd = makeResponseData({
        chainItems: [makeEntry({
          response: {
            status: 200,
            statusText: 'OK',
            headers: {},
            body: '',
            responseTime: 10,
            assertions,
          },
        })],
      });
      mockWs.currentFileView.set({ requests: [{}], responseData: { 0: rd } });
      mockReqExec.lastExecutedRequestIndexSignal.set(0);
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      const summary = el.querySelector('.response-entry__assertions-summary');
      expect(summary).toBeTruthy();
      expect(summary!.textContent).toContain('2 passed');
      expect(summary!.textContent).toContain('1 failed');
      expect(summary!.getAttribute('data-failed')).toBe('true');
    });

    it('should show data-failed=false when all pass', () => {
      const assertions: AssertionResult[] = [
        { passed: true, message: 'ok' },
      ];
      const rd = makeResponseData({
        chainItems: [makeEntry({
          response: {
            status: 200,
            statusText: 'OK',
            headers: {},
            body: '',
            responseTime: 10,
            assertions,
          },
        })],
      });
      mockWs.currentFileView.set({ requests: [{}], responseData: { 0: rd } });
      mockReqExec.lastExecutedRequestIndexSignal.set(0);
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      const summary = el.querySelector('.response-entry__assertions-summary');
      expect(summary!.getAttribute('data-failed')).toBe('false');
    });

    it('should expand assertions section to show individual results', () => {
      const assertions: AssertionResult[] = [
        { passed: true, message: 'Status is 200', stage: 'post' },
        { passed: false, message: 'Body check' },
      ];
      const rd = makeResponseData({
        chainItems: [makeEntry({
          response: {
            status: 200,
            statusText: 'OK',
            headers: {},
            body: '',
            responseTime: 10,
            assertions,
          },
        })],
      });
      mockWs.currentFileView.set({ requests: [{}], responseData: { 0: rd } });
      mockReqExec.lastExecutedRequestIndexSignal.set(0);
      fixture.detectChanges();

      // Assertions section defaults to collapsed
      expect(component.isAssertionsCollapsed('entry-1')).toBe(true);
      let el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.response-entry__assertions')).toBeNull();

      // Expand
      component.toggleAssertionsSection('entry-1');
      fixture.detectChanges();

      el = fixture.nativeElement;
      const items = el.querySelectorAll('.response-entry__assertion');
      expect(items.length).toBe(2);
      expect(items[0].textContent).toContain('PASS');
      expect(items[0].textContent).toContain('Status is 200');
      expect(items[1].textContent).toContain('FAIL');
      expect(items[1].textContent).toContain('Body check');
    });
  });

  // -----------------------------------------------------------------------
  // Replay button
  // -----------------------------------------------------------------------

  describe('replay button', () => {
    it('should emit replayRequest when replay is clicked', () => {
      const entry = makeEntry();
      const rd = makeResponseData({ chainItems: [entry] });
      setup(
        { requests: [{}], responseData: { 0: rd } },
        { lastIdx: 0 },
      );
      fixture.detectChanges();

      const spy = jest.fn();
      component.replayRequest.subscribe(spy);

      const el: HTMLElement = fixture.nativeElement;
      const replayBtn = el.querySelector('.response-entry__replay') as HTMLElement;
      expect(replayBtn).toBeTruthy();
      replayBtn.click();

      expect(spy).toHaveBeenCalledWith(entry);
    });
  });

  // -----------------------------------------------------------------------
  // Header chain count display
  // -----------------------------------------------------------------------

  describe('header chain count', () => {
    it('should show chain item count in header', () => {
      const entries = [
        makeEntry({ id: 'a' }),
        makeEntry({ id: 'b' }),
        makeEntry({ id: 'c' }),
      ];
      const rd = makeResponseData({ chainItems: entries });
      setup(
        { requests: [{}], responseData: { 0: rd } },
        { lastIdx: 0 },
      );
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      const count = el.querySelector('.response-panel__count');
      expect(count).toBeTruthy();
      expect(count!.textContent!.trim()).toBe('3');
      expect(el.textContent).toContain('3 requests in chain');
    });

    it('should use singular "request" for single entry', () => {
      const rd = makeResponseData();
      setup(
        { requests: [{}], responseData: { 0: rd } },
        { lastIdx: 0 },
      );
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      expect(el.textContent).toContain('1 request in chain');
    });
  });

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  describe('ngOnDestroy', () => {
    it('should clear copy timers on destroy', async () => {
      setup();
      jest.useFakeTimers();

      await component.copyResponseBody('entry-1', 'body');
      expect(component.getCopyState('entry-1')).toBe('copied');

      fixture.destroy();

      // Timer should have been cleared; no errors from dangling timers
      jest.advanceTimersByTime(2000);

      jest.useRealTimers();
    });
  });
});
