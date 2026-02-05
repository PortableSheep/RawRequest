// Common HTTP headers for autocomplete
export const HTTP_HEADERS = [
  'Accept', 'Accept-Charset', 'Accept-Encoding', 'Accept-Language',
  'Authorization', 'Cache-Control', 'Content-Length', 'Content-Type',
  'Cookie', 'Host', 'If-Match', 'If-Modified-Since', 'If-None-Match',
  'Origin', 'Pragma', 'Referer', 'User-Agent', 'X-Requested-With',
  'X-API-Key', 'X-Auth-Token', 'X-Correlation-ID', 'X-Request-ID'
] as const;

export const CONTENT_TYPES = [
  'application/json',
  'application/xml',
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
  'text/html',
  'text/xml'
] as const;

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'] as const;
export const ANNOTATIONS = ['@name', '@depends', '@load', '@timeout', '@env', '@no-history'] as const;

export type LoadTestKey = { label: string; detail: string };

export const LOAD_TEST_KEYS: ReadonlyArray<LoadTestKey> = [
  // Concurrency / users
  { label: 'concurrent', detail: 'active users (canonical)' },
  { label: 'users', detail: 'active users (alias)' },
  { label: 'concurrency', detail: 'active users (alias)' },

  // Stop conditions
  { label: 'iterations', detail: 'total requests (canonical)' },
  { label: 'amount', detail: 'total requests (alias)' },
  { label: 'requests', detail: 'total requests (alias)' },
  { label: 'count', detail: 'total requests (alias)' },
  { label: 'duration', detail: 'run time (e.g. 30s, 5m)' },
  { label: 'runtime', detail: 'run time (alias)' },
  { label: 'time', detail: 'run time (alias)' },

  // Ramp/spawn
  { label: 'start', detail: 'starting users' },
  { label: 'max', detail: 'max users' },
  { label: 'rampUp', detail: 'ramp duration (e.g. 30s, 2m)' },
  { label: 'ramp', detail: 'ramp duration (alias)' },
  { label: 'spawnRate', detail: 'users per second' },
  { label: 'spawn_rate', detail: 'users per second (alias)' },

  // Think time / pacing
  { label: 'delay', detail: 'fixed per-user delay between requests' },
  { label: 'wait', detail: 'fixed per-user delay (alias)' },
  { label: 'thinkTime', detail: 'fixed per-user delay (alias)' },
  { label: 'waitMin', detail: 'min random wait (e.g. 200ms)' },
  { label: 'waitMax', detail: 'max random wait (e.g. 2s)' },
  { label: 'minWait', detail: 'min random wait (alias)' },
  { label: 'maxWait', detail: 'max random wait (alias)' },

  // Throttle
  { label: 'requestsPerSecond', detail: 'global RPS cap' },
  { label: 'rps', detail: 'global RPS cap (alias)' },

  // Abort thresholds
  { label: 'failureRateThreshold', detail: 'abort if failure rate exceeds (e.g. 1%, 0.01, 99%)' },
  { label: 'failureThreshold', detail: 'abort threshold (alias)' },
  { label: 'failRate', detail: 'abort threshold (alias)' },

  // Adaptive mode
  { label: 'adaptive', detail: 'enable adaptive capacity discovery (true/false)' },
  { label: 'adaptiveFailureRate', detail: 'target failure rate (e.g. 1%, 0.01)' },
  { label: 'adaptiveWindow', detail: 'window size (e.g. 15s)' },
  { label: 'adaptiveStable', detail: 'stable duration (e.g. 20s)' },
  { label: 'adaptiveCooldown', detail: 'cooldown between adjustments (e.g. 5s)' },
  { label: 'adaptiveBackoffStep', detail: 'users to drop per backoff step' }
];
