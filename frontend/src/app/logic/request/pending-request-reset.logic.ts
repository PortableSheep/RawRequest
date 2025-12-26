import type { ActiveRunProgress } from '../../models/http.models';

export type PendingRequestResetPatch = {
  isRequestRunning: false;
  pendingRequestIndex: null;
  activeRunProgress: ActiveRunProgress | null;
  loadUsersSeries: number[];
  loadRpsSeries: number[];
  lastRpsSampleAtMs: null;
  lastRpsTotalSent: null;
  activeRequestInfo: null;
  isCancellingActiveRequest: false;
};

export function buildPendingRequestResetPatch(): PendingRequestResetPatch {
  return {
    isRequestRunning: false,
    pendingRequestIndex: null,
    activeRunProgress: null,
    loadUsersSeries: [],
    loadRpsSeries: [],
    lastRpsSampleAtMs: null,
    lastRpsTotalSent: null,
    activeRequestInfo: null,
    isCancellingActiveRequest: false
  };
}
