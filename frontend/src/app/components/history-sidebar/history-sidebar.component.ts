import { Component, inject } from '@angular/core';
import type { HistoryItem } from '../../models/http.models';
import { WorkspaceStateService } from '../../services/workspace-state.service';
import { PanelVisibilityService } from '../../services/panel-visibility.service';

@Component({
  selector: 'app-history-sidebar',
  standalone: true,
  imports: [],
  templateUrl: './history-sidebar.component.html',
  styleUrls: ['./history-sidebar.component.scss']
})
export class HistorySidebarComponent {
  readonly ws = inject(WorkspaceStateService);
  readonly panels = inject(PanelVisibilityService);

  constructor() {}

  viewHistory(item: HistoryItem): void {
    this.ws.selectedHistoryItem.set(item);
    this.panels.showHistoryModal.set(true);
  }

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
