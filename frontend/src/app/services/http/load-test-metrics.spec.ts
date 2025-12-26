import { calculateLoadTestMetrics } from './load-test-metrics';

describe('load-test-metrics', () => {
  it('computes percentiles and rates', () => {
    const metrics = calculateLoadTestMetrics({
      totalRequests: 10,
      successfulRequests: 8,
      failedRequests: 2,
      responseTimes: [100, 200, 50, 400, 300],
      errors: [],
      failureStatusCounts: { '500': 2 },
      startTime: 0,
      endTime: 5000,
      cancelled: false,
      aborted: false,
      abortReason: undefined,
      plannedDurationMs: 4000,
      adaptive: { enabled: true },
    });

    expect(metrics.duration).toBe(5);
    expect(metrics.requestsPerSecond).toBeCloseTo(2);

    expect(metrics.minResponseTime).toBe(50);
    expect(metrics.maxResponseTime).toBe(400);

    // sorted: [50, 100, 200, 300, 400]
    expect(metrics.p50).toBe(200);
    expect(metrics.p95).toBe(400);
    expect(metrics.p99).toBe(400);

    expect(metrics.averageResponseTime).toBeCloseTo((50 + 100 + 200 + 300 + 400) / 5);
    expect(metrics.errorRate).toBeCloseTo(20);
    expect(metrics.failureStatusCounts?.['500']).toBe(2);
    expect(metrics.plannedDuration).toBe(4);
    expect(metrics.adaptive?.enabled).toBe(true);
  });

  it('handles empty responseTimes without NaN', () => {
    const metrics = calculateLoadTestMetrics({
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      responseTimes: [],
      errors: [],
      failureStatusCounts: {},
      startTime: 10,
      endTime: 10,
      cancelled: false,
      aborted: false,
      abortReason: undefined,
      plannedDurationMs: null,
      adaptive: { enabled: false },
    });

    expect(metrics.averageResponseTime).toBe(0);
    expect(metrics.p50).toBe(0);
    expect(metrics.minResponseTime).toBe(0);
    expect(metrics.maxResponseTime).toBe(0);
    expect(metrics.requestsPerSecond).toBe(0);
  });
});
