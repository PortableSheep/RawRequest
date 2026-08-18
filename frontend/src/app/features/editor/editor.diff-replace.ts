/**
 * Compute a minimal CodeMirror change spec to turn `oldDoc` into `newDoc`.
 *
 * Returns `null` when the two strings are byte-identical (caller should skip
 * the dispatch entirely so CodeMirror doesn't re-measure / scroll). Otherwise
 * returns a single replacement of just the differing middle range, computed
 * by stripping the common prefix and suffix.
 *
 * Avoiding a whole-doc replace is critical for scroll preservation: a full
 * replace forces every visible line to relayout, and CodeMirror's async
 * measure cycle can clobber a synchronous `scrollTop` write made right after
 * the dispatch. A minimal-diff change usually leaves visible lines untouched
 * and avoids the relayout entirely.
 */
export function computeMinimalReplace(
  oldDoc: string,
  newDoc: string,
): { from: number; to: number; insert: string } | null {
  if (oldDoc === newDoc) return null;

  const oldLen = oldDoc.length;
  const newLen = newDoc.length;

  const maxPrefix = Math.min(oldLen, newLen);
  let prefix = 0;
  while (
    prefix < maxPrefix &&
    oldDoc.charCodeAt(prefix) === newDoc.charCodeAt(prefix)
  ) {
    prefix++;
  }

  const maxSuffix = Math.min(oldLen - prefix, newLen - prefix);
  let suffix = 0;
  while (
    suffix < maxSuffix &&
    oldDoc.charCodeAt(oldLen - 1 - suffix) ===
      newDoc.charCodeAt(newLen - 1 - suffix)
  ) {
    suffix++;
  }

  return {
    from: prefix,
    to: oldLen - suffix,
    insert: newDoc.slice(prefix, newLen - suffix),
  };
}
