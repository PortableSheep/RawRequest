import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SyntaxHighlightPipe } from "../../pipes/syntax-highlight.pipe";

interface ResponseData {
  status: number;
  statusText: string;
  headers: { [key: string]: string };
  body: string;
  responseTime: number;
}

interface HistoryItem {
  timestamp: Date;
  method: string;
  url: string;
  status: number;
  statusText: string;
  responseTime: number;
  responseData: ResponseData;
}

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

  activeTab: 'body' | 'headers' = 'body';

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
}
