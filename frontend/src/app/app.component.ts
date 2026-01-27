import { Component, OnInit, OnDestroy, inject, signal, computed, ViewChild, HostListener, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EditorComponent } from './components/editor/editor.component';
import { RequestManagerComponent } from './components/request-manager/request-manager.component';
import {
  HeaderComponent,
  ResponsePanelComponent,
  HistorySidebarComponent,
  HistoryDetailModalComponent,
  LoadTestResultsModalComponent,
  DonationModalComponent,
  SecretsModalComponent,
  DeleteConfirmModalComponent,
  ConsoleDrawerComponent,
  UpdateNotificationComponent,
  ScriptSnippetModalComponent
} from './components';
import { ToastContainerComponent } from './components/toast-container/toast-container.component';
import { FileTab, ResponseData, HistoryItem, Request, ScriptLogEntry, ActiveRunProgress, ChainEntryPreview } from './models/http.models';
import { HttpService } from './services/http.service';
import { SecretService, SecretIndex, VaultInfo } from './services/secret.service';
import { ScriptConsoleService } from './services/script-console.service';
import { ToastService } from './services/toast.service';
import { UpdateService } from './services/update.service';
import { ScriptSnippet } from './services/script-snippet.service';
import { ThemeService } from './services/theme.service';
import { basename } from './utils/path';
import { generateFileId, normalizeFileTab } from './utils/file-tab-utils';
import { HistoryStoreService } from './services/history-store.service';
import { WorkspaceFacadeService } from './services/workspace-facade.service';
import { Subject, takeUntil } from 'rxjs';
import { gsap } from 'gsap';
import {
  buildActiveRequestMeta,
  buildActiveRequestPreview,
  buildLastResponseSummary,
  buildRequestLabel,
  buildRequestToken,
  buildSecretDeletedToast,
  buildSecretSavedToast,
  buildTrackedLogEntryId,
  buildVaultExportedToast,
  buildVaultFileName,
  decideGlobalKeydownAction,
  decideFooterStatus,
  findExistingOpenFileIndex,
  formatClockMmSs,
  getRequestTimeoutMs,
  normalizeEnvName,
  parseSplitWidthPx
} from './logic/app/app.component.logic';
import {
  buildFileAfterSave,
  buildFirstSaveDefaultName,
  buildSaveAsDefaultName,
  decideFirstSaveHistoryMigration,
  decideSaveAsHistoryMigration
} from './logic/app/file-save.logic';
import { deriveAppStateAfterWorkspaceUpdateWithEnvSync, deriveAppStateFromWorkspaceUpdate } from './logic/app/workspace-update.logic';
import { decideHistorySyncForWorkspaceState } from './logic/app/history-sync.logic';
import {
  clampSplitWidthToContainerPx,
  computeDragSplitWidthPx,
  computeSplitGridTemplateColumns,
  DEFAULT_LEFT_PX,
  SPLIT_LAYOUT_BREAKPOINT_PX
} from './utils/split-layout';
import { readSplitWidthPxFromStorage, writeSplitWidthPxToStorage } from './logic/layout/split-pane-persistence.logic';
import { decideHistoryLoadForActiveFile } from './logic/history/history-load.logic';
import { sampleAndApplyRpsUiState } from './logic/active-run/active-run-rps-ui.logic';
import {
  pushUsersSampleToQueue,
  smoothTowards,
  tickRpsSparklineUi,
  tickUsersSparklineUi
} from './logic/active-run/active-run-sparkline.logic';
import { buildStopActiveRunTickPatch } from './logic/active-run/active-run-stop.logic';
import { decideActiveRunTickActions } from './logic/active-run/active-run-tick.logic';
import { buildActiveRequestInfo, buildInitialLoadRunUiState } from './logic/request/active-request.logic';
import { consumeQueuedRequest } from './logic/request/request-queue.logic';
import { buildPendingRequestResetPatch } from './logic/request/pending-request-reset.logic';
import { buildCancelActiveRequestErrorPatch, decideCancelActiveRequest } from './logic/request/cancel-active-request.logic';

type AlertType = 'info' | 'success' | 'warning' | 'danger';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    EditorComponent,
    RequestManagerComponent,
    HeaderComponent,
    ResponsePanelComponent,
    HistorySidebarComponent,
    HistoryDetailModalComponent,
    LoadTestResultsModalComponent,
    DonationModalComponent,
    SecretsModalComponent,
    DeleteConfirmModalComponent,
    ConsoleDrawerComponent,
    ToastContainerComponent,
    UpdateNotificationComponent,
    ScriptSnippetModalComponent
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'RawRequest';

  private httpService = inject(HttpService);
  private secretService = inject(SecretService);
  private scriptConsole = inject(ScriptConsoleService);
  private toast = inject(ToastService);
  protected updateService = inject(UpdateService);
  private themeService = inject(ThemeService);
  private historyStore = inject(HistoryStoreService);
  private workspace = inject(WorkspaceFacadeService);
  private readonly LAST_SESSION_KEY = 'rawrequest_last_session';
  private readonly EDITOR_SPLIT_WIDTH_KEY = 'rawrequest_editor_pane_width_px';

  @ViewChild('mainSplit') mainSplitEl?: ElementRef<HTMLElement>;

  isSplitLayout = false;
  editorPaneWidthPx = 520;
  splitGridTemplateColumns: string | null = null;

  private isSplitDragging = false;
  private splitDragStartX = 0;
  private splitDragStartWidth = 0;

  @ViewChild(RequestManagerComponent) requestManager!: RequestManagerComponent;
  @ViewChild('editorComponent') editorComponent!: EditorComponent;

  filesSignal = signal<FileTab[]>([]);
  currentFileIndexSignal = signal<number>(0);
  currentEnvSignal = signal<string>('');

  isRequestRunningSignal = signal<boolean>(false);
  pendingRequestIndexSignal = signal<number | null>(null);
  lastExecutedRequestIndexSignal = signal<number | null>(null);
  downloadProgressSignal = signal<{ downloaded: number; total: number } | null>(null);

  private readonly emptyFile: FileTab = {
    id: 'empty',
    name: '',
    content: '',
    requests: [],
    environments: {},
    variables: {},
    responseData: {},
    groups: [],
    selectedEnv: ''
  };

  currentFileView = computed<FileTab>(() => {
    const files = this.filesSignal();
    const index = this.currentFileIndexSignal();
    return files[index] || this.emptyFile;
  });

  // Computed values
  currentFileEnvironments = computed(() => {
    const files = this.filesSignal();
    const index = this.currentFileIndexSignal();
    if (files[index]) {
      return Object.keys(files[index].environments);
    }
    return [];
  });

  currentEnv = computed(() => {
    return this.currentEnvSignal();
  });

  // Request names for autocomplete
  currentFileRequestNames = computed(() => {
    const files = this.filesSignal();
    const index = this.currentFileIndexSignal();
    if (files[index]?.requests) {
      return files[index].requests.map(r => r.name || '');
    }
    return [];
  });

  files: FileTab[] = [];
  currentFileIndex = 0;
  history: HistoryItem[] = [];
  lastExecutedRequestIndex: number | null = null;
  isRequestRunning = false;
  pendingRequestIndex: number | null = null;
  private queuedRequestIndex: number | null = null;
  private activeRunTickHandle: any = null;
  private activeRunNowMs = Date.now();
  private activeRunProgress: ActiveRunProgress | null = null;
  private loadUsersSeries: number[] = [];
	private readonly loadUsersSeriesMaxPoints = 160;
	loadUsersSparklinePathDView = '';
	loadUsersSparklineTransformView = '';
  private loadUsersQueue: number[] = [];
  private loadUsersScrollPhase = 0;
  private loadUsersNextValue: number | null = null;
  private readonly loadUsersScrollMs = 80;
  private readonly loadUsersRampSteps = 36;

  private sparklineRafHandle: number | null = null;
  private sparklineLastFrameAtMs: number | null = null;
  private sparklineLastRenderedAtMs: number | null = null;

  private loadRpsSeries: number[] = [];
	private readonly loadRpsSeriesMaxPoints = 160;
	loadRpsSparklinePathDView = '';
  loadRpsSparklineTransformView = '';
  private loadRpsQueue: number[] = [];
  private loadRpsScrollPhase = 0;
  private loadRpsNextValue: number | null = null;
  private readonly loadRpsScrollMs = 80;
  private readonly loadRpsRampSteps = 36;
  private lastRpsSampleAtMs: number | null = null;
  private lastRpsTotalSent: number | null = null;
  private lastRpsSmoothed: number | null = null;
  private rpsRenderValue: number | null = null;
  private rpsRenderTarget: number | null = null;
  activeRequestInfo: {
    id?: string;
    label: string;
    requestIndex: number;
    canCancel: boolean;
    type: 'single' | 'chain' | 'load';
    startedAt: number;
  } | null = null;
  isCancellingActiveRequest = false;
  downloadProgress: { downloaded: number; total: number } | null = null;
  
  // UI state
  showHistory = false;
  showHistoryModal = false;
  selectedHistoryItem: HistoryItem | null = null;
  showLoadTestResults = false;
  loadTestMetrics: any = null;
  showDonationModal = false;
  showSecretsModal = false;
  showSnippetModal = false;
  showDeleteConfirmModal = false;
  secretToDelete: { env: string, key: string } | null = null;
  allSecrets: SecretIndex = {};
  vaultInfo: VaultInfo | null = null;
  // alertBanner: { message: string; type: AlertType } | null = null;
  consoleOpen = signal(false);
  readonly scriptLogs = this.scriptConsole.logs;
  readonly latestConsoleEntry = computed(() => {
    const entries = this.scriptConsole.logs();
    return entries.length ? entries[entries.length - 1] : null;
  });

  @ViewChild('snippetModal') snippetModal!: ScriptSnippetModalComponent;

  private destroy$ = new Subject<void>();
  private alertTimeout: any;
  private parseDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly PARSE_DEBOUNCE_MS = 150;

  constructor() {}

  ngOnInit() {
    this.themeService.init();
    this.restoreSplitState();
    this.refreshSplitLayoutState();

    this.loadFiles();
    this.refreshSecrets(true);
    this.updateService.init();
    this.checkForUpdates();
    this.checkFirstRun();

    this.secretService
      .onMissingSecret()
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {});

    this.httpService.downloadProgress$
      .pipe(takeUntil(this.destroy$))
      .subscribe(progress => {
        if (this.activeRequestInfo?.id === progress.requestId) {
          this.downloadProgress = { downloaded: progress.downloaded, total: progress.total };
          this.downloadProgressSignal.set(this.downloadProgress);
        }
      });
  }

  @HostListener('window:resize')
  onWindowResize() {
    this.refreshSplitLayoutState();
    this.clampSplitWidthToContainer();
  }

  @HostListener('document:mousemove', ['$event'])
  onDocumentMouseMove(event: MouseEvent) {
    if (!this.isSplitDragging) return;
    if (!this.isSplitLayout) return;
    event.preventDefault();
    const container = this.mainSplitEl?.nativeElement;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const dx = event.clientX - this.splitDragStartX;
    this.editorPaneWidthPx = computeDragSplitWidthPx(rect.width, this.splitDragStartWidth, dx);
    this.splitGridTemplateColumns = this.computeSplitGridTemplateColumns();
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  @HostListener('document:mouseup')
  onDocumentMouseUp() {
    if (!this.isSplitDragging) return;
    this.isSplitDragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    writeSplitWidthPxToStorage(localStorage, this.EDITOR_SPLIT_WIDTH_KEY, this.editorPaneWidthPx);
  }

  onSplitMouseDown(event: MouseEvent) {
    if (!this.isSplitLayout) return;
    this.isSplitDragging = true;
    this.splitDragStartX = event.clientX;
    this.splitDragStartWidth = this.editorPaneWidthPx;
    event.preventDefault();
  }

  resetSplit() {
    this.editorPaneWidthPx = DEFAULT_LEFT_PX;
    this.splitGridTemplateColumns = this.computeSplitGridTemplateColumns();
    writeSplitWidthPxToStorage(localStorage, this.EDITOR_SPLIT_WIDTH_KEY, this.editorPaneWidthPx);
  }

  private restoreSplitState(): void {
    const n = readSplitWidthPxFromStorage(localStorage, this.EDITOR_SPLIT_WIDTH_KEY);
    if (n !== null) {
      this.editorPaneWidthPx = n;
    }
  }

  private refreshSplitLayoutState(): void {
    // "lg" breakpoint is 1024px.
    this.isSplitLayout = typeof window !== 'undefined' && window.innerWidth >= SPLIT_LAYOUT_BREAKPOINT_PX;
    this.splitGridTemplateColumns = this.computeSplitGridTemplateColumns();
  }

  private computeSplitGridTemplateColumns(): string | null {
    if (!this.isSplitLayout) {
      return null;
    }
    return computeSplitGridTemplateColumns(this.editorPaneWidthPx);
  }

  private clampSplitWidthToContainer(): void {
    if (!this.isSplitLayout) return;
    const container = this.mainSplitEl?.nativeElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    const clamped = clampSplitWidthToContainerPx(rect.width, this.editorPaneWidthPx);
    if (clamped !== this.editorPaneWidthPx) {
      this.editorPaneWidthPx = clamped;
      this.splitGridTemplateColumns = this.computeSplitGridTemplateColumns();
    }
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.alertTimeout) {
      clearTimeout(this.alertTimeout);
    }
    if (this.parseDebounceTimer) {
      clearTimeout(this.parseDebounceTimer);
    }
  }

  private loadFiles(): void {
    const init = this.workspace.initializeFromStorage(this.LAST_SESSION_KEY);
    if (init.shouldAddNewTab) {
      // Create default file with example content
      this.addNewTab();
      return;
    }

    const next = deriveAppStateAfterWorkspaceUpdateWithEnvSync({
      update: init,
      syncCurrentEnvWithFile: (files, index) => this.workspace.syncCurrentEnvWithFile(files, index)
    });
    this.applyWorkspaceDerivedState(next);

    this.loadHistoryForFile(next.activeFileId || undefined);
  }

  private refreshSecrets(force = false): void {
    this.secretService
      .list(force)
      .then(secrets => {
        this.allSecrets = secrets || {};
      })
      .catch(error => console.error('Failed to load secrets', error));
    void this.loadVaultInfo(force);
  }

  private loadVaultInfo(force = false): Promise<void> {
    return this.secretService
      .getVaultInfo(force)
      .then(info => {
        this.vaultInfo = info;
      })
      .catch(error => console.error('Failed to load vault info', error));
  }

  // File management
  onFilesChange(files: FileTab[]) {
    const normalized = this.workspace.normalizeFiles(files);
    this.files = normalized;
    this.filesSignal.set(normalized);

    const synced = this.workspace.syncCurrentEnvWithFile(this.files, this.currentFileIndex);
    if (synced.files !== this.files) {
      this.files = synced.files;
      this.filesSignal.set(synced.files);
    }
    this.currentEnvSignal.set(synced.currentEnv || '');

    const historyDecision = decideHistorySyncForWorkspaceState({
      files: this.files,
      currentFileIndex: this.currentFileIndex,
      getCachedHistory: (fileId) => this.historyStore.get(fileId)
    });
    this.history = historyDecision.history;
    if (historyDecision.fileIdToLoad) {
      this.loadHistoryForFile(historyDecision.fileIdToLoad);
    }
    this.workspace.persistSessionState(this.LAST_SESSION_KEY, this.files, this.currentFileIndex);
  }

  onCurrentFileIndexChange(index: number) {
    this.currentFileIndex = index;
    this.currentFileIndexSignal.set(index);

    const synced = this.workspace.syncCurrentEnvWithFile(this.files, index);
    if (synced.files !== this.files) {
      this.files = synced.files;
      this.filesSignal.set(synced.files);
    }
    this.currentEnvSignal.set(synced.currentEnv || '');

    const historyDecision = decideHistorySyncForWorkspaceState({
      files: this.files,
      currentFileIndex: index,
      getCachedHistory: (fileId) => this.historyStore.get(fileId)
    });
    this.history = historyDecision.history;
    if (historyDecision.fileIdToLoad) {
      this.loadHistoryForFile(historyDecision.fileIdToLoad);
    }
    this.workspace.persistSessionState(this.LAST_SESSION_KEY, this.files, this.currentFileIndex);
  }

  onCurrentEnvChange(env: string) {
    const file = this.files[this.currentFileIndex];
    if (file) {
      const updatedFiles = this.workspace.replaceFileAtIndex(this.files, this.currentFileIndex, { ...file, selectedEnv: env });
      this.files = updatedFiles;
      this.filesSignal.set(updatedFiles);
    }
    this.currentEnvSignal.set(env);
    this.httpService.saveFiles(this.files);
    this.workspace.persistSessionState(this.LAST_SESSION_KEY, this.files, this.currentFileIndex);
  }

  // Editor content change handler
  // Uses debounced parsing to prevent UI lag when editing large files.
  // Content is saved immediately; parsing (which extracts requests/environments) is debounced.
  onEditorContentChange(content: string) {
    // Cancel any pending parse
    if (this.parseDebounceTimer) {
      clearTimeout(this.parseDebounceTimer);
    }

    // Immediately update raw content so the editor stays responsive
    const currentFile = this.files[this.currentFileIndex];
    if (currentFile) {
      const quickUpdate = [...this.files];
      quickUpdate[this.currentFileIndex] = { ...currentFile, content };
      this.files = quickUpdate;
      this.filesSignal.set(quickUpdate);
      this.httpService.saveFiles(quickUpdate);
    }

    // Debounce the expensive parsing operation
    this.parseDebounceTimer = setTimeout(() => {
      this.parseDebounceTimer = null;
      const updated = this.workspace.updateFileContent(this.files, this.currentFileIndex, content);
      this.files = updated.files;
      this.filesSignal.set(updated.files);
      this.currentEnvSignal.set(updated.currentEnv || '');
    }, this.PARSE_DEBOUNCE_MS);
  }

  // Request execution
  onRequestExecute(requestIndex: number) {
    if (this.isRequestRunning) {
      this.queuedRequestIndex = requestIndex;
      return; // queue request until current one finishes
    }

    const activeFile = this.files[this.currentFileIndex];
    if (!activeFile || !activeFile.requests?.[requestIndex]) {
      return;
    }

    if (!this.requestManager) {
      return;
    }

    // Clear the response panel immediately so stale results don't linger while the
    // new request is running. The response panel will show its loading state.
    this.lastExecutedRequestIndex = null;
    this.lastExecutedRequestIndexSignal.set(null);

    this.isRequestRunning = true;
    this.isRequestRunningSignal.set(true);
    this.pendingRequestIndex = requestIndex;
    this.pendingRequestIndexSignal.set(requestIndex);
    this.downloadProgress = null; // Reset download progress for new request
    this.downloadProgressSignal.set(null);
    const request = activeFile.requests[requestIndex];
    const now = Date.now();
    this.activeRequestInfo = buildActiveRequestInfo(activeFile.id, requestIndex, request, now);
    this.isCancellingActiveRequest = false;

    const loadRun = buildInitialLoadRunUiState(this.loadUsersSeriesMaxPoints, this.loadRpsSeriesMaxPoints);
    this.activeRunProgress = loadRun.activeRunProgress;

    this.loadUsersSeries = loadRun.loadUsersSeries;
    this.loadUsersQueue = loadRun.loadUsersQueue;
    this.loadUsersScrollPhase = loadRun.loadUsersScrollPhase;
    this.loadUsersNextValue = loadRun.loadUsersNextValue;
    this.loadUsersSparklineTransformView = loadRun.loadUsersSparklineTransformView;
    this.loadUsersSparklinePathDView = loadRun.loadUsersSparklinePathDView;

    this.loadRpsSeries = loadRun.loadRpsSeries;
    this.loadRpsQueue = loadRun.loadRpsQueue;
    this.loadRpsScrollPhase = loadRun.loadRpsScrollPhase;
    this.loadRpsNextValue = loadRun.loadRpsNextValue;
    this.loadRpsSparklineTransformView = loadRun.loadRpsSparklineTransformView;
    this.loadRpsSparklinePathDView = loadRun.loadRpsSparklinePathDView;

    this.lastRpsSampleAtMs = loadRun.lastRpsSampleAtMs;
    this.lastRpsTotalSent = loadRun.lastRpsTotalSent;
    this.lastRpsSmoothed = loadRun.lastRpsSmoothed;
    this.rpsRenderValue = loadRun.rpsRenderValue;
    this.rpsRenderTarget = loadRun.rpsRenderTarget;
    this.startActiveRunTick();

    const execution = this.requestManager.executeRequestByIndex(requestIndex, this.activeRequestInfo.id);
    execution?.catch(error => {
      console.error('Request execution failed', error);
      this.resetPendingRequestState();
    });
  }

  onReplayRequest(entry: ChainEntryPreview) {
    const activeFile = this.files[this.currentFileIndex];
    if (!activeFile) {
      return;
    }

    // If the user clicks replay for the primary entry (the request currently shown in the
    // response panel), replay by index. This avoids mismatches when the stored preview URL
    // is a processed/expanded URL (e.g. variables resolved) while the editor contains the
    // templated URL.
    const lastIdx = this.lastExecutedRequestIndexSignal();
    if (entry?.isPrimary && typeof lastIdx === 'number' && lastIdx >= 0 && lastIdx < activeFile.requests.length) {
      this.onRequestExecute(lastIdx);
      return;
    }

    const targetName = String(entry?.request?.name || '').trim();
    let idx = -1;

    if (targetName) {
      idx = activeFile.requests.findIndex(r => String(r?.name || '').trim() === targetName);
    }

    // Fallback if the request is unnamed.
    if (idx < 0) {
      idx = activeFile.requests.findIndex(
        r => r?.method === entry.request.method && r?.url === entry.request.url
      );
    }

    if (idx < 0) {
      this.toast.info('Request not found in editor; cannot replay.');
      return;
    }

    this.onRequestExecute(idx);
  }

  onRequestExecuted(result: { requestIndex: number; response: ResponseData }) {
    this.lastExecutedRequestIndex = result.requestIndex;
    this.lastExecutedRequestIndexSignal.set(result.requestIndex);
    this.resetPendingRequestState();

    // Check if this is a load test result
    if ((result.response as any).loadTestMetrics) {
      this.loadTestMetrics = (result.response as any).loadTestMetrics;
      this.showLoadTestResults = true;
    }
  }

  onRequestProgress(progress: ActiveRunProgress) {
    if (!this.activeRequestInfo?.id) {
      return;
    }
    if (progress.requestId !== this.activeRequestInfo.id) {
      return;
    }
    this.activeRunProgress = progress;
    if (progress.type === 'load') {
      const sample = typeof progress.activeUsers === 'number' ? progress.activeUsers : 0;
      this.pushLoadUsersSample(sample);
    }
  }

  onHistoryUpdated(event: { fileId: string; history: HistoryItem[] }) {
    this.historyStore.set(event.fileId, event.history);
    const activeFile = this.files[this.currentFileIndex];
    if (activeFile && activeFile.id === event.fileId) {
      this.history = event.history;
    }
  }

  // UI handlers
  toggleHistory() {
    this.showHistory = !this.showHistory;
  }

  viewHistory(item: HistoryItem) {
    this.selectedHistoryItem = item;
    this.showHistoryModal = true;
  }

  closeHistoryModal() {
    this.showHistoryModal = false;
    this.selectedHistoryItem = null;
  }

  @HostListener('document:keydown', ['$event'])
  onGlobalKeydown(event: KeyboardEvent): void {
    const decision = decideGlobalKeydownAction({
      key: event.key,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      showHistoryModal: this.showHistoryModal,
      showHistory: this.showHistory,
      isRequestRunning: this.isRequestRunning
    });

    if (decision.shouldPreventDefault) {
      event.preventDefault();
    }
    if (decision.shouldStopPropagation) {
      event.stopPropagation();
    }

    switch (decision.action) {
      case 'saveAs':
        void this.saveCurrentFileAs();
        return;
      case 'save':
        void this.saveCurrentFile();
        return;
      case 'closeHistoryModal':
        this.closeHistoryModal();
        return;
      case 'toggleHistory':
        this.toggleHistory();
        return;
      case 'cancelRequest':
        void this.cancelActiveRequest();
        return;
      case 'none':
      default:
        return;
    }
  }

  openSecretsModal() {
    void this.loadVaultInfo();
    this.showSecretsModal = true;
  }

  closeLoadTestResults() {
    this.showLoadTestResults = false;
  }

  // File management methods (delegated to request manager)
  switchToFile(index: number) {
    this.onCurrentFileIndexChange(index);
  }

  closeTab(index: number) {
    const updated = this.workspace.closeTab(this.LAST_SESSION_KEY, this.files, this.currentFileIndex, index);

    const next = deriveAppStateAfterWorkspaceUpdateWithEnvSync({
      update: updated,
      syncCurrentEnvWithFile: (files, idx) => this.workspace.syncCurrentEnvWithFile(files, idx)
    });
    this.applyWorkspaceDerivedState(next);
    this.loadHistoryForFile(next.activeFileId || undefined);
  }

  async revealInFinder(index: number) {
    const file = this.files[index];
    if (!file?.filePath) {
      this.toast.info('This file has not been saved to disk yet.');
      return;
    }

    try {
      const { RevealInFinder } = await import('../../wailsjs/go/main/App');
      await RevealInFinder(file.filePath);
    } catch (error) {
      console.error('Failed to reveal file:', error);
      this.toast.error('Failed to reveal file in Finder.');
    }
  }

  closeOtherTabs(keepIndex: number) {
    const updated = this.workspace.closeOtherTabs(this.LAST_SESSION_KEY, this.files, keepIndex);
    const next = deriveAppStateAfterWorkspaceUpdateWithEnvSync({
      update: updated,
      syncCurrentEnvWithFile: (files, idx) => this.workspace.syncCurrentEnvWithFile(files, idx)
    });
    this.applyWorkspaceDerivedState(next);
    this.loadHistoryForFile(next.activeFileId || undefined);
  }

  addNewTab() {
    const updated = this.workspace.addNewTab(this.LAST_SESSION_KEY, this.files);

    const next = deriveAppStateAfterWorkspaceUpdateWithEnvSync({
      update: updated,
      syncCurrentEnvWithFile: (files, idx) => this.workspace.syncCurrentEnvWithFile(files, idx)
    });
    this.applyWorkspaceDerivedState(next);

    this.history = [];
  }

  async openFile() {
    try {
      // Use native file dialog via Wails for full file path support
      const { OpenFileDialog, ReadFileContents } = await import('../../wailsjs/go/main/App');
      const filePaths = await OpenFileDialog();
      
      if (filePaths && filePaths.length > 0) {
        for (const filePath of filePaths) {
          const existingIndex = findExistingOpenFileIndex(this.files, filePath);
          if (existingIndex >= 0) {
            this.switchToFile(existingIndex);
            continue;
          }
          const content = await ReadFileContents(filePath);
          const fileName = basename(filePath) || 'Untitled.http';
          this.addFileFromContent(fileName, content, filePath);
        }
      }
    } catch (error) {
      console.error('Failed to open file dialog:', error);
      // Fallback to browser file input
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.http';
      input.multiple = true;
      input.onchange = (event) => {
        const files = (event.target as HTMLInputElement).files;
        if (files) {
          for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const reader = new FileReader();
            reader.onload = (e) => {
              const content = e.target?.result as string;
              const fileName = file.name;
              this.addFileFromContent(fileName, content);
            };
            reader.readAsText(file);
          }
        }
      };
      input.click();
    }
  }

  onTabsReordered(event: { fromIndex: number; toIndex: number }) {
    const updated = this.workspace.reorderTabs(
      this.LAST_SESSION_KEY,
      this.files,
      this.currentFileIndex,
      event.fromIndex,
      event.toIndex
    );

    const next = deriveAppStateFromWorkspaceUpdate(updated);
    this.applyWorkspaceDerivedState(next);
  }

  private addFileFromContent(fileName: string, content: string, filePath?: string) {
    const updated = this.workspace.addFileFromContent(
      this.LAST_SESSION_KEY,
      this.files,
      fileName,
      content,
      filePath
    );

    const next = deriveAppStateFromWorkspaceUpdate(updated);
    this.applyWorkspaceDerivedState(next);
    this.history = [];
    if (next.activeFileId) {
      this.loadHistoryForFile(next.activeFileId);
    }
  }

  getEnvironments(): string[] {
    return this.currentFileEnvironments();
  }

  get currentFile(): FileTab {
    return this.files[this.currentFileIndex] || { id: generateFileId(), name: '', content: '', requests: [], environments: {}, variables: {}, responseData: {}, groups: [], selectedEnv: '' };
  }

  getActiveRequestDetails(): Request | null {
    if (!this.activeRequestInfo) {
      return null;
    }

    const file = this.currentFile;
    return file.requests?.[this.activeRequestInfo.requestIndex] || null;
  }

  getActiveRequestPreview(): string {
    const request = this.getActiveRequestDetails();
    return buildActiveRequestPreview(request);
  }

  get activeRunProgressView(): ActiveRunProgress | null {
    return this.activeRunProgress;
  }

  getActiveRequestMeta(): string {
    const request = this.getActiveRequestDetails();
    return buildActiveRequestMeta({
      activeRequestInfo: this.activeRequestInfo,
      isRequestRunning: this.isRequestRunning,
      isCancellingActiveRequest: this.isCancellingActiveRequest,
      nowMs: this.activeRunNowMs,
      activeRunProgress: this.activeRunProgress,
      activeRequestTimeoutMs: this.getActiveRequestTimeoutMs(),
      request
    });
  }

  footerStatus(): { label: string; detail: string; tone: 'idle' | 'pending' | 'success' | 'warning' | 'error' } {
    return decideFooterStatus({
      isRequestRunning: this.isRequestRunning,
      isCancellingActiveRequest: this.isCancellingActiveRequest,
      activeRequestMeta: this.getActiveRequestMeta(),
      lastResponseSummary: this.lastResponseSummary(),
      activeEnv: this.currentEnv()
    });
  }

  toggleConsole(force?: boolean) {
    if (typeof force === 'boolean') {
      this.consoleOpen.set(force);
      return;
    }
    this.consoleOpen.update(current => !current);
  }

  clearConsole() {
    void this.scriptConsole.clear();
  }

  trackLogEntry(index: number, entry: ScriptLogEntry): string {
    return buildTrackedLogEntryId(entry, index);
  }

  lastResponseSummary(): { status: string; time: string; code: number } | null {
    return buildLastResponseSummary(this.currentFile, this.lastExecutedRequestIndex);
  }

  private syncCurrentEnvWithFile(index: number): void {
    const synced = this.workspace.syncCurrentEnvWithFile(this.files, index);
    if (synced.files !== this.files) {
      this.files = synced.files;
      this.filesSignal.set(synced.files);
    }
    this.currentEnvSignal.set(synced.currentEnv || '');
  }

  private applyWorkspaceDerivedState(next: { files: FileTab[]; currentFileIndex: number; currentEnv: string }): void {
    this.files = next.files;
    this.filesSignal.set(next.files);
    this.currentFileIndex = next.currentFileIndex;
    this.currentFileIndexSignal.set(next.currentFileIndex);
    this.currentEnvSignal.set(next.currentEnv);
  }

  private replaceFileAtIndex(index: number, newFile: FileTab): void {
    const updated = this.workspace.replaceFileAtIndex(this.files, index, newFile);
    this.files = updated;
    this.filesSignal.set(updated);
  }

  private resetPendingRequestState(): void {
    this.stopActiveRunTick();

    const patch = buildPendingRequestResetPatch();
    this.isRequestRunning = patch.isRequestRunning;
    this.pendingRequestIndex = patch.pendingRequestIndex;
    this.activeRunProgress = patch.activeRunProgress;
    this.loadUsersSeries = patch.loadUsersSeries;
    this.loadRpsSeries = patch.loadRpsSeries;
    this.lastRpsSampleAtMs = patch.lastRpsSampleAtMs;
    this.lastRpsTotalSent = patch.lastRpsTotalSent;
    this.activeRequestInfo = patch.activeRequestInfo;
    this.isCancellingActiveRequest = patch.isCancellingActiveRequest;

    this.isRequestRunningSignal.set(this.isRequestRunning);
    this.pendingRequestIndexSignal.set(this.pendingRequestIndex);

    if (!this.isRequestRunning) {
      // Request lifecycle ended; clear download progress.
      this.downloadProgressSignal.set(null);
    }

    const q = consumeQueuedRequest({
      isRequestRunning: this.isRequestRunning,
      queuedRequestIndex: this.queuedRequestIndex
    });
    this.queuedRequestIndex = q.queuedRequestIndexAfter;
    const nextIndexToExecute = q.nextRequestIndexToExecute;
    if (nextIndexToExecute !== null) {
      setTimeout(() => this.onRequestExecute(nextIndexToExecute), 0);
    }
  }

  async saveCurrentFile(): Promise<void> {
    const file = this.currentFile;
    if (!file) return;

    try {
      const { SaveFileContents, ShowSaveDialog, MigrateResponsesFromRunLocationToHttpFile } = await import('../../wailsjs/go/main/App');

      if (file.filePath && file.filePath.length) {
        await SaveFileContents(file.filePath, file.content);
      } else {
        const previousId = file.id;
        // Ask for a location
        const defaultName = buildFirstSaveDefaultName(file);
        const path = await ShowSaveDialog(defaultName);
        if (path && path.length) {
          await SaveFileContents(path, file.content);

          // Capture history before migrating files on disk.
          let priorHistory: HistoryItem[] = [];
          try {
            priorHistory = await this.httpService.loadHistory(previousId);
          } catch (historyErr) {
            console.warn('Failed to load prior history on first save:', historyErr);
          }

          // Move {unsavedId}.responses/ from run location into {fileName}.responses/ beside the saved file.
          try {
            await MigrateResponsesFromRunLocationToHttpFile(previousId, path);
          } catch (moveErr) {
            console.warn('Failed to migrate response files on first save:', moveErr);
          }

          // Update file metadata to point to saved path
          const updated = buildFileAfterSave(file, path);
          const idx = this.currentFileIndex;
          this.replaceFileAtIndex(idx, updated);
          this.httpService.saveFiles(this.files);

          // Migrate history state for the renamed file
          try {
            const decision = decideFirstSaveHistoryMigration({
              previousId,
              newId: updated.id,
              priorHistory,
              activeFileId: this.files[this.currentFileIndex]?.id
            });

            if (decision.shouldMigrate) {
              this.historyStore.delete(decision.oldId);
              this.historyStore.set(decision.newId, decision.newHistory);
              if (decision.activeHistory) {
                this.history = decision.activeHistory;
              }
            }
          } catch (historyErr) {
            console.warn('Failed to migrate history on first save:', historyErr);
          }
        }
      }
    } catch (err) {
      console.error('Failed to save file:', err);
    }
  }

  async saveCurrentFileAs(): Promise<void> {
    const file = this.currentFile;
    if (!file) return;

    try {
      const { SaveFileContents, ShowSaveDialog, MigrateResponsesFromRunLocationToHttpFile } = await import('../../wailsjs/go/main/App');

      const previousId = file.id;
      const previousPath = file.filePath;
      const defaultName = buildSaveAsDefaultName(file);
      const path = await ShowSaveDialog(defaultName);
      if (!path || !path.length) {
        return;
      }

      await SaveFileContents(path, file.content);
      const updated = buildFileAfterSave(file, path);

      const idx = this.currentFileIndex;
      this.replaceFileAtIndex(idx, updated);
      this.httpService.saveFiles(this.files);

      try {
        const priorHistory = await this.httpService.loadHistory(previousId, previousPath);

        if (!previousPath || !previousPath.length) {
          try {
            await MigrateResponsesFromRunLocationToHttpFile(previousId, path);
          } catch (moveErr) {
            console.warn('Failed to migrate response files on Save As:', moveErr);
          }
        }

        const decision = decideSaveAsHistoryMigration({
          previousId,
          newId: updated.id,
          priorHistory,
          activeFileId: this.files[this.currentFileIndex]?.id
        });
        this.historyStore.delete(decision.oldId);
        this.historyStore.set(decision.newId, decision.newHistory);
        if (decision.activeHistory) {
          this.history = decision.activeHistory;
        }
      } catch (historyErr) {
        console.warn('Failed to migrate history on Save As:', historyErr);
      }
    } catch (err) {
      console.error('Failed to save file as:', err);
    }
  }

  async openExamplesFile(): Promise<void> {
    try {
      const { GetExamplesFile } = await import('../../wailsjs/go/main/App');
      const result = await GetExamplesFile();
      const content = result?.content || '';
      const name = result?.filePath || 'Examples.http';

      const updated = this.workspace.upsertExamplesTab(this.LAST_SESSION_KEY, this.files, content, name);

      const next = deriveAppStateFromWorkspaceUpdate(updated);
      this.files = next.files;
      this.filesSignal.set(next.files);
      this.currentFileIndex = next.currentFileIndex;
      this.currentFileIndexSignal.set(next.currentFileIndex);
      this.currentEnvSignal.set(next.currentEnv);

      if (next.activeFileId === '__examples__') {
        this.history = [];
      }
    } catch (error) {
      console.error('Failed to open examples file:', error);
      this.toast.error('Failed to open examples file.');
    }
  }

  private loadHistoryForFile(fileId?: string): void {
    if (!fileId) {
      this.history = [];
      return;
    }

    const filePath = this.files.find(file => file.id === fileId)?.filePath;

    const cached = this.historyStore.get(fileId);
    if (cached) {
      this.history = cached;
      return;
    }

    this.historyStore.ensureLoaded(fileId, filePath)
      .then(history => {
        if (this.files[this.currentFileIndex]?.id === fileId) {
          this.history = history;
        }
      })
      .catch(error => console.error('Failed to load history for file', fileId, error));
  }

  donate(amount: number) {
    this.showDonationModal = false;
  }

  async handleSecretSave(secret: { env: string; key: string; value: string }) {
    const normalizedEnv = normalizeEnvName(secret.env);
    try {
      const snapshot = await this.secretService.save(normalizedEnv, secret.key, secret.value);
      this.allSecrets = snapshot;
      await this.loadVaultInfo(true);
      this.toast.success(buildSecretSavedToast({ key: secret.key, env: normalizedEnv }));
    } catch (error) {
      console.error('Failed to save secret', error);
      this.toast.error('Failed to save secret');
    }
  }

  confirmDeleteSecret(env: string, key: string) {
    this.secretToDelete = { env, key };
    this.showDeleteConfirmModal = true;
  }

  async deleteSecret() {
    if (!this.secretToDelete) {
      return;
    }
    try {
      const snapshot = await this.secretService.remove(this.secretToDelete.env, this.secretToDelete.key);
      this.allSecrets = snapshot;
      await this.loadVaultInfo(true);
      this.toast.info(buildSecretDeletedToast(this.secretToDelete.key));
    } catch (error) {
      console.error('Failed to delete secret', error);
      this.toast.error('Failed to delete secret');
    }
    this.showDeleteConfirmModal = false;
    this.secretToDelete = null;
  }

  cancelDeleteSecret() {
    this.showDeleteConfirmModal = false;
    this.secretToDelete = null;
  }

  async handleVaultExport() {
    try {
      const payload = await this.secretService.export();
      const fileName = buildVaultFileName(new Date());
      this.downloadSecretsFile(payload, fileName);
      this.toast.success(buildVaultExportedToast(fileName));
    } catch (error) {
      console.error('Failed to export secrets', error);
      this.toast.error('Failed to export secrets');
    }
  }

  async handleVaultReset() {
    const confirmed = confirm('Resetting the vault deletes all stored secrets on this device. Continue?');
    if (!confirmed) {
      return;
    }
    try {
      await this.secretService.resetVault();
      this.allSecrets = {};
      await this.loadVaultInfo(true);
      this.toast.info('Vault reset. Add new secrets to continue.');
    } catch (error) {
      console.error('Failed to reset vault', error);
      this.toast.error('Failed to reset vault');
    }
  }

  async cancelActiveRequest() {
    const decision = decideCancelActiveRequest({
      activeRequestId: this.activeRequestInfo?.id,
      isCancelling: this.isCancellingActiveRequest,
      hasRequestManager: Boolean(this.requestManager)
    });
    if (!decision.shouldCancel) {
      return;
    }

    this.isCancellingActiveRequest = decision.isCancellingAfterStart;
    try {
      await this.requestManager.cancelActiveRequest();
      this.toast.info('Request cancelled');
    } catch (error) {
      console.error('Failed to cancel request', error);
      this.toast.error('Failed to cancel request');
      const patch = buildCancelActiveRequestErrorPatch();
      this.isCancellingActiveRequest = patch.isCancellingActiveRequest;
    }
  }

  private startActiveRunTick(): void {
    this.stopActiveRunTick();
    this.activeRunNowMs = Date.now();
    this.activeRunTickHandle = setInterval(() => {
      this.activeRunNowMs = Date.now();
      const actions = decideActiveRunTickActions({
        isRequestRunning: this.isRequestRunning,
        activeRequestType: this.activeRequestInfo?.type,
        activeUsers: this.activeRunProgress?.activeUsers
      });

      if (actions.usersSample !== null) {
        this.pushLoadUsersSample(actions.usersSample);
      }
      if (actions.shouldSampleRps) {
        this.sampleLoadRps();
      }
      if (actions.shouldEnsureSparkline) {
        this.ensureSparklineAnimation();
      }
    }, 200);

    // Only start rAF animation for load runs.
    const initialActions = decideActiveRunTickActions({
      isRequestRunning: this.isRequestRunning,
      activeRequestType: this.activeRequestInfo?.type,
      activeUsers: this.activeRunProgress?.activeUsers
    });
    if (initialActions.shouldEnsureSparkline) {
      this.ensureSparklineAnimation();
    }
  }

  private ensureSparklineAnimation(): void {
    if (this.sparklineRafHandle !== null) return;
    this.sparklineLastFrameAtMs = null;
    this.sparklineLastRenderedAtMs = null;

    const step = (t: number) => {
      this.sparklineRafHandle = requestAnimationFrame(step);

      // Only animate during an active load run.
      if (!this.isRequestRunning || this.activeRequestInfo?.type !== 'load') {
        return;
      }

      // Use rAF's high-resolution timestamp for stable frame deltas.
      const last = this.sparklineLastFrameAtMs;
      this.sparklineLastFrameAtMs = t;
      const dt = last === null ? 0 : Math.max(0, Math.min(50, t - last));

      // Keep lastRenderedAt for debugging/telemetry (not throttling).
      this.sparklineLastRenderedAtMs = t;

      // Smooth the RPS readout every frame; the RPS sparkline also uses this value.
      this.rpsRenderValue = smoothTowards(this.rpsRenderValue, this.rpsRenderTarget, dt);

      const usersTick = tickUsersSparklineUi({
        state: {
          series: this.loadUsersSeries,
          queue: this.loadUsersQueue,
          scrollPhase: this.loadUsersScrollPhase,
          nextValue: this.loadUsersNextValue
        },
        dtMs: dt,
        maxPoints: this.loadUsersSeriesMaxPoints,
        scrollMs: this.loadUsersScrollMs,
        maxUsers: this.activeRunProgress?.maxUsers,
        currentPathDView: this.loadUsersSparklinePathDView
      });

      this.loadUsersSeries = usersTick.state.series;
      this.loadUsersQueue = usersTick.state.queue;
      this.loadUsersScrollPhase = usersTick.state.scrollPhase;
      this.loadUsersNextValue = usersTick.state.nextValue;
      this.loadUsersSparklineTransformView = usersTick.transformView;
      this.loadUsersSparklinePathDView = usersTick.pathDView;

      const rpsTick = tickRpsSparklineUi({
        state: {
          series: this.loadRpsSeries,
          queue: this.loadRpsQueue,
          scrollPhase: this.loadRpsScrollPhase,
          nextValue: this.loadRpsNextValue
        },
        dtMs: dt,
        maxPoints: this.loadRpsSeriesMaxPoints,
        scrollMs: this.loadRpsScrollMs,
        currentPathDView: this.loadRpsSparklinePathDView
      });

      this.loadRpsSeries = rpsTick.state.series;
      this.loadRpsQueue = rpsTick.state.queue;
      this.loadRpsScrollPhase = rpsTick.state.scrollPhase;
      this.loadRpsNextValue = rpsTick.state.nextValue;
      this.loadRpsSparklineTransformView = rpsTick.transformView;
      this.loadRpsSparklinePathDView = rpsTick.pathDView;
    };

    this.sparklineRafHandle = requestAnimationFrame(step);
  }

  private pushLoadUsersSample(value: number): void {
    const r = pushUsersSampleToQueue(
      this.loadUsersQueue,
      this.loadUsersSeries,
      this.loadUsersNextValue,
      this.loadUsersSeriesMaxPoints,
      this.loadUsersRampSteps,
      value
    );
    this.loadUsersQueue = r.queue;
  }


  private sampleLoadRps(): void {
    const r = sampleAndApplyRpsUiState({
      samplingState: {
        lastSampleAtMs: this.lastRpsSampleAtMs,
        lastTotalSent: this.lastRpsTotalSent,
        lastSmoothed: this.lastRpsSmoothed
      },
      nowMs: this.activeRunNowMs,
      totalSent: this.activeRunProgress?.totalSent,
      queue: this.loadRpsQueue,
      series: this.loadRpsSeries,
      nextValue: this.loadRpsNextValue,
      maxPoints: this.loadRpsSeriesMaxPoints,
      rampSteps: this.loadRpsRampSteps,
      rpsRenderTarget: this.rpsRenderTarget,
      rpsRenderValue: this.rpsRenderValue
    });

    this.lastRpsSampleAtMs = r.samplingState.lastSampleAtMs;
    this.lastRpsTotalSent = r.samplingState.lastTotalSent;
    this.lastRpsSmoothed = r.samplingState.lastSmoothed;
    this.loadRpsQueue = r.queue;
    this.rpsRenderTarget = r.rpsRenderTarget;
    this.rpsRenderValue = r.rpsRenderValue;
  }


  get currentLoadRpsView(): number {
    const series = this.loadRpsSeries;
    if (!series.length) return 0;
    return series[series.length - 1] ?? 0;
  }

  private stopActiveRunTick(): void {
    if (this.activeRunTickHandle) {
      clearInterval(this.activeRunTickHandle);
      this.activeRunTickHandle = null;
    }

    if (this.sparklineRafHandle !== null) {
      cancelAnimationFrame(this.sparklineRafHandle);
      this.sparklineRafHandle = null;
    }

    const patch = buildStopActiveRunTickPatch();
    this.loadUsersQueue = patch.loadUsersQueue;
    this.loadUsersScrollPhase = patch.loadUsersScrollPhase;
    this.loadUsersNextValue = patch.loadUsersNextValue;
    this.loadUsersSparklineTransformView = patch.loadUsersSparklineTransformView;
    this.loadUsersSparklinePathDView = patch.loadUsersSparklinePathDView;
    this.loadRpsQueue = patch.loadRpsQueue;
    this.loadRpsScrollPhase = patch.loadRpsScrollPhase;
    this.loadRpsNextValue = patch.loadRpsNextValue;
    this.loadRpsSparklineTransformView = patch.loadRpsSparklineTransformView;
    this.loadRpsSparklinePathDView = patch.loadRpsSparklinePathDView;
    this.sparklineLastFrameAtMs = patch.sparklineLastFrameAtMs;
    this.sparklineLastRenderedAtMs = patch.sparklineLastRenderedAtMs;
  }

  private getActiveRequestTimeoutMs(): number | null {
    const req = this.getActiveRequestDetails();
    return getRequestTimeoutMs(req);
  }

  private downloadSecretsFile(content: string, fileName: string) {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private async checkForUpdates(): Promise<void> {
    try {
      await this.updateService.checkForUpdates();
    } catch (error) {
      // Silently fail - update check is non-critical
      console.warn('Update check failed:', error);
    }
  }

  private async checkFirstRun() {
    try {
      const { GetExamplesForFirstRun } = await import('../../wailsjs/go/main/App');
      const resp = await GetExamplesForFirstRun();
      const content = resp?.content || '';
      const filePath = resp?.filePath || 'examples.http';
      const isFirstRun = !!resp?.isFirstRun;

      if (isFirstRun && content) {
        // Open the examples file
        const fileName = 'examples.http';
        this.addFileFromContent(fileName, content, filePath);
        try {
          const { MarkFirstRunComplete } = await import('../../wailsjs/go/main/App');
          await MarkFirstRunComplete();
        } catch (err) {
          console.warn('Failed to mark first run complete:', err);
        }
      }
    } catch (error) {
      console.warn('Failed to check for first run:', error);
    }
  }

  // Script Snippets
  openSnippetModal(): void {
    this.showSnippetModal = true;
    setTimeout(() => this.snippetModal?.open(), 0);
  }

  onSnippetSelected(event: { snippet: ScriptSnippet; type: 'pre' | 'post' }): void {
    const { snippet, type } = event;
    const code = type === 'pre' ? snippet.preScript : snippet.postScript;
    if (!code) return;

    const scriptBlock = type === 'pre' 
      ? `\n< {\n${code}\n}\n` 
      : `\n> {\n${code}\n}\n`;

    // Insert at cursor position using the editor component
    if (this.editorComponent) {
      this.editorComponent.insertAtCursor(scriptBlock);
    } else {
      // Fallback: append to end if editor not available
      const file = this.files[this.currentFileIndex];
      if (file) {
        const newContent = file.content + scriptBlock;
        this.onEditorContentChange(newContent);
      }
    }
    
    this.toast.success(`Inserted "${snippet.name}" snippet`);
    this.showSnippetModal = false;
  }
}
