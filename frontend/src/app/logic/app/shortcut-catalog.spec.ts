import {
  SHORTCUT_CATALOG,
  formatKeyCombo,
  getVisibleShortcuts,
  findShortcut,
  shortcutHint,
  type ShortcutEntry,
} from './shortcut-catalog';

describe('shortcut-catalog', () => {
  describe('SHORTCUT_CATALOG', () => {
    it('should have unique ids', () => {
      const ids = SHORTCUT_CATALOG.map(e => e.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('should have a label for every entry', () => {
      for (const entry of SHORTCUT_CATALOG) {
        expect(entry.label.length).toBeGreaterThan(0);
      }
    });
  });

  describe('formatKeyCombo', () => {
    it('should format ctrl + single key', () => {
      const result = formatKeyCombo({ key: 's', ctrl: true });
      // Platform-dependent: should contain the key and a modifier
      expect(result).toMatch(/S$/);
      expect(result).toMatch(/⌘|Ctrl/);
    });

    it('should format ctrl + shift + key', () => {
      const result = formatKeyCombo({ key: 'h', ctrl: true, shift: true });
      expect(result).toContain('Shift');
      expect(result).toMatch(/H$/);
    });

    it('should format a standalone key', () => {
      const result = formatKeyCombo({ key: 'Escape' });
      expect(result).toBe('Esc');
    });

    it('should format alt modifier', () => {
      const result = formatKeyCombo({ key: 'a', alt: true });
      expect(result).toMatch(/⌥|Alt/);
      expect(result).toMatch(/A$/);
    });
  });

  describe('getVisibleShortcuts', () => {
    it('should exclude entries with showInHelp: false', () => {
      const visible = getVisibleShortcuts();
      expect(visible.every(e => e.showInHelp !== false)).toBe(true);
    });

    it('should include fewer entries than the full catalog', () => {
      const hidden = SHORTCUT_CATALOG.filter(e => e.showInHelp === false);
      // Only meaningful if there actually are hidden entries
      if (hidden.length > 0) {
        expect(getVisibleShortcuts().length).toBeLessThan(SHORTCUT_CATALOG.length);
      }
    });
  });

  describe('findShortcut', () => {
    it('should return the entry for a known id', () => {
      const entry = findShortcut('app:save');
      expect(entry).toBeDefined();
      expect(entry!.label).toBe('Save');
    });

    it('should return undefined for an unknown id', () => {
      expect(findShortcut('nonexistent')).toBeUndefined();
    });
  });

  describe('shortcutHint', () => {
    it('should return a formatted string for a known id', () => {
      const hint = shortcutHint('app:save');
      expect(hint).toMatch(/⌘|Ctrl/);
      expect(hint).toMatch(/S$/);
    });

    it('should return empty string for an unknown id', () => {
      expect(shortcutHint('nonexistent')).toBe('');
    });
  });
});
