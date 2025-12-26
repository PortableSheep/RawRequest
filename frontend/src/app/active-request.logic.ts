import type { Request } from './models/http.models';

import { buildRequestLabel, buildRequestToken } from './logic/app/app.component.logic';
import { buildRpsSparklinePathD, buildUsersSparklinePathD } from './logic/active-run/active-run-sparkline.logic';

export type ActiveRequestInfo = {
  id?: string;
  label: string;
  requestIndex: number;
  canCancel: boolean;
  type: 'single' | 'chain' | 'load';
  startedAt: number;
};

export type LoadRunUiState = {
  activeRunProgress: null;
  loadUsersSeries: number[];
  loadUsersQueue: number[];
  loadUsersScrollPhase: number;
  loadUsersNextValue: null;
  loadUsersSparklineTransformView: string;
  loadUsersSparklinePathDView: string;

  loadRpsSeries: number[];
  loadRpsQueue: number[];
  loadRpsScrollPhase: number;
  loadRpsNextValue: null;
  loadRpsSparklineTransformView: string;
  loadRpsSparklinePathDView: string;

  // RPS sampler state
  lastRpsSampleAtMs: null;
  lastRpsTotalSent: null;
  lastRpsSmoothed: null;

  // RPS numeric readout smoothing
  rpsRenderValue: null;
  rpsRenderTarget: null;
};

export function deriveActiveRequestType(request: Request): 'single' | 'chain' | 'load' {
  return request.loadTest ? 'load' : request.depends ? 'chain' : 'single';
}

export function buildActiveRequestInfo(
  fileId: string,
  requestIndex: number,
  request: Request,
  nowMs: number
): ActiveRequestInfo {
  return {
    id: buildRequestToken(fileId, requestIndex, nowMs),
    label: buildRequestLabel(request),
    requestIndex,
    canCancel: true,
    type: deriveActiveRequestType(request),
    startedAt: nowMs
  };
}

export function buildInitialLoadRunUiState(
  usersMaxPoints: number,
  rpsMaxPoints: number
): LoadRunUiState {
  const loadUsersSeries = Array(usersMaxPoints).fill(0);
  const loadRpsSeries = Array(rpsMaxPoints).fill(0);

  return {
    activeRunProgress: null,

    loadUsersSeries,
    loadUsersQueue: [],
    loadUsersScrollPhase: 0,
    loadUsersNextValue: null,
    loadUsersSparklineTransformView: '',
    loadUsersSparklinePathDView: buildUsersSparklinePathD(loadUsersSeries, usersMaxPoints),

    loadRpsSeries,
    loadRpsQueue: [],
    loadRpsScrollPhase: 0,
    loadRpsNextValue: null,
    loadRpsSparklineTransformView: '',
    loadRpsSparklinePathDView: buildRpsSparklinePathD(loadRpsSeries, rpsMaxPoints),

    lastRpsSampleAtMs: null,
    lastRpsTotalSent: null,
    lastRpsSmoothed: null,

    rpsRenderValue: null,
    rpsRenderTarget: null
  };
}
