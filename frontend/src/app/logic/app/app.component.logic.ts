import type { ActiveRunProgress, FileTab, Request, ScriptLogEntry } from '../../models/http.models';

export type FooterTone = 'idle' | 'pending' | 'success' | 'warning' | 'error';

export type GlobalKeydownAction = 'none' | 'save' | 'saveAs' | 'closeHistoryModal' | 'toggleHistory';

export interface GlobalKeydownDecision {
  action: GlobalKeydownAction;
  shouldPreventDefault: boolean;
  shouldStopPropagation: boolean;
}

export interface ActiveRequestInfoLite {
  type: 'single' | 'chain' | 'load';
  startedAt: number;
}

export function normalizeEnvName(env: string | null | undefined): string {
  const trimmed = (env || '').trim();
  return trimmed || 'default';
}

export function buildSecretSavedToast(args: { key: string; env: string }): string {
  return `Saved secret "${args.key}" to ${args.env}`;
}

export function buildSecretDeletedToast(key: string): string {
  return `Deleted secret "${key}"`;
}

export function buildVaultExportedToast(fileName: string): string {
  return `Exported secrets to ${fileName}`;
}

export function formatClockMmSs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export function buildRequestLabel(request: Request): string {
  return `${request.method} ${request.url}`.trim();
}

export function buildRequestToken(fileId: string, requestIndex: number, nowMs: number): string {
  return `${fileId}-${requestIndex}-${nowMs}`;
}

export function buildVaultFileName(now: Date): string {
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return `rawrequest-secrets-${timestamp}.json`;
}

export function buildTrackedLogEntryId(entry: ScriptLogEntry, index: number): string {
  return `${entry.timestamp}-${entry.source}-${index}`;
}

export function buildLastResponseSummary(
  file: FileTab | null | undefined,
  lastExecutedRequestIndex: number | null
): { status: string; time: string; code: number } | null {
  if (!file) {
    return null;
  }
  if (lastExecutedRequestIndex === null) {
    return null;
  }
  const response = file.responseData?.[lastExecutedRequestIndex];
  if (!response) {
    return null;
  }
  return {
    status: `${response.status} ${response.statusText}`.trim(),
    time: `${response.responseTime}ms`,
    code: response.status
  };
}

export function findExistingOpenFileIndex(
  files: Array<Pick<FileTab, 'id'> & { filePath?: string }>,
  filePath: string
): number {
  const normalizedPath = (filePath || '').trim();
  if (!normalizedPath) {
    return -1;
  }
  return files.findIndex(file => file.filePath === normalizedPath || file.id === normalizedPath);
}

export function parseSplitWidthPx(raw: string | null | undefined): number | null {
  const n = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  return n;
}

export function buildActiveRequestPreview(request: Request | null): string {
  if (!request) {
    return '// Waiting for the next request to start.';
  }

  const method = (request.method || 'GET').toUpperCase();
  const url = request.url || request.name || 'https://';
  const body = typeof request.body === 'string' ? request.body.trim() : '';
  return body ? `${method} ${url}\n\n${body}` : `${method} ${url}`;
}

export function buildActiveRequestMeta(args: {
  activeRequestInfo: ActiveRequestInfoLite | null;
  isRequestRunning: boolean;
  isCancellingActiveRequest: boolean;
  nowMs: number;
  activeRunProgress: ActiveRunProgress | null;
  activeRequestTimeoutMs: number | null;
  request: Request | null;
}): string {
  if (!args.activeRequestInfo) {
    return 'Awaiting request';
  }

  if (args.isCancellingActiveRequest) {
    return 'Canceling active request';
  }

  if (args.isRequestRunning) {
    const elapsedMs = Math.max(0, args.nowMs - args.activeRequestInfo.startedAt);
    const elapsed = formatClockMmSs(elapsedMs);

    if (args.activeRequestInfo.type === 'load') {
      const total = args.activeRunProgress?.totalSent ?? 0;
      const ok = args.activeRunProgress?.successful ?? 0;
      const failed = args.activeRunProgress?.failed ?? 0;
      const planned = args.activeRunProgress?.plannedDurationMs ?? null;
      if (planned && planned > 0) {
        const remainingMs = Math.max(0, (args.activeRequestInfo.startedAt + planned) - args.nowMs);
        const remaining = formatClockMmSs(remainingMs);
        return `Load test running · ${total} sent · ${ok} ok · ${failed} failed · ${elapsed} elapsed · ${remaining} remaining`;
      }
      return `Load test running · ${total} sent · ${ok} ok · ${failed} failed · ${elapsed} elapsed`;
    }

    const timeoutMs = args.activeRequestTimeoutMs;
    if (timeoutMs && timeoutMs > 0) {
      const remainingMs = Math.max(0, (args.activeRequestInfo.startedAt + timeoutMs) - args.nowMs);
      const remaining = formatClockMmSs(remainingMs);
      return `Request running · ${elapsed} elapsed · ${remaining} remaining`;
    }

    return `Request running · ${elapsed} elapsed`;
  }

  const method = args.request?.method?.toUpperCase() || '—';
  const target = args.request?.url || args.request?.name || 'Untitled request';
  return `${method} · ${target}`;
}

export function decideFooterStatus(args: {
  isRequestRunning: boolean;
  isCancellingActiveRequest: boolean;
  activeRequestMeta: string;
  lastResponseSummary: { status: string; time: string; code: number } | null;
  activeEnv: string;
}): { label: string; detail: string; tone: FooterTone } {
  if (args.isRequestRunning) {
    return {
      label: args.isCancellingActiveRequest ? 'Canceling run' : 'Running request',
      detail: args.activeRequestMeta,
      tone: args.isCancellingActiveRequest ? 'warning' : 'pending'
    };
  }

  const summary = args.lastResponseSummary;
  if (summary) {
    let tone: 'success' | 'warning' | 'error';
    if (summary.code >= 200 && summary.code < 300) {
      tone = 'success';
    } else if (summary.code >= 400 || summary.code === 0) {
      tone = 'error';
    } else {
      tone = 'warning';
    }
    return {
      label: summary.status,
      detail: summary.time,
      tone
    };
  }

  const activeEnv = args.activeEnv;
  return {
    label: 'Ready to send',
    detail: activeEnv ? `Env · ${activeEnv}` : 'Waiting for next request',
    tone: 'idle'
  };
}

export function decideGlobalKeydownAction(args: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  showHistoryModal: boolean;
  showHistory: boolean;
}): GlobalKeydownDecision {
  const key = args.key || '';
  const isSave = (args.metaKey || args.ctrlKey) && key.toLowerCase() === 's';
  if (isSave) {
    return {
      action: args.shiftKey ? 'saveAs' : 'save',
      shouldPreventDefault: true,
      shouldStopPropagation: true
    };
  }

  if (key !== 'Escape') {
    return { action: 'none', shouldPreventDefault: false, shouldStopPropagation: false };
  }

  // Close only the topmost layer.
  if (args.showHistoryModal) {
    return { action: 'closeHistoryModal', shouldPreventDefault: true, shouldStopPropagation: true };
  }
  if (args.showHistory) {
    return { action: 'toggleHistory', shouldPreventDefault: true, shouldStopPropagation: true };
  }

  return { action: 'none', shouldPreventDefault: false, shouldStopPropagation: false };
}

export function getRequestTimeoutMs(request: Request | null): number | null {
  const timeout = request?.options?.timeout;
  return typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0 ? timeout : null;
}
