import { Component, input, output } from '@angular/core';


interface LoadTestMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  requestsPerSecond: number;
  averageResponseTime: number;
  p50: number;
  p95: number;
  p99: number;
  minResponseTime: number;
  maxResponseTime: number;
  errorRate: number;
  duration: number;
}

@Component({
  selector: 'app-load-test-results-modal',
  standalone: true,
  imports: [],
  templateUrl: './load-test-results-modal.component.html',
  styleUrls: ['./load-test-results-modal.component.scss']
})
export class LoadTestResultsModalComponent {
  isOpen = input<boolean>(false);
  metrics = input<LoadTestMetrics | null>(null);

  onClose = output<void>();
}
