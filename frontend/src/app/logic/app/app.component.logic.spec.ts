import {
  buildActiveRequestMeta,
  buildActiveRequestPreview,
  buildLastResponseSummary,
  buildRequestLabel,
  buildRequestToken,
  buildSecretDeletedToast,
  buildSecretSavedToast,
  buildTrackedLogEntryId,
  buildVaultExportedToast,
  buildVaultFileName,
  decideGlobalKeydownAction,
  decideFooterStatus,
  findExistingOpenFileIndex,
  formatClockMmSs,
  getRequestTimeoutMs,
  normalizeEnvName,
  parseSplitWidthPx
} from './app.component.logic';

describe('app.component.logic', () => {
  it('formatClockMmSs formats mm:ss and clamps negatives', () => {
    expect(formatClockMmSs(-1)).toBe('00:00');
    expect(formatClockMmSs(0)).toBe('00:00');
    expect(formatClockMmSs(999)).toBe('00:00');
    expect(formatClockMmSs(1_000)).toBe('00:01');
    expect(formatClockMmSs(60_000)).toBe('01:00');
    expect(formatClockMmSs(61_000)).toBe('01:01');
  });

  it('buildRequestLabel returns METHOD url trimmed', () => {
    expect(buildRequestLabel({ method: 'GET', url: 'https://x', headers: {} })).toBe('GET https://x');
  });

  it('buildRequestToken is deterministic for a given nowMs', () => {
    expect(buildRequestToken('file', 2, 123)).toBe('file-2-123');
  });

  it('buildVaultFileName uses ISO timestamp with safe separators', () => {
    const d = new Date('2025-12-25T12:34:56.789Z');
    expect(buildVaultFileName(d)).toBe('rawrequest-secrets-2025-12-25T12-34-56-789Z.json');
  });

  it('normalizeEnvName trims and defaults to "default"', () => {
    expect(normalizeEnvName('')).toBe('default');
    expect(normalizeEnvName('   ')).toBe('default');
    expect(normalizeEnvName(undefined)).toBe('default');
    expect(normalizeEnvName(' prod ')).toBe('prod');
  });

  it('secret/vault toast builders are deterministic', () => {
    expect(buildSecretSavedToast({ key: 'API_KEY', env: 'prod' })).toBe('Saved secret "API_KEY" to prod');
    expect(buildSecretDeletedToast('API_KEY')).toBe('Deleted secret "API_KEY"');
    expect(buildVaultExportedToast('file.json')).toBe('Exported secrets to file.json');
  });

  it('buildTrackedLogEntryId is deterministic', () => {
    expect(
      buildTrackedLogEntryId(
        { timestamp: 't', level: 'info', source: 'src', message: 'm' },
        3
      )
    ).toBe('t-src-3');
  });

  it('buildLastResponseSummary returns null without a response', () => {
    expect(buildLastResponseSummary(undefined, 0)).toBeNull();
    expect(
      buildLastResponseSummary(
        {
          id: 'f',
          name: 'n',
          content: '',
          requests: [],
          environments: {},
          variables: {},
          responseData: {},
          groups: []
        },
        null
      )
    ).toBeNull();
  });

  it('buildLastResponseSummary formats status and time', () => {
    const file = {
      id: 'f',
      name: 'n',
      content: '',
      requests: [],
      environments: {},
      variables: {},
      responseData: {
        2: {
          status: 200,
          statusText: 'OK',
          headers: {},
          body: '',
          responseTime: 123
        }
      },
      groups: []
    } as any;

    expect(buildLastResponseSummary(file, 2)).toEqual({ status: '200 OK', time: '123ms', code: 200 });
  });

  it('parseSplitWidthPx returns a positive integer or null', () => {
    expect(parseSplitWidthPx(null)).toBeNull();
    expect(parseSplitWidthPx('')).toBeNull();
    expect(parseSplitWidthPx('abc')).toBeNull();
    expect(parseSplitWidthPx('-1')).toBeNull();
    expect(parseSplitWidthPx('0')).toBeNull();
    expect(parseSplitWidthPx('10')).toBe(10);
  });

  it('buildActiveRequestPreview shows placeholder when missing request', () => {
    expect(buildActiveRequestPreview(null)).toBe('// Waiting for the next request to start.');
  });

  it('buildActiveRequestPreview includes body when present', () => {
    expect(
      buildActiveRequestPreview({ method: 'post', url: 'https://x', headers: {}, body: ' hi ' } as any)
    ).toBe('POST https://x\n\nhi');
  });

  it('buildActiveRequestMeta covers running request with timeout', () => {
    expect(
      buildActiveRequestMeta({
        activeRequestInfo: { type: 'single', startedAt: 0 },
        isRequestRunning: true,
        isCancellingActiveRequest: false,
        nowMs: 61_000,
        activeRunProgress: null,
        activeRequestTimeoutMs: 120_000,
        request: { method: 'GET', url: 'https://x', headers: {} } as any
      })
    ).toBe('Request running · 01:01 elapsed · 00:59 remaining');
  });

  it('buildActiveRequestMeta covers running load test with planned duration', () => {
    expect(
      buildActiveRequestMeta({
        activeRequestInfo: { type: 'load', startedAt: 0 },
        isRequestRunning: true,
        isCancellingActiveRequest: false,
        nowMs: 10_000,
        activeRunProgress: { type: 'load', requestId: 'x', totalSent: 5, successful: 4, failed: 1, plannedDurationMs: 30_000 } as any,
        activeRequestTimeoutMs: null,
        request: null
      })
    ).toBe('Load test running · 5 sent · 4 ok · 1 failed · 00:10 elapsed · 00:20 remaining');
  });

  it('decideFooterStatus uses summary tone rules', () => {
    expect(
      decideFooterStatus({
        isRequestRunning: false,
        isCancellingActiveRequest: false,
        activeRequestMeta: 'x',
        lastResponseSummary: { status: '200 OK', time: '1ms', code: 200 },
        activeEnv: ''
      }).tone
    ).toBe('success');

    expect(
      decideFooterStatus({
        isRequestRunning: false,
        isCancellingActiveRequest: false,
        activeRequestMeta: 'x',
        lastResponseSummary: { status: '404 Not Found', time: '1ms', code: 404 },
        activeEnv: ''
      }).tone
    ).toBe('error');
  });

  it('decideGlobalKeydownAction routes Cmd/Ctrl+S to save/saveAs', () => {
    expect(
      decideGlobalKeydownAction({
        key: 's',
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        showHistoryModal: false,
        showHistory: false
      })
    ).toEqual({ action: 'save', shouldPreventDefault: true, shouldStopPropagation: true });

    expect(
      decideGlobalKeydownAction({
        key: 'S',
        metaKey: false,
        ctrlKey: true,
        shiftKey: true,
        showHistoryModal: false,
        showHistory: false
      })
    ).toEqual({ action: 'saveAs', shouldPreventDefault: true, shouldStopPropagation: true });
  });

  it('findExistingOpenFileIndex finds by filePath or id', () => {
    const files: any[] = [
      { id: 'a', filePath: '' },
      { id: '/tmp/foo.http', filePath: '/tmp/foo.http' },
      { id: 'c', filePath: '/tmp/bar.http' }
    ];

    expect(findExistingOpenFileIndex(files, '  /tmp/foo.http  ')).toBe(1);
    expect(findExistingOpenFileIndex(files, '/tmp/bar.http')).toBe(2);
    expect(findExistingOpenFileIndex(files, '   ')).toBe(-1);
    expect(findExistingOpenFileIndex(files, '/nope')).toBe(-1);
  });

  it('decideGlobalKeydownAction closes topmost overlays on Escape', () => {
    expect(
      decideGlobalKeydownAction({
        key: 'Escape',
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        showHistoryModal: true,
        showHistory: true
      }).action
    ).toBe('closeHistoryModal');

    expect(
      decideGlobalKeydownAction({
        key: 'Escape',
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        showHistoryModal: false,
        showHistory: true
      }).action
    ).toBe('toggleHistory');

    expect(
      decideGlobalKeydownAction({
        key: 'Escape',
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        showHistoryModal: false,
        showHistory: false
      }).action
    ).toBe('none');
  });

  it('getRequestTimeoutMs returns positive timeout or null', () => {
    expect(getRequestTimeoutMs(null)).toBeNull();
    expect(getRequestTimeoutMs({ method: 'GET', url: 'x', headers: {}, options: { timeout: 0 } } as any)).toBeNull();
    expect(getRequestTimeoutMs({ method: 'GET', url: 'x', headers: {}, options: { timeout: 1000 } } as any)).toBe(1000);
  });
});
