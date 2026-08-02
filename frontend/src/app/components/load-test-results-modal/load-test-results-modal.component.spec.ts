import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LoadTestResultsModalComponent } from './load-test-results-modal.component';
import { LoadTestVisualizationService } from '../../services/load-test-visualization.service';
import { RequestExecutionService } from '../../services/request-execution.service';
import type { LoadTestMetrics } from '../../models/http.models';

function createMockLoadTestViz() {
  return {
    activeRunProgress: null,
    progressHistory: [],
    currentLoadRpsView: 0,
    activeRunNowMs: Date.now(),
  };
}

const sampleMetrics = {
  totalRequests: 10,
  successfulRequests: 9,
  failedRequests: 1,
  failureStatusCounts: {},
  requestsPerSecond: 5,
  averageResponseTime: 42,
  p50: 40,
  p95: 60,
  p99: 80,
  minResponseTime: 10,
  maxResponseTime: 100,
  errorRate: 0.1,
  duration: 2,
} as unknown as LoadTestMetrics;

describe('LoadTestResultsModalComponent', () => {
  let fixture: ComponentFixture<LoadTestResultsModalComponent>;
  let component: LoadTestResultsModalComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoadTestResultsModalComponent],
      providers: [
        { provide: LoadTestVisualizationService, useValue: createMockLoadTestViz() },
        { provide: RequestExecutionService, useValue: { cancelActiveRequest: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadTestResultsModalComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.componentRef.setInput('metrics', sampleMetrics);
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  describe('Escape key', () => {
    it('should emit onClose on Escape when open and not live', () => {
      fixture.componentRef.setInput('isOpen', true);
      fixture.componentRef.setInput('metrics', sampleMetrics);
      fixture.detectChanges();

      const spy = vi.fn();
      component.onClose.subscribe(spy);

      component.handleEscape();

      expect(spy).toHaveBeenCalled();
    });

    it('should not emit onClose on Escape while a run is live', () => {
      fixture.componentRef.setInput('isOpen', true);
      fixture.componentRef.setInput('metrics', null);
      (component.loadTestViz as any).activeRunProgress = { startedAt: Date.now() };
      fixture.detectChanges();

      const spy = vi.fn();
      component.onClose.subscribe(spy);

      component.handleEscape();

      expect(spy).not.toHaveBeenCalled();
    });

    it('should not emit onClose on Escape when closed', () => {
      fixture.componentRef.setInput('isOpen', false);
      fixture.componentRef.setInput('metrics', sampleMetrics);
      fixture.detectChanges();

      const spy = vi.fn();
      component.onClose.subscribe(spy);

      component.handleEscape();

      expect(spy).not.toHaveBeenCalled();
    });
  });
});
