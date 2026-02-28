import { Injectable } from '@angular/core';
import type { BackendClientContract } from './backend-client.contract';
import { resolveServiceBackendBaseUrl } from './backend-client-config';

type JsonMap = Record<string, unknown>;

@Injectable({
  providedIn: 'root'
})
export class ServiceBackendClientService implements BackendClientContract {
  private readonly baseUrl = resolveServiceBackendBaseUrl(
    globalThis as any,
    this.resolveStorage()
  );

  private resolveStorage(): Pick<Storage, 'getItem'> | null {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      return null;
    }
  }

  private buildUrl(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private async postText(path: string, payload: JsonMap): Promise<string> {
    const response = await fetch(this.buildUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`[ServiceBackend] ${path} failed: ${response.status} ${response.statusText}${body ? ` - ${body}` : ''}`);
    }
    return await response.text();
  }

  private async postVoid(path: string, payload: JsonMap): Promise<void> {
    const response = await fetch(this.buildUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`[ServiceBackend] ${path} failed: ${response.status} ${response.statusText}${body ? ` - ${body}` : ''}`);
    }
  }

  private async postJSON<T>(path: string, payload: JsonMap): Promise<T> {
    const raw = await this.postText(path, payload);
    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      throw new Error(`[ServiceBackend] ${path} returned invalid JSON: ${String(error)}`);
    }
  }

  sendRequest(method: string, url: string, headersJson: string, body: string): Promise<string> {
    return this.postText('/v1/send-request', { method, url, headersJson, body });
  }

  sendRequestWithID(id: string, method: string, url: string, headersJson: string, body: string): Promise<string> {
    return this.postText('/v1/send-request-with-id', { id, method, url, headersJson, body });
  }

  sendRequestWithTimeout(
    id: string,
    method: string,
    url: string,
    headersJson: string,
    body: string,
    timeoutMs: number
  ): Promise<string> {
    return this.postText('/v1/send-request-with-timeout', { id, method, url, headersJson, body, timeoutMs });
  }

  executeRequests(requests: Array<Record<string, any>>): Promise<string> {
    return this.postText('/v1/execute-requests', { requests });
  }

  executeRequestsWithID(id: string, requests: Array<Record<string, any>>): Promise<string> {
    return this.postText('/v1/execute-requests-with-id', { id, requests });
  }

  cancelRequest(requestId: string): Promise<void> {
    return this.postVoid('/v1/cancel-request', { requestId });
  }

  startLoadTest(
    requestId: string,
    method: string,
    url: string,
    headersJson: string,
    body: string,
    loadConfigJson: string
  ): Promise<void> {
    return this.postVoid('/v1/start-load-test', {
      requestId,
      method,
      url,
      headersJson,
      body,
      loadConfigJson,
    });
  }

  setVariable(key: string, value: string): Promise<void> {
    return this.postVoid('/v1/set-variable', { key, value });
  }

  getVariable(key: string): Promise<string> {
    return this.postText('/v1/get-variable', { key });
  }

  loadFileHistoryFromDir(fileId: string, dir: string): Promise<string> {
    return this.postText('/v1/load-file-history-from-dir', { fileId, dir });
  }

  loadFileHistoryFromRunLocation(fileId: string): Promise<string> {
    return this.postText('/v1/load-file-history-from-run-location', { fileId });
  }

  saveResponseFile(requestFilePath: string, responseJson: string): Promise<string> {
    return this.postText('/v1/save-response-file', { requestFilePath, responseJson });
  }

  saveResponseFileToRunLocation(fileId: string, responseJson: string): Promise<string> {
    return this.postText('/v1/save-response-file-to-run-location', { fileId, responseJson });
  }

  getScriptLogs(): Promise<Array<{ timestamp: string; level: string; source: string; message: string }>> {
    return this.postJSON('/v1/get-script-logs', {});
  }

  clearScriptLogs(): Promise<void> {
    return this.postVoid('/v1/clear-script-logs', {});
  }

  recordScriptLog(level: string, source: string, message: string): Promise<void> {
    return this.postVoid('/v1/record-script-log', { level, source, message });
  }

  listSecrets(): Promise<Record<string, string[]>> {
    return this.postJSON('/v1/list-secrets', {});
  }

  saveSecret(env: string, key: string, value: string): Promise<Record<string, string[]>> {
    return this.postJSON('/v1/save-secret', { env, key, value });
  }

  deleteSecret(env: string, key: string): Promise<Record<string, string[]>> {
    return this.postJSON('/v1/delete-secret', { env, key });
  }

  getSecretValue(env: string, key: string): Promise<string> {
    return this.postText('/v1/get-secret-value', { env, key });
  }

  getVaultInfo(): Promise<any> {
    return this.postJSON('/v1/get-vault-info', {});
  }

  async hasMasterPassword(): Promise<boolean> {
    const res = await this.postJSON<{ result: boolean }>('/v1/has-master-password', {});
    return res.result;
  }

  setMasterPassword(password: string): Promise<void> {
    return this.postVoid('/v1/set-master-password', { password });
  }

  async verifyMasterPassword(password: string): Promise<boolean> {
    const res = await this.postJSON<{ result: boolean }>('/v1/verify-master-password', { password });
    return res.result;
  }

  resetVault(): Promise<Record<string, string[]>> {
    return this.postJSON('/v1/reset-vault', {});
  }

  exportSecrets(): Promise<Record<string, Record<string, string>>> {
    return this.postJSON('/v1/export-secrets', {});
  }
}
