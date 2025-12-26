export type SparklinePoint = { x: number; y: number };

export type SparklineBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export function pointsToString(points: SparklinePoint[]): string {
  return points.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
}

export function enqueueRamp(queue: number[], from: number, to: number, steps: number, isInt: boolean): void {
  const n = Math.max(1, Math.min(60, Math.trunc(steps)));
  const a = Number.isFinite(from) ? from : 0;
  const b = Number.isFinite(to) ? to : 0;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const e = t * t * (3 - 2 * t); // smoothstep
    const v = a + (b - a) * e;
    queue.push(isInt ? Math.max(0, Math.trunc(v)) : Math.max(0, v));
  }
}

export function pointsToSmoothPathD(points: SparklinePoint[], bounds: SparklineBounds, tension = 0.9): string {
  if (!points.length) return '';
  if (points.length === 1) {
    const p = points[0];
    return `M ${p.x.toFixed(2)},${p.y.toFixed(2)}`;
  }

  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  const clampY = (p: SparklinePoint) => ({ x: p.x, y: clamp(p.y, bounds.minY, bounds.maxY) });

  const t = clamp(tension, 0, 1.5);
  let d = `M ${points[0].x.toFixed(3)},${points[0].y.toFixed(3)}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;

    // Catmull-Rom to cubic Bezier conversion.
    let cp1 = {
      x: p1.x + ((p2.x - p0.x) * t) / 6,
      y: p1.y + ((p2.y - p0.y) * t) / 6
    };
    let cp2 = {
      x: p2.x - ((p3.x - p1.x) * t) / 6,
      y: p2.y - ((p3.y - p1.y) * t) / 6
    };
    cp1 = clampY(cp1);
    cp2 = clampY(cp2);

    d += ` C ${cp1.x.toFixed(3)},${cp1.y.toFixed(3)} ${cp2.x.toFixed(3)},${cp2.y.toFixed(3)} ${p2.x.toFixed(3)},${p2.y.toFixed(3)}`;
  }

  return d;
}
