import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import type { main } from '@wailsjs/go/models';
import {
  DeleteSecret,
  ExportSecrets,
  GetSecretValue,
  GetVaultInfo,
  ListSecrets,
  ResetVault,
  SaveSecret
} from '@wailsjs/go/main/App';

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

    const primary = await this.getSecretValueExact(normalizedEnv, key);
    if (primary.found) {
      return primary.value;
    }

    if (normalizedEnv !== 'default') {
      const fallback = await this.getSecretValueExact('default', key);
      if (fallback.found) {
        return fallback.value;
      }
    }

    this.handleMissingSecret(normalizedEnv, key);
    return '';
  }

  private async getSecretValueExact(env: string, key: string): Promise<{ value: string; found: boolean }> {
    const cacheKey = this.buildCacheKey(env, key);
    if (this.cache.has(cacheKey)) {
      return { value: this.cache.get(cacheKey)!, found: true };
    }
    if (this.pending.has(cacheKey)) {
      const value = await this.pending.get(cacheKey)!;
      return { value, found: true };
    }

    const fetchPromise = GetSecretValue(env, key)
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
