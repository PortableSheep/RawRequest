import type { UpdateInfo } from '../update.service';

export type UpdateReadyDecision = {
  isUpdateReady: boolean;
  updateReadyVersion: string | null;
  shouldClearPreparedUpdate: boolean;
};

export function decideUpdateReadyState(currentVersionRaw: string, readyVersionRaw: string | null): UpdateReadyDecision {
  const readyVersion = (readyVersionRaw || '').trim();
  if (!readyVersion) {
    return { isUpdateReady: false, updateReadyVersion: null, shouldClearPreparedUpdate: false };
  }

  const current = (currentVersionRaw || '').trim();
  const shouldClear = !!current && current !== 'unknown' && current === readyVersion;

  if (shouldClear) {
    return { isUpdateReady: false, updateReadyVersion: null, shouldClearPreparedUpdate: true };
  }

  return { isUpdateReady: true, updateReadyVersion: readyVersion, shouldClearPreparedUpdate: false };
}

export function normalizeUpdateProgressPercent(percent: unknown): number | null {
  if (typeof percent !== 'number' || !isFinite(percent)) {
    return null;
  }
  return Math.max(0, Math.min(1, percent));
}

export function shouldUseCachedUpdateInfo(
  lastCheckValue: string | null,
  nowMs: number,
  intervalMs: number,
  cachedInfo: UpdateInfo | null
): UpdateInfo | null {
  if (!lastCheckValue) {
    return null;
  }
  const lastCheckTime = parseInt(lastCheckValue, 10);
  if (!isFinite(lastCheckTime)) {
    return null;
  }
  if (nowMs-lastCheckTime < intervalMs) {
    return cachedInfo;
  }
  return null;
}

export function shouldShowUpdateNotification(info: UpdateInfo, dismissedVersion: string | null): boolean {
  if (!info.available) {
    return false;
  }
  return (dismissedVersion || '') !== (info.latestVersion || '');
}
