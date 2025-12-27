import {
  hydrateHeaders,
  hydrateHeadersSecretsOnly,
  hydrateText,
  hydrateTextSecretsOnly,
  normalizeEnvName
} from './hydration';

describe('hydration', () => {
  const replaceSecrets = async (text: string) => text.replaceAll('<<secret>>', 'S');

  it('normalizes env name to default', () => {
    expect(normalizeEnvName(undefined)).toBe('default');
    expect(normalizeEnvName('')).toBe('default');
    expect(normalizeEnvName('   ')).toBe('default');
    expect(normalizeEnvName('prod')).toBe('prod');
  });

  it('hydrates text via secrets then variables', async () => {
    const v = await hydrateText('hi <<secret>> {{name}}', { name: 'Ada' }, 'env', async (t) => replaceSecrets(t));
    expect(v).toBe('hi S Ada');
  });

  it('hydrates text secrets-only without replacing variables', async () => {
    const v = await hydrateTextSecretsOnly('hi <<secret>> {{name}}', 'env', async (t) => replaceSecrets(t));
    expect(v).toBe('hi S {{name}}');
  });

  it('hydrates headers using provided replacer', async () => {
    const headers = await hydrateHeaders(
      { Authorization: 'Bearer <<secret>>', X: '{{x}}' },
      { x: '1' },
      'env',
      async (t) => replaceSecrets(t)
    );
    expect(headers['Authorization']).toBe('Bearer S');
    expect(headers['X']).toBe('1');
  });

  it('hydrates headers secrets-only', async () => {
    const headers = await hydrateHeadersSecretsOnly(
      { Authorization: 'Bearer <<secret>>', X: '{{x}}' },
      'env',
      async (t) => replaceSecrets(t)
    );
    expect(headers['Authorization']).toBe('Bearer S');
    expect(headers['X']).toBe('{{x}}');
  });

  it('replaces variables multiple times', async () => {
    const v = await hydrateText('Hello {{name}} and {{name}}!', { name: 'Ada' }, 'env', async (t) => t);
    expect(v).toBe('Hello Ada and Ada!');
  });

  it('leaves unknown placeholders intact', async () => {
    const v = await hydrateText('Hello {{name}} {{missing}}', { name: 'Ada' }, 'env', async (t) => t);
    expect(v).toBe('Hello Ada {{missing}}');
  });
});
