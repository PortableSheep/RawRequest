import { Injectable, inject } from '@angular/core';
import { Subject } from 'rxjs';

import { HttpService } from './http.service';
import { NotificationService } from './notification.service';
import { MockServerService } from './mock-server.service';
import { WorkspaceStateService } from './workspace-state.service';
import {
  Request,
  FileTab,
  ResponseData,
  HistoryItem,
  RequestPreview,
  ChainEntryPreview,
  ResponsePreview,
  ActiveRunProgress
} from '../models/http.models';
import { getActiveEnvNameForFile, getCombinedVariablesForFile } from './request-manager/env-vars';
import { buildRequestChain } from './request-manager/request-chain';
import { buildChainItems, ensureRequestPreview, toResponsePreview } from './request-manager/chain-items';
import {
  applyResponseDataForRequest,
  buildCancelledResponse,
  buildFailureResponse,
  buildHistoryItem,
  buildLoadTestSummaryResponse,
  buildRequestId,
  decideLoadTestStatusText,
  shouldSkipDuplicateExecution
} from './request-manager/request-manager.logic';

/**
 * Orchestrates request execution (single, chained, and load-test requests).
 *
 * This replaces the former `RequestManagerComponent` — a component with an
 * empty template that existed only to be looked up via `@ViewChild` and
 * registered as a delegate on `RequestExecutionService`. As a plain
 * injectable service it reads workspace state directly from
 * `WorkspaceStateService` instead of receiving `files`/`currentFileIndex`/
 * `currentEnv` as component inputs, and pushes file/history updates back
 * through `WorkspaceStateService` directly instead of round-tripping through
 * component outputs and `AppComponent` handlers. `RequestExecutionService`
 * subscribes to `requestExecuted$`/`requestProgress$` to stay in sync,
 * removing the `@ViewChild` + `setDelegate` lifecycle/timing coupling.
 */
@Injectable({
  providedIn: 'root'
})
export class RequestManagerService {
  private readonly httpService = inject(HttpService);
  private readonly notificationService = inject(NotificationService);
  private readonly mockServer = inject(MockServerService);
  private readonly ws = inject(WorkspaceStateService);

  readonly requestExecuted = new Subject<{ requestIndex: number; response: ResponseData }>();
  readonly requestProgress = new Subject<ActiveRunProgress>();

  private history: HistoryItem[] = [];
  private executingRequest = false;
  private activeRequestId: string | null = null;
  private lastExecutedRequestIndex: number | null = null;

  private files(): FileTab[] {
    return this.ws.files();
  }

  private currentFileIndex(): number {
    return this.ws.currentFileIndex();
  }

  private currentEnv(): string {
    return this.ws.currentEnv();
  }

  async executeRequestByIndex(requestIndex: number, requestId?: string): Promise<void> {
    if (
      shouldSkipDuplicateExecution({
        executingRequest: this.executingRequest,
        lastExecutedRequestIndex: this.lastExecutedRequestIndex,
        requestIndex
      })
    ) {
      return;
    }

    this.lastExecutedRequestIndex = requestIndex;
    await this.executeRequest(requestIndex, requestId);
  }

  async executeRequest(requestIndex: number, requestId?: string): Promise<void> {
    const currentFile = this.files()[this.currentFileIndex()];
    if (!currentFile || !currentFile.requests[requestIndex]) return;

    if (this.executingRequest) return;
    this.executingRequest = true;

    const rawRequest = currentFile.requests[requestIndex];
    const request = { ...rawRequest };
    const variables = this.getCombinedVariables();
    const envName = this.getActiveEnvName();
    this.activeRequestId = requestId ?? buildRequestId(currentFile.id, requestIndex, Date.now());

    try {
      if (request.url && request.url.startsWith('/')) {
        const mockStatus = this.mockServer.status();
        if (mockStatus.running) {
          request.url = `http://localhost:${mockStatus.port}${request.url}`;
        } else {
          const offlineErr = new Error(`Relative URL '${request.url}' requires a running mock server. Click the 'Mock Server' button in the top toolbar to configure and start it.`);
          (offlineErr as any).statusText = 'Mock Server Offline';
          throw offlineErr;
        }
      }

      if (request.loadTest) {
        await this.executeLoadTest(requestIndex, request, envName, this.activeRequestId);
        return;
      }

      if (request.depends) {
        await this.executeChainedRequest(requestIndex, request, envName, this.activeRequestId ?? undefined);
        return;
      }

      const response = await this.httpService.sendRequest(request, variables, this.activeRequestId ?? undefined, envName);
      const chainItems = this.buildChainItems([request], [response.requestPreview], [response], 0);
      const responseWithChain = { ...response, chainItems };

      const updatedFiles = applyResponseDataForRequest(this.files(), this.currentFileIndex(), requestIndex, responseWithChain);
      this.ws.onFilesChange(updatedFiles);

      const historyItem: HistoryItem = buildHistoryItem({
        now: new Date(),
        method: request.method,
        fallbackUrl: request.url,
        response: responseWithChain
      });

      await this.pushHistoryEntry(currentFile.id, historyItem, currentFile.filePath, { noHistory: request.noHistory });

      this.notificationService.notifyRequestComplete(request.name, response.status, response.responseTime);
      this.requestExecuted.next({ requestIndex, response: responseWithChain });
    } catch (error: any) {
      if (this.isCancellationError(error)) {
        this.handleCancelledRequest(currentFile.id, request, requestIndex);
        return;
      }
      const errorResponse = buildFailureResponse({
        error,
        fallbackStatusText: 'Network Error',
        fallbackBody: 'Unknown error'
      });

      const errorChain = this.buildChainItems([request], [errorResponse.requestPreview], [errorResponse], 0);
      const decoratedError = { ...errorResponse, chainItems: errorChain };

      const updatedFiles = applyResponseDataForRequest(this.files(), this.currentFileIndex(), requestIndex, decoratedError);
      this.ws.onFilesChange(updatedFiles);

      const errorHistoryItem: HistoryItem = buildHistoryItem({
        now: new Date(),
        method: request.method,
        fallbackUrl: request.url,
        response: decoratedError
      });
      await this.pushHistoryEntry(currentFile.id, errorHistoryItem, currentFile.filePath, { noHistory: request.noHistory });

      this.requestExecuted.next({ requestIndex, response: decoratedError });
    } finally {
      this.executingRequest = false;
      this.activeRequestId = null;
    }
  }

  private getCombinedVariables(): { [key: string]: string } {
    const currentFile = this.files()[this.currentFileIndex()];
    return getCombinedVariablesForFile(currentFile, this.currentEnv());
  }

  private getActiveEnvName(): string {
    const currentFile = this.files()[this.currentFileIndex()];
    return getActiveEnvNameForFile(currentFile, this.currentEnv());
  }

  private async executeChainedRequest(requestIndex: number, request: Request, envName: string, requestId?: string): Promise<void> {
    const currentFile = this.files()[this.currentFileIndex()];
    const variables = this.getCombinedVariables();

    try {
      const chain = this.buildRequestChain(requestIndex).map(r => {
        const cloned = { ...r };
        if (cloned.url && cloned.url.startsWith('/')) {
          const mockStatus = this.mockServer.status();
          if (mockStatus.running) {
            cloned.url = `http://localhost:${mockStatus.port}${cloned.url}`;
          } else {
            const offlineErr = new Error(`Relative URL '${cloned.url}' in chained request '${cloned.name || ''}' requires a running mock server. Click the 'Mock Server' button in the top toolbar to configure and start it.`);
            (offlineErr as any).statusText = 'Mock Server Offline';
            throw offlineErr;
          }
        }
        return cloned;
      });
      const chainHasNoHistory = chain.some(r => r.noHistory);

      const execution = await this.httpService.executeChain(chain, variables, requestId, envName);
      const responses = execution.responses;

      const lastResponse = responses[responses.length - 1];
      const primaryIndex = Math.max(0, responses.length - 1);
      const chainItems = this.buildChainItems(chain, execution.requestPreviews, responses, primaryIndex);
      const decoratedLastResponse = { ...lastResponse, chainItems };

      const updatedFiles = applyResponseDataForRequest(this.files(), this.currentFileIndex(), requestIndex, decoratedLastResponse);
      this.ws.onFilesChange(updatedFiles);

      const historyItem: HistoryItem = buildHistoryItem({
        now: new Date(),
        method: request.method,
        fallbackUrl: request.url,
        response: decoratedLastResponse
      });

      await this.pushHistoryEntry(currentFile.id, historyItem, currentFile.filePath, { noHistory: chainHasNoHistory });

      const totalDuration = responses.reduce((sum, r) => sum + (r?.responseTime || 0), 0);
      const allSuccessful = responses.every(r => r && r.status >= 200 && r.status < 300);
      this.notificationService.notifyChainComplete(responses.length, totalDuration, allSuccessful);

      this.requestExecuted.next({ requestIndex, response: decoratedLastResponse });
    } catch (error: any) {
      if (this.isCancellationError(error)) {
        this.handleCancelledRequest(currentFile.id, request, requestIndex);
        return;
      }
      console.error('[RequestManager] Chained request error:', error);
      const errorResponse = buildFailureResponse({
        error,
        fallbackStatusText: 'Chain Error',
        fallbackBody: 'Chain execution failed'
      });

      const updatedFiles = applyResponseDataForRequest(this.files(), this.currentFileIndex(), requestIndex, errorResponse);
      this.ws.onFilesChange(updatedFiles);

      this.requestExecuted.next({ requestIndex, response: errorResponse });
    } finally {
      this.executingRequest = false;
    }
  }

  private buildRequestChain(requestIndex: number): Request[] {
    const currentFile = this.files()[this.currentFileIndex()];
    return buildRequestChain(currentFile.requests, requestIndex);
  }

  private buildChainItems(
    chain: Request[],
    previews: Array<RequestPreview | undefined | null>,
    responses: Array<ResponseData | null | undefined>,
    primaryIndex: number
  ): ChainEntryPreview[] {
    return buildChainItems(chain, previews, responses, primaryIndex);
  }

  private ensureRequestPreview(request: Request, preview?: RequestPreview | null): RequestPreview {
    return ensureRequestPreview(request, preview);
  }

  private toResponsePreview(response?: ResponseData | null): ResponsePreview | null {
    return toResponsePreview(response);
  }

  // Execute load test
  private async executeLoadTest(requestIndex: number, request: Request, envName: string, requestId: string): Promise<void> {
    const currentFile = this.files()[this.currentFileIndex()];
    const variables = this.getCombinedVariables();

    try {
      const results = await this.httpService.executeLoadTest(
        request,
        variables,
        envName,
        requestId,
        progress => this.requestProgress.next(progress)
      );
      const metrics = this.httpService.calculateLoadTestMetrics(results);

      const statusText = decideLoadTestStatusText(results);

      const summaryResponse: ResponseData = buildLoadTestSummaryResponse({
        metrics,
        results,
        statusText,
        method: request.method,
        url: request.url,
        name: request.name
      });

      const updatedFiles = applyResponseDataForRequest(this.files(), this.currentFileIndex(), requestIndex, summaryResponse);
      this.ws.onFilesChange(updatedFiles);

      // Emit results for display in modal
      this.requestExecuted.next({
        requestIndex,
        response: { ...summaryResponse, loadTestMetrics: metrics } as any
      });

      // Add to history
      const historyItem: HistoryItem = buildHistoryItem({
        now: new Date(),
        method: request.method + ' (Load Test)',
        fallbackUrl: request.url,
        response: summaryResponse
      });

      await this.pushHistoryEntry(currentFile.id, historyItem, currentFile.filePath, { noHistory: request.noHistory });

      // Send notification if app is in background
      this.notificationService.notifyLoadTestComplete(
        request.name,
        metrics.totalRequests,
        results.endTime - results.startTime,
        metrics.averageResponseTime
      );

    } catch (error: any) {
      const errorResponse: ResponseData = buildFailureResponse({
        error,
        fallbackStatusText: 'Load Test Error',
        fallbackBody: 'Load test failed'
      });

      const updatedFiles = applyResponseDataForRequest(this.files(), this.currentFileIndex(), requestIndex, errorResponse);
      this.ws.onFilesChange(updatedFiles);

      this.requestExecuted.next({ requestIndex, response: errorResponse });
    } finally {
      this.executingRequest = false;
    }
  }

  private async pushHistoryEntry(fileId: string, entry: HistoryItem, filePath?: string, options?: { noHistory?: boolean }) {
    const history = await this.httpService.addToHistory(fileId, entry, filePath, options);
    this.history = history;
    this.ws.onHistoryUpdated({ fileId, history });
  }

  async cancelActiveRequest(): Promise<void> {
    if (!this.activeRequestId) {
      return;
    }

    await this.httpService.cancelRequest(this.activeRequestId);
  }

  private createRequestId(fileId: string, requestIndex: number): string {
    return buildRequestId(fileId, requestIndex, Date.now());
  }

  private isCancellationError(error: any): boolean {
    return !!error?.cancelled;
  }

  private handleCancelledRequest(fileId: string, request: Request, requestIndex: number) {
    const cancelledResponse = buildCancelledResponse();

    const updatedFiles = applyResponseDataForRequest(this.files(), this.currentFileIndex(), requestIndex, cancelledResponse);
    this.ws.onFilesChange(updatedFiles);

    this.requestExecuted.next({ requestIndex, response: cancelledResponse });
  }
}
