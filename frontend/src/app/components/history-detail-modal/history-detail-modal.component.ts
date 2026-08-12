import { Component, input, output, effect, HostListener, computed, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { VirtualResponseBodyComponent } from '../virtual-response-body/virtual-response-body.component';
import { FocusTrapDirective } from '../../directives/focus-trap.directive';
import { IconComponent } from '../icon/icon.component';
import type { HistoryItem, LoadTestMetrics } from '../../models/http.models';
import { formatResponseBody } from '../../utils/response-body-format';

@Component({
  selector: 'app-history-detail-modal',
  standalone: true,
  imports: [CommonModule, VirtualResponseBodyComponent, FocusTrapDirective, IconComponent],
  templateUrl: './history-detail-modal.component.html',
  styleUrls: ['./history-detail-modal.component.scss']
})
export class HistoryDetailModalComponent implements OnDestroy {
  isOpen = input<boolean>(false);
  item = input<HistoryItem | null>(null);

  onClose = output<void>();

  activeTab: 'body' | 'headers' | 'summary' | 'raw' = 'body';
  readonly copyState = signal<'idle' | 'copied' | 'error'>('idle');
  readonly formattedResponse = computed(() => formatResponseBody(this.item()?.responseData?.body ?? ''));
  readonly rawJson = computed(() => {
    const metrics = this.item()?.responseData?.loadTestMetrics;
    return metrics ? JSON.stringify(metrics, null, 2) : this.formattedResponse();
  });

  private lastItemKey: string | null = null;
  private copyTimer: ReturnType<typeof setTimeout> | null = null;

  @HostListener('document:keydown.escape')
  handleEscape(): void {
    if (!this.isOpen()) return;
    this.onClose.emit();
  }

  constructor() {
    effect(() => {
      const it = this.item();
      const open = this.isOpen();
      const key = it ? `${it.timestamp?.toString?.() ?? ''}|${it.method}|${it.url}` : null;
      if (!open || !it) {
        this.lastItemKey = key;
        return;
      }

      // When switching to a load test history item, default to Summary.
      if (key !== this.lastItemKey) {
        this.setCopyState('idle');
        if (it.responseData?.loadTestMetrics) {
          this.activeTab = 'summary';
        } else {
          this.activeTab = 'body';
        }
      }

      this.lastItemKey = key;
    });
  }

  ngOnDestroy(): void {
    if (this.copyTimer) {
      clearTimeout(this.copyTimer);
    }
  }

  isLoadTest(): boolean {
    const it = this.item();
    return !!it?.responseData?.loadTestMetrics;
  }

  getLoadTestMetrics(): LoadTestMetrics | null {
    const it = this.item();
    return (it?.responseData?.loadTestMetrics as LoadTestMetrics) || null;
  }

  formatTime(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (seconds < 60) return `${seconds}s ago`;
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleString();
  }

  getFormattedResponse(): string {
    return this.formattedResponse();
  }

  getRawJson(): string {
    return this.rawJson();
  }

  async copyVisibleResponse(): Promise<void> {
    const text = this.activeTab === 'raw' ? this.rawJson() : this.formattedResponse();
    if (!text) return;

    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      this.setCopyState('error');
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      this.setCopyState('copied');
    } catch {
      this.setCopyState('error');
    }
  }

  private setCopyState(state: 'idle' | 'copied' | 'error'): void {
    this.copyState.set(state);
    if (this.copyTimer) {
      clearTimeout(this.copyTimer);
      this.copyTimer = null;
    }
    if (state !== 'idle') {
      this.copyTimer = setTimeout(() => {
        this.copyState.set('idle');
        this.copyTimer = null;
      }, 1500);
    }
  }

}
