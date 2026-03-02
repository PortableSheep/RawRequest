import {
  computeRequestBlockIndex,
  findRequestIndexByPos,
  computeRequestIndexAtPosFallback,
  DocLike,
  RequestBlock
} from './editor-request-indexer.logic';

/**
 * Build a DocLike from raw text so we can test without CodeMirror.
 */
function docFrom(text: string): DocLike {
  const rawLines = text.split('\n');
  // Build line metadata (1-based to match CodeMirror convention)
  const lineMeta: Array<{ from: number; to: number; text: string }> = [];
  let offset = 0;
  for (const raw of rawLines) {
    lineMeta.push({ from: offset, to: offset + raw.length, text: raw });
    offset += raw.length + 1; // +1 for '\n'
  }
  return {
    lines: rawLines.length,
    length: Math.max(0, offset - 1), // total chars excluding trailing newline
    line(n: number) {
      return lineMeta[n - 1];
    }
  };
}

describe('editor-request-indexer.logic', () => {
  describe('computeRequestBlockIndex', () => {
    it('returns empty for empty document', () => {
      expect(computeRequestBlockIndex(docFrom(''))).toEqual([]);
    });

    it('finds a single request', () => {
      const doc = docFrom('GET https://example.com\nAccept: application/json');
      const blocks = computeRequestBlockIndex(doc);
      expect(blocks).toEqual([{ from: 0, to: doc.length, index: 0 }]);
    });

    it('finds two requests separated by ###', () => {
      const text = 'GET https://a.com\n### separator\nPOST https://b.com';
      const doc = docFrom(text);
      const blocks = computeRequestBlockIndex(doc);
      expect(blocks).toHaveLength(2);
      expect(blocks[0].index).toBe(0);
      expect(blocks[1].index).toBe(1);
    });

    it('does not create a block for separator-only content', () => {
      const doc = docFrom('### separator');
      expect(computeRequestBlockIndex(doc)).toEqual([]);
    });

    it('handles directives before method line', () => {
      const text = '@name Login\nPOST https://api.test/login\nContent-Type: application/json';
      const doc = docFrom(text);
      const blocks = computeRequestBlockIndex(doc);
      // The block should start at the method line, not at the @name directive
      const methodLineFrom = text.indexOf('POST');
      expect(blocks).toHaveLength(1);
      expect(blocks[0].from).toBe(methodLineFrom);
    });
  });

  describe('findRequestIndexByPos', () => {
    const blocks: RequestBlock[] = [
      { from: 0, to: 30, index: 0 },
      { from: 50, to: 90, index: 1 },
      { from: 110, to: 150, index: 2 }
    ];

    it('returns null for empty blocks', () => {
      expect(findRequestIndexByPos([], 5)).toBeNull();
    });

    it('finds index for position inside first block', () => {
      expect(findRequestIndexByPos(blocks, 10)).toBe(0);
    });

    it('finds index for position inside last block', () => {
      expect(findRequestIndexByPos(blocks, 130)).toBe(2);
    });

    it('finds index at exact block boundaries', () => {
      expect(findRequestIndexByPos(blocks, 0)).toBe(0);
      expect(findRequestIndexByPos(blocks, 30)).toBe(0);
      expect(findRequestIndexByPos(blocks, 50)).toBe(1);
      expect(findRequestIndexByPos(blocks, 90)).toBe(1);
    });

    it('returns null for position between blocks', () => {
      expect(findRequestIndexByPos(blocks, 35)).toBeNull();
      expect(findRequestIndexByPos(blocks, 100)).toBeNull();
    });

    it('returns null for position after all blocks', () => {
      expect(findRequestIndexByPos(blocks, 200)).toBeNull();
    });
  });

  describe('computeRequestIndexAtPosFallback', () => {
    it('returns null for empty document', () => {
      expect(computeRequestIndexAtPosFallback(docFrom(''), 0, 0)).toBeNull();
    });

    it('returns 0 for position inside the first request', () => {
      const doc = docFrom('GET https://a.com\nAccept: */*');
      expect(computeRequestIndexAtPosFallback(doc, 5, 1)).toBe(0);
    });

    it('returns correct index for second request', () => {
      const text = 'GET https://a.com\n### sep\nPOST https://b.com';
      const doc = docFrom(text);
      const posInSecond = text.indexOf('POST') + 2;
      expect(computeRequestIndexAtPosFallback(doc, posInSecond, 2)).toBe(1);
    });

    it('returns null when index exceeds request count', () => {
      const doc = docFrom('GET https://a.com');
      // requestCount=0 means there are no known requests
      expect(computeRequestIndexAtPosFallback(doc, 5, 0)).toBeNull();
    });

    it('returns null for position before any method line', () => {
      const doc = docFrom('@name Foo\n@depends Bar');
      expect(computeRequestIndexAtPosFallback(doc, 3, 1)).toBeNull();
    });
  });
});
