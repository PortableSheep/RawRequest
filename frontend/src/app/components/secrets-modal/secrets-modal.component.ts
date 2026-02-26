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
      }
      this.wasOpen = open;
    });
  }

  onClose = output<void>();
  onSave = output<{env: string, key: string, value: string}>();
  onDeleteClick = output<{env: string, key: string}>();
  onExport = output<void>();
  onResetVault = output<void>();

  Object = Object;

  @HostListener('document:keydown.escape')
  handleEscape(): void {
    if (!this.isOpen()) return;
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
}
