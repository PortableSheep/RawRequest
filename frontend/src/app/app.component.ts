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
import { FileTab, ResponseData, HistoryItem, Request, ScriptLogEntry, ActiveRunProgress } from './models/http.models';
import { HttpService } from './services/http.service';
import { SecretService, SecretIndex, VaultInfo } from './services/secret.service';
import { ScriptConsoleService } from './services/script-console.service';
import { ToastService } from './services/toast.service';
import { UpdateService } from './services/update.service';
import { ScriptSnippet } from './services/script-snippet.service';
import { basename } from './utils/path';
import { generateFileId, normalizeFileTab } from './utils/file-tab-utils';
import { HistoryStoreService } from './services/history-store.service';
import { WorkspaceFacadeService } from './services/workspace-facade.service';
import { Subject, takeUntil } from 'rxjs';
import { gsap } from 'gsap';

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

  // State management - convert to signals
  filesSignal = signal<FileTab[]>([]);
  currentFileIndexSignal = signal<number>(0);
  currentEnvSignal = signal<string>('');

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

  // Legacy properties for compatibility
  files: FileTab[] = [];
  currentFileIndex = 0;
  // currentEnv = '';
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
  // History is cached in HistoryStoreService
  // executeRequestTrigger = signal<number | null>(null);

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

  constructor() {}

  ngOnInit() {
    this.restoreSplitState();
    this.refreshSplitLayoutState();

    // Load initial data
    // this.loadEnvironmentPreference();
    this.loadFiles();
    this.refreshSecrets(true);

    // Wire update events + fetch app version (non-blocking)
    this.updateService.init();

    // Check for updates (non-blocking)
    this.checkForUpdates();

    // Check if this is first run and open examples
    this.checkFirstRun();

    this.secretService
      .onMissingSecret()
      .pipe(takeUntil(this.destroy$))
      .subscribe(({ env, key }) => {
        // this.showAlert(`Secret "${key}" is missing in environment "${env}"`, 'warning');
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
    const splitterColWidth = 10;
    const minLeft = 340;
    const minRight = 420;
    const maxLeft = Math.max(minLeft, rect.width - minRight - splitterColWidth);

    const dx = event.clientX - this.splitDragStartX;
    const next = Math.max(minLeft, Math.min(maxLeft, this.splitDragStartWidth + dx));
    this.editorPaneWidthPx = Math.round(next);
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
    try {
      localStorage.setItem(this.EDITOR_SPLIT_WIDTH_KEY, String(this.editorPaneWidthPx));
    } catch {
      // ignore
    }
  }

  onSplitMouseDown(event: MouseEvent) {
    if (!this.isSplitLayout) return;
    this.isSplitDragging = true;
    this.splitDragStartX = event.clientX;
    this.splitDragStartWidth = this.editorPaneWidthPx;
    event.preventDefault();
  }

  resetSplit() {
    this.editorPaneWidthPx = 520;
    this.splitGridTemplateColumns = this.computeSplitGridTemplateColumns();
    try {
      localStorage.setItem(this.EDITOR_SPLIT_WIDTH_KEY, String(this.editorPaneWidthPx));
    } catch {
      // ignore
    }
  }

  private restoreSplitState(): void {
    try {
      const raw = localStorage.getItem(this.EDITOR_SPLIT_WIDTH_KEY);
      const n = raw ? parseInt(raw, 10) : NaN;
      if (Number.isFinite(n) && n > 0) {
        this.editorPaneWidthPx = n;
      }
    } catch {
      // ignore
    }
  }

  private refreshSplitLayoutState(): void {
    // Tailwind `lg` breakpoint is 1024px.
    this.isSplitLayout = typeof window !== 'undefined' && window.innerWidth >= 1024;
    this.splitGridTemplateColumns = this.computeSplitGridTemplateColumns();
  }

  private computeSplitGridTemplateColumns(): string | null {
    if (!this.isSplitLayout) {
      return null;
    }
    // editor | splitter | response
    return `minmax(0, ${this.editorPaneWidthPx}px) 10px minmax(0, 1fr)`;
  }

  private clampSplitWidthToContainer(): void {
    if (!this.isSplitLayout) return;
    const container = this.mainSplitEl?.nativeElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const splitterColWidth = 10;
    const minLeft = 340;
    const minRight = 420;
    const maxLeft = Math.max(minLeft, rect.width - minRight - splitterColWidth);
    const clamped = Math.max(minLeft, Math.min(maxLeft, this.editorPaneWidthPx));
    if (clamped !== this.editorPaneWidthPx) {
      this.editorPaneWidthPx = Math.round(clamped);
      this.splitGridTemplateColumns = this.computeSplitGridTemplateColumns();
    }
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.alertTimeout) {
      clearTimeout(this.alertTimeout);
    }
  }

  private loadFiles(): void {
    const initial = this.workspace.loadFromStorage(this.LAST_SESSION_KEY);
    if (initial.files.length > 0) {
      this.files = initial.files;
      this.filesSignal.set(initial.files);
      this.currentFileIndex = initial.currentFileIndex;
      this.currentFileIndexSignal.set(initial.currentFileIndex);

      const synced = this.workspace.syncCurrentEnvWithFile(this.files, this.currentFileIndex);
      this.files = synced.files;
      this.filesSignal.set(synced.files);
      this.currentEnvSignal.set(synced.currentEnv || '');

      this.loadHistoryForFile(this.files[this.currentFileIndex]?.id);
      this.workspace.persistSessionState(this.LAST_SESSION_KEY, this.files, this.currentFileIndex);
    } else {
      // Create default file with example content
      this.addNewTab();
    }
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

    const activeFile = this.files[this.currentFileIndex];
    if (activeFile) {
      const cached = this.historyStore.get(activeFile.id);
      if (cached) {
        this.history = cached;
      } else {
        this.history = [];
        this.loadHistoryForFile(activeFile.id);
      }
    } else {
      this.history = [];
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

    this.loadHistoryForFile(this.files[index]?.id);
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
  onEditorContentChange(content: string) {
    const updated = this.workspace.updateFileContent(this.files, this.currentFileIndex, content);
    this.files = updated.files;
    this.filesSignal.set(updated.files);
    this.currentEnvSignal.set(updated.currentEnv || '');
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

    this.isRequestRunning = true;
    this.pendingRequestIndex = requestIndex;
    const request = activeFile.requests[requestIndex];
    const requestId = this.buildRequestToken(activeFile.id, requestIndex);
    this.activeRequestInfo = {
      id: requestId,
      label: this.buildRequestLabel(request),
      requestIndex,
      canCancel: true,
      type: request.loadTest ? 'load' : request.depends ? 'chain' : 'single',
      startedAt: Date.now()
    };
    this.isCancellingActiveRequest = false;
    this.activeRunProgress = null;
    this.loadUsersSeries = Array(this.loadUsersSeriesMaxPoints).fill(0);
		this.loadUsersQueue = [];
		this.loadUsersScrollPhase = 0;
		this.loadUsersNextValue = null;
    this.loadUsersSparklineTransformView = '';
		this.loadUsersSparklinePathDView = this.buildLoadUsersSparklinePathD(this.loadUsersSeries);

		this.loadRpsSeries = Array(this.loadRpsSeriesMaxPoints).fill(0);
		this.loadRpsQueue = [];
		this.loadRpsScrollPhase = 0;
		this.loadRpsNextValue = null;
    this.loadRpsSparklineTransformView = '';
    this.loadRpsSparklinePathDView = this.buildLoadRpsSparklinePathD(undefined, this.loadRpsSeries);
    this.lastRpsSampleAtMs = null;
    this.lastRpsTotalSent = null;
  	this.lastRpsSmoothed = null;
  	this.rpsRenderValue = null;
  	this.rpsRenderTarget = null;
    this.startActiveRunTick();

    const execution = this.requestManager.executeRequestByIndex(requestIndex, requestId);
    execution?.catch(error => {
      console.error('Request execution failed', error);
      this.resetPendingRequestState();
    });
  }

  onRequestExecuted(result: { requestIndex: number; response: ResponseData }) {
    this.lastExecutedRequestIndex = result.requestIndex;
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
    // Save shortcuts
    if ((event.metaKey || event.ctrlKey) && (event.key === 's' || event.key === 'S')) {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) {
        void this.saveCurrentFileAs();
      } else {
        void this.saveCurrentFile();
      }
      return;
    }

    // Overlay close
    if (event.key !== 'Escape') return;

    // Close only the topmost layer.
    if (this.showHistoryModal) {
      event.preventDefault();
      event.stopPropagation();
      this.closeHistoryModal();
      return;
    }

    if (this.showHistory) {
      event.preventDefault();
      event.stopPropagation();
      this.toggleHistory();
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
    this.files = updated.files;
    this.filesSignal.set(updated.files);
    this.currentFileIndex = updated.currentFileIndex;
    this.currentFileIndexSignal.set(updated.currentFileIndex);

    if (this.files.length) {
      const synced = this.workspace.syncCurrentEnvWithFile(this.files, this.currentFileIndex);
      if (synced.files !== this.files) {
        this.files = synced.files;
        this.filesSignal.set(synced.files);
      }
      this.currentEnvSignal.set(synced.currentEnv || '');
      this.loadHistoryForFile(this.files[this.currentFileIndex]?.id);
    } else {
      this.currentEnvSignal.set('');
      this.history = [];
    }
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
    this.files = updated.files;
    this.filesSignal.set(updated.files);
    this.currentFileIndex = updated.currentFileIndex;
    this.currentFileIndexSignal.set(updated.currentFileIndex);

    const synced = this.workspace.syncCurrentEnvWithFile(this.files, this.currentFileIndex);
    if (synced.files !== this.files) {
      this.files = synced.files;
      this.filesSignal.set(synced.files);
    }
    this.currentEnvSignal.set(synced.currentEnv || '');
    this.loadHistoryForFile(this.files[this.currentFileIndex]?.id);
  }

  addNewTab() {
    const updated = this.workspace.addNewTab(this.LAST_SESSION_KEY, this.files);
    this.files = updated.files;
    this.filesSignal.set(updated.files);
    this.currentFileIndex = updated.currentFileIndex;
    this.currentFileIndexSignal.set(updated.currentFileIndex);

    const synced = this.workspace.syncCurrentEnvWithFile(this.files, this.currentFileIndex);
    if (synced.files !== this.files) {
      this.files = synced.files;
      this.filesSignal.set(synced.files);
    }
    this.currentEnvSignal.set(synced.currentEnv || '');

    this.history = [];
  }

  async openFile() {
    try {
      // Use native file dialog via Wails for full file path support
      const { OpenFileDialog, ReadFileContents } = await import('../../wailsjs/go/main/App');
      const filePaths = await OpenFileDialog();
      
      if (filePaths && filePaths.length > 0) {
        for (const filePath of filePaths) {
          const existingIndex = this.files.findIndex(file => file.filePath === filePath || file.id === filePath);
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

    this.files = updated.files;
    this.filesSignal.set(updated.files);
    this.currentFileIndex = updated.currentFileIndex;
    this.currentFileIndexSignal.set(updated.currentFileIndex);
  }

  private addFileFromContent(fileName: string, content: string, filePath?: string) {
    const updated = this.workspace.addFileFromContent(
      this.LAST_SESSION_KEY,
      this.files,
      fileName,
      content,
      filePath
    );

    this.files = updated.files;
    this.filesSignal.set(updated.files);
    this.currentFileIndex = updated.currentFileIndex;
    this.currentFileIndexSignal.set(updated.currentFileIndex);

    this.currentEnvSignal.set(updated.currentEnv || '');
    this.history = [];
    if (updated.activeFileId) {
      this.loadHistoryForFile(updated.activeFileId);
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
    if (!request) {
      return '// Waiting for the next request to start.';
    }

    const method = (request.method || 'GET').toUpperCase();
    const url = request.url || request.name || 'https://';
    const body = typeof request.body === 'string' ? request.body.trim() : '';
    return body ? `${method} ${url}\n\n${body}` : `${method} ${url}`;
  }

  get activeRunProgressView(): ActiveRunProgress | null {
    return this.activeRunProgress;
  }

  getActiveRequestMeta(): string {
    if (!this.activeRequestInfo) {
      return 'Awaiting request';
    }

    if (this.isCancellingActiveRequest) {
      return 'Canceling active request';
    }

    if (this.isRequestRunning) {
      const elapsedMs = Math.max(0, this.activeRunNowMs - this.activeRequestInfo.startedAt);
      const elapsed = this.formatClock(elapsedMs);

      if (this.activeRequestInfo.type === 'load') {
        const total = this.activeRunProgress?.totalSent ?? 0;
        const ok = this.activeRunProgress?.successful ?? 0;
        const failed = this.activeRunProgress?.failed ?? 0;
        const planned = this.activeRunProgress?.plannedDurationMs ?? null;
        if (planned && planned > 0) {
          const remainingMs = Math.max(0, (this.activeRequestInfo.startedAt + planned) - this.activeRunNowMs);
          const remaining = this.formatClock(remainingMs);
          return `Load test running · ${total} sent · ${ok} ok · ${failed} failed · ${elapsed} elapsed · ${remaining} remaining`;
        }
        return `Load test running · ${total} sent · ${ok} ok · ${failed} failed · ${elapsed} elapsed`;
      }

      const timeoutMs = this.getActiveRequestTimeoutMs();
      if (timeoutMs && timeoutMs > 0) {
        const remainingMs = Math.max(0, (this.activeRequestInfo.startedAt + timeoutMs) - this.activeRunNowMs);
        const remaining = this.formatClock(remainingMs);
        return `Request running · ${elapsed} elapsed · ${remaining} remaining`;
      }

      return `Request running · ${elapsed} elapsed`;
    }

    const request = this.getActiveRequestDetails();
    const method = request?.method?.toUpperCase() || '—';
    const target = request?.url || request?.name || 'Untitled request';
    return `${method} · ${target}`;
  }

  footerStatus(): { label: string; detail: string; tone: 'idle' | 'pending' | 'success' | 'warning' | 'error' } {
    if (this.isRequestRunning) {
      return {
        label: this.isCancellingActiveRequest ? 'Canceling run' : 'Running request',
        detail: this.getActiveRequestMeta(),
        tone: this.isCancellingActiveRequest ? 'warning' : 'pending'
      };
    }

    const summary = this.lastResponseSummary();
    if (summary) {
      let tone: 'success' | 'warning' | 'error';
      if (summary.code >= 200 && summary.code < 300) {
        tone = 'success';
      } else if (summary.code >= 400 || summary.code === 0) {
        tone = 'error';
      } else {
        tone = 'warning';
      }
      return {
        label: summary.status,
        detail: summary.time,
        tone
      };
    }

    const activeEnv = this.currentEnv();
    return {
      label: 'Ready to send',
      detail: activeEnv ? `Env · ${activeEnv}` : 'Waiting for next request',
      tone: 'idle'
    };
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
    return `${entry.timestamp}-${entry.source}-${index}`;
  }

  lastResponseSummary(): { status: string; time: string; code: number } | null {
    if (this.lastExecutedRequestIndex === null) {
      return null;
    }
    const response = this.currentFile.responseData?.[this.lastExecutedRequestIndex];
    if (!response) {
      return null;
    }
    return {
      status: `${response.status} ${response.statusText}`.trim(),
      time: `${response.responseTime}ms`,
      code: response.status
    };
  }
  //
  // private loadEnvironmentPreference(): void {
  //   this.currentEnv = localStorage.getItem('rawrequest_environment') || '';
  // }
  //
  // private saveEnvironmentPreference(): void {
  //   localStorage.setItem('rawrequest_environment', this.currentEnv);
  // }

  private syncCurrentEnvWithFile(index: number): void {
    const synced = this.workspace.syncCurrentEnvWithFile(this.files, index);
    if (synced.files !== this.files) {
      this.files = synced.files;
      this.filesSignal.set(synced.files);
    }
    this.currentEnvSignal.set(synced.currentEnv || '');
  }

  private replaceFileAtIndex(index: number, newFile: FileTab): void {
    const updated = this.workspace.replaceFileAtIndex(this.files, index, newFile);
    this.files = updated;
    this.filesSignal.set(updated);
  }

  private resetPendingRequestState(): void {
    this.isRequestRunning = false;
    this.pendingRequestIndex = null;
    this.stopActiveRunTick();
    this.activeRunProgress = null;
    this.loadUsersSeries = [];
    this.loadRpsSeries = [];
    this.lastRpsSampleAtMs = null;
    this.lastRpsTotalSent = null;
    this.clearActiveRequestState();
    this.triggerQueuedRequestIfNeeded();
  }

  async saveCurrentFile(): Promise<void> {
    const file = this.currentFile;
    if (!file) return;

    try {
      const { SaveFileContents, ShowSaveDialog } = await import('../../wailsjs/go/main/App');

      if (file.filePath && file.filePath.length) {
        await SaveFileContents(file.filePath, file.content);
        console.log('Saved file to', file.filePath);
      } else {
        const previousId = file.id;
        // Ask for a location
        const defaultName = file.name || file.displayName || 'untitled.http';
        const path = await ShowSaveDialog(defaultName);
        if (path && path.length) {
          await SaveFileContents(path, file.content);
          // Update file metadata to point to saved path
          const updated = { ...file, filePath: path, id: path, name: basename(path) } as any;
          const idx = this.currentFileIndex;
          this.replaceFileAtIndex(idx, updated);
          this.httpService.saveFiles(this.files);
          console.log('Saved new file to', path);

          // Migrate any existing (unsaved) history into the file directory
          try {
            const priorHistory = await this.httpService.loadHistory(previousId);
            if (priorHistory?.length) {
              await this.httpService.saveHistorySnapshot(updated.id, priorHistory, updated.filePath);
              this.historyStore.delete(previousId);
              this.historyStore.set(updated.id, priorHistory);
              if (this.files[this.currentFileIndex]?.id === updated.id) {
                this.history = priorHistory;
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
      const { SaveFileContents, ShowSaveDialog } = await import('../../wailsjs/go/main/App');

      const previousId = file.id;
      const previousPath = file.filePath;
      const defaultName = basename(file.filePath || file.name || file.displayName || 'untitled.http');
      const path = await ShowSaveDialog(defaultName);
      if (!path || !path.length) {
        return;
      }

      await SaveFileContents(path, file.content);
      const updated = {
        ...file,
        filePath: path,
        id: path,
        name: basename(path)
      } as any;

      const idx = this.currentFileIndex;
      this.replaceFileAtIndex(idx, updated);
      this.httpService.saveFiles(this.files);
      console.log('Saved file as', path);

      try {
        const priorHistory = await this.httpService.loadHistory(previousId, previousPath);
        if (priorHistory?.length) {
          await this.httpService.saveHistorySnapshot(updated.id, priorHistory, updated.filePath);
        }
        this.historyStore.delete(previousId);
        this.historyStore.set(updated.id, priorHistory || []);
        if (this.files[this.currentFileIndex]?.id === updated.id) {
          this.history = this.historyStore.get(updated.id) || [];
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
      this.files = updated.files;
      this.filesSignal.set(updated.files);
      this.currentFileIndex = updated.currentFileIndex;
      this.currentFileIndexSignal.set(updated.currentFileIndex);
      this.currentEnvSignal.set(updated.currentEnv || '');

      if (updated.activeFileId === '__examples__') {
        this.history = [];
      }
    } catch (error) {
      console.error('Failed to open examples file:', error);
      this.toast.error('Failed to open examples file.');
    }
  }

  private triggerQueuedRequestIfNeeded(): void {
    if (this.isRequestRunning) {
      return;
    }
    const nextIndex = this.queuedRequestIndex;
    if (nextIndex === null || nextIndex === undefined) {
      return;
    }
    this.queuedRequestIndex = null;
    setTimeout(() => this.onRequestExecute(nextIndex), 0);
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
    const normalizedEnv = (secret.env || '').trim() || 'default';
    try {
      const snapshot = await this.secretService.save(normalizedEnv, secret.key, secret.value);
      this.allSecrets = snapshot;
      await this.loadVaultInfo(true);
      this.toast.success(`Saved secret "${secret.key}" to ${normalizedEnv}`);
    } catch (error) {
      console.error('Failed to save secret', error);
      this.toast.error('Failed to save secret');
    }
  }

  confirmDeleteSecret(env: string, key: string) {
    console.log('Confirming delete:', env, key);
    this.secretToDelete = { env, key };
    this.showDeleteConfirmModal = true;
  }

  async deleteSecret() {
    if (!this.secretToDelete) {
      return;
    }
    console.log('Deleting secret');
    try {
      const snapshot = await this.secretService.remove(this.secretToDelete.env, this.secretToDelete.key);
      this.allSecrets = snapshot;
      await this.loadVaultInfo(true);
      this.toast.info(`Deleted secret "${this.secretToDelete.key}"`);
    } catch (error) {
      console.error('Failed to delete secret', error);
      this.toast.error('Failed to delete secret');
    }
    this.showDeleteConfirmModal = false;
    this.secretToDelete = null;
  }

  cancelDeleteSecret() {
    console.log('Canceling delete');
    this.showDeleteConfirmModal = false;
    this.secretToDelete = null;
  }

  async handleVaultExport() {
    try {
      const payload = await this.secretService.export();
      const fileName = this.buildVaultFileName();
      this.downloadSecretsFile(payload, fileName);
      this.toast.success(`Exported secrets to ${fileName}`);
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
    if (!this.activeRequestInfo?.id || this.isCancellingActiveRequest) {
      return;
    }

    if (!this.requestManager) {
      return;
    }

    this.isCancellingActiveRequest = true;
    try {
      await this.requestManager.cancelActiveRequest();
      this.toast.info('Request cancelled');
    } catch (error) {
      console.error('Failed to cancel request', error);
      this.toast.error('Failed to cancel request');
      this.isCancellingActiveRequest = false;
    }
  }

  private clearActiveRequestState(): void {
    this.activeRequestInfo = null;
    this.isCancellingActiveRequest = false;
  }

  private startActiveRunTick(): void {
    this.stopActiveRunTick();
    this.activeRunNowMs = Date.now();
    this.activeRunTickHandle = setInterval(() => {
      this.activeRunNowMs = Date.now();
      if (this.isRequestRunning && this.activeRequestInfo?.type === 'load') {
        const sample = this.activeRunProgress?.activeUsers ?? 0;
        this.pushLoadUsersSample(sample);
        this.sampleLoadRps();
      }

      // Kick the animation loop while a run is active.
      if (this.isRequestRunning && this.activeRequestInfo?.type === 'load') {
        this.ensureSparklineAnimation();
      }
    }, 200);

    this.ensureSparklineAnimation();
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
      if (this.rpsRenderTarget !== null) {
        if (this.rpsRenderValue === null) {
          this.rpsRenderValue = this.rpsRenderTarget;
        } else {
          const k = 1 - Math.pow(0.02, dt / 16.67);
          this.rpsRenderValue = this.rpsRenderValue + (this.rpsRenderTarget - this.rpsRenderValue) * k;
        }
      }

      this.tickUsersSparkline(dt);
      this.tickRpsSparkline(dt);
    };

    this.sparklineRafHandle = requestAnimationFrame(step);
  }

  private pushLoadUsersSample(value: number): void {
    const v = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
    const slots = this.loadUsersSeriesMaxPoints;
    const current = this.loadUsersQueue.length
      ? (this.loadUsersQueue[this.loadUsersQueue.length - 1] ?? 0)
      : (this.loadUsersNextValue ?? this.loadUsersSeries[slots - 1] ?? 0);
    this.enqueueRamp(this.loadUsersQueue, current, v, this.loadUsersRampSteps, true);
    const maxQueue = slots * 4;
    if (this.loadUsersQueue.length > maxQueue) {
      this.loadUsersQueue = this.loadUsersQueue.slice(-maxQueue);
    }
  }

  private buildLoadUsersSparklinePoints(series: number[], nextValue?: number): string {
    const slots = this.loadUsersSeriesMaxPoints;
    if (!series.length || slots <= 0) return '';

    const height = 20;
    const maxUsers = this.activeRunProgress?.maxUsers;
    const localMax = Math.max(1, ...series, nextValue ?? 0);
    const denom = typeof maxUsers === 'number' && maxUsers > 0 ? Math.max(maxUsers, 1) : localMax;

    // Use step=100/slots so we can place the "next" point at x=100 without
    // drawing any segment beyond the viewBox (prevents a persistent right-edge blob).
    const step = slots > 1 ? 100 / slots : 100;
    const points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < slots; i++) {
      const x = i * step;
      const value = series[i] ?? 0;
      const y = height - (Math.min(denom, value) / denom) * height;
      points.push({ x, y });
    }

    if (nextValue !== undefined) {
      const x = 100;
      const y = height - (Math.min(denom, nextValue) / denom) * height;
      points.push({ x, y });
    }

    return this.pointsToString(points);
  }

  private buildLoadUsersSparklinePathD(series: number[], nextValue?: number): string {
    const slots = this.loadUsersSeriesMaxPoints;
    if (!series.length || slots <= 0) return '';

    const height = 20;
    const maxUsers = this.activeRunProgress?.maxUsers;
    const localMax = Math.max(1, ...series, nextValue ?? 0);
    const denom = typeof maxUsers === 'number' && maxUsers > 0 ? Math.max(maxUsers, 1) : localMax;

    const step = slots > 1 ? 100 / slots : 100;
    const points: Array<{ x: number; y: number }> = [];
    const firstValue = series[0] ?? 0;
    const firstY = height - (Math.min(denom, firstValue) / denom) * height;
    points.push({ x: -2 * step, y: firstY });
    points.push({ x: -1 * step, y: firstY });
    for (let i = 0; i < slots; i++) {
      const x = i * step;
      const value = series[i] ?? 0;
      const y = height - (Math.min(denom, value) / denom) * height;
      points.push({ x, y });
    }

    if (nextValue !== undefined) {
      const y = height - (Math.min(denom, nextValue) / denom) * height;
      points.push({ x: slots * step, y });
      points.push({ x: (slots + 1) * step, y });
    }

    return this.pointsToSmoothPathD(points, { minX: 0, maxX: 100, minY: 0, maxY: height }, 0.55);
  }

  private buildScrollingUsersSparklinePathD(series: number[], nextValue: number, phase: number): string {
    const slots = this.loadUsersSeriesMaxPoints;
    if (!series.length || slots <= 0) return '';

    const height = 20;
    const maxUsers = this.activeRunProgress?.maxUsers;
    const localMax = Math.max(1, ...series, nextValue);
    const denom = typeof maxUsers === 'number' && maxUsers > 0 ? Math.max(maxUsers, 1) : localMax;

    // Build a stable curve and scroll it via translate().
    // We include two extra points past x=100 and clip in the SVG, so the line
    // enters/exits smoothly without the "top-to-bottom" shimmer of reindexing.
    const step = slots > 1 ? 100 / slots : 100;
    const t = Math.max(0, Math.min(1, phase));
    const last = series[slots - 1] ?? 0;
    const lerpedLast = last + (nextValue - last) * t;

    const points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < slots; i++) {
      const x = i * step;
      const value = series[i] ?? 0;
      const y = height - (Math.min(denom, value) / denom) * height;
      points.push({ x, y });
    }
    // Point at x=100 eases from last->next during the phase.
    points.push({
      x: slots * step,
      y: height - (Math.min(denom, lerpedLast) / denom) * height
    });
    // One more point past the viewBox.
    points.push({
      x: (slots + 1) * step,
      y: height - (Math.min(denom, nextValue) / denom) * height
    });

    return this.pointsToSmoothPathD(points, { minX: 0, maxX: 100, minY: 0, maxY: height }, 0.75);
  }

  private sampleLoadRps(): void {
    const now = this.activeRunNowMs;
    const totalSent = this.activeRunProgress?.totalSent;
    if (typeof totalSent !== 'number') {
      return;
    }

    if (this.lastRpsSampleAtMs === null || this.lastRpsTotalSent === null) {
      this.lastRpsSampleAtMs = now;
      this.lastRpsTotalSent = totalSent;
      return;
    }

    const dtMs = now - this.lastRpsSampleAtMs;
    if (dtMs < 150) {
      return;
    }

    const dCount = totalSent - this.lastRpsTotalSent;
    const rps = dtMs > 0 ? Math.max(0, dCount) / (dtMs / 1000) : 0;
		const alpha = 0.18;
		const smoothed = this.lastRpsSmoothed === null ? rps : (alpha * rps + (1 - alpha) * this.lastRpsSmoothed);
		this.lastRpsSmoothed = smoothed;

    this.lastRpsSampleAtMs = now;
    this.lastRpsTotalSent = totalSent;
    this.pushLoadRpsSample(smoothed);
  }

  private pushLoadRpsSample(value: number): void {
    const v = Number.isFinite(value) ? Math.max(0, value) : 0;
    const slots = this.loadRpsSeriesMaxPoints;
    const current = this.loadRpsQueue.length
      ? (this.loadRpsQueue[this.loadRpsQueue.length - 1] ?? 0)
      : (this.loadRpsNextValue ?? this.loadRpsSeries[slots - 1] ?? 0);
    this.enqueueRamp(this.loadRpsQueue, current, v, this.loadRpsRampSteps, false);
    const maxQueue = slots * 4;
    if (this.loadRpsQueue.length > maxQueue) {
      this.loadRpsQueue = this.loadRpsQueue.slice(-maxQueue);
    }

    // Keep numeric readout smoothing.
    this.rpsRenderTarget = v;
    if (this.rpsRenderValue === null) {
      this.rpsRenderValue = v;
    }
  }

  private buildLoadRpsSparklinePoints(renderLastValue?: number, seriesOverride?: number[], nextValue?: number): string {
    const series = seriesOverride ?? this.loadRpsSeries;
    if (!series.length) return '';

    const height = 20;
    const lastValue = renderLastValue !== undefined ? renderLastValue : series[series.length - 1] ?? 0;
    const extra = nextValue !== undefined ? nextValue : lastValue;
    const denom = Math.max(1, ...series, lastValue, extra);

    // Fixed x spacing (stable window) to avoid jitter from re-scaling when length changes.
    const slots = this.loadRpsSeriesMaxPoints;
		// Match Users: step=100/slots so the extra point can be exactly at x=100.
    const step = slots > 1 ? 100 / slots : 100;
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < slots; i++) {
    const x = i * step;
    const raw = series[i] ?? 0;
    const y = height - (Math.min(denom, raw) / denom) * height;
    points.push({ x, y });
  }

  if (nextValue !== undefined) {
    const x = 100;
    const y = height - (Math.min(denom, nextValue) / denom) * height;
    points.push({ x, y });
  }

  return this.pointsToString(points);
  }

  private buildLoadRpsSparklinePathD(renderLastValue?: number, seriesOverride?: number[], nextValue?: number): string {
    const series = seriesOverride ?? this.loadRpsSeries;
    if (!series.length) return '';

    const height = 20;
    const lastValue = renderLastValue !== undefined ? renderLastValue : series[series.length - 1] ?? 0;
    const extra = nextValue !== undefined ? nextValue : lastValue;
    const denom = Math.max(1, ...series, lastValue, extra);

    const slots = this.loadRpsSeriesMaxPoints;
    const step = slots > 1 ? 100 / slots : 100;
    const points: Array<{ x: number; y: number }> = [];
    const firstValue = series[0] ?? 0;
    const firstY = height - (Math.min(denom, firstValue) / denom) * height;
    points.push({ x: -2 * step, y: firstY });
    points.push({ x: -1 * step, y: firstY });
    for (let i = 0; i < slots; i++) {
      const x = i * step;
      const value = series[i] ?? 0;
      const y = height - (Math.min(denom, value) / denom) * height;
      points.push({ x, y });
    }
    const y = height - (Math.min(denom, extra) / denom) * height;
    points.push({ x: slots * step, y });
    points.push({ x: (slots + 1) * step, y });
    return this.pointsToSmoothPathD(points, { minX: 0, maxX: 100, minY: 0, maxY: height }, 0.55);
  }

  private buildScrollingRpsSparklinePathD(series: number[], nextValue: number, phase: number): string {
    const slots = this.loadRpsSeriesMaxPoints;
    if (!series.length || slots <= 0) return '';

    const height = 20;
    const t = Math.max(0, Math.min(1, phase));
    const denom = Math.max(1, ...series, nextValue);
    const step = slots > 1 ? 100 / slots : 100;
    const last = series[slots - 1] ?? 0;
    const lerpedLast = last + (nextValue - last) * t;

    const points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < slots; i++) {
      const x = i * step;
      const value = series[i] ?? 0;
      const y = height - (Math.min(denom, value) / denom) * height;
      points.push({ x, y });
    }
    points.push({
      x: slots * step,
      y: height - (Math.min(denom, lerpedLast) / denom) * height
    });
    points.push({
      x: (slots + 1) * step,
      y: height - (Math.min(denom, nextValue) / denom) * height
    });

    return this.pointsToSmoothPathD(points, { minX: 0, maxX: 100, minY: 0, maxY: height }, 0.75);
  }

  private tickUsersSparkline(dtMs: number): void {
    const slots = this.loadUsersSeriesMaxPoints;
    if (slots <= 0) return;
    if (!this.loadUsersSeries.length) {
      this.loadUsersSeries = Array(slots).fill(0);
    }
    if (this.loadUsersSeries.length !== slots) {
      this.loadUsersSeries = this.loadUsersSeries.slice(-slots);
      if (this.loadUsersSeries.length < slots) {
        this.loadUsersSeries = [...Array(slots - this.loadUsersSeries.length).fill(0), ...this.loadUsersSeries];
      }
    }

    const xStep = slots > 1 ? 100 / slots : 100;
    const phaseInc = this.loadUsersScrollMs > 0 ? dtMs / this.loadUsersScrollMs : 0;
    this.loadUsersScrollPhase = Math.min(10, Math.max(0, this.loadUsersScrollPhase + phaseInc));

    if (this.loadUsersNextValue === null) {
      this.loadUsersNextValue = this.loadUsersQueue.shift() ?? this.loadUsersSeries[slots - 1] ?? 0;
    }

    let advanced = false;
    while (this.loadUsersScrollPhase >= 1) {
      this.loadUsersSeries.shift();
      this.loadUsersSeries.push(this.loadUsersNextValue);
      this.loadUsersScrollPhase -= 1;
      this.loadUsersNextValue = this.loadUsersQueue.shift() ?? this.loadUsersSeries[slots - 1] ?? 0;
			advanced = true;
    }

    const offsetX = -xStep * this.loadUsersScrollPhase;
    this.loadUsersSparklineTransformView = offsetX !== 0 ? `translate(${offsetX.toFixed(6)} 0)` : '';
		if (advanced || !this.loadUsersSparklinePathDView) {
			this.loadUsersSparklinePathDView = this.buildLoadUsersSparklinePathD(this.loadUsersSeries, this.loadUsersNextValue);
		}
  }

  private tickRpsSparkline(dtMs: number): void {
    const slots = this.loadRpsSeriesMaxPoints;
    if (slots <= 0) return;
    if (!this.loadRpsSeries.length) {
      this.loadRpsSeries = Array(slots).fill(0);
    }
    if (this.loadRpsSeries.length !== slots) {
      this.loadRpsSeries = this.loadRpsSeries.slice(-slots);
      if (this.loadRpsSeries.length < slots) {
        this.loadRpsSeries = [...Array(slots - this.loadRpsSeries.length).fill(0), ...this.loadRpsSeries];
      }
    }

    const xStep = slots > 1 ? 100 / slots : 100;
    const phaseInc = this.loadRpsScrollMs > 0 ? dtMs / this.loadRpsScrollMs : 0;
    this.loadRpsScrollPhase = Math.min(10, Math.max(0, this.loadRpsScrollPhase + phaseInc));

    if (this.loadRpsNextValue === null) {
      this.loadRpsNextValue = this.loadRpsQueue.shift() ?? this.loadRpsSeries[slots - 1] ?? 0;
    }
    let advanced = false;
    while (this.loadRpsScrollPhase >= 1) {
      this.loadRpsSeries.shift();
      this.loadRpsSeries.push(this.loadRpsNextValue);
      this.loadRpsScrollPhase -= 1;
      this.loadRpsNextValue = this.loadRpsQueue.shift() ?? this.loadRpsSeries[slots - 1] ?? 0;
      advanced = true;
    }

    const offsetX = -xStep * this.loadRpsScrollPhase;
    this.loadRpsSparklineTransformView = offsetX !== 0 ? `translate(${offsetX.toFixed(6)} 0)` : '';
		if (advanced || !this.loadRpsSparklinePathDView) {
			this.loadRpsSparklinePathDView = this.buildLoadRpsSparklinePathD(undefined, this.loadRpsSeries, this.loadRpsNextValue);
		}
  }

  private pointsToString(points: Array<{ x: number; y: number }>): string {
    return points.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  }

  private enqueueRamp(queue: number[], from: number, to: number, steps: number, isInt: boolean): void {
    const n = Math.max(1, Math.min(60, Math.trunc(steps)));
    const a = Number.isFinite(from) ? from : 0;
    const b = Number.isFinite(to) ? to : 0;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const e = t * t * (3 - 2 * t); // smoothstep
      const v = a + (b - a) * e;
      queue.push(isInt ? Math.max(0, Math.trunc(v)) : Math.max(0, v));
    }
  }

  private pointsToSmoothPathD(
    points: Array<{ x: number; y: number }>,
    bounds: { minX: number; maxX: number; minY: number; maxY: number },
    tension = 0.9
  ): string {
    if (!points.length) return '';
    if (points.length === 1) {
      const p = points[0];
      return `M ${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    }

    const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
    const clampY = (p: { x: number; y: number }) => ({ x: p.x, y: clamp(p.y, bounds.minY, bounds.maxY) });

    const t = clamp(tension, 0, 1.5);
    let d = `M ${points[0].x.toFixed(3)},${points[0].y.toFixed(3)}`;

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] ?? points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] ?? p2;

      // Catmull-Rom to cubic Bezier conversion.
      let cp1 = {
        x: p1.x + ((p2.x - p0.x) * t) / 6,
        y: p1.y + ((p2.y - p0.y) * t) / 6
      };
      let cp2 = {
        x: p2.x - ((p3.x - p1.x) * t) / 6,
        y: p2.y - ((p3.y - p1.y) * t) / 6
      };
      cp1 = clampY(cp1);
      cp2 = clampY(cp2);

      d += ` C ${cp1.x.toFixed(3)},${cp1.y.toFixed(3)} ${cp2.x.toFixed(3)},${cp2.y.toFixed(3)} ${p2.x.toFixed(3)},${p2.y.toFixed(3)}`;
    }

    return d;
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
  this.loadUsersQueue = [];
  this.loadUsersScrollPhase = 0;
  this.loadUsersNextValue = null;
  this.loadUsersSparklineTransformView = '';
	this.loadUsersSparklinePathDView = '';
  this.loadRpsQueue = [];
  this.loadRpsScrollPhase = 0;
  this.loadRpsNextValue = null;
  this.loadRpsSparklineTransformView = '';
	this.loadRpsSparklinePathDView = '';
	this.sparklineLastFrameAtMs = null;
	this.sparklineLastRenderedAtMs = null;
  }

  private formatClock(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  private getActiveRequestTimeoutMs(): number | null {
    const req = this.getActiveRequestDetails();
    const timeout = req?.options?.timeout;
    return typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0 ? timeout : null;
  }

  private buildRequestLabel(request: Request): string {
    return `${request.method} ${request.url}`.trim();
  }

  private buildRequestToken(fileId: string, requestIndex: number): string {
    return `${fileId}-${requestIndex}-${Date.now()}`;
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

  private buildVaultFileName(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `rawrequest-secrets-${timestamp}.json`;
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

    // Determine if we should wrap in pre/post script block
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
