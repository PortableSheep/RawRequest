import {
  buildRpsSparklinePathD,
  buildRpsSparklinePoints,
  buildScrollingRpsSparklinePathD,
  buildScrollingUsersSparklinePathD,
  buildUsersSparklinePathD,
  buildUsersSparklinePoints,
  pushRpsSampleToQueue,
  pushUsersSampleToQueue,
  smoothTowards,
  tickRpsSparklineUi,
  tickScrollingSparkline,
  tickUsersSparklineUi
} from './active-run-sparkline.logic';

describe('active-run-sparkline.logic', () => {
  describe('tickScrollingSparkline', () => {
    it('initializes series to maxPoints and produces empty transform at phase 0', () => {
      const r = tickScrollingSparkline(
        { series: [], queue: [], scrollPhase: 0, nextValue: null },
        0,
        { maxPoints: 4, scrollMs: 80 }
      );

      expect(r.state.series).toEqual([0, 0, 0, 0]);
      expect(r.state.nextValue).toBe(0);
      expect(r.state.scrollPhase).toBe(0);
      expect(r.advanced).toBe(false);
      expect(r.transformView).toBe('');
    });

    it('advances series when scrollPhase crosses 1 and preserves fractional remainder', () => {
      const r = tickScrollingSparkline(
        {
          series: [1, 2, 3, 4],
          queue: [10, 20],
          scrollPhase: 0,
          nextValue: null
        },
        120,
        { maxPoints: 4, scrollMs: 80 }
      );

      // dt=120, scrollMs=80 => phaseInc=1.5; one advance leaves phase=0.5
      expect(r.state.scrollPhase).toBeCloseTo(0.5);
      expect(r.advanced).toBe(true);

      // nextValue pulled from queue (10), series shifted and appended 10
      expect(r.state.series).toEqual([2, 3, 4, 10]);
      // nextValue updated to next queued value (20)
      expect(r.state.nextValue).toBe(20);

      const xStep = 100 / 4;
      expect(r.transformView).toBe(`translate(${(-xStep * 0.5).toFixed(6)} 0)`);
    });

    it('pads/trims series to match maxPoints', () => {
      const padded = tickScrollingSparkline(
        { series: [7], queue: [], scrollPhase: 0, nextValue: null },
        0,
        { maxPoints: 3, scrollMs: 80 }
      );
      expect(padded.state.series).toEqual([0, 0, 7]);

      const trimmed = tickScrollingSparkline(
        { series: [1, 2, 3, 4, 5], queue: [], scrollPhase: 0, nextValue: null },
        0,
        { maxPoints: 3, scrollMs: 80 }
      );
      expect(trimmed.state.series).toEqual([3, 4, 5]);
    });
  });

  describe('smoothTowards', () => {
    it('returns target immediately when current is null', () => {
      expect(smoothTowards(null, 5, 16.67)).toBe(5);
    });

    it('no-ops when target is null', () => {
      expect(smoothTowards(2, null, 16.67)).toBe(2);
    });

    it('moves current toward target with stable factor', () => {
      const v = smoothTowards(0, 100, 16.67, { base: 0.02, frameMs: 16.67 });
      // For dt==frameMs: k = 1 - base
      expect(v).toBeCloseTo(98);
    });
  });

  describe('sparkline path/points builders', () => {
    it('buildUsersSparklinePoints formats expected x/y using local max denom', () => {
      const s = [0, 10, 20, 30];
      const points = buildUsersSparklinePoints(s, 4, undefined, 15);
      expect(points).toBe(
        '0.00,20.00 25.00,13.33 50.00,6.67 75.00,0.00 100.00,10.00'
      );
    });

    it('buildUsersSparklinePoints uses maxUsers as denom cap when provided', () => {
      const s = [0, 10, 20, 30];
      // denom=maxUsers=100 -> y for 30 is 20 - (30/100)*20 = 14
      const points = buildUsersSparklinePoints(s, 4, 100);
      expect(points).toContain('75.00,14.00');
    });

    it('buildUsersSparklinePathD includes extra tail points only when nextValue is provided', () => {
      const s = [0, 10, 20, 30];
      const withoutNext = buildUsersSparklinePathD(s, 4);
      expect(withoutNext).toContain('M -50.000,20.000');
      expect(withoutNext).not.toContain('125.000');

      const withNext = buildUsersSparklinePathD(s, 4, undefined, 15);
      expect(withNext).toContain('125.000');
    });

    it('buildScrollingUsersSparklinePathD interpolates the x=100 point based on phase', () => {
      const s = [0, 10, 20, 30];
      const p0 = buildScrollingUsersSparklinePathD(s, 4, undefined, 15, 0);
      expect(p0).toContain('100.000,0.000');

      const p1 = buildScrollingUsersSparklinePathD(s, 4, undefined, 15, 1);
      expect(p1).toContain('100.000,10.000');
    });

    it('buildRpsSparklinePoints uses 1024-free linear scaling and includes x=100 only when nextValue provided', () => {
      const s = [0, 10, 20, 30];
      const pointsNoNext = buildRpsSparklinePoints(s, 4);
      expect(pointsNoNext).toBe('0.00,20.00 25.00,13.33 50.00,6.67 75.00,0.00');

      const pointsNext = buildRpsSparklinePoints(s, 4, undefined, 15);
      expect(pointsNext).toBe(
        '0.00,20.00 25.00,13.33 50.00,6.67 75.00,0.00 100.00,10.00'
      );
    });

    it('buildRpsSparklinePathD always includes a tail point beyond x=100', () => {
      const s = [0, 10, 20, 30];
      const d = buildRpsSparklinePathD(s, 4);
      expect(d).toContain('M -50.000,20.000');
      expect(d).toContain('125.000');
    });

    it('buildScrollingRpsSparklinePathD interpolates the x=100 point based on phase', () => {
      const s = [0, 10, 20, 30];
      const p0 = buildScrollingRpsSparklinePathD(s, 4, 15, 0);
      expect(p0).toContain('100.000,0.000');

      const p1 = buildScrollingRpsSparklinePathD(s, 4, 15, 1);
      expect(p1).toContain('100.000,10.000');
    });
  });

  describe('queue ramping helpers', () => {
    it('pushUsersSampleToQueue truncates and clamps negatives', () => {
      const r = pushUsersSampleToQueue([], [0, 0, 0, 0], null, 4, 3, -2.8);
      expect(r.sample).toBe(0);
      expect(r.queue.length).toBeGreaterThan(0);
      expect(r.queue.every(n => Number.isInteger(n) && n >= 0)).toBe(true);
    });

    it('pushUsersSampleToQueue uses nextValue as current when queue is empty', () => {
      const r = pushUsersSampleToQueue([], [1, 2, 3, 4], 9, 4, 1, 10);
      // With 1 step, queue should contain a single ramped value.
      expect(r.queue).toEqual([10]);
    });

    it('pushRpsSampleToQueue clamps NaN to 0 and trims maxQueue', () => {
      let queue: number[] = [];
      const series = Array(4).fill(0);
      for (let i = 0; i < 100; i++) {
        const r = pushRpsSampleToQueue(queue, series, null, 4, 2, Number.NaN);
        queue = r.queue;
      }
      // maxQueue = slots*4 = 16
      expect(queue.length).toBeLessThanOrEqual(16);
      expect(queue.every(v => v === 0)).toBe(true);
    });
  });

  describe('tick*SparklineUi helpers', () => {
    it('tickUsersSparklineUi preserves existing path when not advanced', () => {
      const sentinel = 'SENTINEL_PATH';
      const r = tickUsersSparklineUi({
        state: { series: [1, 2, 3, 4], queue: [], scrollPhase: 0, nextValue: null },
        dtMs: 0,
        maxPoints: 4,
        scrollMs: 80,
        maxUsers: 100,
        currentPathDView: sentinel
      });

      expect(r.advanced).toBe(false);
      expect(r.pathDView).toBe(sentinel);
    });

    it('tickUsersSparklineUi rebuilds path when advanced', () => {
      const sentinel = 'SENTINEL_PATH';
      const r = tickUsersSparklineUi({
        state: { series: [1, 2, 3, 4], queue: [10], scrollPhase: 0, nextValue: null },
        dtMs: 200,
        maxPoints: 4,
        scrollMs: 80,
        maxUsers: 100,
        currentPathDView: sentinel
      });

      expect(r.advanced).toBe(true);
      expect(r.pathDView).not.toBe(sentinel);
      expect(r.pathDView.length).toBeGreaterThan(0);
    });

    it('tickRpsSparklineUi rebuilds path when missing', () => {
      const r = tickRpsSparklineUi({
        state: { series: [1, 2, 3, 4], queue: [], scrollPhase: 0, nextValue: null },
        dtMs: 0,
        maxPoints: 4,
        scrollMs: 80,
        currentPathDView: ''
      });

      expect(r.pathDView.length).toBeGreaterThan(0);
    });
  });
});
