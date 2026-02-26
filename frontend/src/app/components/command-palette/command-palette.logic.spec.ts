import { buildPaletteItems, fuzzyMatch, searchPaletteItems } from './command-palette.logic';

describe('command-palette.logic', () => {
  describe('buildPaletteItems', () => {
    it('builds items from requests', () => {
      const items = buildPaletteItems([
        { method: 'GET', url: 'https://api.com/users', name: 'GetUsers', group: 'Users' },
        { method: 'POST', url: 'https://api.com/login' }
      ]);
      expect(items).toHaveLength(2);
      expect(items[0]).toEqual({
        requestIndex: 0, method: 'GET', label: 'GetUsers', group: 'Users', url: 'https://api.com/users'
      });
      expect(items[1].label).toBe('');
      expect(items[1].group).toBeNull();
    });

    it('defaults method to GET', () => {
      const items = buildPaletteItems([{ method: '', url: '/test' }]);
      expect(items[0].method).toBe('GET');
    });
  });

  describe('fuzzyMatch', () => {
    it('returns all chars highlighted for exact match', () => {
      const result = fuzzyMatch('hello', 'hello');
      expect(result).not.toBeNull();
      expect(result!.highlights).toEqual([0, 1, 2, 3, 4]);
    });

    it('returns null for no match', () => {
      expect(fuzzyMatch('abc', 'xyz')).toBeNull();
    });

    it('matches non-contiguous characters', () => {
      const result = fuzzyMatch('GetUsers', 'gtu');
      expect(result).not.toBeNull();
      expect(result!.highlights.length).toBe(3);
    });

    it('returns highlights for empty query', () => {
      const result = fuzzyMatch('anything', '');
      expect(result).not.toBeNull();
      expect(result!.highlights).toEqual([]);
    });

    it('gives bonus for word-start matches', () => {
      const wordStart = fuzzyMatch('get-users', 'gu');
      const midWord = fuzzyMatch('xgxuxsers', 'gu');
      expect(wordStart!.score).toBeGreaterThan(midWord!.score);
    });
  });

  describe('searchPaletteItems', () => {
    const items = buildPaletteItems([
      { method: 'GET', url: 'https://api.com/users', name: 'GetUsers', group: 'Users' },
      { method: 'POST', url: 'https://api.com/login', name: 'Login', group: 'Auth' },
      { method: 'DELETE', url: 'https://api.com/users/1', name: 'DeleteUser' }
    ]);

    it('returns all items for empty query', () => {
      expect(searchPaletteItems(items, '')).toHaveLength(3);
    });

    it('filters by method', () => {
      const results = searchPaletteItems(items, 'DELETE');
      expect(results[0].item.label).toBe('DeleteUser');
    });

    it('filters by name', () => {
      const results = searchPaletteItems(items, 'login');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item.label).toBe('Login');
    });

    it('filters by group', () => {
      const results = searchPaletteItems(items, 'Auth');
      expect(results[0].item.group).toBe('Auth');
    });

    it('sorts by relevance score', () => {
      const results = searchPaletteItems(items, 'user');
      expect(results.length).toBeGreaterThanOrEqual(2);
      // Results should be sorted by score descending
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });
  });
});
