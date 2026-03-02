import { Injectable, ChangeDetectorRef, signal, inject } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import type {
  FileTab,
  Request,
  ResponseData,
  ActiveRunProgress,
  ChainEntryPreview,
} from '../models/http.models';
import { HttpService } from './http.service';
import { SecretService } from './secret.service';
import { ToastService } from './toast.service';
import { LoadTestVisualizationService } from './load-test-visualization.service';
import { PanelVisibilityService } from './panel-visibility.service';
import {
  buildActiveRequestMeta,
  buildActiveRequestPreview,
  getRequestTimeoutMs,
} from '../logic/app/app.component.logic';
import {
  buildActiveRequestInfo,
  type ActiveRequestInfo,
} from '../logic/request/active-request.logic';
import { buildPendingRequestResetPatch } from '../logic/request/pending-request-reset.logic';
import {
  buildCancelActiveRequestErrorPatch,
  decideCancelActiveRequest,
} from '../logic/request/cancel-active-request.logic';
import { consumeQueuedRequest } from '../logic/request/request-queue.logic';
import {
  getCombinedVariablesForFile,
  getActiveEnvNameForFile,
} from '../components/request-manager/env-vars';
import { hydrateText } from './http/hydration';

/** Delegate that the host component provides so the service can trigger execution. */
export interface RequestExecutionDelegate {
  executeRequestByIndex(requestIndex: number, requestId?: string): Promise<void> | undefined;
  cancelActiveRequest(): Promise<void>;
}

@Injectable({ providedIn: 'root' })
export class RequestExecutionService {
  private readonly httpService = inject(HttpService);
  private readonly secretService = inject(SecretService);
  private readonly toast = inject(ToastService);
  readonly loadTestViz = inject(LoadTestVisualizationService);
  private readonly panels = inject(PanelVisibilityService);

  // --- Signals (reactive state exposed to templates) ---
  readonly isRequestRunningSignal = signal<boolean>(false);
  readonly pendingRequestIndexSignal = signal<number | null>(null);
  readonly lastExecutedRequestIndexSignal = signal<number | null>(null);
  readonly downloadProgressSignal = signal<{ downloaded: number; total: number } | null>(null);

  // --- Mutable state ---
  isRequestRunning = false;
  pendingRequestIndex: number | null = null;
  lastExecutedRequestIndex: number | null = null;
  private queuedRequestIndex: number | null = null;
  activeRequestInfo: ActiveRequestInfo | null = null;
  isCancellingActiveRequest = false;
  downloadProgress: { downloaded: number; total: number } | null = null;

  private delegate: RequestExecutionDelegate | null = null;

  /** Wire up the download-progress subscription. Call once during app init. */
  subscribeToDownloadProgress(destroy$: Subject<void>): void {
    this.httpService.downloadProgress$
      .pipe(takeUntil(destroy$))
      .subscribe((progress) => {
        if (this.activeRequestInfo?.id === progress.requestId) {
          this.downloadProgress = {
            downloaded: progress.downloaded,
            total: progress.total,
          };
          this.downloadProgressSignal.set(this.downloadProgress);
        }
      });
  }

  /** Register the component that actually runs requests (RequestManagerComponent). */
  setDelegate(delegate: RequestExecutionDelegate): void {
    this.delegate = delegate;
  }

  // --- Request execution lifecycle ---

  onRequestExecute(
    requestIndex: number,
    files: FileTab[],
    currentFileIndex: number,
    currentEnv: string,
    cdr: ChangeDetectorRef,
  ): void {
    if (this.isRequestRunning) {
      this.queuedRequestIndex = requestIndex;
      return;
    }

    const activeFile = files[currentFileIndex];
    if (!activeFile || !activeFile.requests?.[requestIndex]) {
      return;
    }
    if (!this.delegate) {
      return;
    }

    // Clear the response panel so stale results don't linger.
    this.lastExecutedRequestIndex = null;
    this.lastExecutedRequestIndexSignal.set(null);

    this.isRequestRunning = true;
    this.isRequestRunningSignal.set(true);
    this.pendingRequestIndex = requestIndex;
    this.pendingRequestIndexSignal.set(requestIndex);
    this.downloadProgress = null;
    this.downloadProgressSignal.set(null);

    const request = activeFile.requests[requestIndex];
    const now = Date.now();
    this.activeRequestInfo = buildActiveRequestInfo(
      activeFile.id,
      requestIndex,
      request,
      now,
    );
    this.isCancellingActiveRequest = false;

    // Eagerly hydrate the URL so the pending modal shows the resolved URL
    const variables = getCombinedVariablesForFile(activeFile, currentEnv);
    const envName = getActiveEnvNameForFile(activeFile, currentEnv);
    const capturedId = this.activeRequestInfo.id;
    hydrateText(request.url, variables, envName, (text, env) =>
      this.secretService.replaceSecrets(text, env),
    )
      .then((resolved) => {
        if (this.activeRequestInfo?.id === capturedId) {
          this.activeRequestInfo = {
            ...this.activeRequestInfo!,
            processedUrl: resolved,
          };
        }
      })
      .catch(() => {});

    this.loadTestViz.initializeLoadRun();
    this.loadTestViz.startActiveRunTick(
      () => this.isRequestRunning,
      () => this.activeRequestInfo?.type,
      cdr,
    );

    const execution = this.delegate.executeRequestByIndex(
      requestIndex,
      this.activeRequestInfo.id,
    );
    execution?.catch((error) => {
      console.error('Request execution failed', error);
      this.resetPendingRequestState();
    });
  }

  onReplayRequest(
    entry: ChainEntryPreview,
    files: FileTab[],
    currentFileIndex: number,
    currentEnv: string,
    cdr: ChangeDetectorRef,
  ): void {
    const activeFile = files[currentFileIndex];
    if (!activeFile) {
      return;
    }

    const lastIdx = this.lastExecutedRequestIndexSignal();
    if (
      entry?.isPrimary &&
      typeof lastIdx === 'number' &&
      lastIdx >= 0 &&
      lastIdx < activeFile.requests.length
    ) {
      this.onRequestExecute(lastIdx, files, currentFileIndex, currentEnv, cdr);
      return;
    }

    const targetName = String(entry?.request?.name || '').trim();
    let idx = -1;

    if (targetName) {
      idx = activeFile.requests.findIndex(
        (r) => String(r?.name || '').trim() === targetName,
      );
    }

    if (idx < 0) {
      idx = activeFile.requests.findIndex(
        (r) =>
          r?.method === entry.request.method && r?.url === entry.request.url,
      );
    }

    if (idx < 0) {
      this.toast.info('Request not found in editor; cannot replay.');
      return;
    }

    this.onRequestExecute(idx, files, currentFileIndex, currentEnv, cdr);
  }

  onRequestExecuted(result: { requestIndex: number; response: ResponseData }): void {
    this.lastExecutedRequestIndex = result.requestIndex;
    this.lastExecutedRequestIndexSignal.set(result.requestIndex);
    this.resetPendingRequestState();

    if ((result.response as any).loadTestMetrics) {
      this.loadTestViz.loadTestMetrics = (result.response as any).loadTestMetrics;
      this.panels.showLoadTestResults.set(true);
    }
  }

  onRequestProgress(progress: ActiveRunProgress): void {
    if (!this.activeRequestInfo?.id) {
      return;
    }
    if (progress.requestId !== this.activeRequestInfo.id) {
      return;
    }
    this.loadTestViz.activeRunProgress = progress;
    if (progress.type === 'load') {
      const sample =
        typeof progress.activeUsers === 'number' ? progress.activeUsers : 0;
      this.loadTestViz.pushLoadUsersSample(sample);
    }
  }

  // --- Active request helpers ---

  getActiveRequestDetails(currentFile: FileTab): Request | null {
    if (!this.activeRequestInfo) {
      return null;
    }
    return currentFile.requests?.[this.activeRequestInfo.requestIndex] || null;
  }

  getActiveRequestPreview(currentFile: FileTab): string {
    const request = this.getActiveRequestDetails(currentFile);
    const processedUrl = this.activeRequestInfo
      ? (currentFile.responseData?.[this.activeRequestInfo.requestIndex]
          ?.processedUrl ?? this.activeRequestInfo.processedUrl)
      : undefined;
    return buildActiveRequestPreview(request, processedUrl);
  }

  getActiveRequestMeta(currentFile: FileTab): string {
    const request = this.getActiveRequestDetails(currentFile);
    const processedUrl = this.activeRequestInfo
      ? (currentFile.responseData?.[this.activeRequestInfo.requestIndex]
          ?.processedUrl ?? this.activeRequestInfo.processedUrl)
      : undefined;
    return buildActiveRequestMeta({
      activeRequestInfo: this.activeRequestInfo,
      isRequestRunning: this.isRequestRunning,
      isCancellingActiveRequest: this.isCancellingActiveRequest,
      nowMs: this.loadTestViz.activeRunNowMs,
      activeRunProgress: this.loadTestViz.activeRunProgress,
      activeRequestTimeoutMs: this.getActiveRequestTimeoutMs(currentFile),
      request,
      processedUrl,
    });
  }

  getActiveRequestTimeoutMs(currentFile: FileTab): number | null {
    const req = this.getActiveRequestDetails(currentFile);
    return getRequestTimeoutMs(req);
  }

  async cancelActiveRequest(): Promise<void> {
    const decision = decideCancelActiveRequest({
      activeRequestId: this.activeRequestInfo?.id,
      isCancelling: this.isCancellingActiveRequest,
      hasRequestManager: Boolean(this.delegate),
    });
    if (!decision.shouldCancel) {
      return;
    }

    this.isCancellingActiveRequest = decision.isCancellingAfterStart;
    try {
      await this.delegate!.cancelActiveRequest();
      this.toast.info('Request cancelled');
    } catch (error) {
      console.error('Failed to cancel request', error);
      this.toast.error('Failed to cancel request');
      const patch = buildCancelActiveRequestErrorPatch();
      this.isCancellingActiveRequest = patch.isCancellingActiveRequest;
    }
  }

  // --- Internal ---

  private resetPendingRequestState(): void {
    this.loadTestViz.stopActiveRunTick();

    const patch = buildPendingRequestResetPatch();
    this.isRequestRunning = patch.isRequestRunning;
    this.pendingRequestIndex = patch.pendingRequestIndex;
    this.loadTestViz.applyResetPatch();
    this.activeRequestInfo = patch.activeRequestInfo;
    this.isCancellingActiveRequest = patch.isCancellingActiveRequest;

    this.isRequestRunningSignal.set(this.isRequestRunning);
    this.pendingRequestIndexSignal.set(this.pendingRequestIndex);

    if (!this.isRequestRunning) {
      this.downloadProgressSignal.set(null);
    }

    const q = consumeQueuedRequest({
      isRequestRunning: this.isRequestRunning,
      queuedRequestIndex: this.queuedRequestIndex,
    });
    this.queuedRequestIndex = q.queuedRequestIndexAfter;
    const nextIndexToExecute = q.nextRequestIndexToExecute;
    if (nextIndexToExecute !== null) {
      // Deferred execution so the current lifecycle finishes first.
      // The caller must call onRequestExecute again with proper context;
      // we emit a signal so the host component can wire this up.
      this.queuedExecutionRequested.next(nextIndexToExecute);
    }
  }

  /** Emits when a queued request should be executed after the current one finishes. */
  readonly queuedExecutionRequested = new Subject<number>();
}
