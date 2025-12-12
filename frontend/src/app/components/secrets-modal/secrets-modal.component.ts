import { Component, input, output } from '@angular/core';

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
  // environments = input<string[]>([]);
  allSecrets = input<SecretIndex>({});
  vaultInfo = input<VaultInfo | null>(null);

  // Internal form state (not inputs)
  // selectedEnv = '';
  newKey = '';
  newValue = '';

  onClose = output<void>();
  onSave = output<{env: string, key: string, value: string}>();
  onDeleteClick = output<{env: string, key: string}>();
  onExport = output<void>();
  onResetVault = output<void>();

  Object = Object;

  handleSave() {
    if (!this.newKey || !this.newValue || !this.selectedEnv()) {
      alert('Please fill in all fields');
      return;
    }
    this.onSave.emit({
      env: this.selectedEnv(),
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
    this.onResetVault.emit();
  }

  getTotalSecretCount(): number {
    const secrets = this.allSecrets();
    return Object.values(secrets).reduce((sum, keys) => sum + (keys?.length || 0), 0);
  }
}
