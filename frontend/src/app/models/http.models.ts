export interface Request {
  method: string;
  url: string;
  headers: { [key: string]: string };
  body?: string | FormData;
  name?: string;
  group?: string;
  preScript?: string;
  postScript?: string;
  assertions?: Assertion[];
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
}

export interface ChainEntryPreview {
  id: string;
  label: string;
  request: RequestPreview;
  response?: ResponsePreview | null;
  isPrimary?: boolean;
}

export interface LoadTestConfig {
  concurrent?: number;
  duration?: string;
  iterations?: number;  // Total number of requests to make
  start?: number;
  max?: number;
  rampUp?: string;
  requestsPerSecond?: number;
}

export interface LoadTestResults {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  responseTimes: number[];
  errors: any[];
  startTime: number;
  endTime: number;
}

export interface LoadTestMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  requestsPerSecond: number;
  averageResponseTime: number;
  p50: number;
  p95: number;
  p99: number;
  minResponseTime: number;
  maxResponseTime: number;
  errorRate: number;
  duration: number;
}

export interface Assertion {
  type: 'status' | 'header' | 'body' | 'json';
  operator: '==' | '!=' | 'contains' | 'not_contains' | 'matches';
  expected: string;
  actual?: string;
  passed?: boolean;
}

export interface ResponseData {
  status: number;
  statusText: string;
  headers: { [key: string]: string };
  body: string;
  json?: any;
  responseTime: number;
  timing?: TimingBreakdown;
  size?: number;  // Response body size in bytes
  processedUrl?: string;
  requestPreview?: RequestPreview;
  chainItems?: ChainEntryPreview[];
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