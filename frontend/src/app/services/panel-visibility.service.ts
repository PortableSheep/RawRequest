import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { DiagnosticLoggerService } from './diagnostic-logger.service';

export type SecondarySurface = 'history' | 'outline' | 'commandPalette' | 'console' | 'secrets';

@Injectable({ providedIn: 'root' })
export class PanelVisibilityService {
  private readonly diagnostics = inject(DiagnosticLoggerService);

  readonly showHistory = signal(false);
  readonly showHistoryModal = signal(false);
  readonly showOutlinePanel = signal(false);
  readonly showCommandPalette = signal(false);
  readonly showLoadTestResults = signal(false);
  readonly showDonationModal = signal(false);
  readonly showSecretsModal = signal(false);
  readonly showSnippetModal = signal(false);
  readonly showDeleteConfirmModal = signal(false);
  readonly showVersionManager = signal(false);
  
  readonly consoleOpen = signal<boolean>(this.loadConsoleOpen());
  readonly consoleActiveTab = signal<'logs' | 'mock'>(this.loadConsoleActiveTab());

  constructor() {
    effect(() => {
      const open = this.consoleOpen();
      localStorage.setItem('rawrequest:consoleOpen', JSON.stringify(open));
      this.diagnostics.info(`Console visibility changed to: ${open ? 'OPEN' : 'CLOSED'}`);
    });

    effect(() => {
      const tab = this.consoleActiveTab();
      localStorage.setItem('rawrequest:consoleActiveTab', tab);
      this.diagnostics.info(`Console active tab changed to: ${tab.toUpperCase()}`);
    });
  }

  private loadConsoleOpen(): boolean {
    try {
      const val = localStorage.getItem('rawrequest:consoleOpen');
      return val ? JSON.parse(val) === true : false;
    } catch {
      return false;
    }
  }

  private loadConsoleActiveTab(): 'logs' | 'mock' {
    try {
      const val = localStorage.getItem('rawrequest:consoleActiveTab');
      return (val === 'mock') ? 'mock' : 'logs';
    } catch {
      return 'logs';
    }
  }

  /** True when no sidebar or modal overlay is active. */
  readonly noSidebarOpen = computed(
    () =>
      !this.showHistory() &&
      !this.showOutlinePanel() &&
      !this.showCommandPalette() &&
      !this.showSecretsModal(),
  );

  toggleHistory(): void {
    const shouldOpen = !this.showHistory();
    this.closeSecondarySurfaces(shouldOpen ? 'history' : undefined);
    this.showHistory.set(shouldOpen);
  }

  toggleOutlinePanel(): void {
    const shouldOpen = !this.showOutlinePanel();
    this.closeSecondarySurfaces(shouldOpen ? 'outline' : undefined);
    this.showOutlinePanel.set(shouldOpen);
  }

  toggleCommandPalette(): void {
    const shouldOpen = !this.showCommandPalette();
    this.closeSecondarySurfaces(shouldOpen ? 'commandPalette' : undefined);
    this.showCommandPalette.set(shouldOpen);
  }

  toggleConsole(force?: boolean): void {
    if (typeof force === 'boolean') {
      if (force) {
        this.closeSecondarySurfaces('console');
      }
      this.consoleOpen.set(force);
      return;
    }
    const shouldOpen = !this.consoleOpen();
    if (shouldOpen) {
      this.closeSecondarySurfaces('console');
    }
    this.consoleOpen.set(shouldOpen);
  }

  openSecretsModal(): void {
    this.closeSecondarySurfaces('secrets');
    this.showSecretsModal.set(true);
  }

  closeHistoryModal(): void {
    this.showHistoryModal.set(false);
  }

  closeLoadTestResults(): void {
    this.showLoadTestResults.set(false);
  }

  closeSecondarySurfaces(keepOpen?: SecondarySurface): void {
    if (keepOpen !== 'history') {
      this.showHistory.set(false);
    }
    if (keepOpen !== 'outline') {
      this.showOutlinePanel.set(false);
    }
    if (keepOpen !== 'commandPalette') {
      this.showCommandPalette.set(false);
    }
    if (keepOpen !== 'console') {
      this.consoleOpen.set(false);
    }
    if (keepOpen !== 'secrets') {
      this.showSecretsModal.set(false);
    }
  }
}
