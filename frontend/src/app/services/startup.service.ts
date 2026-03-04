import { Injectable, inject } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { WorkspaceStateService } from './workspace-state.service';
import { SecretService } from './secret.service';
import { ToastService } from './toast.service';
import { UpdateService } from './update.service';
import { RequestExecutionService } from './request-execution.service';
import { resolveServiceBackendBaseUrl } from './backend-client-config';

@Injectable({ providedIn: 'root' })
export class StartupService {
  private readonly state = inject(WorkspaceStateService);
  private readonly secretService = inject(SecretService);
  private readonly toast = inject(ToastService);
  readonly updateService = inject(UpdateService);
  private readonly reqExec = inject(RequestExecutionService);

  serviceStartupError: string | null = null;
  private startupInitialized = false;

  /** Main bootstrap sequence. Wire onRequestExecute callback for queued execution. */
  async bootstrap(
    destroy$: Subject<void>,
    onRequestExecute: (idx: number) => void,
  ): Promise<void> {
    if (this.startupInitialized) {
      return;
    }
    const backendReady = await this.ensureServiceBackendReady();
    if (!backendReady) {
      return;
    }
    this.startupInitialized = true;

    this.state.loadFiles();
    this.secretService.onMasterPasswordWarning(() => {
      this.toast.info(
        'You have secrets but no master password. Open Secrets to set one.',
        5000,
      );
    });
    this.secretService.refreshSecrets(true);
    this.updateService.init();
    this.checkForUpdates();
    this.checkFirstRun();

    this.secretService
      .onMissingSecret()
      .pipe(takeUntil(destroy$))
      .subscribe(() => {});

    this.reqExec.subscribeToDownloadProgress(destroy$);
    this.reqExec.queuedExecutionRequested
      .pipe(takeUntil(destroy$))
      .subscribe((idx) => {
        setTimeout(() => onRequestExecute(idx), 0);
      });
  }

  private safeStorage(): Pick<Storage, 'getItem'> | null {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      return null;
    }
  }

  private async ensureServiceBackendReady(): Promise<boolean> {
    const storage = this.safeStorage();
    const baseUrl = resolveServiceBackendBaseUrl(globalThis as any, storage);
    try {
      const { EnsureServiceRunning } = await import('@wailsjs/go/app/App');
      await EnsureServiceRunning(baseUrl);
      this.serviceStartupError = null;
      return true;
    } catch (error: any) {
      const detail =
        typeof error?.message === 'string'
          ? error.message
          : String(error || 'unknown error');
      this.serviceStartupError = `Service startup failed (${baseUrl}): ${detail}`;
      return false;
    }
  }

  retryServiceStartup(
    destroy$: Subject<void>,
    onRequestExecute: (idx: number) => void,
  ): void {
    this.serviceStartupError = null;
    void this.bootstrap(destroy$, onRequestExecute);
  }

  private async checkForUpdates(): Promise<void> {
    try {
      await this.updateService.checkForUpdates();
    } catch (error) {
      console.warn('Update check failed:', error);
    }
  }

  private async checkFirstRun(): Promise<void> {
    try {
      const { GetExamplesForFirstRun } = await import('@wailsjs/go/app/App');
      const resp = await GetExamplesForFirstRun();
      const content = resp?.content || '';
      const filePath = resp?.filePath || 'examples.http';
      const isFirstRun = !!resp?.isFirstRun;

      if (isFirstRun && content) {
        const fileName = 'examples.http';
        this.state.addFileFromContent(fileName, content, filePath);
        try {
          const { MarkFirstRunComplete } = await import('@wailsjs/go/app/App');
          await MarkFirstRunComplete();
        } catch (err) {
          console.warn('Failed to mark first run complete:', err);
        }
      }
    } catch (error) {
      console.warn('Failed to check for first run:', error);
    }
  }
}
