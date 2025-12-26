import { consumeQueuedRequest } from './request-queue.logic';

describe('request-queue.logic', () => {
  it('does nothing when a request is running', () => {
    expect(
      consumeQueuedRequest({ isRequestRunning: true, queuedRequestIndex: 3 })
    ).toEqual({ queuedRequestIndexAfter: 3, nextRequestIndexToExecute: null });
  });

  it('does nothing when there is no queued index', () => {
    expect(
      consumeQueuedRequest({ isRequestRunning: false, queuedRequestIndex: null })
    ).toEqual({ queuedRequestIndexAfter: null, nextRequestIndexToExecute: null });
  });

  it('consumes queued index when idle', () => {
    expect(
      consumeQueuedRequest({ isRequestRunning: false, queuedRequestIndex: 7 })
    ).toEqual({ queuedRequestIndexAfter: null, nextRequestIndexToExecute: 7 });
  });
});
