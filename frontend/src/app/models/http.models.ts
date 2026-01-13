export interface Request {
  method: string;
  url: string;
  headers: { [key: string]: string };
  body?: string | FormData;
  name?: string;
  group?: string;
  preScript?: string;
  postScript?: string;
  depends?: string;  // Name of request to execute first
  loadTest?: LoadTestConfig;  // Load test configuration
  options?: {
    timeout?: number;
    noRedirect?: boolean;
  }
}

export interface RequestPreview {
  name?: string;
  method: string;
  url: string;
  headers: { [key: string]: string };
  body?: string;
}

export interface TimingBreakdown {
  dnsLookup: number;      // DNS resolution time in ms
  tcpConnect: number;     // TCP connection time in ms
  tlsHandshake: number;   // TLS handshake time in ms
  timeToFirstByte: number; // Time to first response byte in ms
  contentTransfer: number; // Content download time in ms
  total: number;          // Total request time in ms
}

export interface ResponsePreview {
  status: number;
  statusText: string;
  headers: { [key: string]: string };
  body: string;
  responseTime: number;
  timing?: TimingBreakdown;
  size?: number;  // Response body size in bytes
  assertions?: AssertionResult[];
}

export interface AssertionResult {
  passed: boolean;
  message: string;
  stage?: 'pre' | 'post' | 'custom' | string;
}

export interface ChainEntryPreview {
  id: string;
  label: string;
  request: RequestPreview;
  response?: ResponsePreview | null;
  isPrimary?: boolean;
}

export interface LoadTestConfig {
  // Locust-ish terminology support (parsed from @load ...)
  // Concurrency / users
  concurrent?: number;
  users?: number;
  start?: number;       // starting users (legacy)
  startUsers?: number;
  max?: number;         // max users (legacy)
  maxUsers?: number;

  // Stop conditions
  duration?: string;    // e.g. 30s, 2m
  iterations?: number;  // total number of requests to make (aka amount/requests)

  // Ramp up / spawn
  rampUp?: string;      // duration (e.g. 10s) OR users/sec when used as a number-like string
  spawnRate?: number;   // users per second

  // Pacing / throttling
  delay?: string | number;      // fixed delay between requests per user
  waitMin?: string | number;    // random wait lower bound
  waitMax?: string | number;    // random wait upper bound
  requestsPerSecond?: number;   // global RPS cap
  
  // Early abort
  // Example: failureRateThreshold=99% (or 0.99)
  failureRateThreshold?: string | number;

  // Adaptive mode (ramp → back off until stable → stop)
  adaptive?: boolean | string | number;
  adaptiveFailureRate?: string | number; // failure fraction (0..1) or percent ("1%" or 1)
  adaptiveWindow?: string | number;      // window length (e.g. "10s")
  adaptiveStable?: string | number;      // stable duration required (e.g. "20s")
  adaptiveCooldown?: string | number;    // min time between adjustments
  adaptiveBackoffStep?: number | string; // users to drop per step
}

export interface AdaptiveLoadTestSummary {
  enabled: boolean;
  stabilized?: boolean;
  phase?: 'ramping' | 'backing_off' | 'stable' | 'exhausted' | 'disabled';
  peakUsers?: number;
  stableUsers?: number;
  timeToFirstFailureMs?: number;
  backoffSteps?: number;
  peakWindowFailureRate?: number;
  stableWindowFailureRate?: number;
  peakWindowRps?: number;
  stableWindowRps?: number;
}

export interface LoadTestResults {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  responseTimes: number[];
  errors: any[];
  failureStatusCounts?: { [statusCode: string]: number };
  startTime: number;
  endTime: number;
  
  cancelled?: boolean;
  aborted?: boolean;
  abortReason?: string;
  plannedDurationMs?: number | null;

  adaptive?: AdaptiveLoadTestSummary;
}

export interface LoadTestMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  failureStatusCounts?: { [statusCode: string]: number };
  requestsPerSecond: number;
  averageResponseTime: number;
  p50: number;
  p95: number;
  p99: number;
  minResponseTime: number;
  maxResponseTime: number;
  errorRate: number;
  duration: number;
  
  // Run state
  cancelled?: boolean;
  aborted?: boolean;
  abortReason?: string;
  plannedDuration?: number; // seconds, if duration-based test

  adaptive?: AdaptiveLoadTestSummary;
}
 
export interface ActiveRunProgress {
  requestId: string;
  type: 'load' | 'single' | 'chain';
  startedAt: number;
  plannedDurationMs?: number | null;
  activeUsers?: number;
  maxUsers?: number;
  totalSent?: number;
  successful?: number;
  failed?: number;
  done?: boolean;
  cancelled?: boolean;
  aborted?: boolean;
  abortReason?: string;
}

export interface ResponseData {
  status: number;
  statusText: string;
  headers: { [key: string]: string };
  body: string;
  json?: any;
  loadTestMetrics?: LoadTestMetrics;
  responseTime: number;
  timing?: TimingBreakdown;
  size?: number;  // Response body size in bytes
  processedUrl?: string;
  requestPreview?: RequestPreview;
  chainItems?: ChainEntryPreview[];
  assertions?: AssertionResult[];
}

export interface FileTab {
  id: string;
  name: string;
  content: string;
  requests: Request[];
  environments: { [env: string]: { [key: string]: string } };
  variables: { [key: string]: string };
  responseData: { [requestIndex: number]: ResponseData };
  groups: string[];
  selectedEnv?: string;
  displayName?: string;
  filePath?: string;  // Full path to the file on disk (if opened from file system)
}

export interface HistoryItem {
  timestamp: Date;
  method: string;
  url: string;
  status: number;
  statusText: string;
  responseTime: number;
  responseData: ResponseData;
}

export interface ScriptLogEntry {
  timestamp: string;
  level: string;
  source: string;
  message: string;
}