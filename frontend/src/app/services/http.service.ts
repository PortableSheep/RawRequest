import { Injectable, inject } from '@angular/core';
import {
  Request,
  ResponseData,
  FileTab,
  HistoryItem,
  LoadTestResults,
  LoadTestMetrics,
  RequestPreview
} from '../models/http.models';
import { cleanScriptContent } from '../utils/script-cleaner.generated';
import {
  SendRequest,
  ExecuteRequests,
  SetVariable,
  GetVariable,
  SaveFileHistory,
  LoadFileHistory,
  SendRequestWithID,
  ExecuteRequestsWithID,
  CancelRequest as CancelBackendRequest
} from '../../../wailsjs/go/main/App';
import { ScriptConsoleService } from './script-console.service';
import { SecretService } from './secret.service';

@Injectable({
  providedIn: 'root'
})
export class HttpService {
  private readonly scriptConsole = inject(ScriptConsoleService);
  private readonly secretService = inject(SecretService);

  private readonly FILES_KEY = 'rawrequest_files';
  private readonly CANCELLED_RESPONSE = '__CANCELLED__';

  constructor() {
    this.scriptConsole.init().catch(() => {
      // Console UI will surface errors; swallow to avoid blocking requests
    });
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
      // Replace secrets + variables in URL, headers, and body
      processedUrl = await this.hydrateText(request.url, variables, envName);
      processedHeaders = await this.hydrateHeaders(request.headers, variables, envName);
      if (request.body && !(request.body instanceof FormData)) {
        processedBody = await this.hydrateText(String(request.body), variables, envName);
      } else if (request.body instanceof FormData) {
        bodyPlaceholder = '[FormData]';
      }

      // Execute pre-script if present
      if (request.preScript) {
        await this.executeScript(request.preScript, { request, variables }, 'pre');
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
        ? await SendRequestWithID(requestId, request.method, processedUrl, headersJson, bodyStr)
        : await SendRequest(request.method, processedUrl, headersJson, bodyStr);

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
        SetVariable(key, stringValue).catch(err => console.error('Failed to sync variable:', err));
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

      const func = new Function(
        'context',
        'setVar',
        'getVar',
        'console',
        'setHeader',
        'updateRequest',
        'assert',
        'delay',
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
        delayFn
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
  async loadHistory(fileId: string): Promise<HistoryItem[]> {
    if (!fileId) {
      return [];
    }
    try {
      const stored = await LoadFileHistory(fileId);
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

  private async saveHistory(fileId: string, history: HistoryItem[]): Promise<void> {
    if (!fileId) {
      return;
    }
    try {
      await SaveFileHistory(fileId, JSON.stringify(history));
    } catch (error) {
      console.error('Error saving history for file', fileId, error);
    }
  }

  async addToHistory(fileId: string, item: HistoryItem, maxItems: number = 100): Promise<HistoryItem[]> {
    const history = await this.loadHistory(fileId);
    history.unshift(item);
    if (history.length > maxItems) {
      history.splice(maxItems);
    }
    await this.saveHistory(fileId, history);
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
        ? await ExecuteRequestsWithID(requestId, requestsData)
        : await ExecuteRequests(requestsData);

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

    try {
      await CancelBackendRequest(requestId);
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

  // Execute load test
  async executeLoadTest(
    request: Request,
    variables: { [key: string]: string } = {},
    env?: string
  ): Promise<LoadTestResults> {
    const startTime = Date.now();
    const envName = this.normalizeEnvName(env);
    const results: LoadTestResults = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      responseTimes: [],
      errors: [],
      startTime,
      endTime: 0
    };

    if (!request.loadTest) {
      throw new Error('No load test configuration');
    }

    const config = request.loadTest;
    const iterations = config.iterations || 10;
    const concurrent = config.concurrent || 1;

    // Execute requests in batches
    const batches = Math.ceil(iterations / concurrent);

    for (let batch = 0; batch < batches; batch++) {
      const batchSize = Math.min(concurrent, iterations - batch * concurrent);
      const promises: Promise<any>[] = [];

      for (let i = 0; i < batchSize; i++) {
        const promise = this.sendRequest(request, variables, undefined, envName)
          .then(response => {
            results.successfulRequests++;
            results.responseTimes.push(response.responseTime);
          })
          .catch(error => {
            results.failedRequests++;
            results.errors.push(error);
          });
        promises.push(promise);
        results.totalRequests++;
      }

      await Promise.all(promises);
    }

    results.endTime = Date.now();
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
      requestsPerSecond: results.totalRequests / duration,
      averageResponseTime: sortedTimes.reduce((a, b) => a + b, 0) / sortedTimes.length || 0,
      p50: sortedTimes[Math.floor(sortedTimes.length * 0.5)] || 0,
      p95: sortedTimes[Math.floor(sortedTimes.length * 0.95)] || 0,
      p99: sortedTimes[Math.floor(sortedTimes.length * 0.99)] || 0,
      minResponseTime: sortedTimes[0] || 0,
      maxResponseTime: sortedTimes[sortedTimes.length - 1] || 0,
      errorRate: (results.failedRequests / results.totalRequests) * 100 || 0,
      duration
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
      postScript: req.postScript,
      assertions: req.assertions
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