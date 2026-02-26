import { Component, effect, HostListener, input, output } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { SecretIndex, VaultInfo } from '../../services/secret.service';
import {
  SecretRow, SortColumn, SortDirection,
  buildSecretRows, sortSecretRows, filterSecretRows, countSecretUsage, toggleSort
} from './secrets-modal.logic';

@Component({
  selector: 'app-secrets-modal',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './secrets-modal.component.html',
  styleUrls: ['./secrets-modal.component.scss']
})
export class SecretsModalComponent {
  isOpen = input<boolean>(false);
  selectedEnv = input<string>('');
  environments = input<string[]>([]);
  allSecrets = input<SecretIndex>({});
  vaultInfo = input<VaultInfo | null>(null);
  fileContent = input<string>('');

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
        this.masterPasswordError = '';
      }
      this.wasOpen = open;
    });
  }

  onClose = output<void>();
  onSave = output<{env: string, key: string, value: string}>();
  onDeleteClick = output<{env: string, key: string}>();
  onExport = output<void>();
  onResetVault = output<void>();
  onSetMasterPassword = output<string>();
  onVerifyMasterPassword = output<string>();
  onGetSecretValue = output<{env: string, key: string}>();

  Object = Object;

  // Master password & value reveal state
  showMasterPasswordPrompt = false;
  masterPasswordInput = '';
  masterPasswordMode: 'set' | 'verify' = 'verify';
  masterPasswordError = '';
  isValuesRevealed = false;
  revealedValues: Record<string, string> = {};

  @HostListener('document:keydown.escape')
  handleEscape(): void {
    if (!this.isOpen()) return;
    if (this.showMasterPasswordPrompt) {
      this.showMasterPasswordPrompt = false;
      return;
    }
    if (this.showResetConfirm) {
      this.cancelReset();
      return;
    }
    this.onClose.emit();
  }

  handleShellClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.onClose.emit();
    }
  }

  toggleShowValue(): void {
    this.showValue = !this.showValue;
  }

  /** Build sorted, filtered rows for the table */
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

  handleSave() {
    if (!this.newKey || !this.newValue) {
      return;
    }
    this.onSave.emit({
      env: this.targetEnv,
      key: this.newKey,
      value: this.newValue
    });
    this.newKey = '';
    this.newValue = '';
  }

  triggerExport() {
    this.onExport.emit();
  }

  confirmReset() {
    this.showResetConfirm = true;
    this.resetConfirmText = '';
  }

  cancelReset() {
    this.showResetConfirm = false;
    this.resetConfirmText = '';
  }

  executeReset() {
    if (!this.isResetEnabled) return;
    this.onResetVault.emit();
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
    this.masterPasswordError = '';
    this.showMasterPasswordPrompt = true;
  }

  hideValues() {
    this.isValuesRevealed = false;
    this.revealedValues = {};
  }

  /** Called by parent when master password is verified or set successfully */
  onMasterPasswordVerified() {
    this.showMasterPasswordPrompt = false;
    this.isValuesRevealed = true;
  }

  /** Called by parent when master password verification fails */
  onMasterPasswordFailed(message: string) {
    this.masterPasswordError = message;
  }

  /** Called by parent to provide a revealed value */
  setRevealedValue(env: string, key: string, value: string) {
    this.revealedValues[`${env}:${key}`] = value;
  }

  getRevealedValue(env: string, key: string): string | undefined {
    return this.revealedValues[`${env}:${key}`];
  }
}
