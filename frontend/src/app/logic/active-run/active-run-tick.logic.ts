export type ActiveRequestType = 'single' | 'chain' | 'load' | null | undefined;

export type ActiveRunTickInput = {
  isRequestRunning: boolean;
  activeRequestType: ActiveRequestType;
  activeUsers?: number | null;
};

export type ActiveRunTickActions = {
  shouldEnsureSparkline: boolean;
  usersSample: number | null;
  shouldSampleRps: boolean;
};

export function decideActiveRunTickActions(input: ActiveRunTickInput): ActiveRunTickActions {
  if (!input.isRequestRunning || input.activeRequestType !== 'load') {
    return {
      shouldEnsureSparkline: false,
      usersSample: null,
      shouldSampleRps: false
    };
  }

  const sample = typeof input.activeUsers === 'number' && Number.isFinite(input.activeUsers)
    ? input.activeUsers
    : 0;

  return {
    shouldEnsureSparkline: true,
    usersSample: sample,
    shouldSampleRps: true
  };
}
