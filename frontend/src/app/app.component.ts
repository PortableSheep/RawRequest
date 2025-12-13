import { Component, OnInit, OnDestroy, inject, signal, computed, ViewChild } from '@angular/core';
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
import { FileTab, ResponseData, HistoryItem, Request, ScriptLogEntry } from './models/http.models';
import { HttpService } from './services/http.service';
import { ParserService } from './services/parser.service';
import { SecretService, SecretIndex, VaultInfo } from './services/secret.service';
import { ScriptConsoleService } from './services/script-console.service';
import { ToastService } from './services/toast.service';
import { UpdateService } from './services/update.service';
import { ScriptSnippet } from './services/script-snippet.service';
import { Subject, takeUntil } from 'rxjs';

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
  private parserService = inject(ParserService);
  private secretService = inject(SecretService);
  private scriptConsole = inject(ScriptConsoleService);
  private toast = inject(ToastService);
  private updateService = inject(UpdateService);
  private readonly LAST_SESSION_KEY = 'rawrequest_last_session';

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
  activeRequestInfo: {
    id?: string;
    label: string;
    requestIndex: number;
    canCancel: boolean;
    type: 'single' | 'chain' | 'load';
    startedAt: number;
  } | null = null;
  isCancellingActiveRequest = false;
  private historyCache: { [fileId: string]: HistoryItem[] } = {};
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
    // Load initial data
    // this.loadEnvironmentPreference();
    this.loadFiles();
    this.refreshSecrets(true);

    // Check for updates (non-blocking)
    this.checkForUpdates();

    this.secretService
      .onMissingSecret()
      .pipe(takeUntil(this.destroy$))
      .subscribe(({ env, key }) => {
        // this.showAlert(`Secret "${key}" is missing in environment "${env}"`, 'warning');
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.alertTimeout) {
      clearTimeout(this.alertTimeout);
    }
  }

  private loadFiles(): void {
    const savedFiles = this.httpService.loadFiles();
    if (savedFiles.length > 0) {
      const normalized = savedFiles.map(file => this.normalizeFile(file));
      this.files = normalized;
      this.filesSignal.set(normalized);
      this.restoreSessionState();
      this.syncCurrentEnvWithFile(this.currentFileIndex);
      this.loadHistoryForFile(this.files[this.currentFileIndex]?.id);
      this.persistSessionState();
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
    const normalized = files.map(file => this.normalizeFile(file));
    this.files = normalized;
    this.filesSignal.set(normalized);
    this.syncCurrentEnvWithFile(this.currentFileIndex);
    const activeFile = this.files[this.currentFileIndex];
    if (activeFile) {
      if (this.historyCache[activeFile.id]) {
        this.history = this.historyCache[activeFile.id];
      } else {
        this.history = [];
        this.loadHistoryForFile(activeFile.id);
      }
    } else {
      this.history = [];
    }
    this.persistSessionState();
  }

  onCurrentFileIndexChange(index: number) {
    this.currentFileIndex = index;
    this.currentFileIndexSignal.set(index);
    this.syncCurrentEnvWithFile(index);
    this.loadHistoryForFile(this.files[index]?.id);
    this.persistSessionState();
  }

  onCurrentEnvChange(env: string) {
    const file = this.files[this.currentFileIndex];
    if (file) {
      this.replaceFileAtIndex(this.currentFileIndex, { ...file, selectedEnv: env });
    }
    this.currentEnvSignal.set(env);
    this.httpService.saveFiles(this.files);
    this.persistSessionState();
  }

  // Editor content change handler
  onEditorContentChange(content: string) {
    const previousFile = this.files[this.currentFileIndex];
    if (!previousFile) {
      return;
    }

    // Parse the updated content
    const parsed = this.parserService.parseHttpFile(content);
    const fileDisplayName = parsed.fileDisplayName?.trim() || undefined;

    const envNames = Object.keys(parsed.environments || {});
    let selectedEnv = previousFile.selectedEnv || '';
    if (selectedEnv && !envNames.includes(selectedEnv)) {
      selectedEnv = envNames[0] || '';
    } else if (!selectedEnv && envNames.length > 0) {
      selectedEnv = envNames[0];
    }

    // Update the current file with parsed data
    const updatedFile: FileTab = {
      ...previousFile,
      content,
      requests: parsed.requests,
      environments: parsed.environments,
      variables: parsed.variables,
      groups: parsed.groups,
      selectedEnv,
      displayName: fileDisplayName
    };

    const updatedFiles = [...this.files];
    updatedFiles[this.currentFileIndex] = updatedFile;

    // Update both legacy and signal state
    this.files = updatedFiles;
    this.filesSignal.set(updatedFiles);
    this.currentEnvSignal.set(selectedEnv);

    // Save files to localStorage
    this.httpService.saveFiles(this.files);
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

    this.isRequestRunning = true;
    this.pendingRequestIndex = requestIndex;
    const request = activeFile.requests[requestIndex];
    const requestId = request.loadTest ? undefined : this.buildRequestToken(activeFile.id, requestIndex);
    this.activeRequestInfo = {
      id: requestId,
      label: this.buildRequestLabel(request),
      requestIndex,
      canCancel: !request.loadTest,
      type: request.loadTest ? 'load' : request.depends ? 'chain' : 'single',
      startedAt: Date.now()
    };
    this.isCancellingActiveRequest = false;

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

  onHistoryUpdated(event: { fileId: string; history: HistoryItem[] }) {
    this.historyCache[event.fileId] = event.history;
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
    if (this.files.length <= 1) return; // Keep at least one file

    const removedFile = this.files[index];
    if (removedFile) {
      delete this.historyCache[removedFile.id];
    }

    this.files = this.files.filter((_, i) => i !== index);
    this.filesSignal.set(this.files);

    // Adjust current index if necessary
    if (this.currentFileIndex >= this.files.length) {
      this.currentFileIndex = this.files.length - 1;
    } else if (this.currentFileIndex > index) {
      this.currentFileIndex--;
    }
    this.currentFileIndexSignal.set(this.currentFileIndex);
    if (this.files.length) {
      this.syncCurrentEnvWithFile(this.currentFileIndex);
      this.loadHistoryForFile(this.files[this.currentFileIndex]?.id);
    } else {
      this.currentEnvSignal.set('');
      this.history = [];
    }
    this.httpService.saveFiles(this.files);
    this.persistSessionState();
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
    if (this.files.length <= 1) return;

    const fileToKeep = this.files[keepIndex];
    if (!fileToKeep) return;

    // Clean up history caches for closed files
    this.files.forEach((file, i) => {
      if (i !== keepIndex && file) {
        delete this.historyCache[file.id];
      }
    });

    this.files = [fileToKeep];
    this.filesSignal.set(this.files);
    this.currentFileIndex = 0;
    this.currentFileIndexSignal.set(0);
    this.syncCurrentEnvWithFile(0);
    this.loadHistoryForFile(fileToKeep.id);
    this.httpService.saveFiles(this.files);
    this.persistSessionState();
  }

  addNewTab() {
    const newFile: FileTab = {
      id: this.generateFileId(),
      name: `Untitled-${this.files.length + 1}.http`,
      content: '',
      requests: [],
      environments: {},
      variables: {},
      responseData: {},
      groups: [],
      selectedEnv: ''
    };
    const normalizedFile = this.normalizeFile(newFile);
    this.files = [...this.files, normalizedFile];
    this.filesSignal.set(this.files);
    this.currentFileIndex = this.files.length - 1;
    this.currentFileIndexSignal.set(this.currentFileIndex);
    this.syncCurrentEnvWithFile(this.currentFileIndex);
    this.historyCache[normalizedFile.id] = [];
    this.history = [];
    this.httpService.saveFiles(this.files);
    this.persistSessionState();
  }

  async openFile() {
    try {
      // Use native file dialog via Wails for full file path support
      const { OpenFileDialog, ReadFileContents } = await import('../../wailsjs/go/main/App');
      const filePaths = await OpenFileDialog();
      
      if (filePaths && filePaths.length > 0) {
        for (const filePath of filePaths) {
          const content = await ReadFileContents(filePath);
          const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || 'Untitled.http';
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
    const filesLength = this.files.length;
    if (!filesLength) {
      return;
    }

    const fromIndex = Math.max(0, Math.min(filesLength - 1, event.fromIndex));
    const toIndex = Math.max(0, Math.min(filesLength - 1, event.toIndex));
    if (fromIndex === toIndex) {
      return;
    }

    const reordered = [...this.files];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);

    const activeFileId = this.files[this.currentFileIndex]?.id;
    this.files = reordered;
    this.filesSignal.set(reordered);
    if (activeFileId) {
      const nextActiveIndex = reordered.findIndex(file => file.id === activeFileId);
      if (nextActiveIndex !== -1) {
        this.currentFileIndex = nextActiveIndex;
        this.currentFileIndexSignal.set(nextActiveIndex);
      }
    }

    this.httpService.saveFiles(this.files);
    this.persistSessionState();
  }

  private addFileFromContent(fileName: string, content: string, filePath?: string) {
    // Parse the content to extract environments and variables
    const parsed = this.parserService.parseHttpFile(content);
    const envNames = Object.keys(parsed.environments || {});
    const fileDisplayName = parsed.fileDisplayName?.trim() || undefined;

    const newFile: FileTab = {
      id: this.generateFileId(),
      name: fileName,
      content: content,
      requests: parsed.requests,
      environments: parsed.environments,
      variables: parsed.variables,
      responseData: {},
      groups: parsed.groups,
      selectedEnv: envNames[0] || '',
      displayName: fileDisplayName,
      filePath: filePath
    };
    const normalizedFile = this.normalizeFile(newFile);
    this.files = [...this.files, normalizedFile];
    this.filesSignal.set(this.files);
    this.currentFileIndex = this.files.length - 1;
    this.currentFileIndexSignal.set(this.currentFileIndex);
    this.syncCurrentEnvWithFile(this.currentFileIndex);
    this.historyCache[normalizedFile.id] = [];
    this.loadHistoryForFile(normalizedFile.id);
    this.httpService.saveFiles(this.files);
    this.persistSessionState();
  }

  getEnvironments(): string[] {
    return this.currentFileEnvironments();
  }

  get currentFile(): FileTab {
    return this.files[this.currentFileIndex] || { id: this.generateFileId(), name: '', content: '', requests: [], environments: {}, variables: {}, responseData: {}, groups: [], selectedEnv: '' };
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

  getActiveRequestMeta(): string {
    if (!this.activeRequestInfo) {
      return 'Awaiting request';
    }

    if (this.isCancellingActiveRequest) {
      return 'Canceling active request';
    }

    if (this.isRequestRunning) {
      return 'Streaming response';
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

  private normalizeFile(file: FileTab): FileTab {
    const envNames = Object.keys(file.environments || {});
    let selectedEnv = file.selectedEnv ?? '';

    if (selectedEnv && !envNames.includes(selectedEnv)) {
      selectedEnv = envNames[0] || '';
    } else if (!selectedEnv && envNames.length > 0) {
      selectedEnv = envNames[0];
    } else if (!envNames.length) {
      selectedEnv = '';
    }

    const id = file.id && file.id.length ? file.id : this.generateFileId();
    const displayName = file.displayName?.trim();

    return {
      ...file,
      id,
      selectedEnv,
      displayName: displayName || undefined
    };
  }

  private generateFileId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    return `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private syncCurrentEnvWithFile(index: number): void {
    const file = this.files[index];
    if (!file) {
      this.currentEnvSignal.set('');
      return;
    }

    const normalized = this.normalizeFile(file);
    if (normalized !== file) {
      this.replaceFileAtIndex(index, normalized);
    }

    this.currentEnvSignal.set(normalized.selectedEnv || '');
  }

  private replaceFileAtIndex(index: number, newFile: FileTab): void {
    const updated = [...this.files];
    updated[index] = newFile;
    this.files = updated;
    this.filesSignal.set(updated);
  }

  private resetPendingRequestState(): void {
    this.isRequestRunning = false;
    this.pendingRequestIndex = null;
    this.clearActiveRequestState();
    this.triggerQueuedRequestIfNeeded();
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

    if (this.historyCache[fileId]) {
      this.history = this.historyCache[fileId];
      return;
    }

    this.httpService.loadHistory(fileId)
      .then(history => {
        this.historyCache[fileId] = history;
        if (this.files[this.currentFileIndex]?.id === fileId) {
          this.history = history;
        }
      })
      .catch(error => console.error('Failed to load history for file', fileId, error));
  }

  private persistSessionState(): void {
    const activeFile = this.files[this.currentFileIndex];
    if (!activeFile) {
      localStorage.removeItem(this.LAST_SESSION_KEY);
      return;
    }

    const payload = {
      fileId: activeFile.id,
      fileName: activeFile.name,
      selectedEnv: activeFile.selectedEnv || ''
    };

    try {
      localStorage.setItem(this.LAST_SESSION_KEY, JSON.stringify(payload));
    } catch (error) {
      console.error('Failed to persist session state', error);
    }
  }

  private restoreSessionState(): void {
    try {
      const stored = localStorage.getItem(this.LAST_SESSION_KEY);
      if (!stored) {
        return;
      }
      const session = JSON.parse(stored) as { fileId?: string; fileName?: string; selectedEnv?: string };
      const targetIndex = this.files.findIndex(file => file.id === session.fileId || file.name === session.fileName);
      if (targetIndex >= 0) {
        this.currentFileIndex = targetIndex;
        this.currentFileIndexSignal.set(targetIndex);
        if (session.selectedEnv && this.files[targetIndex].selectedEnv !== session.selectedEnv) {
          this.replaceFileAtIndex(targetIndex, { ...this.files[targetIndex], selectedEnv: session.selectedEnv });
        }
      }
    } catch (error) {
      console.error('Failed to restore session state', error);
    }
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
      console.debug('Update check failed:', error);
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
