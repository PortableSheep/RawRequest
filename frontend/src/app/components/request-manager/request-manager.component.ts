import { Component, input, output, inject } from '@angular/core';

import { HttpService } from '../../services/http.service';
import { NotificationService } from '../../services/notification.service';
import {
  Request,
  FileTab,
  ResponseData,
  HistoryItem,
  RequestPreview,
  ChainEntryPreview,
  ResponsePreview,
  ActiveRunProgress
} from '../../models/http.models';
import { getActiveEnvNameForFile, getCombinedVariablesForFile } from './env-vars';
import { buildRequestChain } from './request-chain';
import { buildChainItems, ensureRequestPreview, toResponsePreview } from './chain-items';
import {
  applyResponseDataForRequest,
  buildCancelledResponse,
  buildFailureResponse,
  buildHistoryItem,
  buildLoadTestSummaryResponse,
  buildRequestId,
  decideLoadTestStatusText,
  shouldSkipDuplicateExecution
} from './request-manager.logic';

@Component({
  selector: 'app-request-manager',
  standalone: true,
  imports: [],
  template: ``,
  styles: []
})
export class RequestManagerComponent {
  private httpService = inject(HttpService);
  private notificationService = inject(NotificationService);

  // Inputs
  files = input.required<FileTab[]>();
  currentFileIndex = input.required<number>();
  currentEnv = input.required<string>();

  // Outputs
  filesChange = output<FileTab[]>();
  currentFileIndexChange = output<number>();
  currentEnvChange = output<string>();
  requestExecuted = output<{ requestIndex: number; response: ResponseData }>();
  requestProgress = output<ActiveRunProgress>();
  historyUpdated = output<{ fileId: string; history: HistoryItem[] }>();

  private history: HistoryItem[] = [];
  private executingRequest = false;
  private activeRequestId: string | null = null;
  private lastExecutedRequestIndex: number | null = null;

  // Execute a request by index
  async executeRequestByIndex(requestIndex: number, requestId?: string): Promise<void> {
    // Prevent duplicate execution of the same request
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

  // Request execution
  async executeRequest(requestIndex: number, requestId?: string): Promise<void> {
    const currentFile = this.files()[this.currentFileIndex()];
    if (!currentFile || !currentFile.requests[requestIndex]) return;

    if (this.executingRequest) return; // Prevent duplicate execution
    this.executingRequest = true;

    const request = currentFile.requests[requestIndex];
    const variables = this.getCombinedVariables();
    const envName = this.getActiveEnvName();
    this.activeRequestId = requestId ?? buildRequestId(currentFile.id, requestIndex, Date.now());

    try {
      // Check if this is a load test
      if (request.loadTest) {
        await this.executeLoadTest(requestIndex, envName, this.activeRequestId);
        return;
      }

      // Check if this is a chained request
      if (request.depends) {
        await this.executeChainedRequest(requestIndex, envName, this.activeRequestId ?? undefined);
        return;
      }

      // Regular single request
      const response = await this.httpService.sendRequest(request, variables, this.activeRequestId ?? undefined, envName);
      const chainItems = this.buildChainItems([request], [response.requestPreview], [response], 0);
      const responseWithChain = { ...response, chainItems };

      // Update response data
      const updatedFiles = applyResponseDataForRequest(this.files(), this.currentFileIndex(), requestIndex, responseWithChain);
      this.filesChange.emit(updatedFiles);

      const historyItem: HistoryItem = buildHistoryItem({
        now: new Date(),
        method: request.method,
        fallbackUrl: request.url,
        response: responseWithChain
      });

      console.log('[RequestManager] Adding to history:', historyItem);
      await this.pushHistoryEntry(currentFile.id, historyItem, currentFile.filePath);
      // Save a response file next to the http file (if present)
      try {
        const { SaveResponseFile } = await import('@wailsjs/go/main/App');
        if (currentFile.filePath) {
          const saved = await SaveResponseFile(currentFile.filePath, JSON.stringify(responseWithChain, null, 2));
          console.log('Saved response file:', saved);
        }
      } catch (err) {
        console.warn('Failed to save response file:', err);
      }

      // Send notification if app is in background
      this.notificationService.notifyRequestComplete(request.name, response.status, response.responseTime);

      // Emit execution result
      this.requestExecuted.emit({ requestIndex, response: responseWithChain });
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
      this.filesChange.emit(updatedFiles);

      // Add error to history too
      const errorHistoryItem: HistoryItem = buildHistoryItem({
        now: new Date(),
        method: request.method,
        fallbackUrl: request.url,
        response: decoratedError
      });
      await this.pushHistoryEntry(currentFile.id, errorHistoryItem, currentFile.filePath);

      this.requestExecuted.emit({ requestIndex, response: decoratedError });
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

  // Execute chained requests
  private async executeChainedRequest(requestIndex: number, envName: string, requestId?: string): Promise<void> {
    const currentFile = this.files()[this.currentFileIndex()];
    const request = currentFile.requests[requestIndex];
    const variables = this.getCombinedVariables();

    try {
      console.log('[RequestManager] Executing chained request:', requestIndex);

      // Find all requests in the chain
      const chain = this.buildRequestChain(requestIndex);
      console.log('[RequestManager] Built chain with', chain.length, 'requests:', chain.map(r => r.name));

      // Execute the chain using Go backend
      const execution = await this.httpService.executeChain(chain, variables, requestId, envName);
      const responses = execution.responses;
      console.log('[RequestManager] Chain execution completed with', responses.length, 'responses');

      const lastResponse = responses[responses.length - 1];
      const primaryIndex = Math.max(0, responses.length - 1);
      const chainItems = this.buildChainItems(chain, execution.requestPreviews, responses, primaryIndex);
      const decoratedLastResponse = { ...lastResponse, chainItems };

      const updatedFiles = applyResponseDataForRequest(this.files(), this.currentFileIndex(), requestIndex, decoratedLastResponse);
      this.filesChange.emit(updatedFiles);

      // Add to history
      const historyItem: HistoryItem = buildHistoryItem({
        now: new Date(),
        method: request.method,
        fallbackUrl: request.url,
        response: decoratedLastResponse
      });

      await this.pushHistoryEntry(currentFile.id, historyItem, currentFile.filePath);

      // Send notification if app is in background
      const totalDuration = responses.reduce((sum, r) => sum + (r?.responseTime || 0), 0);
      const allSuccessful = responses.every(r => r && r.status >= 200 && r.status < 300);
      this.notificationService.notifyChainComplete(responses.length, totalDuration, allSuccessful);

      this.requestExecuted.emit({ requestIndex, response: decoratedLastResponse });
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
      this.filesChange.emit(updatedFiles);

      this.requestExecuted.emit({ requestIndex, response: errorResponse });
    } finally {
      this.executingRequest = false;
    }
  }

  // Build chain of requests by following @depends
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
  private async executeLoadTest(requestIndex: number, envName: string, requestId: string): Promise<void> {
    const currentFile = this.files()[this.currentFileIndex()];
    const request = currentFile.requests[requestIndex];
    const variables = this.getCombinedVariables();

    try {
      const results = await this.httpService.executeLoadTest(
        request,
        variables,
        envName,
        requestId,
        progress => this.requestProgress.emit(progress)
      );
      const metrics = this.httpService.calculateLoadTestMetrics(results);

      const statusText = decideLoadTestStatusText(results);

      const summaryResponse: ResponseData = buildLoadTestSummaryResponse({
        metrics,
        results,
        statusText
      });

      const updatedFiles = applyResponseDataForRequest(this.files(), this.currentFileIndex(), requestIndex, summaryResponse);
      this.filesChange.emit(updatedFiles);

      // Emit results for display in modal
      this.requestExecuted.emit({
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

      await this.pushHistoryEntry(currentFile.id, historyItem, currentFile.filePath);

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
      this.filesChange.emit(updatedFiles);

      this.requestExecuted.emit({ requestIndex, response: errorResponse });
    } finally {
      this.executingRequest = false;
    }
  }

  private async pushHistoryEntry(fileId: string, entry: HistoryItem, filePath?: string) {
    const history = await this.httpService.addToHistory(fileId, entry, filePath);
    this.history = history;
    this.historyUpdated.emit({ fileId, history });
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
    this.filesChange.emit(updatedFiles);

    this.requestExecuted.emit({ requestIndex, response: cancelledResponse });
  }
}