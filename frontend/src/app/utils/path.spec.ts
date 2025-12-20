import { basename, dirname } from './path';

describe('path utils', () => {
  describe('basename', () => {
    it('returns empty for empty input', () => {
      expect(basename('')).toBe('');
      expect(basename(null as any)).toBe('');
    });

    it('handles posix paths', () => {
      expect(basename('/a/b/c.http')).toBe('c.http');
      expect(basename('/a/b/')).toBe('b');
      expect(basename('/')).toBe('');
    });

    it('handles windows paths', () => {
      expect(basename('C:\\a\\b\\c.http')).toBe('c.http');
      expect(basename('C:\\a\\b\\')).toBe('b');
    });
  });

  describe('dirname', () => {
    it('returns empty for empty input', () => {
      expect(dirname('')).toBe('');
      expect(dirname(undefined as any)).toBe('');
    });

    it('handles posix paths', () => {
      expect(dirname('/a/b/c.http')).toBe('/a/b');
      expect(dirname('/a/b/')).toBe('/a');
      expect(dirname('/a')).toBe('/');
      expect(dirname('/')).toBe('/');
    });

    it('handles windows paths', () => {
      expect(dirname('C:\\a\\b\\c.http')).toBe('C:\\a\\b');
      expect(dirname('C:\\a\\b\\')).toBe('C:\\a');
    });

    it('returns empty when no separators', () => {
      expect(dirname('file.http')).toBe('');
    });
  });
});
