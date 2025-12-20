import { Component, input, output, inject, OnInit, OnDestroy, signal, effect } from '@angular/core';

import { HttpService } from '../../services/http.service';
import { ParserService } from '../../services/parser.service';
import { NotificationService } from '../../services/notification.service';
import {
  Request,
  FileTab,
  ResponseData,
  HistoryItem,
  RequestPreview,
  ChainEntryPreview,
  ResponsePreview
} from '../../models/http.models';

@Component({
  selector: 'app-request-manager',
  standalone: true,
  imports: [],
  template: ``,
  styles: []
})
export class RequestManagerComponent {
  private httpService = inject(HttpService);
  private parserService = inject(ParserService);
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
  historyUpdated = output<{ fileId: string; history: HistoryItem[] }>();

  private history: HistoryItem[] = [];
  private executingRequest = false;
  private activeRequestId: string | null = null;
  private lastExecutedRequestIndex: number | null = null;

  // Execute a request by index
  async executeRequestByIndex(requestIndex: number, requestId?: string): Promise<void> {
    // Prevent duplicate execution of the same request
    if (this.executingRequest && this.lastExecutedRequestIndex === requestIndex) {
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

    const supportsCancellation = true; // All request types now support cancellation
    this.activeRequestId = requestId ?? this.createRequestId(currentFile.id, requestIndex);

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
      const updatedFiles = [...this.files()];
      updatedFiles[this.currentFileIndex()].responseData[requestIndex] = responseWithChain;
      this.filesChange.emit(updatedFiles);

      const historyItem: HistoryItem = {
        timestamp: new Date(),
        method: request.method,
        url: responseWithChain.processedUrl || request.url,
        status: response.status,
        statusText: response.statusText,
        responseTime: response.responseTime,
        responseData: responseWithChain
      };

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
      const errorResponse: ResponseData = {
        status: error.status || 0,
        statusText: error.statusText || 'Network Error',
        headers: error.headers || {},
        body: error.body || error.message || 'Unknown error',
        responseTime: error.responseTime || 0
      };
      if (error?.requestPreview) {
        errorResponse.requestPreview = error.requestPreview;
        errorResponse.processedUrl = error.requestPreview.url;
      }

      const errorChain = this.buildChainItems([request], [errorResponse.requestPreview], [errorResponse], 0);
      const decoratedError = { ...errorResponse, chainItems: errorChain };

      const updatedFiles = [...this.files()];
      updatedFiles[this.currentFileIndex()].responseData[requestIndex] = decoratedError;
      this.filesChange.emit(updatedFiles);

      // Add error to history too
      const errorHistoryItem: HistoryItem = {
        timestamp: new Date(),
        method: request.method,
        url: decoratedError.processedUrl || request.url,
        status: errorResponse.status,
        statusText: errorResponse.statusText,
        responseTime: errorResponse.responseTime,
        responseData: decoratedError
      };
      await this.pushHistoryEntry(currentFile.id, errorHistoryItem, currentFile.filePath);

      this.requestExecuted.emit({ requestIndex, response: decoratedError });
    } finally {
      this.executingRequest = false;
      this.activeRequestId = null;
    }
  }

  private getCombinedVariables(): { [key: string]: string } {
    const currentFile = this.files()[this.currentFileIndex()];
    if (!currentFile) return {};

    const variables = { ...currentFile.variables };

    const activeEnvName = this.getActiveEnvName();

    const envVars = (activeEnvName && currentFile.environments)
      ? currentFile.environments[activeEnvName] || {}
      : {};
    Object.assign(variables, envVars);

    return variables;
  }

  private getActiveEnvName(): string {
    const currentFile = this.files()[this.currentFileIndex()];
    if (currentFile?.selectedEnv && currentFile.selectedEnv.length) {
      return currentFile.selectedEnv;
    }
    const env = this.currentEnv();
    return env && env.length ? env : 'default';
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
      const chainItems = this.buildChainItems(chain, execution.requestPreviews, responses, chain.length - 1);
      const decoratedLastResponse = { ...lastResponse, chainItems };

      const updatedFiles = [...this.files()];
      updatedFiles[this.currentFileIndex()].responseData[requestIndex] = decoratedLastResponse;
      this.filesChange.emit(updatedFiles);

      // Add to history
      const historyItem: HistoryItem = {
        timestamp: new Date(),
        method: request.method,
        url: decoratedLastResponse.processedUrl || request.url,
        status: decoratedLastResponse.status,
        statusText: decoratedLastResponse.statusText,
        responseTime: decoratedLastResponse.responseTime,
        responseData: decoratedLastResponse
      };

      await this.pushHistoryEntry(currentFile.id, historyItem, currentFile.filePath);

      // Send notification if app is in background
      const totalDuration = responses.reduce((sum, r) => sum + (r?.responseTime || 0), 0);
      const allSuccessful = responses.every(r => r && r.status >= 200 && r.status < 300);
      this.notificationService.notifyChainComplete(chain.length, totalDuration, allSuccessful);

      this.requestExecuted.emit({ requestIndex, response: decoratedLastResponse });
    } catch (error: any) {
      if (this.isCancellationError(error)) {
        this.handleCancelledRequest(currentFile.id, request, requestIndex);
        return;
      }
      console.error('[RequestManager] Chained request error:', error);
      const errorResponse: ResponseData = {
        status: error.status || 0,
        statusText: error.statusText || 'Chain Error',
        headers: error.headers || {},
        body: error.body || error.message || 'Chain execution failed',
        responseTime: error.responseTime || 0
      };

      const updatedFiles = [...this.files()];
      updatedFiles[this.currentFileIndex()].responseData[requestIndex] = errorResponse;
      this.filesChange.emit(updatedFiles);

      this.requestExecuted.emit({ requestIndex, response: errorResponse });
    } finally {
      this.executingRequest = false;
    }
  }

  // Build chain of requests by following @depends
  private buildRequestChain(requestIndex: number): Request[] {
    const currentFile = this.files()[this.currentFileIndex()];
    const chain: Request[] = [];
    const visited = new Set<number>();

    const addToChain = (index: number) => {
      if (visited.has(index)) {
        throw new Error('Circular dependency detected in request chain');
      }
      visited.add(index);

      const req = currentFile.requests[index];
      if (!req) return;

      // If this request depends on another, add that one first
      if (req.depends) {
        const dependsIndex = currentFile.requests.findIndex(r => r.name === req.depends);
        if (dependsIndex !== -1) {
          addToChain(dependsIndex);
        }
      }

      chain.push(req);
    };

    addToChain(requestIndex);
    return chain;
  }

  private buildChainItems(
    chain: Request[],
    previews: Array<RequestPreview | undefined | null>,
    responses: Array<ResponseData | null | undefined>,
    primaryIndex: number
  ): ChainEntryPreview[] {
    return chain.map((req, idx) => {
      const preview = this.ensureRequestPreview(req, previews[idx]);
      const responsePreview = this.toResponsePreview(responses[idx]);
      return {
        id: `${req.name || req.method}-${idx}`,
        label: req.name || `${req.method} ${preview.url}`.trim(),
        request: preview,
        response: responsePreview,
        isPrimary: idx === primaryIndex
      };
    });
  }

  private ensureRequestPreview(request: Request, preview?: RequestPreview | null): RequestPreview {
    if (preview) {
      return {
        name: preview.name || request.name,
        method: preview.method || request.method,
        url: preview.url,
        headers: { ...preview.headers },
        body: preview.body
      };
    }

    return {
      name: request.name,
      method: request.method,
      url: request.url,
      headers: { ...request.headers },
      body: typeof request.body === 'string' ? request.body : undefined
    };
  }

  private toResponsePreview(response?: ResponseData | null): ResponsePreview | null {
    if (!response) {
      return null;
    }
    return {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers || {},
      body: response.body,
      responseTime: response.responseTime,
      timing: response.timing,
      size: response.size
    };
  }

  // Execute load test
  private async executeLoadTest(requestIndex: number, envName: string, requestId: string): Promise<void> {
    const currentFile = this.files()[this.currentFileIndex()];
    const request = currentFile.requests[requestIndex];
    const variables = this.getCombinedVariables();

    try {
      const results = await this.httpService.executeLoadTest(request, variables, envName, requestId);
      const metrics = this.httpService.calculateLoadTestMetrics(results);

      // Create a summary response
      const summaryResponse: ResponseData = {
        status: 200,
        statusText: 'Load Test Complete',
        headers: {},
        body: JSON.stringify(metrics, null, 2),
        responseTime: results.endTime - results.startTime
      };

      const updatedFiles = [...this.files()];
      updatedFiles[this.currentFileIndex()].responseData[requestIndex] = summaryResponse;
      this.filesChange.emit(updatedFiles);

      // Emit results for display in modal
      this.requestExecuted.emit({
        requestIndex,
        response: { ...summaryResponse, loadTestMetrics: metrics } as any
      });

      // Add to history
      const historyItem: HistoryItem = {
        timestamp: new Date(),
        method: request.method + ' (Load Test)',
        url: request.url,
        status: 200,
        statusText: 'Load Test Complete',
        responseTime: results.endTime - results.startTime,
        responseData: summaryResponse
      };

      await this.pushHistoryEntry(currentFile.id, historyItem, currentFile.filePath);

      // Send notification if app is in background
      this.notificationService.notifyLoadTestComplete(
        request.name,
        metrics.totalRequests,
        results.endTime - results.startTime,
        metrics.averageResponseTime
      );

    } catch (error: any) {
      const errorResponse: ResponseData = {
        status: 0,
        statusText: 'Load Test Error',
        headers: {},
        body: error.message || 'Load test failed',
        responseTime: 0
      };

      const updatedFiles = [...this.files()];
      updatedFiles[this.currentFileIndex()].responseData[requestIndex] = errorResponse;
      this.filesChange.emit(updatedFiles);

      this.requestExecuted.emit({ requestIndex, response: errorResponse });
    } finally {
      this.executingRequest = false;
    }
  }

  // Environment management
  // getEnvironments(): string[] {
  //   const currentFile = this.files()[this.currentFileIndex()];
  //   if (!currentFile) return ['local'];
  //
  //   // Extract environment names from the nested structure
  //   const envs = Object.keys(currentFile.environments);
  //
  //   // If no environments defined, return a default
  //   return envs.length > 0 ? envs : ['local'];
  // }

  // History management
  // private loadHistory(): void {
  //   this.history = this.httpService.loadHistory();
  //   this.historyUpdated.emit(this.history);
  // }

  // viewHistoryItem(item: HistoryItem): void {
  //   // This could open a modal or update the current request
  //   console.log('Viewing history item:', item);
  // }

  // File operations
  // saveFiles(): void {
  //   this.httpService.saveFiles(this.files());
  // }

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
    return `${fileId}-${requestIndex}-${Date.now()}`;
  }

  private isCancellationError(error: any): boolean {
    return !!error?.cancelled;
  }

  private handleCancelledRequest(fileId: string, request: Request, requestIndex: number) {
    const cancelledResponse: ResponseData = {
      status: 0,
      statusText: 'Cancelled',
      headers: {},
      body: 'Request was cancelled before completion.',
      responseTime: 0
    };

    const updatedFiles = [...this.files()];
    updatedFiles[this.currentFileIndex()].responseData[requestIndex] = cancelledResponse;
    this.filesChange.emit(updatedFiles);

    this.requestExecuted.emit({ requestIndex, response: cancelledResponse });
  }
}