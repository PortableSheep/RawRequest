import { Injectable, signal, computed } from '@angular/core';
import { CheckForUpdates, GetAppVersion, OpenReleaseURL, StartUpdateAndRestart } from '@wailsjs/go/main/App';

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  releaseNotes: string;
  releaseName: string;
  publishedAt: string;
}

const DISMISSED_VERSION_KEY = 'rawrequest_dismissed_update_version';
const LAST_CHECK_KEY = 'rawrequest_last_update_check';
const CHECK_INTERVAL_MS = 1 * 60 * 60 * 1000; // 1 hour

@Injectable({
  providedIn: 'root'
})
export class UpdateService {
  private _updateInfo = signal<UpdateInfo | null>(null);
  private _isChecking = signal<boolean>(false);
  private _error = signal<string | null>(null);
  private _showNotification = signal<boolean>(false);

  readonly updateInfo = computed(() => this._updateInfo());
  readonly isChecking = computed(() => this._isChecking());
  readonly error = computed(() => this._error());
  readonly showNotification = computed(() => this._showNotification());
  readonly hasUpdate = computed(() => this._updateInfo()?.available ?? false);

  async getVersion(): Promise<string> {
    try {
      return await GetAppVersion();
    } catch {
      return 'unknown';
    }
  }

  async checkForUpdates(): Promise<UpdateInfo | null> {
    const lastCheck = localStorage.getItem(LAST_CHECK_KEY);
    if (lastCheck) {
      const lastCheckTime = parseInt(lastCheck, 10);
      if (Date.now() - lastCheckTime < CHECK_INTERVAL_MS) {
        const cached = this._updateInfo();
        if (cached) return cached;
      }
    }
  
    this._isChecking.set(true);
    this._error.set(null);

    try {
      const info = await CheckForUpdates();
      this._updateInfo.set(info);
      localStorage.setItem(LAST_CHECK_KEY, Date.now().toString());

      if (info.available) {
        const dismissedVersion = localStorage.getItem(DISMISSED_VERSION_KEY);
        if (dismissedVersion !== info.latestVersion) {
          this._showNotification.set(true);
        }
      }

      return info;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to check for updates';
      this._error.set(message);
      console.error('Update check failed:', err);
      return null;
    } finally {
      this._isChecking.set(false);
    }
  }

  async openReleasePage(): Promise<void> {
    const info = this._updateInfo();
    if (info?.releaseUrl) {
      try {
        await OpenReleaseURL(info.releaseUrl);
      } catch (err) {
        console.error('Failed to open release page:', err);
      }
    }
  }

  async startUpdateAndRestart(): Promise<boolean> {
    const info = this._updateInfo();
    if (!info?.latestVersion) return false;

    try {
      await StartUpdateAndRestart(info.latestVersion);
      return true;
    } catch (err) {
      console.error('Failed to start updater:', err);
      return false;
    }
  }

  dismissUpdate(): void {
    const info = this._updateInfo();
    if (info?.latestVersion) {
      localStorage.setItem(DISMISSED_VERSION_KEY, info.latestVersion);
    }
    this._showNotification.set(false);
  }

  remindLater(): void {
    this._showNotification.set(false);
  }

  clearDismissed(): void {
    localStorage.removeItem(DISMISSED_VERSION_KEY);
  }
}
