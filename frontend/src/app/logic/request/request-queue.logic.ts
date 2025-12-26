export type ConsumeQueuedRequestInput = {
  isRequestRunning: boolean;
  queuedRequestIndex: number | null | undefined;
};

export type ConsumeQueuedRequestResult = {
  queuedRequestIndexAfter: number | null;
  nextRequestIndexToExecute: number | null;
};

export function consumeQueuedRequest(input: ConsumeQueuedRequestInput): ConsumeQueuedRequestResult {
  if (input.isRequestRunning) {
    return { queuedRequestIndexAfter: input.queuedRequestIndex ?? null, nextRequestIndexToExecute: null };
  }

  const next = input.queuedRequestIndex;
  if (next === null || next === undefined) {
    return { queuedRequestIndexAfter: null, nextRequestIndexToExecute: null };
  }

  return { queuedRequestIndexAfter: null, nextRequestIndexToExecute: next };
}
