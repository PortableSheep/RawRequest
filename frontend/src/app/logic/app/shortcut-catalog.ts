import type { KeyCombo } from '../../services/keyboard-shortcut.service';

export interface ShortcutEntry {
  id: string;
  combo: KeyCombo;
  label: string;
  group: 'file' | 'navigation' | 'general';
  /** When false the shortcut won't appear in the help popover. Default true. */
  showInHelp?: boolean;
  priority?: number;
}

/**
 * Single source of truth for every global keyboard shortcut.
 * `app.component.ts` attaches actions; the help popover reads labels.
 */
export const SHORTCUT_CATALOG: readonly ShortcutEntry[] = [
  { id: 'app:save',                 combo: { key: 's', ctrl: true },                label: 'Save',              group: 'file' },
  { id: 'app:saveAs',               combo: { key: 's', ctrl: true, shift: true },   label: 'Save As…',          group: 'file',       priority: 1 },
  { id: 'app:toggleCommandPalette', combo: { key: 'p', ctrl: true },                label: 'Search Requests',   group: 'navigation' },
  { id: 'app:toggleOutline',        combo: { key: 'o', ctrl: true, shift: true },   label: 'Toggle Outline',    group: 'navigation' },
  { id: 'app:toggleHistory',        combo: { key: 'h', ctrl: true, shift: true },   label: 'Toggle History',    group: 'navigation' },
  { id: 'app:find',                  combo: { key: 'f', ctrl: true },                label: 'Find',              group: 'general' },
  { id: 'app:escape',               combo: { key: 'Escape' },                       label: 'Close / Cancel',    group: 'general', showInHelp: false },
] as const;

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform ?? navigator.userAgent);

function modSymbol(): string {
  return isMac ? '⌘' : 'Ctrl';
}

/** Render a `KeyCombo` as a human-readable string like "⌘+Shift+S". */
export function formatKeyCombo(combo: KeyCombo): string {
  const parts: string[] = [];
  if (combo.ctrl) parts.push(modSymbol());
  if (combo.shift) parts.push('Shift');
  if (combo.alt) parts.push(isMac ? '⌥' : 'Alt');
  parts.push(friendlyKeyName(combo.key));
  return parts.join('+');
}

function friendlyKeyName(key: string): string {
  if (key.length === 1) return key.toUpperCase();
  switch (key) {
    case 'Escape': return 'Esc';
    case 'ArrowUp': return '↑';
    case 'ArrowDown': return '↓';
    case 'ArrowLeft': return '←';
    case 'ArrowRight': return '→';
    default: return key;
  }
}

/** Return only entries intended for the help popover. */
export function getVisibleShortcuts(): readonly ShortcutEntry[] {
  return SHORTCUT_CATALOG.filter(e => e.showInHelp !== false);
}

/** Look up a catalog entry by id. */
export function findShortcut(id: string): ShortcutEntry | undefined {
  return SHORTCUT_CATALOG.find(e => e.id === id);
}

/** Format the shortcut hint for a given id (e.g. "⌘+P"). Returns empty string if not found. */
export function shortcutHint(id: string): string {
  const entry = findShortcut(id);
  return entry ? formatKeyCombo(entry.combo) : '';
}
