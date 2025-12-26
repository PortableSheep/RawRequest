import { sampleAndApplyRpsUiState } from './active-run-rps-ui.logic';

describe('active-run-rps-ui.logic', () => {
  it('does not change queue or render targets when no sample is produced', () => {
    const r = sampleAndApplyRpsUiState({
      samplingState: { lastSampleAtMs: null, lastTotalSent: null, lastSmoothed: null },
      nowMs: 1000,
      totalSent: 10,
      queue: [1, 2],
      series: [0, 0, 0, 0],
      nextValue: null,
      maxPoints: 4,
      rampSteps: 3,
      rpsRenderTarget: 123,
      rpsRenderValue: 456
    });

    expect(r.queue).toEqual([1, 2]);
    expect(r.rpsRenderTarget).toBe(123);
    expect(r.rpsRenderValue).toBe(456);
    expect(r.samplingState.lastSampleAtMs).toBe(1000);
    expect(r.samplingState.lastTotalSent).toBe(10);
  });

  it('pushes queue and initializes render value when sample is produced', () => {
    const r = sampleAndApplyRpsUiState({
      samplingState: { lastSampleAtMs: 0, lastTotalSent: 0, lastSmoothed: null },
      nowMs: 200,
      totalSent: 20,
      options: { minDtMs: 150, alpha: 0.18 },
      queue: [],
      series: [0, 0, 0, 0],
      nextValue: null,
      maxPoints: 4,
      rampSteps: 1,
      rpsRenderTarget: null,
      rpsRenderValue: null
    });

    expect(r.queue.length).toBeGreaterThan(0);
    expect(typeof r.rpsRenderTarget).toBe('number');
    expect(r.rpsRenderValue).toBe(r.rpsRenderTarget);
  });

  it('does not overwrite render value once set', () => {
    const r = sampleAndApplyRpsUiState({
      samplingState: { lastSampleAtMs: 0, lastTotalSent: 0, lastSmoothed: null },
      nowMs: 200,
      totalSent: 20,
      options: { minDtMs: 150, alpha: 0.18 },
      queue: [],
      series: [0, 0, 0, 0],
      nextValue: null,
      maxPoints: 4,
      rampSteps: 1,
      rpsRenderTarget: null,
      rpsRenderValue: 999
    });

    expect(r.rpsRenderValue).toBe(999);
    expect(typeof r.rpsRenderTarget).toBe('number');
  });
});
