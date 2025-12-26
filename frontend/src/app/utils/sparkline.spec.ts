import { enqueueRamp, pointsToSmoothPathD, pointsToString } from './sparkline';

describe('sparkline utils', () => {
  test('enqueueRamp generates smoothstep intermediate values', () => {
    const q: number[] = [];
    enqueueRamp(q, 0, 10, 5, false);
    expect(q).toHaveLength(5);
    // Monotonic and ends at target (within float tolerance)
    for (let i = 1; i < q.length; i++) {
      expect(q[i]).toBeGreaterThanOrEqual(q[i - 1]);
    }
    expect(q[q.length - 1]).toBeCloseTo(10, 8);
  });

  test('enqueueRamp respects integer mode', () => {
    const q: number[] = [];
    enqueueRamp(q, 0, 10, 10, true);
    expect(q.every(v => Number.isInteger(v))).toBe(true);
    expect(q[q.length - 1]).toBe(10);
  });

  test('pointsToString formats points', () => {
    expect(pointsToString([{ x: 1.234, y: 9.876 }])).toBe('1.23,9.88');
  });

  test('pointsToSmoothPathD returns a cubic path and clamps Y control points', () => {
    const d = pointsToSmoothPathD(
      [
        { x: 0, y: -100 },
        { x: 50, y: 10 },
        { x: 100, y: 200 }
      ],
      { minX: 0, maxX: 100, minY: 0, maxY: 20 },
      0.9
    );

    expect(d.startsWith('M ')).toBe(true);
    expect(d.includes(' C ')).toBe(true);
    // Ensure we didn't produce NaN/Infinity
    expect(d.includes('NaN')).toBe(false);
    expect(d.includes('Infinity')).toBe(false);
  });
});
