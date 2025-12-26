export type CancelActiveRequestInput = {
  activeRequestId: string | undefined;
  isCancelling: boolean;
  hasRequestManager: boolean;
};

export type CancelActiveRequestDecision = {
  shouldCancel: boolean;
  isCancellingAfterStart: boolean;
};

export function decideCancelActiveRequest(input: CancelActiveRequestInput): CancelActiveRequestDecision {
  const hasId = typeof input.activeRequestId === 'string' && input.activeRequestId.length > 0;
  const shouldCancel = hasId && !input.isCancelling && input.hasRequestManager;
  return {
    shouldCancel,
    isCancellingAfterStart: shouldCancel ? true : input.isCancelling
  };
}

export type CancelActiveRequestErrorPatch = {
  isCancellingActiveRequest: false;
};

export function buildCancelActiveRequestErrorPatch(): CancelActiveRequestErrorPatch {
  return { isCancellingActiveRequest: false };
}
