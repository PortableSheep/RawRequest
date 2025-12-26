import { getJsDecorationsForSegment, getLoadKeyDecorations, getNonScriptLineDecorations } from './editor.highlighter.logic';

describe('editor.highlighter.logic', () => {
  describe('getJsDecorationsForSegment', () => {
    it('returns empty for whitespace-only segment', () => {
      expect(
        getJsDecorationsForSegment({
          lineFrom: 0,
          text: '   ',
          startOffset: 0
        })
      ).toEqual([]);
    });

    it('highlights comments and avoids overlapping helper highlights inside comments', () => {
      const text = "// setVar('x', 'y')";
      const decos = getJsDecorationsForSegment({ lineFrom: 10, text, startOffset: 0 });

      const comment = decos.find((d) => d.cls === 'cm-js-comment');
      expect(comment).toBeTruthy();

      const helper = decos.find((d) => d.cls === 'cm-js-helper');
      expect(helper).toBeFalsy();
    });

    it('highlights strings and avoids keyword highlights inside strings', () => {
      const text = "const s = 'if else for'";
      const decos = getJsDecorationsForSegment({ lineFrom: 0, text, startOffset: 0 });

      const keywordConst = decos.find((d) => d.cls === 'cm-js-keyword' && text.slice(d.from, d.to) === 'const');
      expect(keywordConst).toBeTruthy();

      const stringDeco = decos.find((d) => d.cls === 'cm-js-string');
      expect(stringDeco).toBeTruthy();

      const anyKeywordInsideString = decos.some((d) => {
        if (d.cls !== 'cm-js-keyword') return false;
        if (!stringDeco) return false;
        return d.from >= stringDeco.from && d.to <= stringDeco.to;
      });
      expect(anyKeywordInsideString).toBe(false);
    });

    it('highlights function names but excludes keyword-like functions', () => {
      const text = 'foo(1); if (x) {}';
      const decos = getJsDecorationsForSegment({ lineFrom: 0, text, startOffset: 0 });

      expect(decos.some((d) => d.cls === 'cm-js-function' && text.slice(d.from, d.to) === 'foo')).toBe(true);
      expect(decos.some((d) => d.cls === 'cm-js-function' && text.slice(d.from, d.to) === 'if')).toBe(false);
    });

    it('produces absolute ranges using lineFrom and startOffset', () => {
      const text = 'xx setVar(1) yy';
      const decos = getJsDecorationsForSegment({ lineFrom: 100, text, startOffset: 3 });

      // segment begins at index 3 -> "setVar(1) yy"
      const helper = decos.find((d) => d.cls === 'cm-js-helper');
      expect(helper).toBeTruthy();
      expect(text.slice(helper!.from - 100, helper!.to - 100)).toBe('setVar');
    });
  });

  describe('getLoadKeyDecorations', () => {
    it('extracts key names from @load key=value pairs', () => {
      const text = '@load users=10, ramp=5 warmup=1';
      const decos = getLoadKeyDecorations({ lineFrom: 0, text, loadKeywordIndex: 0 });

      const keys = decos.map((d) => text.slice(d.from, d.to));
      expect(keys).toEqual(['users', 'ramp', 'warmup']);
    });

    it('returns empty when keyword index is invalid', () => {
      const text = '@load users=10';
      expect(getLoadKeyDecorations({ lineFrom: 0, text, loadKeywordIndex: -1 })).toEqual([]);
    });
  });

  describe('getNonScriptLineDecorations', () => {
    it('highlights method token for MethodLine', () => {
      const res = getNonScriptLineDecorations({
        lineFrom: 100,
        text: '  GET https://x',
        leadingWhitespace: 2,
        lineNodeName: 'MethodLine',
        nodeText: '  GET https://x'
      });

      const m = res.decorations.find((d) => d.cls === 'cm-http-method');
      expect(m).toBeTruthy();
      expect(m).toEqual({ from: 102, to: 105, cls: 'cm-http-method' });
    });

    it('highlights header key for HeaderLine', () => {
      const res = getNonScriptLineDecorations({
        lineFrom: 0,
        text: 'X-Test: 1',
        leadingWhitespace: 0,
        lineNodeName: 'HeaderLine',
        nodeText: 'X-Test: 1'
      });
      expect(res.decorations).toContainEqual({ from: 0, to: 6, cls: 'cm-http-header' });
    });

    it('highlights @env.* tokens', () => {
      const res = getNonScriptLineDecorations({
        lineFrom: 10,
        text: 'hello @env.prod world',
        leadingWhitespace: 0,
        lineNodeName: 'Text',
        nodeText: 'hello @env.prod world'
      });

      const d = res.decorations.find((x) => x.cls === 'cm-environment');
      expect(d).toBeTruthy();
      expect('hello @env.prod world'.slice(d!.from - 10, d!.to - 10)).toBe('@env.prod');
    });

    it('highlights @load annotation and load keys', () => {
      const text = '@load users=10, ramp=5';
      const res = getNonScriptLineDecorations({
        lineFrom: 0,
        text,
        leadingWhitespace: 0,
        lineNodeName: 'AnnotationLine',
        nodeText: text
      });

      expect(res.decorations).toContainEqual({ from: 0, to: 6, cls: 'cm-annotation' });
      const keys = res.decorations
        .filter((d) => d.cls === 'cm-load-key')
        .map((d) => text.slice(d.from, d.to));
      expect(keys).toEqual(['users', 'ramp']);
    });

    it('adds line decoration for SeparatorLine', () => {
      const res = getNonScriptLineDecorations({
        lineFrom: 50,
        text: '### foo',
        leadingWhitespace: 0,
        lineNodeName: 'SeparatorLine',
        nodeText: '### foo'
      });
      expect(res.lineDecorations).toEqual([{ at: 50, cls: 'cm-separator' }]);
    });
  });
});
