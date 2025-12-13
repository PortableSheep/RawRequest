import { Injectable } from '@angular/core';
import { SendNotification } from '../../../wailsjs/go/main/App';

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private isAppFocused = true;
  private readonly MIN_DURATION_MS = 2000; // Only notify for requests taking > 2 seconds

  constructor() {
    this.setupFocusListeners();
  }

  private setupFocusListeners(): void {
    // Track window focus state
    window.addEventListener('focus', () => {
      this.isAppFocused = true;
    });

    window.addEventListener('blur', () => {
      this.isAppFocused = false;
    });

    // Also check visibility state for tab switching
    document.addEventListener('visibilitychange', () => {
      this.isAppFocused = document.visibilityState === 'visible';
    });

    // Initialize with current state
    this.isAppFocused = document.hasFocus();
  }

  /**
   * Send a notification if the app is not focused and the duration exceeds threshold
   */
  async notifyIfBackground(title: string, message: string, durationMs?: number): Promise<void> {
    // Don't notify if app is focused
    if (this.isAppFocused) {
      return;
    }

    // Don't notify for quick requests (if duration provided)
    if (durationMs !== undefined && durationMs < this.MIN_DURATION_MS) {
      return;
    }

    try {
      await SendNotification(title, message);
    } catch (error) {
      // Silently fail - notifications are non-critical
      console.warn('Failed to send notification:', error);
    }
  }

  /**
   * Send a notification for request completion
   */
  async notifyRequestComplete(
    requestName: string | undefined,
    status: number,
    durationMs: number
  ): Promise<void> {
    const name = requestName || 'Request';
    const statusEmoji = status >= 200 && status < 300 ? '✓' : '✗';
    const title = `${statusEmoji} ${name} Complete`;
    const message = `Status: ${status} • ${this.formatDuration(durationMs)}`;

    await this.notifyIfBackground(title, message, durationMs);
  }

  /**
   * Send a notification for load test completion
   */
  async notifyLoadTestComplete(
    requestName: string | undefined,
    totalRequests: number,
    durationMs: number,
    avgResponseTime: number
  ): Promise<void> {
    const name = requestName || 'Load Test';
    const title = `⚡ ${name} Complete`;
    const message = `${totalRequests} requests • Avg: ${Math.round(avgResponseTime)}ms • ${this.formatDuration(durationMs)}`;

    await this.notifyIfBackground(title, message, durationMs);
  }

  /**
   * Send a notification for chained request completion
   */
  async notifyChainComplete(
    chainLength: number,
    durationMs: number,
    allSuccessful: boolean
  ): Promise<void> {
    const statusEmoji = allSuccessful ? '✓' : '⚠';
    const title = `${statusEmoji} Chain Complete`;
    const message = `${chainLength} requests • ${this.formatDuration(durationMs)}`;

    await this.notifyIfBackground(title, message, durationMs);
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${Math.round(ms)}ms`;
    } else if (ms < 60000) {
      return `${(ms / 1000).toFixed(1)}s`;
    } else {
      const mins = Math.floor(ms / 60000);
      const secs = Math.round((ms % 60000) / 1000);
      return `${mins}m ${secs}s`;
    }
  }
}
