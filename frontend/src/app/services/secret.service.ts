import { Inject, Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { BACKEND_CLIENT, BackendClientContract } from './backend-client.contract';
import { isFileScopedEnv, secretLookupChain } from './secret-scope.logic';

export type SecretIndex = Partial<Record<string, string[]>>;

export type VaultInfo = any;

@Injectable({ providedIn: 'root' })
export class SecretService {
  private readonly pattern = /\{\{\s*secret:([^}\r\n]+?)\s*\}\}/g;
  private cache = new Map<string, string>();
  private pending = new Map<string, Promise<string>>();
  private lastSnapshot: SecretIndex = {};
  private vaultInfoCache: VaultInfo | null = null;
  private missingSecretSubject = new Subject<{ env: string; key: string }>();
  private missingSecret$ = this.missingSecretSubject.asObservable();

  /** Vault management state exposed for UI binding.
   *  Signals so consumers (templates, computed(), effect()) reactively update
   *  when secrets or vault info change — add/remove/reset no longer requires
   *  a relaunch to see the UI refresh. */
  readonly allSecrets = signal<SecretIndex>({});
  readonly vaultInfo = signal<VaultInfo | null>(null);
  /** Absolute path of the active tab's .http file; used for file-scoped secrets. */
  readonly activeFilePath = signal<string | null>(null);
  secretToDelete: { env: string; key: string } | null = null;
  private masterPasswordCheckDone = false;
  private masterPasswordWarningCallback: (() => void) | null = null;

  constructor(@Inject(BACKEND_CLIENT) private readonly backend: BackendClientContract) {}

  /**
   * Register a callback invoked once when secrets exist but no master password is set.
   */
  onMasterPasswordWarning(cb: () => void): void {
    this.masterPasswordWarningCallback = cb;
  }

  async list(refresh = false): Promise<SecretIndex> {
    if (!refresh && Object.keys(this.lastSnapshot).length) {
      return this.lastSnapshot;
    }
    const result = await this.backend.listSecrets();
    this.lastSnapshot = result || {};
    return this.lastSnapshot;
  }

  async save(env: string, key: string, value: string): Promise<SecretIndex> {
    const normalizedEnv = this.normalizeEnv(env);
    const snapshot = await this.backend.saveSecret(normalizedEnv, key, value);
    this.lastSnapshot = snapshot || {};
    const cacheKey = this.buildCacheKey(normalizedEnv, key);
    this.cache.set(cacheKey, value);
    this.invalidateVaultInfo();
    return this.lastSnapshot;
  }

  async remove(env: string, key: string): Promise<SecretIndex> {
    const normalizedEnv = this.normalizeEnv(env);
    const snapshot = await this.backend.deleteSecret(normalizedEnv, key);
    this.lastSnapshot = snapshot || {};
    const cacheKey = this.buildCacheKey(normalizedEnv, key);
    this.cache.delete(cacheKey);
    this.pending.delete(cacheKey);
    this.invalidateVaultInfo();
    return this.lastSnapshot;
  }

  /**
   * Resolve a secret honoring file scope: file+env, file+default, env, default.
   * `filePath` defaults to the active tab's file (see activeFilePath).
   */
  async getSecretValue(env: string, key: string, filePath?: string | null): Promise<string> {
    const normalizedEnv = this.normalizeEnv(env);
    const scopeFile = filePath === undefined ? this.activeFilePath() : filePath;

    const chain = secretLookupChain(scopeFile, normalizedEnv);
    if (chain.some(isFileScopedEnv) && !Object.keys(this.lastSnapshot).length) {
      try {
        await this.list();
      } catch {
        // fall through; non-file scopes still resolve directly
      }
    }

    for (const bucket of chain) {
      // Skip file-scoped buckets the index says don't hold this key, so we
      // don't hit the backend (and log warnings) for every request.
      if (isFileScopedEnv(bucket) && !this.indexHas(bucket, key)) {
        continue;
      }
      const result = await this.getSecretValueExact(bucket, key);
      if (result.found) {
        return result.value;
      }
    }

    this.handleMissingSecret(normalizedEnv, key);
    return '';
  }

  private indexHas(bucket: string, key: string): boolean {
    const keys = this.lastSnapshot[bucket];
    return Array.isArray(keys) && keys.includes(key);
  }

  async getSecretValueExact(env: string, key: string): Promise<{ value: string; found: boolean }> {
    const cacheKey = this.buildCacheKey(env, key);
    if (this.cache.has(cacheKey)) {
      return { value: this.cache.get(cacheKey)!, found: true };
    }
    if (this.pending.has(cacheKey)) {
      const value = await this.pending.get(cacheKey)!;
      return { value, found: true };
    }

    const fetchPromise = this.backend.getSecretValue(env, key)
      .then((value: string) => {
        this.cache.set(cacheKey, value);
        return value;
      })
      .finally(() => {
        this.pending.delete(cacheKey);
      });

    this.pending.set(cacheKey, fetchPromise);
    try {
      const value = await fetchPromise;
      return { value, found: true };
    } catch (error) {
      console.warn('[SecretService] getSecretValue failed', error);
      return { value: '', found: false };
    }
  }

  async replaceSecrets(input: string, env: string, filePath?: string | null): Promise<string> {
    if (!input || !input.includes('{{secret:')) {
      return input;
    }
    const matches = Array.from(input.matchAll(this.pattern));
    if (!matches.length) {
      return input;
    }

    const replacements = new Map<string, string>();
    for (const match of matches) {
      const token = match[1].trim();
      if (replacements.has(token)) {
        continue;
      }
      const value = await this.getSecretValue(env, token, filePath);
      replacements.set(token, value);
    }

    return input.replace(this.pattern, (_, token: string) => {
      const trimmedToken = token.trim();
      return replacements.has(trimmedToken) ? replacements.get(trimmedToken)! : _;
    });
  }

  clearCache(): void {
    this.cache.clear();
    this.pending.clear();
  }

  async getVaultInfo(force = false): Promise<VaultInfo | null> {
    if (!force && this.vaultInfoCache) {
      return this.vaultInfoCache;
    }
    const info = await this.backend.getVaultInfo();
    this.vaultInfoCache = info ?? null;
    return this.vaultInfoCache;
  }

  async resetVault(): Promise<void> {
    await this.backend.resetVault();
    this.clearCache();
    this.lastSnapshot = {};
    this.vaultInfoCache = null;
  }

  async export(): Promise<string> {
    const secrets = await this.backend.exportSecrets();
    const normalized = secrets || {};
    return JSON.stringify(normalized, null, 2);
  }

  onMissingSecret() {
    return this.missingSecret$;
  }

  private normalizeEnv(env: string): string {
    const trimmed = (env || '').trim();
    return trimmed.length ? trimmed : 'default';
  }

  private buildCacheKey(env: string, key: string): string {
    return `${env}:${key}`;
  }

  private invalidateVaultInfo() {
    this.vaultInfoCache = null;
  }

  private handleMissingSecret(env: string, key: string) {
    this.missingSecretSubject.next({ env: this.normalizeEnv(env), key });
  }

  async setMasterPassword(password: string): Promise<void> {
    await this.backend.setMasterPassword(password);
    this.invalidateVaultInfo();
  }

  async verifyMasterPassword(password: string): Promise<boolean> {
    return this.backend.verifyMasterPassword(password);
  }

  // --- Vault management operations ---

  refreshSecrets(force = false): void {
    this.list(force)
      .then((secrets) => {
        this.allSecrets.set(secrets || {});
        this.checkMasterPasswordNeeded();
      })
      .catch((error) => console.error('Failed to load secrets', error));
    void this.loadVaultInfo(force);
  }

  async loadVaultInfo(force = false): Promise<VaultInfo | null> {
    try {
      const info = await this.getVaultInfo(force);
      this.vaultInfo.set(info);
      this.checkMasterPasswordNeeded();
      return info;
    } catch (error) {
      console.error('Failed to load vault info', error);
      return null;
    }
  }

  private checkMasterPasswordNeeded(): void {
    if (this.masterPasswordCheckDone) return;
    const hasSecrets = Object.values(this.allSecrets()).some(
      (keys) => keys && keys.length > 0,
    );
    if (!hasSecrets) return;
    const info = this.vaultInfo();
    if (!info || info.hasMasterPassword) return;
    this.masterPasswordCheckDone = true;
    this.masterPasswordWarningCallback?.();
  }

  async saveSecret(env: string, key: string, value: string): Promise<SecretIndex> {
    const snapshot = await this.save(env, key, value);
    this.allSecrets.set(snapshot);
    await this.loadVaultInfo(true);
    return snapshot;
  }

  async removeSecret(env: string, key: string): Promise<SecretIndex> {
    const snapshot = await this.remove(env, key);
    this.allSecrets.set(snapshot);
    await this.loadVaultInfo(true);
    return snapshot;
  }

  confirmDeleteSecret(env: string, key: string): void {
    this.secretToDelete = { env, key };
  }

  cancelDeleteSecret(): void {
    this.secretToDelete = null;
  }

  async deleteConfirmedSecret(): Promise<string | null> {
    if (!this.secretToDelete) {
      return null;
    }
    const key = this.secretToDelete.key;
    await this.removeSecret(this.secretToDelete.env, this.secretToDelete.key);
    this.secretToDelete = null;
    return key;
  }

  async exportVault(): Promise<string> {
    return this.export();
  }

  async resetVaultAndClear(): Promise<void> {
    await this.resetVault();
    this.allSecrets.set({});
    this.masterPasswordCheckDone = false;
    await this.loadVaultInfo(true);
  }

  async setMasterPasswordAndRefresh(password: string): Promise<void> {
    await this.setMasterPassword(password);
    await this.loadVaultInfo(true);
  }
}
