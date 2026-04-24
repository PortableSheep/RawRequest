import { Component, computed, effect, ElementRef, HostListener, inject, viewChild } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { SecretService } from '../../services/secret.service';
import { ToastService } from '../../services/toast.service';
import { PanelVisibilityService } from '../../services/panel-visibility.service';
import { WorkspaceStateService } from '../../services/workspace-state.service';
import {
  SecretRow, SortColumn, SortDirection,
  buildSecretRows, sortSecretRows, filterSecretRows, countSecretUsage, toggleSort
} from './secrets-modal.logic';
import {
  normalizeEnvName,
  buildSecretSavedToast,
  buildSecretDeletedToast,
  buildVaultExportedToast,
  buildVaultFileName,
} from '../../logic/app/app.component.logic';

@Component({
  selector: 'app-secrets-modal',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './secrets-modal.component.html',
  styleUrls: ['./secrets-modal.component.scss']
})
export class SecretsModalComponent {
  private readonly secretService = inject(SecretService);
  private readonly toast = inject(ToastService);
  readonly panels = inject(PanelVisibilityService);
  private readonly ws = inject(WorkspaceStateService);

  readonly isOpen = this.panels.showSecretsModal;
  readonly environments = this.ws.currentFileEnvironments;
  readonly allSecrets = this.secretService.allSecrets;
  readonly vaultInfo = this.secretService.vaultInfo;
  readonly fileContent = computed(() => this.ws.currentFileView().content);

  // Internal form state
  targetEnv = '';
  newKey = '';
  newValue = '';
  showValue = false;
  resetConfirmText = '';
  showResetConfirm = false;

  // Sort & filter state
  sortColumn: SortColumn = 'key';
  sortDirection: SortDirection = 'asc';
  filterQuery = '';

  // Delete confirmation state
  showDeleteConfirm = false;
  secretToDelete: { env: string; key: string } | null = null;

  private wasOpen = false;

  constructor() {
    effect(() => {
      const open = this.isOpen();
      if (open && !this.wasOpen) {
        this.targetEnv = '';
        this.resetConfirmText = '';
        this.showResetConfirm = false;
        this.filterQuery = '';
        this.isValuesRevealed = false;
        this.revealedValues = {};
        this.showMasterPasswordPrompt = false;
        this.masterPasswordInput = '';
        this.masterPasswordConfirmInput = '';
        this.masterPasswordError = '';
        this.masterPasswordAttempt = 0;
        this.masterPasswordShake = false;
        this.showForgotPasswordConfirm = false;
        this.showDeleteConfirm = false;
        this.secretToDelete = null;
        void this.initModalState();
      }
      this.wasOpen = open;
    });
  }

  Object = Object;

  private async initModalState(): Promise<void> {
    const info = await this.secretService.loadVaultInfo();
    if (info && !info.hasMasterPassword && this.getTotalSecretCount() > 0) {
      this.masterPasswordMode = 'set';
      this.masterPasswordInput = '';
      this.masterPasswordError = '';
      this.showMasterPasswordPrompt = true;
      this.focusMasterPasswordField();
    }
  }

  // Master password & value reveal state
  showMasterPasswordPrompt = false;
  masterPasswordInput = '';
  masterPasswordConfirmInput = '';
  masterPasswordMode: 'set' | 'verify' = 'verify';
  masterPasswordError = '';
  masterPasswordAttempt = 0;
  masterPasswordShake = false;
  showForgotPasswordConfirm = false;
  isValuesRevealed = false;
  revealedValues: Record<string, string> = {};

  private readonly masterPasswordField = viewChild<ElementRef<HTMLInputElement>>('masterPasswordField');

  private focusMasterPasswordField(): void {
    // Defer until after the @if block renders the input.
    setTimeout(() => {
      this.masterPasswordField()?.nativeElement.focus();
    }, 0);
  }

  @HostListener('document:keydown.escape')
  handleEscape(): void {
    if (!this.isOpen()) return;
    if (this.showDeleteConfirm) {
      this.cancelDelete();
      return;
    }
    if (this.showMasterPasswordPrompt) {
      if (this.showForgotPasswordConfirm) {
        this.showForgotPasswordConfirm = false;
        return;
      }
      this.showMasterPasswordPrompt = false;
      return;
    }
    if (this.showResetConfirm) {
      this.cancelReset();
      return;
    }
    this.close();
  }

  close(): void {
    this.panels.showSecretsModal.set(false);
  }

  handleShellClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  toggleShowValue(): void {
    this.showValue = !this.showValue;
  }

  getDisplayRows(): SecretRow[] {
    const usageCounts = countSecretUsage(this.fileContent());
    const rows = buildSecretRows(this.allSecrets(), usageCounts);
    const filtered = filterSecretRows(rows, this.filterQuery);
    return sortSecretRows(filtered, this.sortColumn, this.sortDirection);
  }

  onSortClick(column: SortColumn) {
    const result = toggleSort(this.sortColumn, this.sortDirection, column);
    this.sortColumn = result.column;
    this.sortDirection = result.direction;
  }

  getSortIndicator(column: SortColumn): string {
    if (this.sortColumn !== column) return '';
    return this.sortDirection === 'asc' ? ' ▲' : ' ▼';
  }

  async handleSave() {
    if (!this.newKey || !this.newValue) return;
    const normalizedEnv = normalizeEnvName(this.targetEnv);
    try {
      await this.secretService.saveSecret(normalizedEnv, this.newKey, this.newValue);
      this.toast.success(buildSecretSavedToast({ key: this.newKey, env: normalizedEnv }));
      this.newKey = '';
      this.newValue = '';
    } catch (error) {
      console.error('Failed to save secret', error);
      this.toast.error('Failed to save secret');
    }
  }

  // --- Delete flow ---

  confirmDeleteSecret(env: string, key: string): void {
    this.secretToDelete = { env, key };
    this.showDeleteConfirm = true;
  }

  async deleteSecret(): Promise<void> {
    try {
      const deletedKey = await this.secretService.deleteConfirmedSecret();
      if (deletedKey) {
        this.toast.info(buildSecretDeletedToast(deletedKey));
      }
    } catch (error) {
      console.error('Failed to delete secret', error);
      this.toast.error('Failed to delete secret');
    }
    this.showDeleteConfirm = false;
    this.secretToDelete = null;
  }

  cancelDelete(): void {
    this.showDeleteConfirm = false;
    this.secretToDelete = null;
    this.secretService.cancelDeleteSecret();
  }

  // --- Export / Reset ---

  async triggerExport(): Promise<void> {
    try {
      const payload = await this.secretService.exportVault();
      const fileName = buildVaultFileName(new Date());
      this.downloadSecretsFile(payload, fileName);
      this.toast.success(buildVaultExportedToast(fileName));
    } catch (error) {
      console.error('Failed to export secrets', error);
      this.toast.error('Failed to export secrets');
    }
  }

  confirmReset() {
    this.showResetConfirm = true;
    this.resetConfirmText = '';
  }

  cancelReset() {
    this.showResetConfirm = false;
    this.resetConfirmText = '';
  }

  async executeReset(): Promise<void> {
    if (!this.isResetEnabled) return;
    try {
      await this.secretService.resetVaultAndClear();
      this.toast.info('Vault reset. Add new secrets to continue.');
    } catch (error) {
      console.error('Failed to reset vault', error);
      this.toast.error('Failed to reset vault');
    }
    this.showResetConfirm = false;
    this.resetConfirmText = '';
  }

  get isResetEnabled(): boolean {
    return this.resetConfirmText.trim().toUpperCase() === 'RESET';
  }

  getTotalSecretCount(): number {
    const secrets = this.allSecrets();
    return Object.values(secrets).reduce((sum, keys) => sum + (keys?.length || 0), 0);
  }

  onRevealClick() {
    const info = this.vaultInfo();
    if (info?.hasMasterPassword) {
      this.masterPasswordMode = 'verify';
    } else {
      this.masterPasswordMode = 'set';
    }
    this.masterPasswordInput = '';
    this.masterPasswordConfirmInput = '';
    this.masterPasswordError = '';
    this.masterPasswordAttempt = 0;
    this.masterPasswordShake = false;
    this.showForgotPasswordConfirm = false;
    this.showMasterPasswordPrompt = true;
    this.focusMasterPasswordField();
  }

  onMasterPasswordInput(): void {
    if (this.masterPasswordError || this.masterPasswordShake) {
      this.masterPasswordError = '';
      this.masterPasswordShake = false;
    }
  }

  onMasterPasswordShakeEnd(): void {
    this.masterPasswordShake = false;
  }

  hideValues() {
    this.isValuesRevealed = false;
    this.revealedValues = {};
  }

  getRevealedValue(env: string, key: string): string | undefined {
    return this.revealedValues[`${env}:${key}`];
  }

  async loadSecretValue(env: string, key: string): Promise<void> {
    try {
      const value = await this.secretService.getSecretValue(env, key);
      this.revealedValues[`${env}:${key}`] = value;
    } catch (error) {
      console.error('Failed to get secret value', error);
      this.revealedValues[`${env}:${key}`] = '(error)';
    }
  }

  /** Pre-fetch every secret value in the vault so the table renders them
   *  immediately after the user unlocks, rather than requiring a per-row
   *  "Load" click. */
  private async loadAllSecretValues(): Promise<void> {
    const secrets = this.allSecrets();
    const tasks: Promise<void>[] = [];
    for (const [env, keys] of Object.entries(secrets)) {
      if (!keys) continue;
      for (const key of keys) {
        tasks.push(this.loadSecretValue(env, key));
      }
    }
    await Promise.all(tasks);
  }

  async submitMasterPassword(): Promise<void> {
    if (!this.masterPasswordInput) return;
    try {
      if (this.masterPasswordMode === 'set') {
        if (this.masterPasswordInput !== this.masterPasswordConfirmInput) {
          this.masterPasswordError = 'Passwords do not match';
          this.triggerPasswordShake();
          return;
        }
        await this.secretService.setMasterPasswordAndRefresh(this.masterPasswordInput);
        this.showMasterPasswordPrompt = false;
        this.isValuesRevealed = true;
        this.masterPasswordAttempt = 0;
        this.masterPasswordConfirmInput = '';
        void this.loadAllSecretValues();
      } else {
        const valid = await this.secretService.verifyMasterPassword(this.masterPasswordInput);
        if (valid) {
          this.showMasterPasswordPrompt = false;
          this.isValuesRevealed = true;
          this.masterPasswordAttempt = 0;
          this.masterPasswordShake = false;
          void this.loadAllSecretValues();
        } else {
          this.masterPasswordAttempt += 1;
          this.masterPasswordError = `Incorrect password${this.masterPasswordAttempt > 1 ? ` (attempt ${this.masterPasswordAttempt})` : ''}`;
          this.triggerPasswordShake();
        }
      }
    } catch (error) {
      console.error('Master password operation failed', error);
      this.masterPasswordError = this.masterPasswordMode === 'set'
        ? 'Failed to set password'
        : 'Verification failed';
      this.triggerPasswordShake();
    }
  }

  private triggerPasswordShake(): void {
    this.masterPasswordShake = false;
    // Force the animation to replay on repeat failures by toggling the class
    // on a microtask boundary so Angular applies a true remove → add.
    queueMicrotask(() => {
      this.masterPasswordShake = true;
    });
  }

  // --- Forgot master password ---

  openForgotPasswordConfirm(): void {
    this.showForgotPasswordConfirm = true;
  }

  cancelForgotPassword(): void {
    this.showForgotPasswordConfirm = false;
  }

  async confirmForgotPasswordReset(): Promise<void> {
    try {
      await this.secretService.resetVaultAndClear();
      this.toast.info('Vault cleared. Set a new master password.');
      this.masterPasswordMode = 'set';
      this.masterPasswordInput = '';
      this.masterPasswordConfirmInput = '';
      this.masterPasswordError = '';
      this.masterPasswordAttempt = 0;
      this.masterPasswordShake = false;
      this.showForgotPasswordConfirm = false;
      this.isValuesRevealed = false;
      this.revealedValues = {};
      this.focusMasterPasswordField();
    } catch (error) {
      console.error('Failed to reset vault during forgot-password flow', error);
      this.toast.error('Failed to reset vault');
      this.showForgotPasswordConfirm = false;
    }
  }

  private downloadSecretsFile(content: string, fileName: string): void {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }
}
