export type CancellationError = Error & { cancelled?: boolean };

export function throwIfCancelledResponse(responseStr: string, cancelledSentinel: string): void {
  if (responseStr === cancelledSentinel) {
    const cancellationError: CancellationError = new Error('Request cancelled');
    cancellationError.cancelled = true;
    throw cancellationError;
  }
}
