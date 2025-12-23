import { Injectable, inject } from '@angular/core';
import {
  Request,
  ResponseData,
  FileTab,
  HistoryItem,
  LoadTestResults,
  LoadTestMetrics,
  RequestPreview,
  ActiveRunProgress
} from '../models/http.models';
import { cleanScriptContent } from '../utils/script-cleaner.generated';
import { dirname } from '../utils/path';
import { BackendClientService } from './backend-client.service';
import { ScriptConsoleService } from './script-console.service';
import { SecretService } from './secret.service';

@Injectable({
  providedIn: 'root'
})
export class HttpService {
  private readonly backend = inject(BackendClientService);
  private readonly scriptConsole = inject(ScriptConsoleService);
  private readonly secretService = inject(SecretService);

  private readonly FILES_KEY = 'rawrequest_files';
  private readonly CANCELLED_RESPONSE = '__CANCELLED__';
  private loadTestCancelled = new Set<string>();

  constructor() {
    this.scriptConsole.init().catch(() => {
      // Console UI will surface errors; swallow to avoid blocking requests
    });
  }

  cancelLoadTest(requestId: string): void {
    this.loadTestCancelled.add(requestId);
  }

  async sendRequest(
    request: Request,
    variables: { [key: string]: string } = {},
    requestId?: string,
    env?: string
  ): Promise<ResponseData & { processedUrl: string; requestPreview: RequestPreview }> {
    const startTime = Date.now();
    const envName = this.normalizeEnvName(env);
    let processedUrl = request.url;
    let processedHeaders: { [key: string]: string } = { ...(request.headers || {}) };
    let processedBody: string | undefined;
    let requestPreview: RequestPreview | null = null;
    let bodyPlaceholder: string | undefined;

    try {
      // Execute pre-script if present
      if (request.preScript) {
        await this.executeScript(request.preScript, { request, variables }, 'pre');
      }
      
      // Replace secrets + variables in URL, headers, and body
      processedUrl = await this.hydrateText(request.url, variables, envName);
      processedHeaders = await this.hydrateHeaders(request.headers, variables, envName);
      if (request.body && !(request.body instanceof FormData)) {
        processedBody = await this.hydrateText(String(request.body), variables, envName);
      } else if (request.body instanceof FormData) {
        bodyPlaceholder = '[FormData]';
      }

      // Prepare request options
      const requestOptions: RequestInit = {
        method: request.method,
        headers: processedHeaders,
      };

      // Add body if present
      if (request.body) {
        if (request.body instanceof FormData) {
          requestOptions.body = request.body;
          // Remove Content-Type header for FormData (let browser set it)
          delete processedHeaders['Content-Type'];
        } else {
          requestOptions.body = processedBody ?? '';
        }
      }

      requestPreview = {
        name: request.name,
        method: request.method,
        url: processedUrl,
        headers: { ...processedHeaders },
        body: processedBody ?? bodyPlaceholder
      };

      // Add timeout if specified
      let controller: AbortController | undefined;
      if (request.options?.timeout) {
        controller = new AbortController();
        requestOptions.signal = controller.signal;
        setTimeout(() => controller?.abort(), request.options.timeout);
      }

      // Use Wails Go backend to send request (avoids CORS)
      const headersJson = JSON.stringify(processedHeaders);
      const bodyStr = requestOptions.body ? String(requestOptions.body) : '';

      console.log('[HTTP Service] Sending request:', { method: request.method, url: processedUrl });
      const responseStr = requestId
        ? await this.backend.sendRequestWithID(requestId, request.method, processedUrl, headersJson, bodyStr)
        : await this.backend.sendRequest(request.method, processedUrl, headersJson, bodyStr);

      this.throwIfCancelled(responseStr);
      const responseTime = Date.now() - startTime;
      console.log('[HTTP Service] Response received:', responseStr.substring(0, 200));

      // Parse the response from Go backend
      // Format: "Status: 200 OK\nHeaders: {...}\nBody: ..."
      const responseData = this.parseGoResponse(responseStr, responseTime);

      // Execute post-script if present
      if (request.postScript) {
        await this.executeScript(request.postScript, { request, response: responseData, variables }, 'post');
      }

      return { ...responseData, processedUrl, requestPreview: requestPreview! };
    } catch (error: any) {
      if (error?.cancelled) {
        throw error;
      }
      const responseTime = Date.now() - startTime;
      const fallback: ResponseData = {
        status: 0,
        statusText: error.name || 'Network Error',
        headers: {},
        body: error.message || 'Unknown error occurred',
        responseTime
      };
      if (requestPreview) {
        fallback.processedUrl = requestPreview.url;
        fallback.requestPreview = requestPreview;
      }
      throw fallback;
    }
  }

  private replaceVariables(text: string, variables: { [key: string]: string }): string {
    let result = text;
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{${key}}}`, 'g');
      result = result.replace(regex, value);
    }
    return result;
  }

  private parseResponseHeaders(headers: Headers): { [key: string]: string } {
    const result: { [key: string]: string } = {};
    headers.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }

  private parseGoResponse(responseStr: string, responseTime: number): ResponseData {
    // Check if this is an error response from Go backend
    if (responseStr.startsWith('Error: ') || responseStr.startsWith('Error reading')) {
      return {
        status: 0,
        statusText: 'Request Error',
        headers: {},
        body: responseStr,
        responseTime
      };
    }

    // Parse Go backend response format: "Status: 200 OK\nHeaders: {...}\nBody: ..."
    const lines = responseStr.split('\n');
    let status = 0;
    let statusText = '';
    let headers: { [key: string]: string } = {};
    let body = '';
    let timing: any = null;
    let size: number | undefined;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('Status: ')) {
        const statusLine = line.substring(8); // Remove "Status: "
        const parts = statusLine.split(' ');
        status = parseInt(parts[0]) || 0;
        statusText = parts.slice(1).join(' ');
      } else if (line.startsWith('Headers: ')) {
        try {
          const headersStr = line.substring(9).trim();
          if (headersStr) {
            // New format: Headers contains ResponseMetadata JSON with timing, size, and headers
            const metadata = JSON.parse(headersStr);
            if (metadata.headers) {
              headers = metadata.headers;
            }
            if (metadata.timing) {
              timing = metadata.timing;
            }
            if (typeof metadata.size === 'number') {
              size = metadata.size;
            }
          }
        } catch (e) {
          console.error('Failed to parse headers/metadata:', e, 'Headers string:', line.substring(9));
          headers = {};
        }
      } else if (line.startsWith('Body: ')) {
        // Body is everything after "Body: "
        body = line.substring(6);
        // If there are more lines, append them (multiline body)
        if (i + 1 < lines.length) {
          body += '\n' + lines.slice(i + 1).join('\n');
        }
        break;
      }
    }

    // If we didn't parse anything, treat the whole response as an error
    if (status === 0 && !statusText && !body) {
      return {
        status: 0,
        statusText: 'Parse Error',
        headers: {},
        body: responseStr,
        responseTime
      };
    }

    const responseData: ResponseData = {
      status,
      statusText,
      headers,
      body,
      responseTime: timing?.total ?? responseTime,
      timing,
      size
    };

    // Try to parse JSON
    if (body) {
      try {
        responseData.json = JSON.parse(body);
      } catch (e) {
        // Not JSON, that's fine
      }
    }

    return responseData;
  }

  private async executeScript(script: string, context: any, stage: 'pre' | 'post' | 'custom' = 'custom'): Promise<void> {
    if (!script || !script.trim()) {
      return;
    }

    try {
      const cleanScript = cleanScriptContent(script).trim();
      if (!cleanScript) {
        return;
      }

      const scriptContext = context || {};
      scriptContext.variables = scriptContext.variables || {};
      const source = this.buildScriptSource(stage, scriptContext.request);

      const emitLog = (level: 'info' | 'warn' | 'error' | 'debug', args: any[]) => {
        const message = this.buildConsoleMessage(args);
        if (!message) {
          return;
        }
        void this.scriptConsole.record(level, source, message);
      };

      const setVar = (key: string, value: any) => {
        if (!key) {
          return;
        }
        const stringValue = String(value ?? '');
        scriptContext.variables[key] = stringValue;
        this.backend.setVariable(key, stringValue).catch(err => console.error('Failed to sync variable:', err));
      };

      const getVar = (key: string) => {
        if (!key) {
          return '';
        }
        return scriptContext.variables[key] || '';
      };

      const setHeader = (header: string, value: any) => {
        if (!header) {
          return;
        }
        const request = this.ensureScriptRequest(scriptContext);
        request.headers[header] = String(value ?? '');
      };

      const updateRequest = (patch: Record<string, any>) => {
        if (!patch || typeof patch !== 'object') {
          return;
        }
        const request = this.ensureScriptRequest(scriptContext);
        Object.entries(patch).forEach(([key, val]) => {
          if (key === 'headers' && val && typeof val === 'object') {
            Object.entries(val as Record<string, any>).forEach(([headerKey, headerValue]) => {
              request.headers[headerKey] = String(headerValue ?? '');
            });
            return;
          }
          (request as any)[key] = val;
        });
      };

      const assertFn = (condition: any, message = 'Assertion failed') => {
        if (!condition) {
          throw new Error(message);
        }
      };

      const delayFn = (duration: any) => {
        const parsed = Number(duration);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          return Promise.resolve();
        }
        return new Promise<void>(resolve => setTimeout(resolve, parsed));
      };

      const consoleProxy = {
        log: (...args: any[]) => emitLog('info', args),
        info: (...args: any[]) => emitLog('info', args),
        warn: (...args: any[]) => emitLog('warn', args),
        error: (...args: any[]) => emitLog('error', args),
        debug: (...args: any[]) => emitLog('debug', args)
      };

      // Extract response and request from context for direct access in scripts
      const response = scriptContext.response || {};
      const request = scriptContext.request || {};

      const func = new Function(
        'context',
        'setVar',
        'getVar',
        'console',
        'setHeader',
        'updateRequest',
        'assert',
        'delay',
        'response',
        'request',
        cleanScript
      );

      const result = func(
        scriptContext,
        setVar,
        getVar,
        consoleProxy,
        setHeader,
        updateRequest,
        assertFn,
        delayFn,
        response,
        request
      );

      if (result instanceof Promise) {
        await result;
      }
    } catch (error: any) {
      console.error('Script execution error:', error);
      const message = error?.message || String(error);
      void this.scriptConsole.record('error', this.buildScriptSource(stage, context?.request), `runtime error: ${message}`);
    }
  }

  private ensureScriptRequest(context: any): { headers: Record<string, string> } & Record<string, any> {
    if (!context.request) {
      context.request = { headers: {} };
    }
    if (!context.request.headers) {
      context.request.headers = {};
    }
    return context.request;
  }

  private buildScriptSource(stage: string, request?: Request): string {
    const prefix = stage || 'script';
    if (!request) {
      return prefix;
    }
    if (request.name) {
      return `${prefix}:${request.name}`;
    }
    if (request.method && request.url) {
      return `${prefix}:${request.method} ${request.url}`;
    }
    if (request.method) {
      return `${prefix}:${request.method}`;
    }
    return prefix;
  }

  private buildConsoleMessage(args: any[]): string {
    if (!args || !args.length) {
      return '';
    }
    return args
      .map(arg => {
        if (arg == null) {
          return '';
        }
        if (typeof arg === 'string') {
          return arg;
        }
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg);
          } catch {
            return '[object]';
          }
        }
        return String(arg);
      })
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  // History management
  async loadHistory(fileId: string, filePath?: string): Promise<HistoryItem[]> {
    if (!fileId) {
      return [];
    }
    try {
      const stored = filePath
        ? await this.backend.loadFileHistoryFromDir(fileId, dirname(filePath))
        : await this.backend.loadFileHistoryFromRunLocation(fileId);
      if (stored) {
        const parsed = JSON.parse(stored);
        return parsed.map((item: any) => ({
          ...item,
          timestamp: new Date(item.timestamp)
        }));
      }
    } catch (error) {
      console.error('Error loading history for file', fileId, error);
    }
    return [];
  }

  async saveHistorySnapshot(fileId: string, history: HistoryItem[], filePath?: string): Promise<void> {
    if (!fileId) return;
    const json = JSON.stringify(history || []);
    try {
      if (filePath) {
        await this.backend.saveFileHistoryToDir(fileId, json, dirname(filePath));
      } else {
        await this.backend.saveFileHistoryToRunLocation(fileId, json);
      }
    } catch (error) {
      console.error('Error saving history snapshot for file', fileId, error);
    }
  }

  async addToHistory(fileId: string, item: HistoryItem, filePath?: string, maxItems: number = 100): Promise<HistoryItem[]> {
    const history = await this.loadHistory(fileId, filePath);
    history.unshift(item);
    if (history.length > maxItems) {
      history.splice(maxItems);
    }
    try {
      if (filePath) {
        await this.backend.saveFileHistoryToDir(fileId, JSON.stringify(history), dirname(filePath));
      } else {
        // Save to run location for unsaved tabs
        await this.backend.saveFileHistoryToRunLocation(fileId, JSON.stringify(history));
      }
    } catch (error) {
      console.error('Error saving history for file', fileId, error);
    }

    // If a file path was provided (file saved on disk), also save the response
    // payload alongside the http file for easier inspection.
    try {
      if (filePath) {
        // Save the response JSON for this history entry
        const saved = await this.backend.saveResponseFile(filePath, JSON.stringify(item.responseData, null, 2));
        console.debug('[HTTP Service] Saved response to', saved);
      } else {
        const saved = await this.backend.saveResponseFileToRunLocation(fileId, JSON.stringify(item.responseData, null, 2));
        console.debug('[HTTP Service] Saved response to', saved);
      }
    } catch (err) {
      console.warn('Failed to save response file:', err);
    }

    return history;
  }

  // File management
  loadFiles(): FileTab[] {
    try {
      const stored = localStorage.getItem(this.FILES_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.error('Error loading files:', error);
    }
    return [];
  }

  saveFiles(files: FileTab[]): void {
    try {
      localStorage.setItem(this.FILES_KEY, JSON.stringify(files));
    } catch (error) {
      console.error('Error saving files:', error);
    }
  }

  // Execute chained requests using Go backend
  async executeChain(
    requests: Request[],
    variables: { [key: string]: string } = {},
    requestId?: string,
    env?: string
  ): Promise<{ responses: ResponseData[]; requestPreviews: RequestPreview[] }> {
    try {
      console.log('[HTTP Service] Executing chain with', requests.length, 'requests');
      const envName = this.normalizeEnvName(env);

      // Convert requests to format expected by Go backend
      const requestsData: Array<Record<string, any>> = [];
      const previews: RequestPreview[] = [];
      for (const req of requests) {
        const prepared = await this.prepareBackendRequest(req, variables, envName);
        requestsData.push(prepared.backend);
        previews.push(prepared.preview);
      }

      console.log('[HTTP Service] Calling ExecuteRequests with data:', requestsData);

      const responseStr = requestId
        ? await this.backend.executeRequestsWithID(requestId, requestsData)
        : await this.backend.executeRequests(requestsData);

      this.throwIfCancelled(responseStr);
      console.log('[HTTP Service] ExecuteRequests returned:', responseStr);

      // Parse responses (Go returns concatenated responses)
      const responses: ResponseData[] = [];
      const lines = responseStr.split('\n\n');

      console.log('[HTTP Service] Split into', lines.length, 'response parts');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim()) {
          console.log('[HTTP Service] Parsing response part', i, ':', line.substring(0, 100) + '...');
          try {
            const response = this.parseGoResponse(line, 0);
            const preview = previews[i];
            if (preview) {
              response.requestPreview = preview;
              response.processedUrl = preview.url;
            }
            responses.push(response);
          } catch (parseError) {
            console.error('[HTTP Service] Failed to parse response part', i, ':', parseError);
            // Create a fallback response for failed parsing
            responses.push({
              status: 0,
              statusText: 'Parse Error',
              headers: {},
              body: `Failed to parse response: ${parseError}\n\nRaw response:\n${line}`,
              responseTime: 0
            });
          }
        }
      }

      console.log('[HTTP Service] Parsed', responses.length, 'responses');
      return { responses, requestPreviews: previews };
    } catch (error: any) {
      if (error?.cancelled) {
        throw error;
      }
      console.error('[HTTP Service] Chain execution error:', error);
      throw {
        status: 0,
        statusText: 'Chain Execution Error',
        headers: {},
        body: error.message || 'Failed to execute request chain',
        responseTime: 0
      } as ResponseData;
    }
  }

  async cancelRequest(requestId: string): Promise<void> {
    if (!requestId) {
      return;
    }

    // Cancel load test if one is running with this ID
    this.cancelLoadTest(requestId);

    try {
      await this.backend.cancelRequest(requestId);
    } catch (error) {
      console.error('[HTTP Service] Failed to cancel request', error);
      throw error;
    }
  }

  private throwIfCancelled(responseStr: string) {
    if (responseStr === this.CANCELLED_RESPONSE) {
      const cancellationError: any = new Error('Request cancelled');
      cancellationError.cancelled = true;
      throw cancellationError;
    }
  }

  private sleep(ms: number): Promise<void> {
    const safe = Number.isFinite(ms) ? Math.max(0, ms) : 0;
    return new Promise(resolve => setTimeout(resolve, safe));
  }

  private parseDurationMs(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
      // Bare numbers are treated as milliseconds for delay-like fields.
      return Math.max(0, value);
    }

    const raw = String(value).trim();
    if (!raw.length) return null;

    // Accept forms like: 250ms, 2s, 1.5m, 1h
    const m = raw.match(/^(-?\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/i);
    if (!m) return null;
    const n = parseFloat(m[1]);
    if (!Number.isFinite(n) || n < 0) return null;
    const unit = (m[2] || 'ms').toLowerCase();
    const mult = unit === 'h' ? 3600000 : unit === 'm' ? 60000 : unit === 's' ? 1000 : 1;
    return Math.round(n * mult);
  }

  private normalizeLoadTestConfig(config: any): {
    iterations: number | null;
    durationMs: number | null;
    startUsers: number;
    maxUsers: number;
    spawnRate: number | null;
    rampUpMs: number | null;
    delayMs: number;
    waitMinMs: number | null;
    waitMaxMs: number | null;
    requestsPerSecond: number | null;
    failureRateThreshold: number | null; // fraction 0..1

    adaptiveEnabled: boolean;
    adaptiveFailureRate: number | null; // fraction 0..1
    adaptiveWindowSec: number;
    adaptiveStableSec: number;
    adaptiveCooldownMs: number;
    adaptiveBackoffStepUsers: number;
  } {
    const toInt = (v: any): number | null => {
      const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
      if (!Number.isFinite(n)) return null;
      return Math.trunc(n);
    };

    const iterations = toInt(config?.iterations);
    const durationMs = this.parseDurationMs(config?.duration);

    const concurrent = toInt(config?.concurrent);
    const users = toInt(config?.users);
    const start = toInt(config?.start);
    const startUsers = toInt(config?.startUsers);
    const max = toInt(config?.max);
    const maxUsers = toInt(config?.maxUsers);

    const startU = Math.max(0, startUsers ?? start ?? concurrent ?? users ?? 1);
    const maxU = Math.max(1, maxUsers ?? max ?? concurrent ?? users ?? 1);
    const normalizedStartUsers = Math.min(startU, maxU);

    const spawnRate = toInt(config?.spawnRate);
    const rampUpMs = this.parseDurationMs(config?.rampUp);

    const delayMs = this.parseDurationMs(config?.delay) ?? 0;
    const waitMinMs = this.parseDurationMs(config?.waitMin);
    const waitMaxMs = this.parseDurationMs(config?.waitMax);

    const rps = toInt(config?.requestsPerSecond);

    const parseFailureRateThreshold = (value: unknown): number | null => {
      if (value === null || value === undefined) return null;
      if (typeof value === 'number' && Number.isFinite(value)) {
        const frac = value > 1 ? value / 100 : value;
        return Math.min(1, Math.max(0, frac));
      }
      const s = String(value).trim();
      if (!s) return null;
      const percent = s.match(/^(-?\d+(?:\.\d+)?)\s*%$/);
      if (percent) {
        const p = parseFloat(percent[1]);
        if (!Number.isFinite(p) || p < 0) return null;
        return Math.min(1, Math.max(0, p / 100));
      }
      const n = parseFloat(s);
      if (!Number.isFinite(n) || n < 0) return null;
      const frac = n > 1 ? n / 100 : n;
      return Math.min(1, Math.max(0, frac));
    };

    const failureRateThreshold = parseFailureRateThreshold(config?.failureRateThreshold);

    const parseBool = (value: unknown): boolean => {
      if (value === true) return true;
      if (value === false) return false;
      if (typeof value === 'number') return value !== 0;
      const s = String(value ?? '').trim().toLowerCase();
      if (!s) return false;
      return ['1', 'true', 'yes', 'y', 'on', 'enable', 'enabled'].includes(s);
    };

    const adaptiveEnabled = parseBool(config?.adaptive);
    const adaptiveFailureRateRaw = parseFailureRateThreshold(config?.adaptiveFailureRate);
    const adaptiveFailureRate = adaptiveEnabled
      ? (adaptiveFailureRateRaw ?? 0.01)
      : null;

    const parseSeconds = (value: unknown, fallbackSec: number): number => {
      const ms = this.parseDurationMs(value);
      if (ms !== null && ms > 0) {
        return Math.max(1, Math.round(ms / 1000));
      }
      const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
      if (Number.isFinite(n) && n > 0) {
        return Math.max(1, Math.trunc(n));
      }
      return fallbackSec;
    };

    const adaptiveWindowSec = parseSeconds(config?.adaptiveWindow, 15);
    const adaptiveStableSec = parseSeconds(config?.adaptiveStable, 20);
    const adaptiveCooldownMs = parseSeconds(config?.adaptiveCooldown, 5) * 1000;
    const adaptiveBackoffStepUsers = Math.max(1, toInt(config?.adaptiveBackoffStep) ?? 2);

    let normalizedIterations = iterations && iterations > 0 ? iterations : null;
    const normalizedDurationMs = durationMs && durationMs > 0 ? durationMs : null;
    if (normalizedIterations === null && normalizedDurationMs === null) {
      normalizedIterations = 10;
    }

    return {
      iterations: normalizedIterations,
      durationMs: normalizedDurationMs,
      startUsers: normalizedStartUsers,
      maxUsers: maxU,
      spawnRate: spawnRate && spawnRate > 0 ? spawnRate : null,
      rampUpMs: rampUpMs && rampUpMs > 0 ? rampUpMs : null,
      delayMs: Math.max(0, delayMs),
      waitMinMs: waitMinMs !== null ? Math.max(0, waitMinMs) : null,
      waitMaxMs: waitMaxMs !== null ? Math.max(0, waitMaxMs) : null,
      requestsPerSecond: rps && rps > 0 ? rps : null,
      failureRateThreshold,

      adaptiveEnabled,
      adaptiveFailureRate,
      adaptiveWindowSec,
      adaptiveStableSec,
      adaptiveCooldownMs,
      adaptiveBackoffStepUsers,
    };
  }

  // Execute load test
  async executeLoadTest(
    request: Request,
    variables: { [key: string]: string } = {},
    env?: string,
    requestId?: string,
    onProgress?: (progress: ActiveRunProgress) => void
  ): Promise<LoadTestResults> {
    const startTime = Date.now();
    const envName = this.normalizeEnvName(env);
    const results: LoadTestResults = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      responseTimes: [],
      errors: [],
      failureStatusCounts: {},
      startTime,
      endTime: 0
    };

    // Clear any previous cancellation state for this request
    if (requestId) {
      this.loadTestCancelled.delete(requestId);
    }

    if (!request.loadTest) {
      throw new Error('No load test configuration');
    }

    const cfg = this.normalizeLoadTestConfig(request.loadTest);
    results.plannedDurationMs = cfg.durationMs;
    let stopAt = cfg.durationMs ? (startTime + cfg.durationMs) : Number.POSITIVE_INFINITY;

    let cancelled = false;
    let aborted = false;
    let abortReason: string | undefined;

    let activeUsers = 0;

    // Adaptive backoff summary (stored on results and copied into metrics later)
    results.adaptive = {
      enabled: cfg.adaptiveEnabled,
      phase: cfg.adaptiveEnabled ? 'ramping' : 'disabled',
    };

    type WindowBucket = { sec: number; sent: number; failed: number };
    const windowBuckets: WindowBucket[] = [];
    const recordWindow = (nowMs: number, isFailure: boolean) => {
      if (!cfg.adaptiveEnabled) return;
      const sec = Math.floor(nowMs / 1000);
      const last = windowBuckets.length ? windowBuckets[windowBuckets.length - 1] : null;
      if (!last || last.sec !== sec) {
        windowBuckets.push({ sec, sent: 0, failed: 0 });
      }
      const bucket = windowBuckets[windowBuckets.length - 1];
      bucket.sent++;
      if (isFailure) bucket.failed++;

      const cutoff = sec - cfg.adaptiveWindowSec - 2;
      while (windowBuckets.length && windowBuckets[0].sec < cutoff) {
        windowBuckets.shift();
      }
    };

    const getWindowStats = (nowMs: number): { sent: number; failed: number; failureRate: number | null; rps: number | null } => {
      if (!cfg.adaptiveEnabled) return { sent: 0, failed: 0, failureRate: null, rps: null };
      const nowSec = Math.floor(nowMs / 1000);
      const minSec = nowSec - cfg.adaptiveWindowSec + 1;
      let sent = 0;
      let failed = 0;
      for (const b of windowBuckets) {
        if (b.sec >= minSec && b.sec <= nowSec) {
          sent += b.sent;
          failed += b.failed;
        }
      }
      if (sent <= 0) {
        return { sent, failed, failureRate: null, rps: null };
      }
      const failureRate = failed / sent;
      const rps = sent / cfg.adaptiveWindowSec;
      return { sent, failed, failureRate, rps };
    };

    let lastProgressEmitAt = 0;
    const emitProgress = (patch: Partial<ActiveRunProgress> = {}, force = false) => {
      if (!requestId || !onProgress) return;
      const now = Date.now();
      if (!force && now - lastProgressEmitAt < 200) return;
      lastProgressEmitAt = now;
      onProgress({
        requestId,
        type: 'load',
        startedAt: startTime,
        plannedDurationMs: cfg.durationMs,
        activeUsers,
        maxUsers: cfg.maxUsers,
        totalSent: results.totalRequests,
        successful: results.successfulRequests,
        failed: results.failedRequests,
        cancelled,
        aborted,
        abortReason,
        ...patch
      });
    };

    const markCancelledIfRequested = () => {
      if (cancelled) return;
      if (requestId && this.loadTestCancelled.has(requestId)) {
        cancelled = true;
        this.loadTestCancelled.delete(requestId);
      }
    };

    const maybeAbortForFailureRate = () => {
      if (aborted || cancelled) return;
      if (cfg.failureRateThreshold === null) return;
      const minSamples = 20;
      if (results.totalRequests < minSamples) return;
      if (results.totalRequests <= 0) return;
      const rate = results.failedRequests / results.totalRequests;
      if (rate >= cfg.failureRateThreshold) {
        aborted = true;
        abortReason = `Failure rate ${(rate * 100).toFixed(1)}% exceeded threshold ${(cfg.failureRateThreshold * 100).toFixed(1)}%`;
      }
    };

    emitProgress({}, true);

    let issuedRequests = 0;
    const reserveRequestSlot = (): boolean => {
      if (cfg.iterations === null) {
        return true;
      }
      if (issuedRequests >= cfg.iterations) {
        return false;
      }
      issuedRequests++;
      return true;
    };

    const bumpFailureStatus = (status: number) => {
      const key = String(status);
      results.failureStatusCounts![key] = (results.failureStatusCounts![key] || 0) + 1;
    };

    // Global RPS limiter (simple spacing limiter)
    const rpsIntervalMs = cfg.requestsPerSecond ? (1000 / cfg.requestsPerSecond) : null;
    let nextAllowedAt = startTime;
    const throttleIfNeeded = async () => {
      if (!rpsIntervalMs) return;
      const now = Date.now();
      const waitMs = Math.max(0, nextAllowedAt - now);
      nextAllowedAt = Math.max(nextAllowedAt, now) + rpsIntervalMs;
      if (waitMs > 0) {
        await this.sleep(waitMs);
      }
    };

    const getPerUserWaitMs = (): number => {
      if (cfg.waitMinMs !== null || cfg.waitMaxMs !== null) {
        const min = cfg.waitMinMs ?? 0;
        const max = cfg.waitMaxMs ?? min;
        const low = Math.min(min, max);
        const high = Math.max(min, max);
        if (high <= low) return low;
        return low + Math.floor(Math.random() * (high - low + 1));
      }
      return cfg.delayMs;
    };

    const runUser = async (userNumber: number) => {
      while (true) {
        markCancelledIfRequested();
        if (cancelled || aborted) {
          return;
        }

        // Adaptive downscale: users with a higher index than the current target exit.
        // (This keeps the control logic simple and avoids forcibly killing requests mid-flight.)
        if (cfg.adaptiveEnabled && userNumber > targetUsers) {
          return;
        }

        const now = Date.now();
        if (now >= stopAt) {
          return;
        }

        if (!reserveRequestSlot()) {
          return;
        }

        results.totalRequests++;
        emitProgress();

        try {
          await throttleIfNeeded();
          markCancelledIfRequested();
          if (cancelled || aborted) {
            return;
          }

          const response = await this.sendRequest(request, variables, undefined, envName);

          const isFailure = response.status === 0 || response.status >= 400;
          recordWindow(Date.now(), isFailure);

          if (isFailure) {
            results.failedRequests++;
            bumpFailureStatus(response.status);
            results.errors.push({
              status: response.status,
              statusText: response.statusText,
              body: response.body
            });
          } else {
            results.successfulRequests++;
          }
          results.responseTimes.push(response.responseTime);
        } catch (error: any) {
          recordWindow(Date.now(), true);
          results.failedRequests++;
          bumpFailureStatus(typeof error?.status === 'number' ? error.status : 0);
          results.errors.push(error);
        }

        maybeAbortForFailureRate();
        if (aborted) {
          emitProgress({}, true);
          return;
        }

        emitProgress();

        const waitMs = getPerUserWaitMs();
        if (waitMs > 0) {
          markCancelledIfRequested();
          if (cancelled || aborted) {
            return;
          }
          await this.sleep(waitMs);
        }
      }
    };

    const runUserTracked = async (userNumber: number) => {
      activeUsers++;
      emitProgress({ activeUsers }, true);
      try {
        await runUser(userNumber);
      } finally {
        activeUsers = Math.max(0, activeUsers - 1);
        emitProgress({ activeUsers }, true);
      }
    };

    // Spawn users (optionally ramping up)
    const userTasks: Promise<void>[] = [];
    let nextUserNumber = 0;
    let targetUsers = cfg.adaptiveEnabled ? cfg.startUsers : cfg.maxUsers;
    const spawnUser = () => {
      const userNumber = ++nextUserNumber;
      userTasks.push(runUserTracked(userNumber));
    };

    for (let i = 0; i < cfg.startUsers; i++) {
      spawnUser();
    }

    const remainingUsers = cfg.maxUsers - cfg.startUsers;
    let allowRamping = true;
    const rampPromise = (async () => {
      if (remainingUsers <= 0) return;

      // Prefer explicit spawnRate; else derive from rampUp duration.
      let rate = cfg.spawnRate;
      if (!rate && cfg.rampUpMs && cfg.rampUpMs > 0) {
        const seconds = cfg.rampUpMs / 1000;
        rate = seconds > 0 ? Math.ceil(remainingUsers / seconds) : remainingUsers;
      }

      if (!rate || rate <= 0) {
        // No ramp parameters: spawn all immediately (unless adaptive stops ramping).
        for (let i = 0; i < remainingUsers; i++) {
          markCancelledIfRequested();
          if (cancelled || aborted) return;
          if (!allowRamping) return;
          if (cfg.adaptiveEnabled) {
            targetUsers = Math.min(cfg.maxUsers, targetUsers + 1);
          }
          spawnUser();
        }
        return;
      }

      const intervalMs = Math.max(1, Math.floor(1000 / rate));
      for (let i = 0; i < remainingUsers; i++) {
        markCancelledIfRequested();
        if (cancelled || aborted) return;
        if (!allowRamping) return;
        if (Date.now() >= stopAt) return;

        if (cfg.adaptiveEnabled) {
          targetUsers = Math.min(cfg.maxUsers, targetUsers + 1);
        }
        spawnUser();
        await this.sleep(intervalMs);
      }
    })();

    // Adaptive controller loop: ramp until failure threshold hit, then back off until stable.
    let lastAdjustAt = 0;
    let stableSince: number | null = null;
    let sawInstability = false;
    const adaptiveController = (async () => {
      if (!cfg.adaptiveEnabled || cfg.adaptiveFailureRate === null) return;
      const minWindowSamples = 20;

      while (true) {
        markCancelledIfRequested();
        if (cancelled || aborted) return;
        const now = Date.now();
        if (now >= stopAt) return;

        const stats = getWindowStats(now);
        if (stats.failureRate === null || stats.sent < minWindowSamples) {
          await this.sleep(500);
          continue;
        }

        if (!sawInstability) {
          if (stats.failureRate > cfg.adaptiveFailureRate) {
            sawInstability = true;
            allowRamping = false;
            results.adaptive = {
              ...(results.adaptive || { enabled: true }),
              enabled: true,
              phase: 'backing_off',
              peakUsers: targetUsers,
              timeToFirstFailureMs: now - startTime,
              backoffSteps: 0,
              peakWindowFailureRate: stats.failureRate,
              peakWindowRps: stats.rps ?? undefined,
            };
            stableSince = null;
            lastAdjustAt = now;
          }
          await this.sleep(500);
          continue;
        }

        // backing off
        if (stats.failureRate > cfg.adaptiveFailureRate) {
          stableSince = null;
          if (now - lastAdjustAt >= cfg.adaptiveCooldownMs) {
            const prev = targetUsers;
            targetUsers = Math.max(1, targetUsers - cfg.adaptiveBackoffStepUsers);
            if (results.adaptive) {
              results.adaptive.backoffSteps = (results.adaptive.backoffSteps ?? 0) + (targetUsers < prev ? 1 : 0);
              results.adaptive.phase = 'backing_off';
            }
            lastAdjustAt = now;
            if (targetUsers <= 1) {
              // Can't back off further; mark as exhausted and stop.
              if (results.adaptive) {
                results.adaptive.phase = 'exhausted';
              }
              stopAt = now;
              return;
            }
          }
          await this.sleep(500);
          continue;
        }

        // currently healthy in window
        if (stableSince === null) {
          stableSince = now;
        }
        if (now - stableSince >= cfg.adaptiveStableSec * 1000) {
          if (results.adaptive) {
            results.adaptive.stabilized = true;
            results.adaptive.phase = 'stable';
            results.adaptive.stableUsers = targetUsers;
            results.adaptive.stableWindowFailureRate = stats.failureRate;
            results.adaptive.stableWindowRps = stats.rps ?? undefined;
          }
          // Stop once stable (per your request).
          stopAt = now;
          return;
        }

        await this.sleep(500);
      }
    })();

    try {
      await Promise.all([rampPromise, adaptiveController]);
      await Promise.all(userTasks);
    } finally {
      results.endTime = Date.now();
      markCancelledIfRequested();
      results.cancelled = cancelled;
      results.aborted = aborted;
      results.abortReason = abortReason;
      emitProgress({ done: true }, true);
    }

    return results;
  }

  // Calculate load test metrics
  calculateLoadTestMetrics(results: LoadTestResults): LoadTestMetrics {
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

  private normalizeEnvName(env?: string): string {
    const trimmed = (env || '').trim();
    return trimmed.length ? trimmed : 'default';
  }

  private async hydrateText(value: string, variables: { [key: string]: string }, env: string): Promise<string> {
    if (!value) {
      return value;
    }
    const withSecrets = await this.secretService.replaceSecrets(value, env);
    return this.replaceVariables(withSecrets, variables);
  }

  private async hydrateHeaders(
    headers: { [key: string]: string } | undefined,
    variables: { [key: string]: string },
    env: string
  ): Promise<{ [key: string]: string }> {
    const source = headers || {};
    const result: { [key: string]: string } = {};
    for (const [key, value] of Object.entries(source)) {
      result[key] = await this.hydrateText(value, variables, env);
    }
    return result;
  }

  private async prepareBackendRequest(
    req: Request,
    variables: { [key: string]: string },
    env: string
  ): Promise<{ backend: Record<string, any>; preview: RequestPreview }> {
    const url = await this.hydrateText(req.url, variables, env);
    const headers = await this.hydrateHeaders(req.headers, variables, env);
    let body = '';
    let bodyPlaceholder: string | undefined;
    if (req.body && !(req.body instanceof FormData)) {
      body = await this.hydrateText(String(req.body), variables, env);
    } else if (req.body instanceof FormData) {
      bodyPlaceholder = '[FormData]';
    }

    const backend = {
      method: req.method,
      url,
      headers,
      body,
      preScript: req.preScript,
      postScript: req.postScript
    };

    const preview: RequestPreview = {
      name: req.name,
      method: req.method,
      url,
      headers: { ...headers },
      body: body || bodyPlaceholder
    };

    return { backend, preview };
  }
}