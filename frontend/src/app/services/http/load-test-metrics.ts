import { LoadTestMetrics, LoadTestResults } from '../../models/http.models';

export function calculateLoadTestMetrics(results: LoadTestResults): LoadTestMetrics {
  const sortedTimes = [...results.responseTimes].sort((a, b) => a - b);
  const duration = (results.endTime - results.startTime) / 1000; // seconds

  return {
    totalRequests: results.totalRequests,
    successfulRequests: results.successfulRequests,
    failedRequests: results.failedRequests,
    failureStatusCounts: results.failureStatusCounts || {},
    requestsPerSecond: duration > 0 ? (results.totalRequests / duration) : 0,
    averageResponseTime: sortedTimes.reduce((a, b) => a + b, 0) / sortedTimes.length || 0,
    p50: sortedTimes[Math.floor(sortedTimes.length * 0.5)] || 0,
    p95: sortedTimes[Math.floor(sortedTimes.length * 0.95)] || 0,
    p99: sortedTimes[Math.floor(sortedTimes.length * 0.99)] || 0,
    minResponseTime: sortedTimes[0] || 0,
    maxResponseTime: sortedTimes[sortedTimes.length - 1] || 0,
    errorRate: (results.failedRequests / results.totalRequests) * 100 || 0,
    duration,
    cancelled: results.cancelled,
    aborted: results.aborted,
    abortReason: results.abortReason,
    plannedDuration: results.plannedDurationMs ? results.plannedDurationMs / 1000 : undefined,
    adaptive: results.adaptive,
  };
}
