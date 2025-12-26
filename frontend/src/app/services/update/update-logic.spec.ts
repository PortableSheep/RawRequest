import {
  decideUpdateReadyState,
  normalizeUpdateProgressPercent,
  shouldShowUpdateNotification,
  shouldUseCachedUpdateInfo
} from './update-logic';

describe('update-logic', () => {
  it('decideUpdateReadyState clears when current matches ready', () => {
    expect(decideUpdateReadyState('1.2.3', '1.2.3')).toEqual({
      isUpdateReady: false,
      updateReadyVersion: null,
      shouldClearPreparedUpdate: true
    });
  });

  it('decideUpdateReadyState keeps ready when current is unknown', () => {
    expect(decideUpdateReadyState('unknown', '1.2.3')).toEqual({
      isUpdateReady: true,
      updateReadyVersion: '1.2.3',
      shouldClearPreparedUpdate: false
    });
  });

  it('decideUpdateReadyState handles empty readyVersion', () => {
    expect(decideUpdateReadyState('1.2.3', null)).toEqual({
      isUpdateReady: false,
      updateReadyVersion: null,
      shouldClearPreparedUpdate: false
    });
  });

  it('normalizeUpdateProgressPercent clamps 0..1', () => {
    expect(normalizeUpdateProgressPercent(0.5)).toBe(0.5);
    expect(normalizeUpdateProgressPercent(2)).toBe(1);
    expect(normalizeUpdateProgressPercent(-1)).toBe(0);
    expect(normalizeUpdateProgressPercent('x')).toBeNull();
  });

  it('shouldUseCachedUpdateInfo returns cached when within interval', () => {
    const cached: any = { available: true, latestVersion: '2', currentVersion: '1' };
    expect(shouldUseCachedUpdateInfo('1000', 1000 + 10, 1000, cached)).toBe(cached);
    expect(shouldUseCachedUpdateInfo('1000', 1000 + 2000, 1000, cached)).toBeNull();
  });

  it('shouldShowUpdateNotification respects dismissal', () => {
    const info: any = { available: true, latestVersion: '2.0.0' };
    expect(shouldShowUpdateNotification(info, null)).toBe(true);
    expect(shouldShowUpdateNotification(info, '1.0.0')).toBe(true);
    expect(shouldShowUpdateNotification(info, '2.0.0')).toBe(false);

    const none: any = { available: false, latestVersion: '2.0.0' };
    expect(shouldShowUpdateNotification(none, null)).toBe(false);
  });
});
