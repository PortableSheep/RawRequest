import { prepareBackendRequest, prepareBackendRequestForChain } from './request-prep';
import { Request } from '../../models/http.models';

describe('request-prep', () => {
  it('prepares a backend request with hydrated url/headers/body', async () => {
    const req: Request = {
      method: 'POST',
      url: 'http://x/{{id}}',
      headers: { Authorization: 'Bearer {{t}}' },
      body: 'hello {{name}}',
      name: 'R',
      preScript: 'console.log(1)',
      postScript: 'console.log(2)'
    };

    const result = await prepareBackendRequest(req, { id: '1', t: 'T', name: 'Ada' }, 'env', {
      hydrateText: async (v) => v.replaceAll('{{id}}', '1').replaceAll('{{t}}', 'T').replaceAll('{{name}}', 'Ada'),
      hydrateHeaders: async (h) => ({ ...(h || {}), Authorization: 'Bearer T' })
    });

    expect(result.backend['method']).toBe('POST');
    expect(result.backend['url']).toBe('http://x/1');
    expect(result.backend['headers']['Authorization']).toBe('Bearer T');
    expect(result.backend['body']).toBe('hello Ada');
    expect(result.backend['preScript']).toBe('console.log(1)');
    expect(result.preview.name).toBe('R');
    expect(result.preview.body).toBe('hello Ada');
  });

  it('uses a body placeholder for FormData', async () => {
    const req: Request = {
      method: 'POST',
      url: 'http://x',
      headers: {},
      body: new FormData(),
    };

    const result = await prepareBackendRequest(req, {}, 'env', {
      hydrateText: async (v) => v,
      hydrateHeaders: async (h) => h || {}
    });

    expect(result.backend['body']).toBe('');
    expect(result.preview.body).toBe('[FormData]');
  });

  it('prepares a chain request using secrets-only hydration and includes options', async () => {
    const req: Request = {
      method: 'GET',
      url: 'http://x/<<s>>',
      headers: { A: '<<s>>' },
      options: { timeout: 123, noRedirect: true },
    };

    const result = await prepareBackendRequestForChain(req, 'env', {
      hydrateTextSecretsOnly: async (v) => v.replaceAll('<<s>>', 'S'),
      hydrateHeadersSecretsOnly: async (h) => ({ ...(h || {}), A: 'S' })
    });

    expect(result.backend['url']).toBe('http://x/S');
    expect(result.backend['headers']['A']).toBe('S');
    expect(result.backend['options']['timeout']).toBe(123);
    expect(result.preview.body).toBeUndefined();
  });
});
