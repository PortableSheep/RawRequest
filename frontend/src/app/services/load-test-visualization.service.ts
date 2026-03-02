import { Injectable, NgZone, ChangeDetectorRef, inject } from '@angular/core';
import type { ActiveRunProgress } from '../models/http.models';
import { sampleAndApplyRpsUiState } from '../logic/active-run/active-run-rps-ui.logic';
import {
  pushUsersSampleToQueue,
  smoothTowards,
  tickRpsSparklineUi,
  tickUsersSparklineUi,
} from '../logic/active-run/active-run-sparkline.logic';
import { buildStopActiveRunTickPatch } from '../logic/active-run/active-run-stop.logic';
import type { ActiveRequestType } from '../logic/active-run/active-run-tick.logic';
import { decideActiveRunTickActions } from '../logic/active-run/active-run-tick.logic';
import { buildInitialLoadRunUiState } from '../logic/request/active-request.logic';

@Injectable({ providedIn: 'root' })
export class LoadTestVisualizationService {
  private readonly ngZone = inject(NgZone);
  private readonly additionalCdrs: ChangeDetectorRef[] = [];

  activeRunProgress: ActiveRunProgress | null = null;
  private activeRunTickHandle: any = null;
  activeRunNowMs = Date.now();

  private loadUsersSeries: number[] = [];
  private readonly loadUsersSeriesMaxPoints = 160;
  loadUsersSparklinePathDView = '';
  loadUsersSparklineTransformView = '';
  private loadUsersQueue: number[] = [];
  private loadUsersScrollPhase = 0;
  private loadUsersNextValue: number | null = null;
  private readonly loadUsersScrollMs = 80;
  private readonly loadUsersRampSteps = 36;

  private sparklineRafHandle: number | null = null;
  private sparklineLastFrameAtMs: number | null = null;
  private sparklineLastRenderedAtMs: number | null = null;

  private loadRpsSeries: number[] = [];
  private readonly loadRpsSeriesMaxPoints = 160;
  loadRpsSparklinePathDView = '';
  loadRpsSparklineTransformView = '';
  private loadRpsQueue: number[] = [];
  private loadRpsScrollPhase = 0;
  private loadRpsNextValue: number | null = null;
  private readonly loadRpsScrollMs = 80;
  private readonly loadRpsRampSteps = 8;
  private lastRpsSampleAtMs: number | null = null;
  private lastRpsTotalSent: number | null = null;
  private lastRpsSmoothed: number | null = null;
  private rpsRenderValue: number | null = null;
  private rpsRenderTarget: number | null = null;

  loadTestMetrics: any = null;

  /** Register an additional ChangeDetectorRef to be checked during the sparkline animation loop. */
  registerCdr(cdr: ChangeDetectorRef): void {
    if (!this.additionalCdrs.includes(cdr)) {
      this.additionalCdrs.push(cdr);
    }
  }

  /** Unregister a previously registered ChangeDetectorRef. */
  unregisterCdr(cdr: ChangeDetectorRef): void {
    const idx = this.additionalCdrs.indexOf(cdr);
    if (idx >= 0) {
      this.additionalCdrs.splice(idx, 1);
    }
  }

  /** Trigger change detection on all registered additional CDRs. */
  notifyRegisteredViews(): void {
    for (const c of this.additionalCdrs) {
      c.detectChanges();
    }
  }

  get currentLoadRpsView(): number {
    if (typeof this.rpsRenderValue === 'number' && Number.isFinite(this.rpsRenderValue)) {
      return Math.max(0, this.rpsRenderValue);
    }
    const series = this.loadRpsSeries;
    if (!series.length) return 0;
    return Math.max(0, series[series.length - 1] ?? 0);
  }

  initializeLoadRun(): void {
    const loadRun = buildInitialLoadRunUiState(
      this.loadUsersSeriesMaxPoints,
      this.loadRpsSeriesMaxPoints,
    );
    this.activeRunProgress = loadRun.activeRunProgress;

    this.loadUsersSeries = loadRun.loadUsersSeries;
    this.loadUsersQueue = loadRun.loadUsersQueue;
    this.loadUsersScrollPhase = loadRun.loadUsersScrollPhase;
    this.loadUsersNextValue = loadRun.loadUsersNextValue;
    this.loadUsersSparklineTransformView = loadRun.loadUsersSparklineTransformView;
    this.loadUsersSparklinePathDView = loadRun.loadUsersSparklinePathDView;

    this.loadRpsSeries = loadRun.loadRpsSeries;
    this.loadRpsQueue = loadRun.loadRpsQueue;
    this.loadRpsScrollPhase = loadRun.loadRpsScrollPhase;
    this.loadRpsNextValue = loadRun.loadRpsNextValue;
    this.loadRpsSparklineTransformView = loadRun.loadRpsSparklineTransformView;
    this.loadRpsSparklinePathDView = loadRun.loadRpsSparklinePathDView;

    this.lastRpsSampleAtMs = loadRun.lastRpsSampleAtMs;
    this.lastRpsTotalSent = loadRun.lastRpsTotalSent;
    this.lastRpsSmoothed = loadRun.lastRpsSmoothed;
    this.rpsRenderValue = loadRun.rpsRenderValue;
    this.rpsRenderTarget = loadRun.rpsRenderTarget;
  }

  startActiveRunTick(
    isRequestRunning: () => boolean,
    activeRequestType: () => ActiveRequestType,
    cdr: ChangeDetectorRef,
  ): void {
    this.stopActiveRunTick();
    this.activeRunNowMs = Date.now();
    this.ngZone.runOutsideAngular(() => {
      this.activeRunTickHandle = setInterval(() => {
        this.activeRunNowMs = Date.now();
        const actions = decideActiveRunTickActions({
          isRequestRunning: isRequestRunning(),
          activeRequestType: activeRequestType(),
          activeUsers: this.activeRunProgress?.activeUsers,
        });

        if (actions.usersSample !== null) {
          this.pushLoadUsersSample(actions.usersSample);
        }
        if (actions.shouldSampleRps) {
          this.sampleLoadRps();
        }
        if (actions.shouldEnsureSparkline) {
          this.ensureSparklineAnimation(isRequestRunning, activeRequestType, cdr);
        }
      }, 200);
    });

    const initialActions = decideActiveRunTickActions({
      isRequestRunning: isRequestRunning(),
      activeRequestType: activeRequestType(),
      activeUsers: this.activeRunProgress?.activeUsers,
    });
    if (initialActions.shouldEnsureSparkline) {
      this.ensureSparklineAnimation(isRequestRunning, activeRequestType, cdr);
    }
  }

  private ensureSparklineAnimation(
    isRequestRunning: () => boolean,
    activeRequestType: () => ActiveRequestType,
    cdr: ChangeDetectorRef,
  ): void {
    if (this.sparklineRafHandle !== null) return;
    this.sparklineLastFrameAtMs = null;
    this.sparklineLastRenderedAtMs = null;

    this.ngZone.runOutsideAngular(() => {
      const step = (t: number) => {
        this.sparklineRafHandle = requestAnimationFrame(step);

        if (!isRequestRunning() || activeRequestType() !== 'load') {
          return;
        }

        const last = this.sparklineLastFrameAtMs;
        this.sparklineLastFrameAtMs = t;
        const dt = last === null ? 0 : Math.max(0, Math.min(50, t - last));

        this.sparklineLastRenderedAtMs = t;

        this.rpsRenderValue = smoothTowards(
          this.rpsRenderValue,
          this.rpsRenderTarget,
          dt,
        );

        const usersTick = tickUsersSparklineUi({
          state: {
            series: this.loadUsersSeries,
            queue: this.loadUsersQueue,
            scrollPhase: this.loadUsersScrollPhase,
            nextValue: this.loadUsersNextValue,
          },
          dtMs: dt,
          maxPoints: this.loadUsersSeriesMaxPoints,
          scrollMs: this.loadUsersScrollMs,
          maxUsers: this.activeRunProgress?.maxUsers,
          currentPathDView: this.loadUsersSparklinePathDView,
        });

        this.loadUsersSeries = usersTick.state.series;
        this.loadUsersQueue = usersTick.state.queue;
        this.loadUsersScrollPhase = usersTick.state.scrollPhase;
        this.loadUsersNextValue = usersTick.state.nextValue;
        this.loadUsersSparklineTransformView = usersTick.transformView;
        this.loadUsersSparklinePathDView = usersTick.pathDView;

        const rpsTick = tickRpsSparklineUi({
          state: {
            series: this.loadRpsSeries,
            queue: this.loadRpsQueue,
            scrollPhase: this.loadRpsScrollPhase,
            nextValue: this.loadRpsNextValue,
          },
          dtMs: dt,
          maxPoints: this.loadRpsSeriesMaxPoints,
          scrollMs: this.loadRpsScrollMs,
          currentPathDView: this.loadRpsSparklinePathDView,
        });

        this.loadRpsSeries = rpsTick.state.series;
        this.loadRpsQueue = rpsTick.state.queue;
        this.loadRpsScrollPhase = rpsTick.state.scrollPhase;
        this.loadRpsNextValue = rpsTick.state.nextValue;
        this.loadRpsSparklineTransformView = rpsTick.transformView;
        this.loadRpsSparklinePathDView = rpsTick.pathDView;

        cdr.detectChanges();
        this.notifyRegisteredViews();
      };

      this.sparklineRafHandle = requestAnimationFrame(step);
    });
  }

  pushLoadUsersSample(value: number): void {
    const r = pushUsersSampleToQueue(
      this.loadUsersQueue,
      this.loadUsersSeries,
      this.loadUsersNextValue,
      this.loadUsersSeriesMaxPoints,
      this.loadUsersRampSteps,
      value,
    );
    this.loadUsersQueue = r.queue;
  }

  private sampleLoadRps(): void {
    const r = sampleAndApplyRpsUiState({
      samplingState: {
        lastSampleAtMs: this.lastRpsSampleAtMs,
        lastTotalSent: this.lastRpsTotalSent,
        lastSmoothed: this.lastRpsSmoothed,
      },
      nowMs: this.activeRunNowMs,
      totalSent: this.activeRunProgress?.totalSent,
      queue: this.loadRpsQueue,
      series: this.loadRpsSeries,
      nextValue: this.loadRpsNextValue,
      maxPoints: this.loadRpsSeriesMaxPoints,
      rampSteps: this.loadRpsRampSteps,
      rpsRenderTarget: this.rpsRenderTarget,
      rpsRenderValue: this.rpsRenderValue,
    });

    this.lastRpsSampleAtMs = r.samplingState.lastSampleAtMs;
    this.lastRpsTotalSent = r.samplingState.lastTotalSent;
    this.lastRpsSmoothed = r.samplingState.lastSmoothed;
    this.loadRpsQueue = r.queue;
    this.rpsRenderTarget = r.rpsRenderTarget;
    this.rpsRenderValue = r.rpsRenderValue;
  }

  stopActiveRunTick(): void {
    if (this.activeRunTickHandle) {
      clearInterval(this.activeRunTickHandle);
      this.activeRunTickHandle = null;
    }

    if (this.sparklineRafHandle !== null) {
      cancelAnimationFrame(this.sparklineRafHandle);
      this.sparklineRafHandle = null;
    }

    const patch = buildStopActiveRunTickPatch();
    this.loadUsersQueue = patch.loadUsersQueue;
    this.loadUsersScrollPhase = patch.loadUsersScrollPhase;
    this.loadUsersNextValue = patch.loadUsersNextValue;
    this.loadUsersSparklineTransformView = patch.loadUsersSparklineTransformView;
    this.loadUsersSparklinePathDView = patch.loadUsersSparklinePathDView;
    this.loadRpsQueue = patch.loadRpsQueue;
    this.loadRpsScrollPhase = patch.loadRpsScrollPhase;
    this.loadRpsNextValue = patch.loadRpsNextValue;
    this.loadRpsSparklineTransformView = patch.loadRpsSparklineTransformView;
    this.loadRpsSparklinePathDView = patch.loadRpsSparklinePathDView;
    this.sparklineLastFrameAtMs = patch.sparklineLastFrameAtMs;
    this.sparklineLastRenderedAtMs = patch.sparklineLastRenderedAtMs;
  }

  applyResetPatch(): void {
    this.activeRunProgress = null;
    this.loadUsersSeries = [];
    this.loadRpsSeries = [];
    this.lastRpsSampleAtMs = null;
    this.lastRpsTotalSent = null;
  }
}
