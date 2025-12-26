import {
  buildCancelActiveRequestErrorPatch,
  decideCancelActiveRequest
} from './cancel-active-request.logic';

describe('cancel-active-request.logic', () => {
  it('does not cancel without activeRequestId', () => {
    expect(
      decideCancelActiveRequest({
        activeRequestId: undefined,
        isCancelling: false,
        hasRequestManager: true
      })
    ).toEqual({ shouldCancel: false, isCancellingAfterStart: false });
  });

  it('does not cancel when already cancelling', () => {
    expect(
      decideCancelActiveRequest({
        activeRequestId: 'id',
        isCancelling: true,
        hasRequestManager: true
      })
    ).toEqual({ shouldCancel: false, isCancellingAfterStart: true });
  });

  it('does not cancel without request manager', () => {
    expect(
      decideCancelActiveRequest({
        activeRequestId: 'id',
        isCancelling: false,
        hasRequestManager: false
      })
    ).toEqual({ shouldCancel: false, isCancellingAfterStart: false });
  });

  it('cancels when id exists, not cancelling, and manager exists', () => {
    expect(
      decideCancelActiveRequest({
        activeRequestId: 'id',
        isCancelling: false,
        hasRequestManager: true
      })
    ).toEqual({ shouldCancel: true, isCancellingAfterStart: true });
  });

  it('error patch always clears cancelling flag', () => {
    expect(buildCancelActiveRequestErrorPatch()).toEqual({ isCancellingActiveRequest: false });
  });
});
