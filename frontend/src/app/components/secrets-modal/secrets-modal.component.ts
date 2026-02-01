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

  // Internal form state
  targetEnv = '';
  newKey = '';
  newValue = '';
  showValue = false;
  resetConfirmText = '';
  showResetConfirm = false;

  private wasOpen = false;

  constructor() {
    effect(() => {
      const open = this.isOpen();
      if (open && !this.wasOpen) {
        this.targetEnv = (this.selectedEnv() || '').trim();
        this.resetConfirmText = '';
        this.showResetConfirm = false;
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

  /** Flatten secrets index into a sorted array for table display */
  getFlatSecretList(): Array<{env: string, key: string}> {
    const all = this.allSecrets() || {};
    const result: Array<{env: string, key: string}> = [];
    
    // Sort environments: 'default' first, then alphabetically
    const envs = Object.keys(all).sort((a, b) => {
      if (a === 'default') return -1;
      if (b === 'default') return 1;
      return a.localeCompare(b);
    });
    
    for (const env of envs) {
      const keys = all[env] || [];
      for (const key of keys.sort()) {
        result.push({ env, key });
      }
    }
    return result;
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
