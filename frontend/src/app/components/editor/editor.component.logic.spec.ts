import {
  buildRequestNameRegexes,
  computeContextMenuLocalPosition,
  findRequestNameLineNumber,
  shouldCollapseAccidentalSelection
} from './editor.component.logic';

describe('editor.component.logic', () => {
  describe('buildRequestNameRegexes/findRequestNameLineNumber', () => {
    it('returns null for empty target', () => {
      expect(buildRequestNameRegexes('')).toBeNull();
      expect(findRequestNameLineNumber(['@name X'], '   ')).toBeNull();
    });

    it('finds @name target case-insensitively', () => {
      const lines = ['###', '@name GetUsers', 'GET https://example.com'];
      expect(findRequestNameLineNumber(lines, 'getusers')).toBe(2);
    });

    it('finds legacy meta name marker', () => {
      const lines = ['### name: Health ###', 'GET /health'];
      expect(findRequestNameLineNumber(lines, 'Health')).toBe(1);
    });

    it('does not match partial names', () => {
      const lines = ['@name FooBar', '@name Foo'];
      expect(findRequestNameLineNumber(lines, 'FooB')).toBeNull();
    });

    it('escapes regex characters in target name', () => {
      const lines = ['@name foo.bar+baz?'];
      expect(findRequestNameLineNumber(lines, 'foo.bar+baz?')).toBe(1);
    });
  });

  describe('shouldCollapseAccidentalSelection', () => {
    it('collapses when a new selection spans >2 lines', () => {
      expect(
        shouldCollapseAccidentalSelection({
          hadSelectionBefore: false,
          selectionEmptyAfter: false,
          fromLineNumber: 10,
          toLineNumber: 13
        })
      ).toBe(true);
    });

    it('does not collapse when selection already existed', () => {
      expect(
        shouldCollapseAccidentalSelection({
          hadSelectionBefore: true,
          selectionEmptyAfter: false,
          fromLineNumber: 1,
          toLineNumber: 100
        })
      ).toBe(false);
    });

    it('does not collapse when selection is empty', () => {
      expect(
        shouldCollapseAccidentalSelection({
          hadSelectionBefore: false,
          selectionEmptyAfter: true,
          fromLineNumber: 1,
          toLineNumber: 10
        })
      ).toBe(false);
    });

    it('uses configurable maxLineSpan', () => {
      expect(
        shouldCollapseAccidentalSelection({
          hadSelectionBefore: false,
          selectionEmptyAfter: false,
          fromLineNumber: 1,
          toLineNumber: 4,
          maxLineSpan: 10
        })
      ).toBe(false);
    });
  });

  describe('computeContextMenuLocalPosition', () => {
    it('prefers caret coords over event coords', () => {
      const p = computeContextMenuLocalPosition({
        caretLeft: 50,
        caretBottom: 60,
        eventClientX: 10,
        eventClientY: 20,
        viewportWidth: 1000,
        viewportHeight: 800
      });
      expect(p).toEqual({ x: 50, y: 60 });
    });

    it('clamps to viewport and converts to wrapper-local coords', () => {
      const p = computeContextMenuLocalPosition({
        caretLeft: null,
        caretBottom: null,
        eventClientX: 9999,
        eventClientY: 9999,
        viewportWidth: 500,
        viewportHeight: 400,
        menuWidth: 220,
        menuHeight: 190,
        padding: 8,
        wrapperLeft: 100,
        wrapperTop: 50
      });

      // Desired is clamped to (500-220-8, 400-190-8) = (272, 202)
      // Local subtract wrapper -> (172, 152)
      expect(p).toEqual({ x: 172, y: 152 });
    });

    it('never returns negative local coords', () => {
      const p = computeContextMenuLocalPosition({
        caretLeft: 8,
        caretBottom: 8,
        eventClientX: 8,
        eventClientY: 8,
        viewportWidth: 500,
        viewportHeight: 400,
        wrapperLeft: 999,
        wrapperTop: 999
      });
      expect(p.x).toBe(0);
      expect(p.y).toBe(0);
    });
  });
});
