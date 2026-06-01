/**
 * Normalize file content for equality comparisons that should ignore
 * whitespace-only churn (line-ending flips, trailing-newline differences,
 * trailing horizontal whitespace per line).
 *
 * Used to decide when a `file-externally-modified` event from the Go file
 * watcher represents a *real* change worth reloading. Without this, an
 * external tool that re-saves a byte-equivalent buffer with different line
 * endings, or that adds/removes a final newline, will silently replace the
 * editor's document and reset the user's scroll position.
 */
export function normalizeFileContent(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n+$/, '');
}

/**
 * True when two file contents are equivalent up to whitespace-only churn
 * that the parser would ignore anyway.
 */
export function isFileContentFunctionallyEqual(a: string, b: string): boolean {
  if (a === b) return true;
  return normalizeFileContent(a) === normalizeFileContent(b);
}
