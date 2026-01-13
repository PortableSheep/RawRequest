import { sampleSmoothedRpsFromTotals, type RpsSamplingState } from './active-run-rps.logic';
import { pushRpsSampleToQueue } from './active-run-sparkline.logic';

export type RpsUiSamplingInput = {
  samplingState: RpsSamplingState;
  nowMs: number;
  totalSent: number | undefined;

  queue: number[];
  series: number[];
  nextValue: number | null;
  maxPoints: number;
  rampSteps: number;

  rpsRenderTarget: number | null;
  rpsRenderValue: number | null;

  options?: {
    minDtMs?: number;
    alpha?: number;
  };
};

export type RpsUiSamplingResult = {
  samplingState: RpsSamplingState;
  queue: number[];
  rpsRenderTarget: number | null;
  rpsRenderValue: number | null;
};

export function sampleAndApplyRpsUiState(input: RpsUiSamplingInput): RpsUiSamplingResult {
  const sampled = sampleSmoothedRpsFromTotals(
    input.samplingState,
    input.nowMs,
    input.totalSent,
    input.options
  );

  if (sampled.sample === null) {
    return {
      samplingState: sampled.state,
      queue: input.queue,
      rpsRenderTarget: input.rpsRenderTarget,
      rpsRenderValue: input.rpsRenderValue
    };
  }

  const pushed = pushRpsSampleToQueue(
    input.queue,
    input.series,
    input.nextValue,
    input.maxPoints,
    input.rampSteps,
    sampled.sample
  );

  return {
    samplingState: sampled.state,
    queue: pushed.queue,
    rpsRenderTarget: pushed.sample,
    rpsRenderValue: input.rpsRenderValue === null ? pushed.sample : input.rpsRenderValue
  };
}
