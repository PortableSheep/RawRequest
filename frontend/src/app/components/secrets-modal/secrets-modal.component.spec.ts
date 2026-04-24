import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { signal } from '@angular/core';
import { SecretsModalComponent } from './secrets-modal.component';
import { SecretService } from '../../services/secret.service';
import { ToastService } from '../../services/toast.service';
import { PanelVisibilityService } from '../../services/panel-visibility.service';
import { WorkspaceStateService } from '../../services/workspace-state.service';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMockSecretService(secrets: any = {}) {
  return {
    allSecrets: signal(secrets) as any,
    vaultInfo: signal<any>(null) as any,
    secretToDelete: null as any,
    loadVaultInfo: vi.fn().mockResolvedValue(undefined),
    saveSecret: vi.fn().mockResolvedValue(undefined),
    deleteConfirmedSecret: vi.fn().mockResolvedValue('deleted_key'),
    cancelDeleteSecret: vi.fn(),
    confirmDeleteSecret: vi.fn(),
    exportVault: vi.fn().mockResolvedValue('{}'),
    resetVaultAndClear: vi.fn().mockResolvedValue(undefined),
    getSecretValue: vi.fn().mockResolvedValue('revealed_value'),
    setMasterPasswordAndRefresh: vi.fn().mockResolvedValue(undefined),
    verifyMasterPassword: vi.fn().mockResolvedValue(true),
  };
}

function createMockToastService() {
  return { success: vi.fn(), error: vi.fn(), info: vi.fn() };
}

function createMockPanelVisibilityService() {
  return {
    showSecretsModal: signal(false),
    openSecretsModal: vi.fn(),
  };
}

function createMockWorkspaceStateService() {
  return {
    currentFileEnvironments: signal(['dev', 'prod']),
    currentFileView: signal({ content: '{{secret:api_key}}' }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SecretsModalComponent', () => {
  let fixture: ComponentFixture<SecretsModalComponent>;
  let component: SecretsModalComponent;
  let mockSecretService: ReturnType<typeof createMockSecretService>;
  let mockToast: ReturnType<typeof createMockToastService>;
  let mockPanels: ReturnType<typeof createMockPanelVisibilityService>;
  let mockWs: ReturnType<typeof createMockWorkspaceStateService>;

  beforeEach(async () => {
    mockSecretService = createMockSecretService({ default: ['api_key', 'db_password'], dev: ['api_key'] });
    mockToast = createMockToastService();
    mockPanels = createMockPanelVisibilityService();
    mockWs = createMockWorkspaceStateService();

    await TestBed.configureTestingModule({
      imports: [SecretsModalComponent, FormsModule],
      providers: [
        { provide: SecretService, useValue: mockSecretService },
        { provide: ToastService, useValue: mockToast },
        { provide: PanelVisibilityService, useValue: mockPanels },
        { provide: WorkspaceStateService, useValue: mockWs },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SecretsModalComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // Modal visibility
  // -----------------------------------------------------------------------

  describe('modal visibility', () => {
    it('should not render when closed', () => {
      mockPanels.showSecretsModal.set(false);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.rr-modal-shell')).toBeNull();
    });

    it('should render when open', () => {
      mockPanels.showSecretsModal.set(true);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.rr-modal-shell')).toBeTruthy();
    });

    it('should display "Secrets" title', () => {
      mockPanels.showSecretsModal.set(true);
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Secrets');
    });
  });

  // -----------------------------------------------------------------------
  // Close actions
  // -----------------------------------------------------------------------

  describe('close actions', () => {
    beforeEach(() => {
      mockPanels.showSecretsModal.set(true);
      fixture.detectChanges();
    });

    it('should close modal on close button click', () => {
      const closeBtn = fixture.nativeElement.querySelector('.rr-modal__close') as HTMLElement;
      closeBtn.click();
      expect(mockPanels.showSecretsModal()).toBe(false);
    });

    it('should close modal on backdrop click', () => {
      const backdrop = fixture.nativeElement.querySelector('.rr-modal-backdrop') as HTMLElement;
      backdrop.click();
      expect(mockPanels.showSecretsModal()).toBe(false);
    });

    it('should close modal on Escape when no sub-dialogs open', () => {
      component.handleEscape();
      expect(mockPanels.showSecretsModal()).toBe(false);
    });

    it('should close delete confirm instead of modal on Escape', () => {
      component.showDeleteConfirm = true;
      component.handleEscape();
      expect(component.showDeleteConfirm).toBe(false);
      expect(mockPanels.showSecretsModal()).toBe(true);
    });

    it('should close master password prompt instead of modal on Escape', () => {
      component.showMasterPasswordPrompt = true;
      component.handleEscape();
      expect(component.showMasterPasswordPrompt).toBe(false);
      expect(mockPanels.showSecretsModal()).toBe(true);
    });

    it('should close reset confirm instead of modal on Escape', () => {
      component.showResetConfirm = true;
      component.handleEscape();
      expect(component.showResetConfirm).toBe(false);
      expect(mockPanels.showSecretsModal()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Secret list rendering
  // -----------------------------------------------------------------------

  describe('secret list rendering', () => {
    beforeEach(() => {
      mockPanels.showSecretsModal.set(true);
      fixture.detectChanges();
    });

    it('should render secret rows from service', () => {
      const rows = fixture.nativeElement.querySelectorAll('.secrets-modal__row');
      expect(rows.length).toBe(3);
    });

    it('should display key names', () => {
      expect(fixture.nativeElement.textContent).toContain('api_key');
      expect(fixture.nativeElement.textContent).toContain('db_password');
    });

    it('should show Global for default environment', () => {
      expect(fixture.nativeElement.textContent).toContain('Global');
    });

    it('should show usage count from file content', () => {
      expect(fixture.nativeElement.textContent).toContain('1 ref');
      expect(fixture.nativeElement.textContent).toContain('Unused');
    });
  });

  // -----------------------------------------------------------------------
  // Empty state
  // -----------------------------------------------------------------------

  describe('empty state', () => {
    it('should show empty message when no secrets', () => {
      mockSecretService.allSecrets.set({});
      mockPanels.showSecretsModal.set(true);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.secrets-modal__empty')).toBeTruthy();
      expect(fixture.nativeElement.textContent).toContain('No secrets yet');
    });
  });

  // -----------------------------------------------------------------------
  // Add secret form
  // -----------------------------------------------------------------------

  describe('add secret form', () => {
    beforeEach(() => {
      mockPanels.showSecretsModal.set(true);
      fixture.detectChanges();
    });

    it('should render form inputs', () => {
      expect(fixture.nativeElement.querySelector('.secrets-modal__input-key')).toBeTruthy();
      expect(fixture.nativeElement.querySelector('.secrets-modal__input-value')).toBeTruthy();
      expect(fixture.nativeElement.querySelector('.secrets-modal__add-btn')).toBeTruthy();
    });

    it('should disable add button when key or value is empty', () => {
      const btn = fixture.nativeElement.querySelector('.secrets-modal__add-btn') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it('should call secretService.saveSecret on save', async () => {
      component.newKey = 'my_secret';
      component.newValue = 'secret_value';
      component.targetEnv = 'dev';

      await component.handleSave();

      expect(mockSecretService.saveSecret).toHaveBeenCalledWith('dev', 'my_secret', 'secret_value');
      expect(mockToast.success).toHaveBeenCalled();
    });

    it('should clear form after save', async () => {
      component.newKey = 'key';
      component.newValue = 'val';
      await component.handleSave();
      expect(component.newKey).toBe('');
      expect(component.newValue).toBe('');
    });

    it('should not save when key is empty', async () => {
      component.newKey = '';
      component.newValue = 'value';
      await component.handleSave();
      expect(mockSecretService.saveSecret).not.toHaveBeenCalled();
    });

    it('should show environment options from workspace state', () => {
      const options = fixture.nativeElement.querySelectorAll('.secrets-modal__select-env option');
      expect(options.length).toBe(3); // Global + dev + prod
    });

    it('should show error toast on save failure', async () => {
      mockSecretService.saveSecret.mockRejectedValueOnce(new Error('fail'));
      component.newKey = 'k';
      component.newValue = 'v';
      vi.spyOn(console, 'error').mockImplementation();
      await component.handleSave();
      expect(mockToast.error).toHaveBeenCalledWith('Failed to save secret');
    });
  });

  // -----------------------------------------------------------------------
  // Delete flow
  // -----------------------------------------------------------------------

  describe('delete flow', () => {
    it('should show delete confirmation', () => {
      component.confirmDeleteSecret('dev', 'api_key');
      expect(component.showDeleteConfirm).toBe(true);
      expect(component.secretToDelete).toEqual({ env: 'dev', key: 'api_key' });
    });

    it('should call secretService.deleteConfirmedSecret on confirm', async () => {
      component.confirmDeleteSecret('dev', 'api_key');
      await component.deleteSecret();
      expect(mockSecretService.deleteConfirmedSecret).toHaveBeenCalled();
      expect(mockToast.info).toHaveBeenCalled();
      expect(component.showDeleteConfirm).toBe(false);
    });

    it('should cancel delete', () => {
      component.confirmDeleteSecret('dev', 'api_key');
      component.cancelDelete();
      expect(component.showDeleteConfirm).toBe(false);
      expect(component.secretToDelete).toBeNull();
      expect(mockSecretService.cancelDeleteSecret).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Sorting
  // -----------------------------------------------------------------------

  describe('sorting', () => {
    it('should default to key ascending', () => {
      expect(component.sortColumn).toBe('key');
      expect(component.sortDirection).toBe('asc');
    });

    it('should toggle direction on same column click', () => {
      component.onSortClick('key');
      expect(component.sortDirection).toBe('desc');
    });

    it('should switch to new column with asc', () => {
      component.onSortClick('env');
      expect(component.sortColumn).toBe('env');
      expect(component.sortDirection).toBe('asc');
    });

    it('should return sort indicator', () => {
      expect(component.getSortIndicator('key')).toBe(' ▲');
      expect(component.getSortIndicator('env')).toBe('');
    });
  });

  // -----------------------------------------------------------------------
  // Export
  // -----------------------------------------------------------------------

  describe('export', () => {
    it('should call secretService.exportVault and show toast', async () => {
      // Mock URL.createObjectURL/revokeObjectURL for jsdom
      const mockUrl = 'blob:mock';
      global.URL.createObjectURL = vi.fn().mockReturnValue(mockUrl);
      global.URL.revokeObjectURL = vi.fn();
      await component.triggerExport();
      expect(mockSecretService.exportVault).toHaveBeenCalled();
      expect(mockToast.success).toHaveBeenCalled();
    });

    it('should show error toast on export failure', async () => {
      mockSecretService.exportVault.mockRejectedValueOnce(new Error('fail'));
      vi.spyOn(console, 'error').mockImplementation();
      await component.triggerExport();
      expect(mockToast.error).toHaveBeenCalledWith('Failed to export secrets');
    });
  });

  // -----------------------------------------------------------------------
  // Reset vault
  // -----------------------------------------------------------------------

  describe('reset vault', () => {
    it('should show reset confirmation', () => {
      component.confirmReset();
      expect(component.showResetConfirm).toBe(true);
    });

    it('should cancel reset', () => {
      component.confirmReset();
      component.cancelReset();
      expect(component.showResetConfirm).toBe(false);
    });

    it('should not enable until RESET typed', () => {
      component.resetConfirmText = 'res';
      expect(component.isResetEnabled).toBe(false);
      component.resetConfirmText = 'RESET';
      expect(component.isResetEnabled).toBe(true);
    });

    it('should call resetVaultAndClear when enabled', async () => {
      component.confirmReset();
      component.resetConfirmText = 'RESET';
      await component.executeReset();
      expect(mockSecretService.resetVaultAndClear).toHaveBeenCalled();
      expect(mockToast.info).toHaveBeenCalledWith('Vault reset. Add new secrets to continue.');
    });

    it('should not reset when not enabled', async () => {
      component.resetConfirmText = 'nope';
      await component.executeReset();
      expect(mockSecretService.resetVaultAndClear).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Master password
  // -----------------------------------------------------------------------

  describe('master password', () => {
    it('should show verify mode when vault has password', () => {
      mockSecretService.vaultInfo.set({ hasMasterPassword: true });
      component.onRevealClick();
      expect(component.showMasterPasswordPrompt).toBe(true);
      expect(component.masterPasswordMode).toBe('verify');
    });

    it('should show set mode when vault has no password', () => {
      mockSecretService.vaultInfo.set({ hasMasterPassword: false });
      component.onRevealClick();
      expect(component.masterPasswordMode).toBe('set');
    });

    it('should verify password and reveal values', async () => {
      component.masterPasswordMode = 'verify';
      component.masterPasswordInput = 'password';
      component.showMasterPasswordPrompt = true;
      await component.submitMasterPassword();
      expect(mockSecretService.verifyMasterPassword).toHaveBeenCalledWith('password');
      expect(component.showMasterPasswordPrompt).toBe(false);
      expect(component.isValuesRevealed).toBe(true);
    });

    it('should auto-load all secret values after successful verify', async () => {
      component.masterPasswordMode = 'verify';
      component.masterPasswordInput = 'password';
      await component.submitMasterPassword();
      await flushPromises();
      // Three secrets configured in beforeEach: default/api_key, default/db_password, dev/api_key
      expect(mockSecretService.getSecretValue).toHaveBeenCalledWith('default', 'api_key');
      expect(mockSecretService.getSecretValue).toHaveBeenCalledWith('default', 'db_password');
      expect(mockSecretService.getSecretValue).toHaveBeenCalledWith('dev', 'api_key');
      expect(component.getRevealedValue('default', 'api_key')).toBe('revealed_value');
    });

    it('should show error on wrong password', async () => {
      mockSecretService.verifyMasterPassword.mockResolvedValueOnce(false);
      component.masterPasswordMode = 'verify';
      component.masterPasswordInput = 'wrong';
      await component.submitMasterPassword();
      expect(component.masterPasswordError).toBe('Incorrect password');
      expect(component.masterPasswordAttempt).toBe(1);
      expect(component.isValuesRevealed).toBe(false);
    });

    it('should escalate attempt counter on repeated wrong passwords', async () => {
      mockSecretService.verifyMasterPassword.mockResolvedValue(false);
      component.masterPasswordMode = 'verify';
      component.masterPasswordInput = 'wrong';
      await component.submitMasterPassword();
      await component.submitMasterPassword();
      expect(component.masterPasswordAttempt).toBe(2);
      expect(component.masterPasswordError).toBe('Incorrect password (attempt 2)');
    });

    it('should trigger shake animation flag on wrong password', async () => {
      mockSecretService.verifyMasterPassword.mockResolvedValueOnce(false);
      component.masterPasswordMode = 'verify';
      component.masterPasswordInput = 'wrong';
      await component.submitMasterPassword();
      // queueMicrotask sets the flag asynchronously; await a microtask tick.
      await Promise.resolve();
      expect(component.masterPasswordShake).toBe(true);
    });

    it('should clear error + shake state when user edits the password input', async () => {
      mockSecretService.verifyMasterPassword.mockResolvedValueOnce(false);
      component.masterPasswordMode = 'verify';
      component.masterPasswordInput = 'wrong';
      await component.submitMasterPassword();
      await Promise.resolve();
      component.onMasterPasswordInput();
      expect(component.masterPasswordError).toBe('');
      expect(component.masterPasswordShake).toBe(false);
    });

    it('should set password and reveal values', async () => {
      component.masterPasswordMode = 'set';
      component.masterPasswordInput = 'new_pass';
      component.masterPasswordConfirmInput = 'new_pass';
      await component.submitMasterPassword();
      expect(mockSecretService.setMasterPasswordAndRefresh).toHaveBeenCalledWith('new_pass');
      expect(component.isValuesRevealed).toBe(true);
    });

    it('should reject mismatched confirm password without calling backend', async () => {
      component.masterPasswordMode = 'set';
      component.masterPasswordInput = 'abc123';
      component.masterPasswordConfirmInput = 'different';
      await component.submitMasterPassword();
      expect(mockSecretService.setMasterPasswordAndRefresh).not.toHaveBeenCalled();
      expect(component.masterPasswordError).toBe('Passwords do not match');
      expect(component.isValuesRevealed).toBe(false);
    });

    it('should not submit when password is empty', async () => {
      component.masterPasswordInput = '';
      await component.submitMasterPassword();
      expect(mockSecretService.verifyMasterPassword).not.toHaveBeenCalled();
      expect(mockSecretService.setMasterPasswordAndRefresh).not.toHaveBeenCalled();
    });

    describe('forgot password', () => {
      it('should open confirm from verify prompt', () => {
        component.masterPasswordMode = 'verify';
        component.showMasterPasswordPrompt = true;
        component.openForgotPasswordConfirm();
        expect(component.showForgotPasswordConfirm).toBe(true);
      });

      it('should reset vault, switch to set mode, and keep prompt open on confirm', async () => {
        component.masterPasswordMode = 'verify';
        component.showMasterPasswordPrompt = true;
        component.showForgotPasswordConfirm = true;
        component.masterPasswordInput = 'stale';
        component.masterPasswordError = 'Incorrect password';
        component.masterPasswordAttempt = 3;
        component.isValuesRevealed = true;

        await component.confirmForgotPasswordReset();

        expect(mockSecretService.resetVaultAndClear).toHaveBeenCalled();
        expect(component.masterPasswordMode).toBe('set');
        expect(component.showMasterPasswordPrompt).toBe(true);
        expect(component.showForgotPasswordConfirm).toBe(false);
        expect(component.masterPasswordInput).toBe('');
        expect(component.masterPasswordError).toBe('');
        expect(component.masterPasswordAttempt).toBe(0);
        expect(component.isValuesRevealed).toBe(false);
        expect(mockToast.info).toHaveBeenCalled();
      });

      it('should cancel without resetting', () => {
        component.showForgotPasswordConfirm = true;
        component.cancelForgotPassword();
        expect(component.showForgotPasswordConfirm).toBe(false);
        expect(mockSecretService.resetVaultAndClear).not.toHaveBeenCalled();
      });
    });
  });

  // -----------------------------------------------------------------------
  // Reveal / hide values
  // -----------------------------------------------------------------------

  describe('reveal / hide values', () => {
    it('should hide values and clear cache', () => {
      component.isValuesRevealed = true;
      component.revealedValues = { 'default:api_key': 'val' };
      component.hideValues();
      expect(component.isValuesRevealed).toBe(false);
      expect(component.revealedValues).toEqual({});
    });

    it('should load secret value from service', async () => {
      await component.loadSecretValue('default', 'api_key');
      expect(mockSecretService.getSecretValue).toHaveBeenCalledWith('default', 'api_key');
      expect(component.getRevealedValue('default', 'api_key')).toBe('revealed_value');
    });

    it('should handle load error gracefully', async () => {
      mockSecretService.getSecretValue.mockRejectedValueOnce(new Error('fail'));
      vi.spyOn(console, 'error').mockImplementation();
      await component.loadSecretValue('default', 'api_key');
      expect(component.getRevealedValue('default', 'api_key')).toBe('(error)');
    });

    it('should return undefined for unrevealed values', () => {
      expect(component.getRevealedValue('default', 'unknown')).toBeUndefined();
    });
  });

  describe('auto-prompt master password on open', () => {
    it('should auto-show set password prompt when secrets exist but no master password', async () => {
      mockSecretService.loadVaultInfo.mockResolvedValue({ hasMasterPassword: false });

      mockPanels.showSecretsModal.set(true);
      fixture.detectChanges();
      await flushPromises();

      expect(component.showMasterPasswordPrompt).toBe(true);
      expect(component.masterPasswordMode).toBe('set');
    });

    it('should not auto-prompt when master password exists', async () => {
      mockSecretService.loadVaultInfo.mockResolvedValue({ hasMasterPassword: true });

      mockPanels.showSecretsModal.set(true);
      fixture.detectChanges();
      await flushPromises();

      expect(component.showMasterPasswordPrompt).toBe(false);
    });

    it('should not auto-prompt when no secrets exist', async () => {
      mockSecretService.allSecrets.set({});
      mockSecretService.loadVaultInfo.mockResolvedValue({ hasMasterPassword: false });

      mockPanels.showSecretsModal.set(true);
      fixture.detectChanges();
      await flushPromises();

      expect(component.showMasterPasswordPrompt).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // State reset on open
  // -----------------------------------------------------------------------

  describe('state reset on open', () => {
    it('should reset form state when modal opens', () => {
      component.targetEnv = 'dev';
      component.filterQuery = 'test';
      component.isValuesRevealed = true;
      component.showMasterPasswordPrompt = true;

      mockPanels.showSecretsModal.set(true);
      fixture.detectChanges();

      expect(component.targetEnv).toBe('');
      expect(component.filterQuery).toBe('');
      expect(component.isValuesRevealed).toBe(false);
      expect(component.showMasterPasswordPrompt).toBe(false);
    });

    it('should load vault info when modal opens', () => {
      mockPanels.showSecretsModal.set(true);
      fixture.detectChanges();
      expect(mockSecretService.loadVaultInfo).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Total secret count
  // -----------------------------------------------------------------------

  describe('getTotalSecretCount', () => {
    it('should count all secrets across environments', () => {
      expect(component.getTotalSecretCount()).toBe(3);
    });

    it('should return 0 for empty secrets', () => {
      mockSecretService.allSecrets.set({});
      expect(component.getTotalSecretCount()).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // getDisplayRows
  // -----------------------------------------------------------------------

  describe('getDisplayRows', () => {
    it('should return sorted rows', () => {
      const rows = component.getDisplayRows();
      expect(rows.length).toBe(3);
      expect(rows[0].key).toBe('api_key');
    });

    it('should filter rows', () => {
      component.filterQuery = 'db_password';
      const rows = component.getDisplayRows();
      expect(rows.length).toBe(1);
      expect(rows[0].key).toBe('db_password');
    });
  });
});

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
