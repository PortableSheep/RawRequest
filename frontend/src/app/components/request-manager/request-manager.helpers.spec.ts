import { getActiveEnvNameForFile, getCombinedVariablesForFile } from './env-vars';
import { buildRequestChain } from './request-chain';
import { buildChainItems } from './chain-items';
import type { FileTab, Request, ResponseData } from '../../models/http.models';

describe('request-manager helpers', () => {
  describe('env-vars', () => {
    it('prefers file.selectedEnv over global env', () => {
      const file = {
        id: 'f1',
        name: 'n',
        filePath: '',
        content: '',
        variables: {},
        environments: { dev: { token: 'x' } },
        selectedEnv: 'dev',
        requests: [],
        responseData: []
      } as unknown as FileTab;

      expect(getActiveEnvNameForFile(file, 'prod')).toBe('dev');
    });

    it('falls back to global env, then default', () => {
      const file = {
        id: 'f1',
        name: 'n',
        filePath: '',
        content: '',
        variables: {},
        environments: {},
        selectedEnv: '',
        requests: [],
        responseData: []
      } as unknown as FileTab;

      expect(getActiveEnvNameForFile(file, 'prod')).toBe('prod');
      expect(getActiveEnvNameForFile(file, '')).toBe('default');
    });

    it('merges base vars then env vars (env overrides)', () => {
      const file = {
        id: 'f1',
        name: 'n',
        filePath: '',
        content: '',
        variables: { baseUrl: 'a', token: 'base' },
        environments: { dev: { token: 'dev', extra: '1' } },
        selectedEnv: 'dev',
        requests: [],
        responseData: []
      } as unknown as FileTab;

      const vars = getCombinedVariablesForFile(file, 'ignored');
      expect(vars['baseUrl']).toBe('a');
      expect(vars['token']).toBe('dev');
      expect(vars['extra']).toBe('1');
    });
  });

  describe('request-chain', () => {
    it('builds dependency chain by name', () => {
      const requests: Request[] = [
        { name: 'A', method: 'GET', url: 'u' } as any,
        { name: 'B', method: 'GET', url: 'u', depends: 'A' } as any,
        { name: 'C', method: 'GET', url: 'u', depends: 'B' } as any
      ];

      const chain = buildRequestChain(requests, 2);
      expect(chain.map(r => r.name)).toEqual(['A', 'B', 'C']);
    });

    it('throws on circular dependency', () => {
      const requests: Request[] = [
        { name: 'A', method: 'GET', url: 'u', depends: 'B' } as any,
        { name: 'B', method: 'GET', url: 'u', depends: 'A' } as any
      ];

      expect(() => buildRequestChain(requests, 0)).toThrow('Circular dependency');
    });
  });

  describe('chain-items', () => {
    it('creates chain items with primary marker', () => {
      const chain: Request[] = [
        { name: 'A', method: 'GET', url: 'u1', headers: {} } as any,
        { name: 'B', method: 'POST', url: 'u2', headers: {} } as any
      ];

      const responses: ResponseData[] = [
        { status: 200, statusText: 'OK', headers: {}, body: 'x', responseTime: 10, assertions: [{ passed: true, message: 'ok', stage: 'post' }] },
        { status: 500, statusText: 'ERR', headers: {}, body: 'y', responseTime: 20 }
      ];

      const items = buildChainItems(chain, [null, null], responses, 1);
      expect(items).toHaveLength(2);
      expect(items[0].isPrimary).toBe(false);
      expect(items[1].isPrimary).toBe(true);
      expect(items[0].label).toBe('A');
      expect(items[1].label).toBe('B');
      expect(items[0].response?.status).toBe(200);
      expect(items[0].response?.assertions).toEqual([{ passed: true, message: 'ok', stage: 'post' }]);
    });
  });
});
