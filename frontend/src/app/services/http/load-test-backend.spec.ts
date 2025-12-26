import { executeLoadTestViaBackend, type EventsOnFn } from './load-test-backend';

describe('load-test-backend', () => {
  function createEventsOn() {
    const handlers: Record<string, Array<(payload: any) => void>> = {};
    const unsubscribed: Record<string, number> = {};

    const eventsOn: EventsOnFn = (event, cb) => {
      handlers[event] = handlers[event] || [];
      handlers[event].push(cb);
      return () => {
        unsubscribed[event] = (unsubscribed[event] || 0) + 1;
      };
    };

    return {
      eventsOn,
      emit: (event: string, payload: any) => {
        for (const cb of handlers[event] || []) cb(payload);
      },
      unsubscribed,
    };
  }

  it('wires events, forwards progress, and resolves on done', async () => {
    const ev = createEventsOn();
    const startLoadTest = jest.fn().mockResolvedValue(undefined);
    const hydrateText = jest.fn(async (text: string) => text.replace('SECRET', 's3cr3t'));
    const hydrateHeaders = jest.fn(async (headers?: Record<string, string>) => ({ ...(headers || {}), X: '1' }));
    const normalizeEnvName = jest.fn((env?: string) => env || 'default');

    const progress: any[] = [];

    const promise = executeLoadTestViaBackend(
      {
        name: 't',
        method: 'GET',
        url: 'https://example.com/SECRET',
        headers: { A: 'SECRET' },
        body: 'SECRET',
        options: {},
        loadTest: { duration: '1s' },
      } as any,
      { v: '1' },
      'prod',
      'rid',
      (p) => progress.push(p),
      {
        backend: { startLoadTest },
        eventsOn: ev.eventsOn,
        hydrateText,
        hydrateHeaders,
        normalizeEnvName,
      }
    );

    const waitForStart = async () => {
      const deadline = Date.now() + 250;
      while (startLoadTest.mock.calls.length === 0) {
        if (Date.now() > deadline) {
          throw new Error('Timed out waiting for startLoadTest to be called');
        }
        await new Promise((r) => setTimeout(r, 0));
      }
    };

    // The implementation hydrates inputs before subscribing to events.
    // Wait until we know subscriptions are registered.
    await waitForStart();

    // other requestId should be ignored
    ev.emit('loadtest:progress', { requestId: 'other', value: 1 });
    ev.emit('loadtest:progress', { requestId: 'rid', step: 2 });

    expect(progress).toEqual([{ requestId: 'rid', step: 2 }]);

    ev.emit('loadtest:done', {
      requestId: 'rid',
      results: {
        totalRequests: 3,
        successfulRequests: 2,
        failedRequests: 1,
        responseTimes: [10, 20],
        errors: ['oops'],
        failureStatusCounts: { '500': 1 },
        startTime: 1,
        endTime: 2,
        cancelled: false,
        aborted: true,
        abortReason: 'x',
        plannedDurationMs: 1234,
        adaptive: true,
      }
    });

    const results = await promise;

    expect(results.totalRequests).toBe(3);
    expect(results.failedRequests).toBe(1);
    expect(results.failureStatusCounts?.['500']).toBe(1);
    expect(results.plannedDurationMs).toBe(1234);
    expect(results.aborted).toBe(true);
    expect(results.abortReason).toBe('x');

    expect(startLoadTest).toHaveBeenCalledWith(
      'rid',
      'GET',
      'https://example.com/s3cr3t',
      JSON.stringify({ A: 'SECRET', X: '1' }),
      's3cr3t',
      JSON.stringify({ duration: '1s' })
    );

    // cleanup called for done
    expect(ev.unsubscribed['loadtest:progress']).toBe(1);
    expect(ev.unsubscribed['loadtest:done']).toBe(1);
    expect(ev.unsubscribed['loadtest:error']).toBe(1);
  });

  it('rejects on loadtest:error and cleans up', async () => {
    const ev = createEventsOn();
    const startLoadTest = jest.fn().mockResolvedValue(undefined);

    const promise = executeLoadTestViaBackend(
      {
        name: 't',
        method: 'GET',
        url: 'u',
        headers: {},
        body: undefined,
        options: {},
        loadTest: { iterations: 1 },
      } as any,
      {},
      undefined,
      'rid',
      undefined,
      {
        backend: { startLoadTest },
        eventsOn: ev.eventsOn,
        hydrateText: async (t) => t,
        hydrateHeaders: async (h) => h || {},
        normalizeEnvName: (e) => e || '',
      }
    );

    const waitForStart = async () => {
      const deadline = Date.now() + 250;
      while (startLoadTest.mock.calls.length === 0) {
        if (Date.now() > deadline) {
          throw new Error('Timed out waiting for startLoadTest to be called');
        }
        await new Promise((r) => setTimeout(r, 0));
      }
    };

    await waitForStart();

    ev.emit('loadtest:error', { requestId: 'rid', message: 'boom' });

    await expect(promise).rejects.toThrow('boom');
    expect(ev.unsubscribed['loadtest:progress']).toBe(1);
    expect(ev.unsubscribed['loadtest:done']).toBe(1);
    expect(ev.unsubscribed['loadtest:error']).toBe(1);
  });
});
