import { enqueueRamp, pointsToSmoothPathD, pointsToString } from '../../utils/sparkline';

export type ScrollingSparklineState = {
  series: number[];
  queue: number[];
  scrollPhase: number;
  nextValue: number | null;
};

export type TickScrollingSparklineOptions = {
  maxPoints: number;
  scrollMs: number;
  maxPhase?: number;
};

export type TickScrollingSparklineResult = {
  state: ScrollingSparklineState;
  advanced: boolean;
  transformView: string;
};

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeSeriesLength(series: number[], slots: number): number[] {
  if (slots <= 0) return [];
  if (!series.length) return Array(slots).fill(0);
  if (series.length === slots) return series;

  let normalized = series.slice(-slots);
  if (normalized.length < slots) {
    normalized = [...Array(slots - normalized.length).fill(0), ...normalized];
  }
  return normalized;
}

export function tickScrollingSparkline(
  state: ScrollingSparklineState,
  dtMs: number,
  options: TickScrollingSparklineOptions
): TickScrollingSparklineResult {
  const slots = options.maxPoints;
  if (slots <= 0) {
    return {
      state: {
        series: [],
        queue: state.queue,
        scrollPhase: 0,
        nextValue: null
      },
      advanced: false,
      transformView: ''
    };
  }

  const maxPhase = options.maxPhase ?? 10;
  const series = normalizeSeriesLength(state.series, slots);

  const xStep = slots > 1 ? 100 / slots : 100;
  const phaseInc = options.scrollMs > 0 ? dtMs / options.scrollMs : 0;
  let scrollPhase = clampNumber(state.scrollPhase + phaseInc, 0, maxPhase);

  const queue = state.queue;
  let nextValue = state.nextValue;
  if (nextValue === null) {
    nextValue = queue.shift() ?? series[slots - 1] ?? 0;
  }

  let advanced = false;
  while (scrollPhase >= 1) {
    series.shift();
    series.push(nextValue);
    scrollPhase -= 1;
    nextValue = queue.shift() ?? series[slots - 1] ?? 0;
    advanced = true;
  }

  const offsetX = -xStep * scrollPhase;
  const transformView = offsetX !== 0 ? `translate(${offsetX.toFixed(6)} 0)` : '';

  return {
    state: {
      series,
      queue,
      scrollPhase,
      nextValue
    },
    advanced,
    transformView
  };
}

export type SmoothTowardsOptions = {
  frameMs?: number;
  base?: number;
};

export function smoothTowards(
  current: number | null,
  target: number | null,
  dtMs: number,
  options?: SmoothTowardsOptions
): number | null {
  if (target === null) return current;
  if (current === null) return target;

  const frameMs = options?.frameMs ?? 16.67;
  const base = options?.base ?? 0.02;

  const safeDt = Math.max(0, dtMs);
  const k = 1 - Math.pow(base, safeDt / frameMs);
  return current + (target - current) * k;
}

function computeDenom(localMax: number, maxCap?: number): number {
  if (typeof maxCap === 'number' && Number.isFinite(maxCap) && maxCap > 0) {
    return Math.max(maxCap, 1);
  }
  return Math.max(1, localMax);
}

function clampNonNegativeFinite(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clampNonNegativeTruncInt(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function computeRampCurrent(
  queue: number[],
  nextValue: number | null,
  series: number[],
  slots: number
): number {
  if (queue.length) {
    return queue[queue.length - 1] ?? 0;
  }
  return nextValue ?? series[slots - 1] ?? 0;
}

function enqueueRamped(
  queue: number[],
  from: number,
  to: number,
  steps: number,
  isInt: boolean,
  maxQueue: number
): number[] {
  const nextQueue = queue.slice();
  enqueueRamp(nextQueue, from, to, steps, isInt);
  if (nextQueue.length > maxQueue) {
    return nextQueue.slice(-maxQueue);
  }
  return nextQueue;
}

export type PushRampedSampleResult = {
  queue: number[];
  sample: number;
};

export function pushUsersSampleToQueue(
  queue: number[],
  series: number[],
  nextValue: number | null,
  maxPoints: number,
  rampSteps: number,
  value: number
): PushRampedSampleResult {
  const v = clampNonNegativeTruncInt(value);
  const slots = maxPoints;
  const current = computeRampCurrent(queue, nextValue, series, slots);
  const maxQueue = slots * 4;

  return {
    queue: enqueueRamped(queue, current, v, rampSteps, true, maxQueue),
    sample: v
  };
}

export function pushRpsSampleToQueue(
  queue: number[],
  series: number[],
  nextValue: number | null,
  maxPoints: number,
  rampSteps: number,
  value: number
): PushRampedSampleResult {
  const v = clampNonNegativeFinite(value);
  const slots = maxPoints;
  const current = computeRampCurrent(queue, nextValue, series, slots);
  const maxQueue = slots * 4;

  return {
    queue: enqueueRamped(queue, current, v, rampSteps, false, maxQueue),
    sample: v
  };
}

export function buildUsersSparklinePoints(
  series: number[],
  maxPoints: number,
  maxUsers?: number,
  nextValue?: number
): string {
  const slots = maxPoints;
  if (!series.length || slots <= 0) return '';

  const height = 20;
  const localMax = Math.max(1, ...series, nextValue ?? 0);
  const denom = computeDenom(localMax, maxUsers);

  const step = slots > 1 ? 100 / slots : 100;
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < slots; i++) {
    const x = i * step;
    const value = series[i] ?? 0;
    const y = height - (Math.min(denom, value) / denom) * height;
    points.push({ x, y });
  }

  if (nextValue !== undefined) {
    const x = 100;
    const y = height - (Math.min(denom, nextValue) / denom) * height;
    points.push({ x, y });
  }

  return pointsToString(points);
}

export function buildUsersSparklinePathD(
  series: number[],
  maxPoints: number,
  maxUsers?: number,
  nextValue?: number
): string {
  const slots = maxPoints;
  if (!series.length || slots <= 0) return '';

  const height = 20;
  const localMax = Math.max(1, ...series, nextValue ?? 0);
  const denom = computeDenom(localMax, maxUsers);

  const step = slots > 1 ? 100 / slots : 100;
  const points: Array<{ x: number; y: number }> = [];
  const firstValue = series[0] ?? 0;
  const firstY = height - (Math.min(denom, firstValue) / denom) * height;
  points.push({ x: -2 * step, y: firstY });
  points.push({ x: -1 * step, y: firstY });
  for (let i = 0; i < slots; i++) {
    const x = i * step;
    const value = series[i] ?? 0;
    const y = height - (Math.min(denom, value) / denom) * height;
    points.push({ x, y });
  }

  if (nextValue !== undefined) {
    const y = height - (Math.min(denom, nextValue) / denom) * height;
    points.push({ x: slots * step, y });
    points.push({ x: (slots + 1) * step, y });
  }

  return pointsToSmoothPathD(points, { minX: 0, maxX: 100, minY: 0, maxY: height }, 0.55);
}

export function buildScrollingUsersSparklinePathD(
  series: number[],
  maxPoints: number,
  maxUsers: number | undefined,
  nextValue: number,
  phase: number
): string {
  const slots = maxPoints;
  if (!series.length || slots <= 0) return '';

  const height = 20;
  const localMax = Math.max(1, ...series, nextValue);
  const denom = computeDenom(localMax, maxUsers);

  const step = slots > 1 ? 100 / slots : 100;
  const t = Math.max(0, Math.min(1, phase));
  const last = series[slots - 1] ?? 0;
  const lerpedLast = last + (nextValue - last) * t;

  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < slots; i++) {
    const x = i * step;
    const value = series[i] ?? 0;
    const y = height - (Math.min(denom, value) / denom) * height;
    points.push({ x, y });
  }
  points.push({
    x: slots * step,
    y: height - (Math.min(denom, lerpedLast) / denom) * height
  });
  points.push({
    x: (slots + 1) * step,
    y: height - (Math.min(denom, nextValue) / denom) * height
  });

  return pointsToSmoothPathD(points, { minX: 0, maxX: 100, minY: 0, maxY: height }, 0.75);
}

export function buildRpsSparklinePoints(
  series: number[],
  maxPoints: number,
  renderLastValue?: number,
  nextValue?: number
): string {
  if (!series.length) return '';

  const height = 20;
  const lastValue = renderLastValue !== undefined ? renderLastValue : series[series.length - 1] ?? 0;
  const extra = nextValue !== undefined ? nextValue : lastValue;
  const denom = Math.max(1, ...series, lastValue, extra);

  const slots = maxPoints;
  const step = slots > 1 ? 100 / slots : 100;
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < slots; i++) {
    const x = i * step;
    const raw = series[i] ?? 0;
    const y = height - (Math.min(denom, raw) / denom) * height;
    points.push({ x, y });
  }

  if (nextValue !== undefined) {
    const x = 100;
    const y = height - (Math.min(denom, nextValue) / denom) * height;
    points.push({ x, y });
  }

  return pointsToString(points);
}

export function buildRpsSparklinePathD(
  series: number[],
  maxPoints: number,
  renderLastValue?: number,
  nextValue?: number
): string {
  if (!series.length) return '';

  const height = 20;
  const lastValue = renderLastValue !== undefined ? renderLastValue : series[series.length - 1] ?? 0;
  const extra = nextValue !== undefined ? nextValue : lastValue;
  const denom = Math.max(1, ...series, lastValue, extra);

  const slots = maxPoints;
  const step = slots > 1 ? 100 / slots : 100;
  const points: Array<{ x: number; y: number }> = [];
  const firstValue = series[0] ?? 0;
  const firstY = height - (Math.min(denom, firstValue) / denom) * height;
  points.push({ x: -2 * step, y: firstY });
  points.push({ x: -1 * step, y: firstY });
  for (let i = 0; i < slots; i++) {
    const x = i * step;
    const value = series[i] ?? 0;
    const y = height - (Math.min(denom, value) / denom) * height;
    points.push({ x, y });
  }
  const y = height - (Math.min(denom, extra) / denom) * height;
  points.push({ x: slots * step, y });
  points.push({ x: (slots + 1) * step, y });
  return pointsToSmoothPathD(points, { minX: 0, maxX: 100, minY: 0, maxY: height }, 0.55);
}

export function buildScrollingRpsSparklinePathD(
  series: number[],
  maxPoints: number,
  nextValue: number,
  phase: number
): string {
  const slots = maxPoints;
  if (!series.length || slots <= 0) return '';

  const height = 20;
  const t = Math.max(0, Math.min(1, phase));
  const denom = Math.max(1, ...series, nextValue);
  const step = slots > 1 ? 100 / slots : 100;
  const last = series[slots - 1] ?? 0;
  const lerpedLast = last + (nextValue - last) * t;

  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < slots; i++) {
    const x = i * step;
    const value = series[i] ?? 0;
    const y = height - (Math.min(denom, value) / denom) * height;
    points.push({ x, y });
  }
  points.push({
    x: slots * step,
    y: height - (Math.min(denom, lerpedLast) / denom) * height
  });
  points.push({
    x: (slots + 1) * step,
    y: height - (Math.min(denom, nextValue) / denom) * height
  });

  return pointsToSmoothPathD(points, { minX: 0, maxX: 100, minY: 0, maxY: height }, 0.75);
}

export type TickSparklineUiResult = {
  state: ScrollingSparklineState;
  advanced: boolean;
  transformView: string;
  pathDView: string;
};

export function tickUsersSparklineUi(
  params: {
    state: ScrollingSparklineState;
    dtMs: number;
    maxPoints: number;
    scrollMs: number;
    maxUsers?: number;
    currentPathDView?: string | null;
  }
): TickSparklineUiResult {
  const r = tickScrollingSparkline(params.state, params.dtMs, {
    maxPoints: params.maxPoints,
    scrollMs: params.scrollMs
  });

  const shouldRebuild = r.advanced || !params.currentPathDView;
  const pathDView = shouldRebuild
    ? buildUsersSparklinePathD(
        r.state.series,
        params.maxPoints,
        params.maxUsers,
        (r.state.nextValue ?? 0)
      )
    : (params.currentPathDView as string);

  return {
    state: r.state,
    advanced: r.advanced,
    transformView: r.transformView,
    pathDView
  };
}

export function tickRpsSparklineUi(
  params: {
    state: ScrollingSparklineState;
    dtMs: number;
    maxPoints: number;
    scrollMs: number;
    currentPathDView?: string | null;
  }
): TickSparklineUiResult {
  const r = tickScrollingSparkline(params.state, params.dtMs, {
    maxPoints: params.maxPoints,
    scrollMs: params.scrollMs
  });

  const shouldRebuild = r.advanced || !params.currentPathDView;
  const pathDView = shouldRebuild
    ? buildRpsSparklinePathD(
        r.state.series,
        params.maxPoints,
        undefined,
        (r.state.nextValue ?? 0)
      )
    : (params.currentPathDView as string);

  return {
    state: r.state,
    advanced: r.advanced,
    transformView: r.transformView,
    pathDView
  };
}
