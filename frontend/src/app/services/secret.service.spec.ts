import { TestBed } from '@angular/core/testing';
import { SecretService } from './secret.service';
import { BACKEND_CLIENT, BackendClientContract } from './backend-client.contract';

type MockBackendClient = { [K in keyof BackendClientContract]: jest.Mock };

function createMockBackend(): MockBackendClient {
  return {
    sendRequest: jest.fn(),
    sendRequestWithID: jest.fn(),
    sendRequestWithTimeout: jest.fn(),
    executeRequests: jest.fn(),
    executeRequestsWithID: jest.fn(),
    cancelRequest: jest.fn(),
    startLoadTest: jest.fn(),
    setVariable: jest.fn(),
    getVariable: jest.fn(),
    loadFileHistoryFromDir: jest.fn(),
    loadFileHistoryFromRunLocation: jest.fn(),
    saveResponseFile: jest.fn(),
    saveResponseFileToRunLocation: jest.fn(),
    getScriptLogs: jest.fn(),
    clearScriptLogs: jest.fn(),
    recordScriptLog: jest.fn(),
    listSecrets: jest.fn(),
    saveSecret: jest.fn(),
    deleteSecret: jest.fn(),
    getSecretValue: jest.fn(),
    getVaultInfo: jest.fn(),
    hasMasterPassword: jest.fn(),
    setMasterPassword: jest.fn(),
    verifyMasterPassword: jest.fn(),
    resetVault: jest.fn(),
    exportSecrets: jest.fn(),
  };
}

describe('SecretService', () => {
  let service: SecretService;
  let backend: MockBackendClient;

  beforeEach(() => {
    backend = createMockBackend();
    TestBed.configureTestingModule({
      providers: [
        SecretService,
        { provide: BACKEND_CLIENT, useValue: backend },
      ],
    });
    service = TestBed.inject(SecretService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('refreshSecrets', () => {
    it('should populate allSecrets from backend', async () => {
      const secrets = { dev: ['API_KEY'], prod: ['DB_PASS'] };
      backend.listSecrets.mockResolvedValue(secrets);
      backend.getVaultInfo.mockResolvedValue({ hasMasterPassword: true });

      service.refreshSecrets(true);
      await flushPromises();

      expect(service.allSecrets).toEqual(secrets);
    });

    it('should populate vaultInfo from backend', async () => {
      backend.listSecrets.mockResolvedValue({});
      const info = { hasMasterPassword: true, secretCount: 5 };
      backend.getVaultInfo.mockResolvedValue(info);

      service.refreshSecrets(true);
      await flushPromises();

      expect(service.vaultInfo).toEqual(info);
    });

    it('should invoke master password warning when secrets exist but no master password', async () => {
      const warningCb = jest.fn();
      service.onMasterPasswordWarning(warningCb);

      backend.listSecrets.mockResolvedValue({ dev: ['API_KEY'] });
      backend.getVaultInfo.mockResolvedValue({ hasMasterPassword: false });

      service.refreshSecrets(true);
      await flushPromises();

      expect(warningCb).toHaveBeenCalledTimes(1);
    });

    it('should not invoke warning when vault has master password', async () => {
      const warningCb = jest.fn();
      service.onMasterPasswordWarning(warningCb);

      backend.listSecrets.mockResolvedValue({ dev: ['API_KEY'] });
      backend.getVaultInfo.mockResolvedValue({ hasMasterPassword: true });

      service.refreshSecrets(true);
      await flushPromises();

      expect(warningCb).not.toHaveBeenCalled();
    });

    it('should only invoke warning once', async () => {
      const warningCb = jest.fn();
      service.onMasterPasswordWarning(warningCb);

      backend.listSecrets.mockResolvedValue({ dev: ['KEY'] });
      backend.getVaultInfo.mockResolvedValue({ hasMasterPassword: false });

      service.refreshSecrets(true);
      await flushPromises();
      service.refreshSecrets(true);
      await flushPromises();

      expect(warningCb).toHaveBeenCalledTimes(1);
    });
  });

  describe('loadVaultInfo', () => {
    it('should update vaultInfo', async () => {
      const info = { hasMasterPassword: false };
      backend.getVaultInfo.mockResolvedValue(info);

      await service.loadVaultInfo(true);

      expect(service.vaultInfo).toEqual(info);
    });

    it('should not throw on backend error', async () => {
      backend.getVaultInfo.mockRejectedValue(new Error('network error'));

      await expect(service.loadVaultInfo(true)).resolves.not.toThrow();
    });
  });

  describe('saveSecret', () => {
    it('should update allSecrets and refresh vault info', async () => {
      const snapshot = { dev: ['API_KEY', 'NEW_KEY'] };
      backend.saveSecret.mockResolvedValue(snapshot);
      backend.getVaultInfo.mockResolvedValue({ hasMasterPassword: true });

      const result = await service.saveSecret('dev', 'NEW_KEY', 'value123');

      expect(result).toEqual(snapshot);
      expect(service.allSecrets).toEqual(snapshot);
      expect(backend.getVaultInfo).toHaveBeenCalled();
    });
  });

  describe('removeSecret', () => {
    it('should update allSecrets and refresh vault info', async () => {
      const snapshot = { dev: [] as string[] };
      backend.deleteSecret.mockResolvedValue(snapshot);
      backend.getVaultInfo.mockResolvedValue({ hasMasterPassword: true });

      const result = await service.removeSecret('dev', 'API_KEY');

      expect(result).toEqual(snapshot);
      expect(service.allSecrets).toEqual(snapshot);
      expect(backend.getVaultInfo).toHaveBeenCalled();
    });
  });

  describe('confirmDeleteSecret / cancelDeleteSecret', () => {
    it('should set secretToDelete', () => {
      service.confirmDeleteSecret('prod', 'DB_PASS');
      expect(service.secretToDelete).toEqual({ env: 'prod', key: 'DB_PASS' });
    });

    it('should clear secretToDelete on cancel', () => {
      service.confirmDeleteSecret('prod', 'DB_PASS');
      service.cancelDeleteSecret();
      expect(service.secretToDelete).toBeNull();
    });
  });

  describe('deleteConfirmedSecret', () => {
    it('should return null if no secret is pending deletion', async () => {
      const result = await service.deleteConfirmedSecret();
      expect(result).toBeNull();
    });

    it('should delete the confirmed secret and return its key', async () => {
      const snapshot = { prod: [] as string[] };
      backend.deleteSecret.mockResolvedValue(snapshot);
      backend.getVaultInfo.mockResolvedValue({ hasMasterPassword: true });

      service.confirmDeleteSecret('prod', 'DB_PASS');
      const key = await service.deleteConfirmedSecret();

      expect(key).toBe('DB_PASS');
      expect(service.allSecrets).toEqual(snapshot);
      expect(service.secretToDelete).toBeNull();
    });
  });

  describe('exportVault', () => {
    it('should return JSON string from backend', async () => {
      const data = { dev: { API_KEY: 'abc' } };
      backend.exportSecrets.mockResolvedValue(data);

      const result = await service.exportVault();

      expect(JSON.parse(result)).toEqual(data);
    });
  });

  describe('resetVaultAndClear', () => {
    it('should reset vault, clear allSecrets, and refresh vault info', async () => {
      service.allSecrets = { dev: ['KEY'] };
      backend.resetVault.mockResolvedValue({} as any);
      backend.getVaultInfo.mockResolvedValue({ hasMasterPassword: false });

      await service.resetVaultAndClear();

      expect(service.allSecrets).toEqual({});
      expect(backend.resetVault).toHaveBeenCalled();
      expect(backend.getVaultInfo).toHaveBeenCalled();
    });
  });

  describe('setMasterPasswordAndRefresh', () => {
    it('should set master password and refresh vault info', async () => {
      backend.setMasterPassword.mockResolvedValue(undefined);
      backend.getVaultInfo.mockResolvedValue({ hasMasterPassword: true });

      await service.setMasterPasswordAndRefresh('mypassword');

      expect(backend.setMasterPassword).toHaveBeenCalledWith('mypassword');
      expect(backend.getVaultInfo).toHaveBeenCalled();
      expect(service.vaultInfo).toEqual({ hasMasterPassword: true });
    });
  });

  describe('verifyMasterPassword', () => {
    it('should return true for correct password', async () => {
      backend.verifyMasterPassword.mockResolvedValue(true);
      expect(await service.verifyMasterPassword('correct')).toBe(true);
    });

    it('should return false for incorrect password', async () => {
      backend.verifyMasterPassword.mockResolvedValue(false);
      expect(await service.verifyMasterPassword('wrong')).toBe(false);
    });
  });
});

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
