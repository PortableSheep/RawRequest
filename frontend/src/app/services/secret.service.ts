import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import type { main } from '../../../wailsjs/go/models';
import {
  DeleteSecret,
  ExportSecrets,
  GetSecretValue,
  GetVaultInfo,
  ListSecrets,
  ResetVault,
  SaveSecret
} from '../../../wailsjs/go/main/App';

export type SecretIndex = Partial<Record<string, string[]>>;

export type VaultInfo = main.VaultInfo;

@Injectable({ providedIn: 'root' })
export class SecretService {
  private readonly pattern = /\{\{\s*secret:([a-zA-Z0-9_\-\.]+)\s*\}\}/g;
  private cache = new Map<string, string>();
  private pending = new Map<string, Promise<string>>();
  private lastSnapshot: SecretIndex = {};
  private vaultInfoCache: VaultInfo | null = null;
  private missingSecretSubject = new Subject<{ env: string; key: string }>();
  private missingSecret$ = this.missingSecretSubject.asObservable();

  async list(refresh = false): Promise<SecretIndex> {
    if (!refresh && Object.keys(this.lastSnapshot).length) {
      return this.lastSnapshot;
    }
    const result = await ListSecrets();
    this.lastSnapshot = result || {};
    return this.lastSnapshot;
  }

  async save(env: string, key: string, value: string): Promise<SecretIndex> {
    const normalizedEnv = this.normalizeEnv(env);
    const snapshot = await SaveSecret(normalizedEnv, key, value);
    this.lastSnapshot = snapshot || {};
    const cacheKey = this.buildCacheKey(normalizedEnv, key);
    this.cache.set(cacheKey, value);
    this.invalidateVaultInfo();
    return this.lastSnapshot;
  }

  async remove(env: string, key: string): Promise<SecretIndex> {
    const normalizedEnv = this.normalizeEnv(env);
    const snapshot = await DeleteSecret(normalizedEnv, key);
    this.lastSnapshot = snapshot || {};
    const cacheKey = this.buildCacheKey(normalizedEnv, key);
    this.cache.delete(cacheKey);
    this.pending.delete(cacheKey);
    this.invalidateVaultInfo();
    return this.lastSnapshot;
  }

  async getSecretValue(env: string, key: string): Promise<string> {
    const normalizedEnv = this.normalizeEnv(env);
    const cacheKey = this.buildCacheKey(normalizedEnv, key);
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }
    if (this.pending.has(cacheKey)) {
      return this.pending.get(cacheKey)!;
    }
    const fetchPromise = GetSecretValue(normalizedEnv, key)
      .then((value: string) => {
        this.cache.set(cacheKey, value);
        return value;
      })
      .catch(error => {
        console.warn('[SecretService] getSecretValue failed', error);
        this.handleMissingSecret(normalizedEnv, key);
        return '';
      })
      .finally(() => {
        this.pending.delete(cacheKey);
      });
    this.pending.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  async replaceSecrets(input: string, env: string): Promise<string> {
    if (!input || !input.includes('{{secret:')) {
      return input;
    }
    const matches = Array.from(input.matchAll(this.pattern));
    if (!matches.length) {
      return input;
    }

    const replacements = new Map<string, string>();
    for (const match of matches) {
      const token = match[1];
      if (replacements.has(token)) {
        continue;
      }
      const value = await this.getSecretValue(env, token);
      replacements.set(token, value);
    }

    return input.replace(this.pattern, (_, token: string) => {
      return replacements.has(token) ? replacements.get(token)! : _;
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
    const info = await GetVaultInfo();
    this.vaultInfoCache = info ?? null;
    return this.vaultInfoCache;
  }

  async resetVault(): Promise<void> {
    await ResetVault();
    this.clearCache();
    this.lastSnapshot = {};
    this.vaultInfoCache = null;
  }

  async export(): Promise<string> {
    const secrets = await ExportSecrets();
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
}
