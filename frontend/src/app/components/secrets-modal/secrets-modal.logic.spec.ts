import {
  buildSecretRows,
  sortSecretRows,
  filterSecretRows,
  countSecretUsage,
  toggleSort,
  SecretRow
} from './secrets-modal.logic';

describe('secrets-modal.logic', () => {
  const sampleSecrets = {
    'default': ['api_key', 'db_password', 'unused_key'],
    'staging': ['api_key'],
    'prod': ['api_key', 'extra_secret']
  };

  describe('buildSecretRows', () => {
    it('builds flat rows from secret index', () => {
      const rows = buildSecretRows(sampleSecrets, {});
      expect(rows.length).toBe(6);
    });

    it('marks env overrides of global keys', () => {
      const rows = buildSecretRows(sampleSecrets, {});
      const stagingApiKey = rows.find(r => r.env === 'staging' && r.key === 'api_key');
      expect(stagingApiKey?.isOverride).toBe(true);
    });

    it('does not mark global keys as override', () => {
      const rows = buildSecretRows(sampleSecrets, {});
      const globalApiKey = rows.find(r => r.env === 'default' && r.key === 'api_key');
      expect(globalApiKey?.isOverride).toBe(false);
    });

    it('does not mark non-global unique keys as override', () => {
      const rows = buildSecretRows(sampleSecrets, {});
      const extraSecret = rows.find(r => r.env === 'prod' && r.key === 'extra_secret');
      expect(extraSecret?.isOverride).toBe(false);
    });

    it('includes usage counts', () => {
      const rows = buildSecretRows(sampleSecrets, { api_key: 3, db_password: 1 });
      const globalApiKey = rows.find(r => r.env === 'default' && r.key === 'api_key');
      expect(globalApiKey?.usage).toBe(3);
    });

    it('defaults usage to 0', () => {
      const rows = buildSecretRows(sampleSecrets, {});
      expect(rows.every(r => r.usage === 0)).toBe(true);
    });
  });

  describe('sortSecretRows', () => {
    let rows: SecretRow[];

    beforeEach(() => {
      rows = buildSecretRows(sampleSecrets, { api_key: 3, db_password: 1 });
    });

    it('sorts by key ascending', () => {
      const sorted = sortSecretRows(rows, 'key', 'asc');
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].key.localeCompare(sorted[i - 1].key)).toBeGreaterThanOrEqual(0);
      }
    });

    it('sorts by key descending', () => {
      const sorted = sortSecretRows(rows, 'key', 'desc');
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].key.localeCompare(sorted[i - 1].key)).toBeLessThanOrEqual(0);
      }
    });

    it('sorts by usage ascending', () => {
      const sorted = sortSecretRows(rows, 'usage', 'asc');
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].usage).toBeGreaterThanOrEqual(sorted[i - 1].usage);
      }
    });

    it('keeps default env first when sorting by env', () => {
      const sorted = sortSecretRows(rows, 'env', 'asc');
      const defaultRows = sorted.filter(r => r.env === 'default');
      const firstNonDefault = sorted.findIndex(r => r.env !== 'default');
      if (firstNonDefault > 0) {
        expect(sorted.slice(0, firstNonDefault).every(r => r.env === 'default')).toBe(true);
      }
    });
  });

  describe('filterSecretRows', () => {
    it('returns all rows for empty query', () => {
      const rows = buildSecretRows(sampleSecrets, {});
      expect(filterSecretRows(rows, '')).toHaveLength(rows.length);
    });

    it('filters by key', () => {
      const rows = buildSecretRows(sampleSecrets, {});
      const filtered = filterSecretRows(rows, 'api');
      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered.every(r => r.key.includes('api'))).toBe(true);
    });

    it('filters by env', () => {
      const rows = buildSecretRows(sampleSecrets, {});
      const filtered = filterSecretRows(rows, 'staging');
      expect(filtered.every(r => r.env === 'staging')).toBe(true);
    });

    it('is case insensitive', () => {
      const rows = buildSecretRows(sampleSecrets, {});
      const filtered = filterSecretRows(rows, 'API');
      expect(filtered.length).toBeGreaterThan(0);
    });
  });

  describe('countSecretUsage', () => {
    it('counts occurrences of secret references', () => {
      const content = `
GET https://api.com
Authorization: Bearer {{secret:api_key}}

###

POST https://api.com/data
X-Secret: {{secret:api_key}}
X-Password: {{secret:db_password}}
      `;
      const counts = countSecretUsage(content);
      expect(counts['api_key']).toBe(2);
      expect(counts['db_password']).toBe(1);
    });

    it('returns empty for no references', () => {
      expect(countSecretUsage('GET https://api.com')).toEqual({});
    });

    it('handles whitespace in key names', () => {
      const counts = countSecretUsage('{{secret: my_key }}');
      expect(counts['my_key']).toBe(1);
    });
  });

  describe('toggleSort', () => {
    it('toggles direction when clicking same column', () => {
      expect(toggleSort('key', 'asc', 'key')).toEqual({ column: 'key', direction: 'desc' });
      expect(toggleSort('key', 'desc', 'key')).toEqual({ column: 'key', direction: 'asc' });
    });

    it('resets to asc when clicking different column', () => {
      expect(toggleSort('key', 'desc', 'env')).toEqual({ column: 'env', direction: 'asc' });
    });
  });
});
