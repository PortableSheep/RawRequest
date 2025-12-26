import { sampleSmoothedRpsFromTotals, type RpsSamplingState } from './active-run-rps.logic';

describe('active-run-rps.logic', () => {
  it('initializes sampling state and returns no sample', () => {
    const s: RpsSamplingState = { lastSampleAtMs: null, lastTotalSent: null, lastSmoothed: null };
    const r = sampleSmoothedRpsFromTotals(s, 1000, 10);
    expect(r.sample).toBeNull();
    expect(r.state.lastSampleAtMs).toBe(1000);
    expect(r.state.lastTotalSent).toBe(10);
  });

  it('does not update state when dt is below threshold', () => {
    const s: RpsSamplingState = { lastSampleAtMs: 1000, lastTotalSent: 10, lastSmoothed: null };
    const r = sampleSmoothedRpsFromTotals(s, 1100, 20, { minDtMs: 150 });
    expect(r.sample).toBeNull();
    expect(r.state).toBe(s);
  });

  it('samples rps and clamps negative deltas', () => {
    const s: RpsSamplingState = { lastSampleAtMs: 1000, lastTotalSent: 10, lastSmoothed: null };
    const r = sampleSmoothedRpsFromTotals(s, 1200, 5, { minDtMs: 150 });
    // dCount negative -> clamped to 0
    expect(r.sample).toBe(0);
    expect(r.state.lastSmoothed).toBe(0);
  });

  it('applies exponential smoothing when prior smoothed exists', () => {
    const s: RpsSamplingState = { lastSampleAtMs: 1000, lastTotalSent: 0, lastSmoothed: 10 };
    // dt=1000ms, dCount=20 => rps=20
    const r = sampleSmoothedRpsFromTotals(s, 2000, 20, { minDtMs: 150, alpha: 0.18 });
    expect(r.sample).toBeCloseTo(11.8, 6);
    expect(r.state.lastSmoothed).toBeCloseTo(11.8, 6);
  });
});
