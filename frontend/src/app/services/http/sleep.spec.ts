import { sleep } from './sleep';

describe('sleep', () => {
  it('uses setTimeout with clamped ms', async () => {
    jest.useFakeTimers();

    let resolved = false;
    const p1 = sleep(10).then(() => {
      resolved = true;
    });

    jest.advanceTimersByTime(9);
    await Promise.resolve();
    expect(resolved).toBe(false);

    jest.advanceTimersByTime(1);
    await p1;
    expect(resolved).toBe(true);

    const p2 = sleep(-10);
    jest.runOnlyPendingTimers();
    await p2;

    const p3 = sleep(Number.NaN);
    jest.runOnlyPendingTimers();
    await p3;

    jest.useRealTimers();
  });
});
