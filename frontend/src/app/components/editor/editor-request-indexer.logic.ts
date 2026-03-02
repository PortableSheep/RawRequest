import { isMethodLine, isSeparatorLine } from '../../utils/http-file-analysis';

export interface RequestBlock {
  from: number;
  to: number;
  index: number;
}

/**
 * Minimal abstraction over a document for request indexing.
 * Matches the subset of CodeMirror's `Text` / `EditorState.doc` used here.
 */
export interface DocLike {
  readonly lines: number;
  readonly length: number;
  line(n: number): { from: number; to: number; text: string };
}

/**
 * Build an ordered array of request blocks from the document.
 * Each block records the character range (`from`/`to`) and 0-based request `index`.
 */
export function computeRequestBlockIndex(doc: DocLike): RequestBlock[] {
  const blocks: RequestBlock[] = [];

  let inRequest = false;
  let currentFrom: number | null = null;
  let index = 0;

  for (let lineNo = 1; lineNo <= doc.lines; lineNo++) {
    const line = doc.line(lineNo);
    const text = line.text;

    if (isSeparatorLine(text)) {
      if (inRequest && currentFrom !== null) {
        const end = line.from - 1;
        if (end > currentFrom) {
          blocks.push({ from: currentFrom, to: end, index });
          index++;
        }
      }
      inRequest = false;
      currentFrom = null;
      continue;
    }

    if (isMethodLine(text) && !inRequest) {
      inRequest = true;
      currentFrom = line.from;
    }
  }

  if (inRequest && currentFrom !== null) {
    blocks.push({ from: currentFrom, to: doc.length, index });
  }

  return blocks;
}

/**
 * Binary-search `blocks` to find which request index contains `pos`.
 * Returns the 0-based request index or `null` if `pos` falls outside any block.
 */
export function findRequestIndexByPos(blocks: RequestBlock[], pos: number): number | null {
  if (!blocks.length) return null;

  let lo = 0;
  let hi = blocks.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const block = blocks[mid];
    if (pos < block.from) {
      hi = mid - 1;
    } else if (pos > block.to) {
      lo = mid + 1;
    } else {
      return block.index;
    }
  }
  return null;
}

/**
 * Fallback: compute request index at `pos` by scanning lines (O(lines)).
 * Used when the cached block index is empty or stale.
 */
export function computeRequestIndexAtPosFallback(
  doc: DocLike,
  pos: number,
  requestCount: number
): number | null {
  let idx = -1;
  let inRequest = false;
  for (let lineNo = 1; lineNo <= doc.lines; lineNo++) {
    const line = doc.line(lineNo);
    const text = line.text;

    if (isSeparatorLine(text)) {
      inRequest = false;
    } else if (isMethodLine(text)) {
      if (!inRequest) {
        idx++;
        inRequest = true;
      }
    }

    if (pos <= line.to) {
      break;
    }
  }

  if (idx < 0) return null;
  if (idx >= requestCount) return null;
  return idx;
}
