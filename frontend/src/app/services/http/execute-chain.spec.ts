import { executeChain } from './execute-chain';

describe('execute-chain', () => {
  it('syncs variables, prepares requests, calls backend, and parses responses', async () => {
    const backend = {
      executeRequests: jest.fn(async () => 'RESP'),
      executeRequestsWithID: jest.fn(async () => 'RESPID'),
      setVariable: jest.fn(async () => {}),
    };

    const syncInitialVariablesToBackend = jest.fn(async (vars: any, setVar: any) => {
      for (const k of Object.keys(vars)) {
        await setVar(k, vars[k]);
      }
    });

    const prepareBackendRequestForChain = jest.fn(async (req: any) => ({
      backend: { method: req.method, url: req.url },
      preview: { method: req.method, url: req.url, headers: {}, body: undefined },
    }));

    const parseConcatenatedChainResponses = jest.fn((_resp: string, previews: any[]) =>
      previews.map((p) => ({ status: 200, statusText: 'OK', headers: {}, body: p.url, responseTime: 1 } as any))
    );

    const result = await executeChain(
      [
        { method: 'GET', url: 'u1', headers: {} } as any,
        { method: 'POST', url: 'u2', headers: {} } as any,
      ],
      { a: '1' },
      'rid',
      'prod',
      {
        backend,
        normalizeEnvName: (e) => e || '',
        syncInitialVariablesToBackend,
        prepareBackendRequestForChain,
        parseConcatenatedChainResponses,
        parseGoResponse: (_s, _t) => ({ status: 200 } as any),
        throwIfCancelled: () => {},
        log: { log: () => {}, error: () => {}, warn: () => {} },
      }
    );

    expect(syncInitialVariablesToBackend).toHaveBeenCalledWith({ a: '1' }, expect.any(Function), expect.any(Object));
    expect(backend.setVariable).toHaveBeenCalledWith('a', '1');

    expect(prepareBackendRequestForChain).toHaveBeenCalledTimes(2);
    expect(backend.executeRequestsWithID).toHaveBeenCalledWith('rid', [
      { method: 'GET', url: 'u1' },
      { method: 'POST', url: 'u2' },
    ]);

    expect(parseConcatenatedChainResponses).toHaveBeenCalledWith(
      'RESPID',
      expect.any(Array),
      expect.any(Function),
      expect.any(Object)
    );

    expect(result.requestPreviews).toHaveLength(2);
    expect(result.responses).toHaveLength(2);
  });

  it('uses executeRequests when no requestId', async () => {
    const backend = {
      executeRequests: jest.fn(async () => 'RESP'),
      executeRequestsWithID: jest.fn(async () => 'RESPID'),
      setVariable: jest.fn(async () => {}),
    };

    await executeChain(
      [{ method: 'GET', url: 'u', headers: {} } as any],
      {},
      undefined,
      undefined,
      {
        backend,
        normalizeEnvName: (e) => e || '',
        syncInitialVariablesToBackend: async () => {},
        prepareBackendRequestForChain: async (req: any) => ({
          backend: { url: req.url },
          preview: { method: req.method, url: req.url, headers: {} },
        }),
        parseConcatenatedChainResponses: () => [],
        parseGoResponse: () => ({ status: 200 } as any),
        throwIfCancelled: () => {},
        log: { log: () => {}, error: () => {}, warn: () => {} },
      }
    );

    expect(backend.executeRequests).toHaveBeenCalled();
    expect(backend.executeRequestsWithID).not.toHaveBeenCalled();
  });

  it('rethrows cancellation errors unchanged', async () => {
    const cancelled: any = new Error('Request cancelled');
    cancelled.cancelled = true;

    await expect(
      executeChain([], {}, undefined, undefined, {
        backend: {
          executeRequests: async () => '__CANCELLED__',
          executeRequestsWithID: async () => '__CANCELLED__',
          setVariable: async () => {},
        },
        normalizeEnvName: (e) => e || '',
        syncInitialVariablesToBackend: async () => {},
        prepareBackendRequestForChain: async () => {
          throw new Error('should not');
        },
        parseConcatenatedChainResponses: () => [],
        parseGoResponse: () => ({ status: 200 } as any),
        throwIfCancelled: () => {
          throw cancelled;
        },
        log: { log: () => {}, error: () => {}, warn: () => {} },
      })
    ).rejects.toBe(cancelled);
  });

  it('throws a shaped ResponseData on failure', async () => {
    await expect(
      executeChain([{ method: 'GET', url: 'u', headers: {} } as any], {}, undefined, undefined, {
        backend: {
          executeRequests: async () => {
            throw new Error('boom');
          },
          executeRequestsWithID: async () => 'x',
          setVariable: async () => {},
        },
        normalizeEnvName: (e) => e || '',
        syncInitialVariablesToBackend: async () => {},
        prepareBackendRequestForChain: async (req: any) => ({
          backend: { url: req.url },
          preview: { method: req.method, url: req.url, headers: {} },
        }),
        parseConcatenatedChainResponses: () => [],
        parseGoResponse: () => ({ status: 200 } as any),
        throwIfCancelled: () => {},
        log: { log: () => {}, error: () => {}, warn: () => {} },
      })
    ).rejects.toMatchObject({
      status: 0,
      statusText: 'Chain Execution Error',
      body: 'boom',
    });
  });
});
