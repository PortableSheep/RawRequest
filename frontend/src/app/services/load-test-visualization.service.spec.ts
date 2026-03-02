import { TestBed } from '@angular/core/testing';
import { ChangeDetectorRef, NgZone } from '@angular/core';
import { LoadTestVisualizationService } from './load-test-visualization.service';

describe('LoadTestVisualizationService', () => {
  let service: LoadTestVisualizationService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(LoadTestVisualizationService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('initializeLoadRun', () => {
    it('should reset all state to initial values', () => {
      service.initializeLoadRun();
      expect(service.activeRunProgress).toBeNull();
      expect(service.loadUsersSparklinePathDView).toBeTruthy();
      expect(service.loadUsersSparklineTransformView).toBe('');
      expect(service.loadRpsSparklinePathDView).toBeTruthy();
      expect(service.loadRpsSparklineTransformView).toBe('');
    });
  });

  describe('currentLoadRpsView', () => {
    it('should return 0 when no data', () => {
      expect(service.currentLoadRpsView).toBe(0);
    });
  });

  describe('pushLoadUsersSample', () => {
    it('should accept a sample without error', () => {
      service.initializeLoadRun();
      expect(() => service.pushLoadUsersSample(5)).not.toThrow();
    });
  });

  describe('stopActiveRunTick', () => {
    it('should reset sparkline views to empty strings', () => {
      service.initializeLoadRun();
      service.stopActiveRunTick();
      expect(service.loadUsersSparklinePathDView).toBe('');
      expect(service.loadUsersSparklineTransformView).toBe('');
      expect(service.loadRpsSparklinePathDView).toBe('');
      expect(service.loadRpsSparklineTransformView).toBe('');
    });
  });

  describe('applyResetPatch', () => {
    it('should clear progress and series data', () => {
      service.initializeLoadRun();
      service.activeRunProgress = { requestId: 'x', type: 'load', startedAt: 0 };
      service.applyResetPatch();
      expect(service.activeRunProgress).toBeNull();
    });
  });

  describe('startActiveRunTick / stopActiveRunTick', () => {
    it('should start and stop without error', () => {
      const cdr = { detectChanges: jest.fn() } as unknown as ChangeDetectorRef;
      service.initializeLoadRun();
      expect(() =>
        service.startActiveRunTick(
          () => true,
          () => 'load',
          cdr,
        ),
      ).not.toThrow();
      service.stopActiveRunTick();
    });
  });
});
