import { Component, input, output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { LoadTestMetrics, ActiveRunProgress } from '../../models/http.models';
import { LoadTestVisualizationService } from '../../services/load-test-visualization.service';
import { RequestExecutionService } from '../../services/request-execution.service';

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

  readonly loadTestViz = inject(LoadTestVisualizationService);
  readonly reqExec = inject(RequestExecutionService);

  get isLive(): boolean {
    return !this.metrics() && !!this.loadTestViz.activeRunProgress;
  }

  get liveProgress(): ActiveRunProgress | null {
    return this.loadTestViz.activeRunProgress;
  }

  get elapsedSeconds(): number {
    const started = this.liveProgress?.startedAt;
    if (!started) return 0;
    return Math.max(0, (this.loadTestViz.activeRunNowMs - started) / 1000);
  }

  get history() {
    return this.loadTestViz.progressHistory;
  }

  get maxConcurrency(): number {
    const list = this.history.map(h => h.concurrency);
    return list.length > 0 ? Math.max(...list, 1) : 1;
  }

  get maxRps(): number {
    const list = this.history.map(h => h.rps);
    return list.length > 0 ? Math.max(...list, 1) : 1;
  }

  get maxLatency(): number {
    const list = this.history.flatMap(h => [h.p50, h.p95, h.p99]);
    return list.length > 0 ? Math.max(...list, 10) : 10;
  }

  get concurrencyPath(): string {
    return this.getSvgPath(this.history.map(h => h.concurrency), 600, 200, this.maxConcurrency);
  }

  get rpsPath(): string {
    return this.getSvgPath(this.history.map(h => h.rps), 600, 200, this.maxRps);
  }

  get p50Path(): string {
    return this.getSvgPath(this.history.map(h => h.p50), 600, 200, this.maxLatency);
  }

  get p95Path(): string {
    return this.getSvgPath(this.history.map(h => h.p95), 600, 200, this.maxLatency);
  }

  get p99Path(): string {
    return this.getSvgPath(this.history.map(h => h.p99), 600, 200, this.maxLatency);
  }

  get concurrencyLastY(): number {
    const val = this.isLive ? (this.liveProgress?.activeUsers ?? 0) : (this.history.length > 0 ? this.history[this.history.length - 1].concurrency : 0);
    return 200 - (val / this.maxConcurrency) * 200;
  }

  get rpsLastY(): number {
    const val = this.isLive ? this.loadTestViz.currentLoadRpsView : (this.history.length > 0 ? this.history[this.history.length - 1].rps : 0);
    return 200 - (val / this.maxRps) * 200;
  }

  get p50LastY(): number {
    const val = this.isLive ? (this.liveProgress?.p50 ?? 0) : (this.history.length > 0 ? this.history[this.history.length - 1].p50 : 0);
    return 200 - (val / this.maxLatency) * 200;
  }

  get p95LastY(): number {
    const val = this.isLive ? (this.liveProgress?.p95 ?? 0) : (this.history.length > 0 ? this.history[this.history.length - 1].p95 : 0);
    return 200 - (val / this.maxLatency) * 200;
  }

  get p99LastY(): number {
    const val = this.isLive ? (this.liveProgress?.p99 ?? 0) : (this.history.length > 0 ? this.history[this.history.length - 1].p99 : 0);
    return 200 - (val / this.maxLatency) * 200;
  }

  getAreaPath(linePath: string, width: number, height: number): string {
    if (!linePath) return '';
    return `${linePath} L ${width} ${height} L 0 ${height} Z`;
  }

  getSvgPath(
    data: number[],
    width: number,
    height: number,
    maxVal?: number
  ): string {
    if (data.length < 2) return '';
    const max = maxVal ?? Math.max(...data, 1);
    const points = data.map((val, idx) => {
      const x = (idx / (data.length - 1)) * width;
      const y = height - (val / max) * height;
      return { x, y };
    });

    let path = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const cpX1 = points[i].x + (points[i+1].x - points[i].x) / 3;
      const cpY1 = points[i].y;
      const cpX2 = points[i].x + 2 * (points[i+1].x - points[i].x) / 3;
      const cpY2 = points[i+1].y;
      path += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${points[i+1].x} ${points[i+1].y}`;
    }
    return path;
  }

  failureStatusEntries(): Array<{ code: string; count: number }> {
    const m = this.metrics();
    const src = m?.failureStatusCounts || {};
    return Object.entries(src)
      .map(([code, count]) => ({ code, count }))
      .filter(e => e.count > 0)
      .sort((a, b) => b.count - a.count);
  }
}
