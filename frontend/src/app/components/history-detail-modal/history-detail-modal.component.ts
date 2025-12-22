import { Component, input, output, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SyntaxHighlightPipe } from "../../pipes/syntax-highlight.pipe";
import type { HistoryItem, LoadTestMetrics } from '../../models/http.models';

@Component({
  selector: 'app-history-detail-modal',
  standalone: true,
  imports: [CommonModule, SyntaxHighlightPipe],
  templateUrl: './history-detail-modal.component.html',
  styleUrls: ['./history-detail-modal.component.scss']
})
export class HistoryDetailModalComponent {
  isOpen = input<boolean>(false);
  item = input<HistoryItem | null>(null);

  onClose = output<void>();

  activeTab: 'body' | 'headers' | 'summary' | 'raw' = 'body';

  private lastItemKey: string | null = null;

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
        if (it.responseData?.loadTestMetrics) {
          this.activeTab = 'summary';
        } else {
          this.activeTab = 'body';
        }
      }

      this.lastItemKey = key;
    });
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
    const currentItem = this.item();
    if (!currentItem || !currentItem.responseData) return '';

    const body = currentItem.responseData.body;
    try {
      const json = JSON.parse(body);
      return JSON.stringify(json, null, 2);
    } catch {
      return body;
    }
  }

  getRawJson(): string {
    const it = this.item();
    if (!it) return '';
    const metrics = this.getLoadTestMetrics();
    if (metrics) {
      return JSON.stringify(metrics, null, 2);
    }
    // Fallback: show response body (pretty-printed if JSON)
    return this.getFormattedResponse();
  }
}
