import { buildOutlineEntries, groupOutlineEntries, filterOutlineEntries } from './outline-panel.logic';
import type { Request } from '../../models/http.models';

describe('outline-panel.logic', () => {
  const makeRequest = (overrides: Partial<Request> = {}): Request => ({
    method: 'GET',
    url: 'https://example.com/users',
    headers: {},
    ...overrides
  });

  describe('buildOutlineEntries', () => {
    it('returns empty array for no requests', () => {
      expect(buildOutlineEntries([])).toEqual([]);
    });

    it('uses request name as label when available', () => {
      const entries = buildOutlineEntries([makeRequest({ name: 'GetUsers', method: 'GET' })]);
      expect(entries).toEqual([{ requestIndex: 0, method: 'GET', label: 'GetUsers', url: 'https://example.com/users', group: null }]);
    });

    it('uses full URL as fallback label', () => {
      const entries = buildOutlineEntries([makeRequest({ url: 'https://api.example.com/v1/users' })]);
      expect(entries[0].label).toBe('https://api.example.com/v1/users');
    });

    it('uses full URL when no path extractable', () => {
      const entries = buildOutlineEntries([makeRequest({ url: 'https://api.example.com/' })]);
      expect(entries[0].label).toBe('https://api.example.com/');
    });

    it('handles template variables in URL', () => {
      const entries = buildOutlineEntries([makeRequest({ url: '{{baseUrl}}/users' })]);
      expect(entries[0].label).toBe('{{baseUrl}}/users');
    });

    it('preserves group from request', () => {
      const entries = buildOutlineEntries([makeRequest({ group: 'Auth' })]);
      expect(entries[0].group).toBe('Auth');
    });

    it('defaults method to GET', () => {
      const entries = buildOutlineEntries([makeRequest({ method: '' })]);
      expect(entries[0].method).toBe('GET');
    });
  });

  describe('groupOutlineEntries', () => {
    it('puts ungrouped entries first', () => {
      const entries = [
        { requestIndex: 0, method: 'GET', label: 'A', url: '', group: null },
        { requestIndex: 1, method: 'POST', label: 'B', url: '', group: 'Auth' }
      ];
      const groups = groupOutlineEntries(entries);
      expect(groups.length).toBe(2);
      expect(groups[0].name).toBeNull();
      expect(groups[0].entries.length).toBe(1);
      expect(groups[1].name).toBe('Auth');
    });

    it('groups multiple requests under same group', () => {
      const entries = [
        { requestIndex: 0, method: 'POST', label: 'Login', url: '', group: 'Auth' },
        { requestIndex: 1, method: 'POST', label: 'Logout', url: '', group: 'Auth' }
      ];
      const groups = groupOutlineEntries(entries);
      expect(groups.length).toBe(1);
      expect(groups[0].entries.length).toBe(2);
    });

    it('returns empty for no entries', () => {
      expect(groupOutlineEntries([])).toEqual([]);
    });
  });

  describe('filterOutlineEntries', () => {
    const entries = [
      { requestIndex: 0, method: 'GET', label: 'GetUsers', url: 'https://example.com/users', group: 'Users' },
      { requestIndex: 1, method: 'POST', label: 'Login', url: 'https://example.com/auth', group: 'Auth' },
      { requestIndex: 2, method: 'DELETE', label: 'RemoveUser', url: 'https://example.com/users/1', group: null }
    ];

    it('returns all entries for empty query', () => {
      expect(filterOutlineEntries(entries, '')).toEqual(entries);
    });

    it('filters by label', () => {
      expect(filterOutlineEntries(entries, 'user')).toHaveLength(2);
    });

    it('filters by method', () => {
      expect(filterOutlineEntries(entries, 'delete')).toHaveLength(1);
    });

    it('filters by group', () => {
      expect(filterOutlineEntries(entries, 'auth')).toHaveLength(1);
    });

    it('is case insensitive', () => {
      expect(filterOutlineEntries(entries, 'LOGIN')).toHaveLength(1);
    });
  });
});
