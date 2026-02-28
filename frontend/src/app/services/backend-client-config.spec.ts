import {
  DEFAULT_SERVICE_BACKEND_BASE_URL,
  resolveServiceBackendBaseUrl,
} from './backend-client-config';

describe('backend-client-config', () => {
  it('resolves service backend base url with precedence and normalization', () => {
    const storage = {
      getItem: jest.fn().mockReturnValue('http://localhost:9000///'),
    };

    expect(resolveServiceBackendBaseUrl({ __RAWREQUEST_BACKEND_BASE_URL: 'http://127.0.0.1:7777/' }, storage as any)).toBe('http://127.0.0.1:7777');
    expect(resolveServiceBackendBaseUrl({}, storage as any)).toBe('http://localhost:9000');
    expect(resolveServiceBackendBaseUrl({}, { getItem: () => '' } as any)).toBe(DEFAULT_SERVICE_BACKEND_BASE_URL);
  });
});
