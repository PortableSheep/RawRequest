import { InjectionToken, inject } from '@angular/core';
import { ServiceBackendClientService } from './service-backend-client.service';

export interface BackendClientContract {
  sendRequest(method: string, url: string, headersJson: string, body: string): Promise<string>;
  sendRequestWithID(id: string, method: string, url: string, headersJson: string, body: string): Promise<string>;
  sendRequestWithTimeout(
    id: string,
    method: string,
    url: string,
    headersJson: string,
    body: string,
    timeoutMs: number
  ): Promise<string>;
  executeRequests(requests: Array<Record<string, any>>): Promise<string>;
  executeRequestsWithID(id: string, requests: Array<Record<string, any>>): Promise<string>;
  cancelRequest(requestId: string): Promise<void>;
  startLoadTest(
    requestId: string,
    method: string,
    url: string,
    headersJson: string,
    body: string,
    loadConfigJson: string
  ): Promise<void>;
  setVariable(key: string, value: string): Promise<void>;
  getVariable(key: string): Promise<string>;
  loadFileHistoryFromDir(fileId: string, dir: string): Promise<string>;
  loadFileHistoryFromRunLocation(fileId: string): Promise<string>;
  saveResponseFile(requestFilePath: string, responseJson: string): Promise<string>;
  saveResponseFileToRunLocation(fileId: string, responseJson: string): Promise<string>;
  getScriptLogs(): Promise<Array<{ timestamp: string; level: string; source: string; message: string }>>;
  clearScriptLogs(): Promise<void>;
  recordScriptLog(level: string, source: string, message: string): Promise<void>;

  // Secret management
  listSecrets(): Promise<Record<string, string[]>>;
  saveSecret(env: string, key: string, value: string): Promise<Record<string, string[]>>;
  deleteSecret(env: string, key: string): Promise<Record<string, string[]>>;
  getSecretValue(env: string, key: string): Promise<string>;
  getVaultInfo(): Promise<any>;
  hasMasterPassword(): Promise<boolean>;
  setMasterPassword(password: string): Promise<void>;
  verifyMasterPassword(password: string): Promise<boolean>;
  resetVault(): Promise<Record<string, string[]>>;
  exportSecrets(): Promise<Record<string, Record<string, string>>>;
}

export const BACKEND_CLIENT = new InjectionToken<BackendClientContract>('BACKEND_CLIENT', {
  providedIn: 'root',
  factory: () => inject(ServiceBackendClientService),
});
