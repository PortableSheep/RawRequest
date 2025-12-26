import { buildPendingRequestResetPatch } from './pending-request-reset.logic';

describe('pending-request-reset.logic', () => {
  it('buildPendingRequestResetPatch clears pending/active request state', () => {
    const p = buildPendingRequestResetPatch();

    expect(p.isRequestRunning).toBe(false);
    expect(p.pendingRequestIndex).toBeNull();
    expect(p.activeRunProgress).toBeNull();
    expect(p.loadUsersSeries).toEqual([]);
    expect(p.loadRpsSeries).toEqual([]);
    expect(p.lastRpsSampleAtMs).toBeNull();
    expect(p.lastRpsTotalSent).toBeNull();
    expect(p.activeRequestInfo).toBeNull();
    expect(p.isCancellingActiveRequest).toBe(false);
  });
});
