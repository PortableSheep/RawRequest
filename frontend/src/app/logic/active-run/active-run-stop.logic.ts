export type StopActiveRunTickPatch = {
  loadUsersQueue: number[];
  loadUsersScrollPhase: number;
  loadUsersNextValue: number | null;
  loadUsersSparklineTransformView: string;
  loadUsersSparklinePathDView: string;
  loadRpsQueue: number[];
  loadRpsScrollPhase: number;
  loadRpsNextValue: number | null;
  loadRpsSparklineTransformView: string;
  loadRpsSparklinePathDView: string;
  sparklineLastFrameAtMs: number | null;
  sparklineLastRenderedAtMs: number | null;
};

export function buildStopActiveRunTickPatch(): StopActiveRunTickPatch {
  return {
    loadUsersQueue: [],
    loadUsersScrollPhase: 0,
    loadUsersNextValue: null,
    loadUsersSparklineTransformView: '',
    loadUsersSparklinePathDView: '',
    loadRpsQueue: [],
    loadRpsScrollPhase: 0,
    loadRpsNextValue: null,
    loadRpsSparklineTransformView: '',
    loadRpsSparklinePathDView: '',
    sparklineLastFrameAtMs: null,
    sparklineLastRenderedAtMs: null
  };
}
