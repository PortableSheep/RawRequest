export type RpsSamplingState = {
  lastSampleAtMs: number | null;
  lastTotalSent: number | null;
  lastSmoothed: number | null;
};

export type RpsSampleResult = {
  state: RpsSamplingState;
  sample: number | null;
};

export function sampleSmoothedRpsFromTotals(
  state: RpsSamplingState,
  nowMs: number,
  totalSent: number | undefined,
  options?: {
    minDtMs?: number;
    alpha?: number;
  }
): RpsSampleResult {
  if (typeof totalSent !== 'number') {
    return { state, sample: null };
  }

  const minDtMs = options?.minDtMs ?? 150;
  const alpha = options?.alpha ?? 0.18;

  if (state.lastSampleAtMs === null || state.lastTotalSent === null) {
    return {
      state: {
        lastSampleAtMs: nowMs,
        lastTotalSent: totalSent,
        lastSmoothed: state.lastSmoothed
      },
      sample: null
    };
  }

  const dtMs = nowMs - state.lastSampleAtMs;
  if (dtMs < minDtMs) {
    return { state, sample: null };
  }

  const dCount = totalSent - state.lastTotalSent;
  const rps = dtMs > 0 ? Math.max(0, dCount) / (dtMs / 1000) : 0;
  const smoothed = state.lastSmoothed === null ? rps : alpha * rps + (1 - alpha) * state.lastSmoothed;

  return {
    state: {
      lastSampleAtMs: nowMs,
      lastTotalSent: totalSent,
      lastSmoothed: smoothed
    },
    sample: smoothed
  };
}
