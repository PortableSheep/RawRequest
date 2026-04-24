import {
  Component,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  OnInit,
  OnDestroy,
  inject,
  ViewChild,
  HostListener,
  ElementRef,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { EditorComponent } from "./components/editor/editor.component";
import { RequestManagerComponent } from "./components/request-manager/request-manager.component";
import {
  HeaderComponent,
  ResponsePanelComponent,
  HistorySidebarComponent,
  HistoryDetailModalComponent,
  LoadTestResultsModalComponent,
  DonationModalComponent,
  SecretsModalComponent,
  ConsoleDrawerComponent,
  UpdateNotificationComponent,
  ScriptSnippetModalComponent,
} from "./components";
import { OutlinePanelComponent } from "./components/outline-panel/outline-panel.component";
import { CommandPaletteComponent } from "./components/command-palette/command-palette.component";
import { ActiveRequestOverlayComponent } from "./components/active-request-overlay/active-request-overlay.component";
import { ToastContainerComponent } from "./components/toast-container/toast-container.component";
import { VersionManagerComponent } from "./components/version-manager/version-manager.component";
import {
  FileTab,
  ResponseData,
  HistoryItem,
  ActiveRunProgress,
  ChainEntryPreview,
} from "./models/http.models";
import { SecretService } from "./services/secret.service";
import { ToastService } from "./services/toast.service";
import { ScriptSnippet } from "./services/script-snippet.service";
import { ThemeService } from "./services/theme.service";
import { KeyboardShortcutService } from "./services/keyboard-shortcut.service";
import { SHORTCUT_CATALOG, shortcutHint } from "./logic/app/shortcut-catalog";
import { SplitPaneService } from "./services/split-pane.service";
import { PanelVisibilityService } from "./services/panel-visibility.service";
import { Subject } from "rxjs";
import {
  buildLastResponseSummary,
  decideFooterStatus,
} from "./logic/app/app.component.logic";
import { LoadTestVisualizationService } from "./services/load-test-visualization.service";
import { RequestExecutionService } from "./services/request-execution.service";
import { WorkspaceStateService } from "./services/workspace-state.service";
import { FileSaveService } from "./services/file-save.service";
import { StartupService } from "./services/startup.service";

@Component({
  selector: "app-root",
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
    ConsoleDrawerComponent,
    ToastContainerComponent,
    UpdateNotificationComponent,
    ScriptSnippetModalComponent,
    OutlinePanelComponent,
    CommandPaletteComponent,
    ActiveRequestOverlayComponent,
    VersionManagerComponent,
  ],
  templateUrl: "./app.component.html",
  styleUrls: ["./app.component.scss"],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements OnInit, OnDestroy {
  title = "RawRequest";

  private readonly secretService = inject(SecretService);
  private toast = inject(ToastService);
  private themeService = inject(ThemeService);
  private keyboardShortcuts = inject(KeyboardShortcutService);
  readonly splitPane = inject(SplitPaneService);
  readonly panels = inject(PanelVisibilityService);
  readonly loadTestViz = inject(LoadTestVisualizationService);
  readonly reqExec = inject(RequestExecutionService);
  readonly ws = inject(WorkspaceStateService);
  private readonly fileSave = inject(FileSaveService);
  readonly startup = inject(StartupService);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly shortcutHint = shortcutHint;

  @ViewChild("mainSplit") mainSplitEl?: ElementRef<HTMLElement>;
  @ViewChild(RequestManagerComponent) requestManager!: RequestManagerComponent;
  @ViewChild("editorComponent") editorComponent!: EditorComponent;
  @ViewChild("snippetModal") snippetModal!: ScriptSnippetModalComponent;

  // Delegated signal accessors for template bindings
  get filesSignal() { return this.ws.files; }
  get currentFileIndexSignal() { return this.ws.currentFileIndex; }
  get currentFileView() { return this.ws.currentFileView; }
  get currentEnv() { return this.ws.currentEnv; }
  get currentFileRequestNames() { return this.ws.currentFileRequestNames; }
  get isRequestRunningSignal() { return this.reqExec.isRequestRunningSignal; }
  get pendingRequestIndexSignal() { return this.reqExec.pendingRequestIndexSignal; }

  // Imperative accessors for template/logic
  get isRequestRunning() { return this.reqExec.isRequestRunning; }
  get pendingRequestIndex() { return this.reqExec.pendingRequestIndex; }
  get activeRequestInfo() { return this.reqExec.activeRequestInfo; }
  get isCancellingActiveRequest() { return this.reqExec.isCancellingActiveRequest; }
  get serviceStartupError() { return this.startup.serviceStartupError; }
  get allSecrets() { return this.secretService.allSecrets(); }

  private destroy$ = new Subject<void>();
  private parseDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly PARSE_DEBOUNCE_MS = 150;

  constructor() {}

  ngOnInit() {
    this.themeService.init();
    this.splitPane.restoreSplitState();
    this.splitPane.refreshSplitLayoutState();
    this.registerKeyboardShortcuts();
    void this.startup.bootstrap(this.destroy$, (idx) => this.onRequestExecute(idx));
  }

  ngOnDestroy() {
    this.keyboardShortcuts.unregisterMany(this.SHORTCUT_IDS);
    this.destroy$.next();
    this.destroy$.complete();
    if (this.parseDebounceTimer) {
      clearTimeout(this.parseDebounceTimer);
    }
  }

  retryServiceStartup(): void {
    this.startup.retryServiceStartup(this.destroy$, (idx) => this.onRequestExecute(idx));
  }

  // --- Split pane HostListeners ---

  @HostListener("window:resize")
  onWindowResize() {
    this.splitPane.onWindowResize(this.mainSplitEl?.nativeElement);
  }

  @HostListener("document:mousemove", ["$event"])
  onDocumentMouseMove(event: MouseEvent) {
    this.splitPane.onMouseMove(event, this.mainSplitEl?.nativeElement);
  }

  @HostListener("document:mouseup")
  onDocumentMouseUp() {
    this.splitPane.onMouseUp();
  }

  onSplitMouseDown(event: MouseEvent) {
    this.splitPane.onSplitMouseDown(event);
  }

  resetSplit() {
    this.splitPane.resetSplit();
  }

  // --- Workspace state delegation ---

  onFilesChange(files: FileTab[]) {
    this.ws.onFilesChange(files);
  }

  onCurrentFileIndexChange(index: number) {
    this.ws.onCurrentFileIndexChange(index);
  }

  onCurrentEnvChange(env: string) {
    this.ws.onCurrentEnvChange(env);
  }

  // Debounced editor content change
  onEditorContentChange(content: string) {
    if (this.parseDebounceTimer) {
      clearTimeout(this.parseDebounceTimer);
    }
    this.ws.updateRawContent(content);
    this.parseDebounceTimer = setTimeout(() => {
      this.parseDebounceTimer = null;
      this.ws.updateFileContent(content);
    }, this.PARSE_DEBOUNCE_MS);
  }

  // --- Request execution ---

  onRequestExecute(requestIndex: number) {
    this.reqExec.setDelegate(this.requestManager);
    this.reqExec.onRequestExecute(
      requestIndex,
      this.ws.files(),
      this.ws.currentFileIndex(),
      this.ws.currentEnv(),
      this.cdr,
    );
  }

  onReplayRequest(entry: ChainEntryPreview) {
    this.reqExec.setDelegate(this.requestManager);
    this.reqExec.onReplayRequest(
      entry,
      this.ws.files(),
      this.ws.currentFileIndex(),
      this.ws.currentEnv(),
      this.cdr,
    );
  }

  onRequestExecuted(result: { requestIndex: number; response: ResponseData }) {
    this.reqExec.onRequestExecuted(result);
  }

  onRequestProgress(progress: ActiveRunProgress) {
    this.reqExec.onRequestProgress(progress);
  }

  onHistoryUpdated(event: { fileId: string; history: HistoryItem[] }) {
    this.ws.onHistoryUpdated(event);
  }

  // --- UI handlers ---

  showHistoryEdgeTrigger(): boolean {
    return this.splitPane.isSplitLayout && this.panels.noSidebarOpen();
  }

  scrollEditorToRequest(requestIndex: number) {
    this.editorComponent?.scrollToRequestIndex(requestIndex);
  }

  closeHistoryModal() {
    this.panels.closeHistoryModal();
    this.ws.selectedHistoryItem.set(null);
  }

  // --- File save (delegated to FileSaveService) ---

  saveCurrentFile() { return this.fileSave.saveCurrentFile(); }
  saveCurrentFileAs() { return this.fileSave.saveCurrentFileAs(); }

  // --- Active request helpers ---

  get currentFile(): FileTab { return this.ws.getCurrentFile(); }

  footerStatus(): {
    label: string;
    detail: string;
    tone: "idle" | "pending" | "success" | "warning" | "error";
  } {
    return decideFooterStatus({
      isRequestRunning: this.isRequestRunning,
      isCancellingActiveRequest: this.isCancellingActiveRequest,
      activeRequestMeta: this.reqExec.getActiveRequestMeta(this.currentFile),
      lastResponseSummary: this.lastResponseSummary(),
      activeEnv: this.currentEnv(),
    });
  }

  lastResponseSummary(): { status: string; time: string; code: number } | null {
    return buildLastResponseSummary(
      this.currentFile,
      this.reqExec.lastExecutedRequestIndex,
    );
  }

  // --- Misc UI ---

  donate(amount: number) {
    this.panels.showDonationModal.set(false);
  }

  openSnippetModal(): void {
    this.panels.showSnippetModal.set(true);
    setTimeout(() => this.snippetModal?.open(), 0);
  }

  onSnippetSelected(event: { snippet: ScriptSnippet; type: "pre" | "post" }): void {
    const { snippet, type } = event;
    const code = type === "pre" ? snippet.preScript : snippet.postScript;
    if (!code) return;

    const scriptBlock = type === "pre" ? `\n< {\n${code}\n}\n` : `\n> {\n${code}\n}\n`;

    if (this.editorComponent) {
      this.editorComponent.insertAtCursor(scriptBlock);
    } else {
      const file = this.ws.files()[this.ws.currentFileIndex()];
      if (file) {
        this.onEditorContentChange(file.content + scriptBlock);
      }
    }

    this.toast.success(`Inserted "${snippet.name}" snippet`);
    this.panels.showSnippetModal.set(false);
  }

  // --- Keyboard shortcuts ---

  private readonly SHORTCUT_IDS = SHORTCUT_CATALOG.map(e => e.id);

  private readonly shortcutActions: Record<string, () => void> = {
    'app:save': () => void this.saveCurrentFile(),
    'app:saveAs': () => void this.saveCurrentFileAs(),
    'app:toggleHistory': () => this.panels.toggleHistory(),
    'app:toggleOutline': () => this.panels.toggleOutlinePanel(),
    'app:toggleCommandPalette': () => this.panels.toggleCommandPalette(),
    'app:escape': () => this.handleEscapeKey(),
  };

  private registerKeyboardShortcuts(): void {
    this.keyboardShortcuts.registerMany(
      SHORTCUT_CATALOG.map(entry => ({
        id: entry.id,
        combo: entry.combo,
        priority: entry.priority,
        action: this.shortcutActions[entry.id] ?? (() => {}),
      })),
    );
  }

  private handleEscapeKey(): void {
    if (this.panels.showCommandPalette()) {
      this.panels.showCommandPalette.set(false);
    } else if (this.panels.showHistoryModal()) {
      this.closeHistoryModal();
    } else if (this.panels.showOutlinePanel()) {
      this.panels.showOutlinePanel.set(false);
    } else if (this.panels.showHistory()) {
      this.panels.toggleHistory();
    } else if (this.isRequestRunning) {
      void this.reqExec.cancelActiveRequest();
    }
  }
}
