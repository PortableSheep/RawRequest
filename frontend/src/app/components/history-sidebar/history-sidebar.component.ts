import { Component, input, output } from '@angular/core';
import type { HistoryItem } from '../../models/http.models';

@Component({
  selector: 'app-history-sidebar',
  standalone: true,
  imports: [],
  templateUrl: './history-sidebar.component.html',
  styleUrls: ['./history-sidebar.component.scss']
})
export class HistorySidebarComponent {
  isOpen = input<boolean>(false);
  history = input<HistoryItem[]>([]);
  selectedItem = input<HistoryItem | null>(null);

  onClose = output<void>();
  onItemClick = output<HistoryItem>();

  constructor() {}

  formatTime(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    // For very recent items, round to nearest 5 seconds to reduce change frequency
    if (seconds < 60) {
      const roundedSeconds = Math.floor(seconds / 5) * 5;
      return `${roundedSeconds}s ago`;
    }
    
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleDateString();
  }

}
