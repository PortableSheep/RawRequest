import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { LoadTestMetrics } from '../../models/http.models';

@Component({
  selector: 'app-load-test-results-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './load-test-results-modal.component.html',
  styleUrls: ['./load-test-results-modal.component.scss']
})
export class LoadTestResultsModalComponent {
  isOpen = input<boolean>(false);
  metrics = input<LoadTestMetrics | null>(null);

  onClose = output<void>();

  failureStatusEntries(): Array<{ code: string; count: number }> {
    const m = this.metrics();
    const src = m?.failureStatusCounts || {};
    return Object.entries(src)
      .map(([code, count]) => ({ code, count }))
      .filter(e => e.count > 0)
      .sort((a, b) => b.count - a.count);
  }
}
