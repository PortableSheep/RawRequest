import { describe, it, expect } from 'vitest';
import {
  isFileContentFunctionallyEqual,
  normalizeFileContent,
} from './workspace-state.normalize';

describe('normalizeFileContent', () => {
  it('treats CRLF and LF as equivalent', () => {
    expect(normalizeFileContent('a\r\nb')).toBe('a\nb');
  });

  it('strips trailing horizontal whitespace per line', () => {
    expect(normalizeFileContent('a   \nb\t\n')).toBe('a\nb');
  });

  it('strips trailing newlines', () => {
    expect(normalizeFileContent('a\nb\n\n\n')).toBe('a\nb');
  });

  it('preserves leading whitespace and interior structure', () => {
    expect(normalizeFileContent('  a\n  b')).toBe('  a\n  b');
  });
});

describe('isFileContentFunctionallyEqual', () => {
  it('returns true for byte-identical strings', () => {
    expect(isFileContentFunctionallyEqual('hello', 'hello')).toBe(true);
  });

  it('returns true when only line endings differ', () => {
    expect(
      isFileContentFunctionallyEqual('GET /a\r\nHost: x', 'GET /a\nHost: x'),
    ).toBe(true);
  });

  it('returns true when only the trailing newline differs', () => {
    expect(isFileContentFunctionallyEqual('GET /a', 'GET /a\n')).toBe(true);
  });

  it('returns true when only trailing spaces on lines differ', () => {
    expect(
      isFileContentFunctionallyEqual('GET /a   \nHost: x', 'GET /a\nHost: x'),
    ).toBe(true);
  });

  it('returns false when actual content differs', () => {
    expect(isFileContentFunctionallyEqual('GET /a', 'GET /b')).toBe(false);
  });

  it('returns false when interior whitespace differs', () => {
    expect(isFileContentFunctionallyEqual('a\nb', 'a\n\nb')).toBe(false);
  });
});
