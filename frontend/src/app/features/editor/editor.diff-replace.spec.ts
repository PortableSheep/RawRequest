import { describe, it, expect } from 'vitest';
import { computeMinimalReplace } from './editor.diff-replace';

describe('computeMinimalReplace', () => {
  it('returns null when documents are identical', () => {
    expect(computeMinimalReplace('hello', 'hello')).toBeNull();
    expect(computeMinimalReplace('', '')).toBeNull();
  });

  it('replaces only the differing middle range when prefix and suffix match', () => {
    const oldDoc = 'GET /a HTTP/1.1\nHost: x\n\n###\nGET /b';
    const newDoc = 'GET /a HTTP/1.1\nHost: y\n\n###\nGET /b';

    const change = computeMinimalReplace(oldDoc, newDoc);
    expect(change).not.toBeNull();

    // Apply manually and check round-trip.
    const result =
      oldDoc.slice(0, change!.from) +
      change!.insert +
      oldDoc.slice(change!.to);
    expect(result).toBe(newDoc);

    // The diff should be tiny — one character difference (x -> y).
    expect(change!.to - change!.from).toBe(1);
    expect(change!.insert).toBe('y');
  });

  it('handles pure insertion at the end', () => {
    const change = computeMinimalReplace('abc', 'abcdef');
    expect(change).toEqual({ from: 3, to: 3, insert: 'def' });
  });

  it('handles pure insertion at the start', () => {
    const change = computeMinimalReplace('xyz', 'abxyz');
    expect(change).toEqual({ from: 0, to: 0, insert: 'ab' });
  });

  it('handles pure deletion in the middle', () => {
    const change = computeMinimalReplace('abXYZcd', 'abcd');
    expect(change).toEqual({ from: 2, to: 5, insert: '' });
  });

  it('handles full replacement when nothing matches', () => {
    const change = computeMinimalReplace('abc', 'xyz');
    expect(change).toEqual({ from: 0, to: 3, insert: 'xyz' });
  });

  it('handles empty old document', () => {
    const change = computeMinimalReplace('', 'hello');
    expect(change).toEqual({ from: 0, to: 0, insert: 'hello' });
  });

  it('handles empty new document', () => {
    const change = computeMinimalReplace('hello', '');
    expect(change).toEqual({ from: 0, to: 5, insert: '' });
  });

  it('handles trailing newline only difference', () => {
    const change = computeMinimalReplace('hello', 'hello\n');
    expect(change).toEqual({ from: 5, to: 5, insert: '\n' });
  });

  it('does not let prefix and suffix overlap', () => {
    // "aaaa" -> "aaaaa": adding one char. Naive suffix matching could
    // double-count overlapping a's. Verify the diff applies cleanly.
    const change = computeMinimalReplace('aaaa', 'aaaaa');
    expect(change).not.toBeNull();
    const result =
      'aaaa'.slice(0, change!.from) +
      change!.insert +
      'aaaa'.slice(change!.to);
    expect(result).toBe('aaaaa');
  });
});
