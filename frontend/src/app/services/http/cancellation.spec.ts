import { throwIfCancelledResponse } from './cancellation';

describe('cancellation', () => {
  it('throws a cancellation error when sentinel matches', () => {
    expect(() => throwIfCancelledResponse('__CANCELLED__', '__CANCELLED__')).toThrow('Request cancelled');
    try {
      throwIfCancelledResponse('__CANCELLED__', '__CANCELLED__');
    } catch (e: any) {
      expect(e.cancelled).toBe(true);
    }
  });

  it('does not throw when sentinel does not match', () => {
    expect(() => throwIfCancelledResponse('OK', '__CANCELLED__')).not.toThrow();
  });
});
