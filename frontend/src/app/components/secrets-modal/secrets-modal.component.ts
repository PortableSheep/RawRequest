import { Component, effect, HostListener, input, output } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { SecretIndex, VaultInfo } from '../../services/secret.service';

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

  // Internal form state (not inputs)
  // selectedEnv = '';
  targetEnv = '';
  newKey = '';
  newValue = '';
  showValue = false;
  filterText = '';
  filterEnv = 'all';
  resetConfirmText = '';

  private wasOpen = false;

  constructor() {
    effect(() => {
      const open = this.isOpen();
      if (open && !this.wasOpen) {
        this.targetEnv = (this.selectedEnv() || '').trim();
		this.resetConfirmText = '';
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

  getFilteredSecrets(): Record<string, string[]> {
    const all = this.allSecrets() || {};
    const q = this.filterText.trim().toLowerCase();
    const envFilter = (this.filterEnv || 'all').trim();

    const result: Record<string, string[]> = {};
    for (const env of Object.keys(all)) {
      if (envFilter !== 'all' && env !== envFilter) continue;
      const keys = all[env] || [];
      const filtered = q ? keys.filter((k) => k.toLowerCase().includes(q)) : keys;
      if (filtered.length) result[env] = filtered;
    }
    return result;
  }

  handleSave() {
    if (!this.newKey || !this.newValue) {
      alert('Please fill in all fields');
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

  triggerReset() {
  if (!this.isResetEnabled) return;
    this.onResetVault.emit();
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
