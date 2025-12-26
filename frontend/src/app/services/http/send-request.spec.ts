import { sendRequest } from './send-request';

describe('send-request', () => {
  it('hydrates, builds preview, calls backend, parses response, and runs scripts', async () => {
    const calls: string[] = [];

    const executeScript = jest.fn(async (_script: string, _ctx: any, stage: any) => {
      calls.push(`script:${stage}`);
    });

    const hydrateText = jest.fn(async (value: string) => {
      calls.push('hydrateText');
      return value.replace('{{x}}', '1').replace('SECRET', 's3cr3t');
    });

    const hydrateHeaders = jest.fn(async (headers?: Record<string, string>) => {
      calls.push('hydrateHeaders');
      return { ...(headers || {}), A: 's3cr3t' };
    });

    const backend = {
      sendRequest: jest.fn(async () => 'Status: 200 OK\nHeaders: {"headers": {"X": "1"}}\nBody: {"ok": true}'),
      sendRequestWithID: jest.fn(async () => ''),
    };

    const throwIfCancelled = jest.fn();

    const parseGoResponse = jest.fn((_s: string, t: number) => ({
      status: 200,
      statusText: 'OK',
      headers: { X: '1' },
      body: '{"ok": true}',
      responseTime: t,
      json: { ok: true },
    } as any));

    const result = await sendRequest(
      {
        name: 'r',
        method: 'POST',
        url: 'https://example.com/{{x}}',
        headers: { 'Content-Type': 'application/json', A: 'SECRET' },
        body: '{"a":"{{x}}"}',
        preScript: 'pre',
        postScript: 'post',
        options: {},
      } as any,
      { x: '1' },
      undefined,
      'prod',
      {
        backend,
        now: (() => {
          let t = 1000;
          return () => (t += 10);
        })(),
        normalizeEnvName: (e) => e || '',
        hydrateText,
        hydrateHeaders,
        executeScript,
        parseGoResponse,
        throwIfCancelled,
      }
    );

    expect(calls[0]).toBe('script:pre');
    expect(calls).toContain('hydrateText');
    expect(calls).toContain('hydrateHeaders');

    expect(backend.sendRequest).toHaveBeenCalledTimes(1);
    expect(throwIfCancelled).toHaveBeenCalled();
    expect(parseGoResponse).toHaveBeenCalled();
    expect(executeScript).toHaveBeenCalledWith('post', expect.any(Object), 'post');

    expect(result.processedUrl).toBe('https://example.com/1');
    expect(result.requestPreview.url).toBe('https://example.com/1');
    expect(result.requestPreview.headers['A']).toBe('s3cr3t');
    expect(result.requestPreview.body).toBe('{"a":"1"}');
  });

  it('throws a ResponseData fallback on backend error and includes preview if available', async () => {
    const backend = {
      sendRequest: jest.fn(async () => {
        throw new Error('boom');
      }),
      sendRequestWithID: jest.fn(async () => ''),
    };

    await expect(
      sendRequest(
        {
          method: 'GET',
          url: 'u',
          headers: {},
          body: undefined,
          options: {},
        } as any,
        {},
        undefined,
        undefined,
        {
          backend,
          now: (() => {
            let t = 0;
            return () => (t += 5);
          })(),
          normalizeEnvName: (e) => e || '',
          hydrateText: async (t) => t,
          hydrateHeaders: async (h) => h || {},
          executeScript: async () => {},
          parseGoResponse: () => ({ status: 200 } as any),
          throwIfCancelled: () => {},
        }
      )
    ).rejects.toMatchObject({
      status: 0,
      body: 'boom',
      requestPreview: { url: 'u' },
      processedUrl: 'u',
    });
  });

  it('rethrows cancellation errors unchanged', async () => {
    const backend = {
      sendRequest: jest.fn(async () => '__CANCELLED__'),
      sendRequestWithID: jest.fn(async () => ''),
    };

    const cancelled: any = new Error('Request cancelled');
    cancelled.cancelled = true;

    await expect(
      sendRequest(
        {
          method: 'GET',
          url: 'u',
          headers: {},
          body: undefined,
          options: {},
        } as any,
        {},
        undefined,
        undefined,
        {
          backend,
          normalizeEnvName: (e) => e || '',
          hydrateText: async (t) => t,
          hydrateHeaders: async (h) => h || {},
          executeScript: async () => {},
          parseGoResponse: () => ({ status: 200 } as any),
          throwIfCancelled: () => {
            throw cancelled;
          },
        }
      )
    ).rejects.toBe(cancelled);
  });
});
