import type { Request } from '../../models/http.models';

import {
  buildActiveRequestInfo,
  buildInitialLoadRunUiState,
  deriveActiveRequestType
} from './active-request.logic';

describe('active-request.logic', () => {
  const baseReq: Request = {
    method: 'GET',
    url: 'https://example.com',
    headers: {}
  };

  it('deriveActiveRequestType returns single by default', () => {
    expect(deriveActiveRequestType(baseReq)).toBe('single');
  });

  it('deriveActiveRequestType returns chain when depends exists', () => {
    expect(deriveActiveRequestType({ ...baseReq, depends: 'Other' })).toBe('chain');
  });

  it('deriveActiveRequestType returns load when loadTest exists', () => {
    expect(deriveActiveRequestType({ ...baseReq, loadTest: { users: 2 } })).toBe('load');
  });

  it('buildActiveRequestInfo is deterministic for a given nowMs', () => {
    const info = buildActiveRequestInfo('file-1', 3, baseReq, 1700000000000);
    expect(info.type).toBe('single');
    expect(info.requestIndex).toBe(3);
    expect(info.canCancel).toBe(true);
    expect(info.startedAt).toBe(1700000000000);
    expect(info.id).toContain('file-1');
  });

  it('buildInitialLoadRunUiState resets series and sampler fields', () => {
    const s = buildInitialLoadRunUiState(4, 5);
    expect(s.activeRunProgress).toBeNull();
    expect(s.loadUsersSeries).toEqual([0, 0, 0, 0]);
    expect(s.loadRpsSeries).toEqual([0, 0, 0, 0, 0]);
    expect(s.loadUsersQueue).toEqual([]);
    expect(s.loadRpsQueue).toEqual([]);
    expect(s.lastRpsSampleAtMs).toBeNull();
    expect(s.rpsRenderTarget).toBeNull();
    expect(typeof s.loadUsersSparklinePathDView).toBe('string');
    expect(typeof s.loadRpsSparklinePathDView).toBe('string');
  });
});
