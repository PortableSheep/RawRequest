import { buildStopActiveRunTickPatch } from './active-run-stop.logic';

describe('buildStopActiveRunTickPatch', () => {
  it('resets sparkline/tick state to defaults', () => {
    const patch = buildStopActiveRunTickPatch();

    expect(patch.loadUsersQueue).toEqual([]);
    expect(patch.loadUsersScrollPhase).toBe(0);
    expect(patch.loadUsersNextValue).toBeNull();
    expect(patch.loadUsersSparklineTransformView).toBe('');
    expect(patch.loadUsersSparklinePathDView).toBe('');

    expect(patch.loadRpsQueue).toEqual([]);
    expect(patch.loadRpsScrollPhase).toBe(0);
    expect(patch.loadRpsNextValue).toBeNull();
    expect(patch.loadRpsSparklineTransformView).toBe('');
    expect(patch.loadRpsSparklinePathDView).toBe('');

    expect(patch.sparklineLastFrameAtMs).toBeNull();
    expect(patch.sparklineLastRenderedAtMs).toBeNull();
  });
});
