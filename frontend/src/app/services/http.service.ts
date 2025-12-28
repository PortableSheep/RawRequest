import { Injectable, inject } from '@angular/core';
import {
  AssertionResult,
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
import { EventsOn } from '@wailsjs/runtime/runtime';
import { parseGoResponse as parseGoResponseHelper } from './http/go-response';
import { calculateLoadTestMetrics as calculateLoadTestMetricsHelper } from './http/load-test-metrics';
import { executeLoadTestViaBackend as executeLoadTestViaBackendHelper } from './http/load-test-backend';
import { throwIfCancelledResponse } from './http/cancellation';
import {
  hydrateHeaders as hydrateHeadersHelper,
  hydrateHeadersSecretsOnly as hydrateHeadersSecretsOnlyHelper,
  hydrateText as hydrateTextHelper,
  hydrateTextSecretsOnly as hydrateTextSecretsOnlyHelper,
  normalizeEnvName as normalizeEnvNameHelper
} from './http/hydration';
import { runScript } from './http/script-runner';
import {
  prepareBackendRequestForChain as prepareBackendRequestForChainHelper
} from './http/request-prep';
import { parseConcatenatedChainResponses } from './http/chain-response-parser';
import { syncInitialVariablesToBackend } from './http/backend-variable-sync';
import { loadFileTabsFromStorage, saveFileTabsToStorage } from './http/file-tabs-storage';
import {
  addToHistory as addToHistoryHelper,
  loadHistory as loadHistoryHelper,
  saveHistorySnapshot as saveHistorySnapshotHelper
} from './http/history-storage';
import { sendRequest as sendRequestHelper } from './http/send-request';
import { executeChain as executeChainHelper } from './http/execute-chain';

@Injectable({
  providedIn: 'root'
})
export class HttpService {
  private readonly backend = inject(BackendClientService);
  private readonly scriptConsole = inject(ScriptConsoleService);
  private readonly secretService = inject(SecretService);

  private readonly FILES_KEY = 'rawrequest_files';
  private readonly CANCELLED_RESPONSE = '__CANCELLED__';

  constructor() {
    this.scriptConsole.init().catch(() => {
      // Console UI will surface errors; swallow to avoid blocking requests
    });
  }

  cancelLoadTest(requestId: string): void {
    // Backend owns load orchestration and cancellation.
    this.backend.cancelRequest(requestId).catch(() => {
      // Swallow errors to keep cancel UX responsive.
    });
  }

  private async executeLoadTestViaBackend(
    request: Request,
    variables: { [key: string]: string } = {},
    env?: string,
    requestId?: string,
    onProgress?: (progress: ActiveRunProgress) => void
  ): Promise<LoadTestResults> {
    return await executeLoadTestViaBackendHelper(request, variables, env, requestId, onProgress, {
      backend: {
        startLoadTest: (id, method, url, headersJson, body, loadTestJson) =>
          this.backend.startLoadTest(id, method, url, headersJson, body, loadTestJson),
      },
      eventsOn: EventsOn,
      normalizeEnvName: (e) => this.normalizeEnvName(e),
      hydrateText: (text, vars, envName) => this.hydrateText(text, vars, envName),
      hydrateHeaders: (headers, vars, envName) => this.hydrateHeaders(headers, vars, envName),
    });
  }

  async sendRequest(
    request: Request,
    variables: { [key: string]: string } = {},
    requestId?: string,
    env?: string
  ): Promise<ResponseData & { processedUrl: string; requestPreview: RequestPreview }> {
    return await sendRequestHelper(request, variables, requestId, env, {
      backend: {
        sendRequest: (method, url, headersJson, bodyStr) => this.backend.sendRequest(method, url, headersJson, bodyStr),
        sendRequestWithID: (id, method, url, headersJson, bodyStr) =>
          this.backend.sendRequestWithID(id, method, url, headersJson, bodyStr),
        sendRequestWithTimeout: (id, method, url, headersJson, bodyStr, timeoutMs) =>
          this.backend.sendRequestWithTimeout(id, method, url, headersJson, bodyStr, timeoutMs),
      },
      now: () => Date.now(),
      normalizeEnvName: (e) => this.normalizeEnvName(e),
      hydrateText: (value, vars, envName) => this.hydrateText(value, vars, envName),
      hydrateHeaders: (headers, vars, envName) => this.hydrateHeaders(headers, vars, envName),
      executeScript: (script, context, stage) => this.executeScript(script, context, stage),
      parseGoResponse: (s, t) => this.parseGoResponse(s, t),
      throwIfCancelled: (s) => this.throwIfCancelled(s),
      log: { debug: console.log },
    });
  }

  private parseGoResponse(responseStr: string, responseTime: number): ResponseData {
    return parseGoResponseHelper(responseStr, responseTime);
  }

  private async executeScript(script: string, context: any, stage: 'pre' | 'post' | 'custom' = 'custom'): Promise<AssertionResult[]> {
    return await runScript(script, context, stage, {
      cleanScript: (raw) => cleanScriptContent(raw),
      recordConsole: (level, source, message) => {
        void this.scriptConsole.record(level, source, message);
      },
      setVariable: (key, value) => this.backend.setVariable(key, value),
    });
  }

  // History management
  async loadHistory(fileId: string, filePath?: string): Promise<HistoryItem[]> {
    return await loadHistoryHelper(fileId, filePath, {
      backend: this.backend,
      dirname,
      log: { error: console.error }
    } as any);
  }

  async saveHistorySnapshot(fileId: string, history: HistoryItem[], filePath?: string): Promise<void> {
    return await saveHistorySnapshotHelper(fileId, history, filePath, {
      backend: this.backend,
      dirname,
      log: { error: console.error }
    } as any);
  }

  async addToHistory(fileId: string, item: HistoryItem, filePath?: string, maxItems: number = 100): Promise<HistoryItem[]> {
    return await addToHistoryHelper(fileId, item, filePath, maxItems, {
      backend: this.backend,
      dirname,
      log: { error: console.error, warn: console.warn, debug: console.debug }
    } as any);
  }

  // File management
  loadFiles(): FileTab[] {
    return loadFileTabsFromStorage(this.FILES_KEY, localStorage, { error: console.error });
  }

  saveFiles(files: FileTab[]): void {
    saveFileTabsToStorage(this.FILES_KEY, files, localStorage, { error: console.error });
  }

  // Execute chained requests using Go backend
  async executeChain(
    requests: Request[],
    variables: { [key: string]: string } = {},
    requestId?: string,
    env?: string
  ): Promise<{ responses: ResponseData[]; requestPreviews: RequestPreview[] }> {
    return await executeChainHelper(requests, variables, requestId, env, {
      backend: {
        executeRequests: (r) => this.backend.executeRequests(r),
        executeRequestsWithID: (id, r) => this.backend.executeRequestsWithID(id, r),
        setVariable: (key, value) => this.backend.setVariable(key, value),
      },
      normalizeEnvName: (e) => this.normalizeEnvName(e),
      syncInitialVariablesToBackend,
      prepareBackendRequestForChain: (req, envName) => this.prepareBackendRequestForChain(req, envName),
      parseConcatenatedChainResponses,
      parseGoResponse: (s, t) => this.parseGoResponse(s, t),
      throwIfCancelled: (s) => this.throwIfCancelled(s),
      log: { log: console.log, error: console.error, warn: console.warn },
    });
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
    throwIfCancelledResponse(responseStr, this.CANCELLED_RESPONSE);
  }

  // Execute load test
  async executeLoadTest(
    request: Request,
    variables: { [key: string]: string } = {},
    env?: string,
    requestId?: string,
    onProgress?: (progress: ActiveRunProgress) => void
  ): Promise<LoadTestResults> {
    if (!requestId) {
      throw new Error('Load testing requires a requestId');
    }
    return await this.executeLoadTestViaBackend(request, variables, env, requestId, onProgress);
  }

  // Calculate load test metrics
  calculateLoadTestMetrics(results: LoadTestResults): LoadTestMetrics {
    return calculateLoadTestMetricsHelper(results);
  }

  private normalizeEnvName(env?: string): string {
    return normalizeEnvNameHelper(env);
  }

  private async hydrateText(value: string, variables: { [key: string]: string }, env: string): Promise<string> {
    return await hydrateTextHelper(value, variables, env, (text, e) => this.secretService.replaceSecrets(text, e));
  }

  private async hydrateTextSecretsOnly(value: string, env: string): Promise<string> {
    return await hydrateTextSecretsOnlyHelper(value, env, (text, e) => this.secretService.replaceSecrets(text, e));
  }

  private async hydrateHeadersSecretsOnly(
    headers: { [key: string]: string } | undefined,
    env: string
  ): Promise<{ [key: string]: string }> {
    return await hydrateHeadersSecretsOnlyHelper(headers, env, (text, e) => this.secretService.replaceSecrets(text, e));
  }

  private async hydrateHeaders(
    headers: { [key: string]: string } | undefined,
    variables: { [key: string]: string },
    env: string
  ): Promise<{ [key: string]: string }> {
    return await hydrateHeadersHelper(headers, variables, env, (text, e) => this.secretService.replaceSecrets(text, e));
  }

  private async prepareBackendRequestForChain(
    req: Request,
    env: string
  ): Promise<{ backend: Record<string, any>; preview: RequestPreview }> {
    return await prepareBackendRequestForChainHelper(req, env, {
      hydrateTextSecretsOnly: (value, e) => this.hydrateTextSecretsOnly(value, e),
      hydrateHeadersSecretsOnly: (headers, e) => this.hydrateHeadersSecretsOnly(headers, e),
    });
  }
}