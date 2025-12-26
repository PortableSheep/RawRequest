import { decideActiveRunTickActions } from './active-run-tick.logic';

describe('active-run-tick.logic', () => {
  it('does nothing when request is not running', () => {
    expect(
      decideActiveRunTickActions({
        isRequestRunning: false,
        activeRequestType: 'load',
        activeUsers: 5
      })
    ).toEqual({
      shouldEnsureSparkline: false,
      usersSample: null,
      shouldSampleRps: false
    });
  });

  it('does nothing for non-load requests', () => {
    expect(
      decideActiveRunTickActions({
        isRequestRunning: true,
        activeRequestType: 'single',
        activeUsers: 5
      })
    ).toEqual({
      shouldEnsureSparkline: false,
      usersSample: null,
      shouldSampleRps: false
    });
  });

  it('samples users and requests RPS sampling for load runs', () => {
    expect(
      decideActiveRunTickActions({
        isRequestRunning: true,
        activeRequestType: 'load',
        activeUsers: 7
      })
    ).toEqual({
      shouldEnsureSparkline: true,
      usersSample: 7,
      shouldSampleRps: true
    });
  });

  it('uses 0 users sample when activeUsers is missing/invalid', () => {
    expect(
      decideActiveRunTickActions({
        isRequestRunning: true,
        activeRequestType: 'load',
        activeUsers: null
      }).usersSample
    ).toBe(0);

    expect(
      decideActiveRunTickActions({
        isRequestRunning: true,
        activeRequestType: 'load',
        activeUsers: Number.NaN
      }).usersSample
    ).toBe(0);
  });
});
