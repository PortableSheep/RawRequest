export type TextDecoration = { from: number; to: number; cls: string };

import {
  extractPlaceholders,
  ANNOTATION_LINE_REGEX,
  LOAD_LINE_REGEX,
  METHOD_LINE_REGEX
} from '../../utils/http-file-analysis';

type HighlightedRange = [number, number];

type AddDecorationFn = (start: number, end: number, cls: string) => void;

function createOverlapSafeAdder(params: {
  lineFrom: number;
  startOffset: number;
  highlighted: HighlightedRange[];
  decorations: TextDecoration[];
}): AddDecorationFn {
  return (start: number, end: number, cls: string) => {
    const absStart = params.startOffset + start;
    const absEnd = params.startOffset + end;

    for (const [hs, he] of params.highlighted) {
      if ((absStart >= hs && absStart < he) || (absEnd > hs && absEnd <= he)) {
        return;
      }
    }

    params.highlighted.push([absStart, absEnd]);
    params.decorations.push({
      from: params.lineFrom + absStart,
      to: params.lineFrom + absEnd,
      cls
    });
  };
}

/**
 * Returns CodeMirror-style absolute decorations for a JS-ish segment embedded in a single line.
 * This is a pure extraction of the editor's current regex-based token highlighting.
 */
export function getJsDecorationsForSegment(params: {
  lineFrom: number;
  text: string;
  startOffset: number;
  endOffset?: number;
}): TextDecoration[] {
  const segment =
    params.endOffset !== undefined
      ? params.text.substring(params.startOffset, params.endOffset)
      : params.text.substring(params.startOffset);

  if (!segment.trim()) return [];

  const decorations: TextDecoration[] = [];
  const highlighted: HighlightedRange[] = [];
  const add = createOverlapSafeAdder({
    lineFrom: params.lineFrom,
    startOffset: params.startOffset,
    highlighted,
    decorations
  });

  let m: RegExpExecArray | null;

  const commentRx = /\/\/.*$|\/\*[\s\S]*?\*\//g;
  while ((m = commentRx.exec(segment)) !== null) add(m.index, m.index + m[0].length, 'cm-js-comment');

  const stringRx = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
  while ((m = stringRx.exec(segment)) !== null) add(m.index, m.index + m[0].length, 'cm-js-string');

  const helperRx = /\b(setVar|getVar|setHeader|updateRequest|assert|delay|response|request)\b/g;
  while ((m = helperRx.exec(segment)) !== null) add(m.index, m.index + m[0].length, 'cm-js-helper');

  const kwRx =
    /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|new|typeof|instanceof|in|of|async|await|class|extends|import|export|default|from|yield)\b/g;
  while ((m = kwRx.exec(segment)) !== null) add(m.index, m.index + m[0].length, 'cm-js-keyword');

  const builtinRx =
    /\b(console|Math|Date|JSON|Object|Array|String|Number|Boolean|Promise|Error|RegExp|Map|Set|setTimeout|setInterval|crypto|true|false|null|undefined)\b/g;
  while ((m = builtinRx.exec(segment)) !== null) add(m.index, m.index + m[0].length, 'cm-js-builtin');

  const numRx = /\b\d+\.?\d*\b/g;
  while ((m = numRx.exec(segment)) !== null) add(m.index, m.index + m[0].length, 'cm-js-number');

  const funcRx = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
  while ((m = funcRx.exec(segment)) !== null) {
    if (!['if', 'for', 'while', 'switch', 'catch', 'function'].includes(m[1])) {
      add(m.index, m.index + m[1].length, 'cm-js-function');
    }
  }

  return decorations;
}

export function getLoadKeyDecorations(params: {
  lineFrom: number;
  text: string;
  loadKeywordIndex: number;
  loadKeyword?: string;
}): TextDecoration[] {
  const loadKeyword = params.loadKeyword ?? '@load';
  if (params.loadKeywordIndex < 0) return [];

  const rest = params.text.slice(params.loadKeywordIndex + loadKeyword.length);
  const keyRx = /(^|[\s,])([A-Za-z_][\w-]*)\s*=/g;
  const decorations: TextDecoration[] = [];

  let m: RegExpExecArray | null;
  while ((m = keyRx.exec(rest)) !== null) {
    const prefixLen = (m[1] || '').length;
    const key = m[2];

    const keyStartInRest = m.index + prefixLen;
    const keyEndInRest = keyStartInRest + key.length;

    decorations.push({
      from: params.lineFrom + params.loadKeywordIndex + loadKeyword.length + keyStartInRest,
      to: params.lineFrom + params.loadKeywordIndex + loadKeyword.length + keyEndInRest,
      cls: 'cm-load-key'
    });
  }

  return decorations;
}

export function getNonScriptLineDecorations(params: {
  lineFrom: number;
  text: string;
  leadingWhitespace: number;
  lineNodeName: string;
  nodeText: string;
}): { decorations: TextDecoration[]; lineDecorations: Array<{ at: number; cls: string }> } {
  const decorations: TextDecoration[] = [];
  const lineDecorations: Array<{ at: number; cls: string }> = [];

  // Highlight HTTP methods
  if (params.lineNodeName === 'MethodLine') {
    const mm = params.nodeText.trimStart().match(METHOD_LINE_REGEX);
    const methodLen = mm?.[1]?.length ?? 0;
    if (methodLen > 0) {
      decorations.push({
        from: params.lineFrom + params.leadingWhitespace,
        to: params.lineFrom + params.leadingWhitespace + methodLen,
        cls: 'cm-http-method'
      });
    }
  }

  // Highlight headers
  if (params.lineNodeName === 'HeaderLine') {
    const colonIdx = params.text.indexOf(':');
    const keyLen = colonIdx >= 0 ? colonIdx : params.text.length;
    decorations.push({
      from: params.lineFrom,
      to: params.lineFrom + keyLen,
      cls: 'cm-http-header'
    });
  }

  // Highlight variables
  for (const placeholder of extractPlaceholders(params.text)) {
    decorations.push({
      from: params.lineFrom + placeholder.start,
      to: params.lineFrom + placeholder.end,
      cls: 'cm-variable'
    });
  }

  // Highlight environment variables
  const envRegex = /@env\.[^=\s]+/g;
  let envMatch: RegExpExecArray | null;
  while ((envMatch = envRegex.exec(params.text)) !== null) {
    decorations.push({
      from: params.lineFrom + envMatch.index,
      to: params.lineFrom + envMatch.index + envMatch[0].length,
      cls: 'cm-environment'
    });
  }

  // Highlight @name, @depends, @load annotations
  if (params.lineNodeName === 'AnnotationLine') {
    const annFrom = params.lineFrom + params.leadingWhitespace;
    const am = params.nodeText.trimStart().match(ANNOTATION_LINE_REGEX);
    const annLen = am?.[0]?.length ?? 0;
    decorations.push({
      from: annFrom,
      to: annFrom + annLen,
      cls: 'cm-annotation'
    });

    // If this is an @load line, also highlight key names in key=value pairs
    const annTrimmed = params.nodeText.trimStart();
    if (LOAD_LINE_REGEX.test(annTrimmed)) {
      const loadIdx = params.text.indexOf('@load');
      if (loadIdx >= 0) {
        decorations.push(
          ...getLoadKeyDecorations({
            lineFrom: params.lineFrom,
            text: params.text,
            loadKeywordIndex: loadIdx,
            loadKeyword: '@load'
          })
        );
      }
    }
  }

  // Highlight separators
  if (params.lineNodeName === 'SeparatorLine') {
    lineDecorations.push({ at: params.lineFrom, cls: 'cm-separator' });
  }

  return { decorations, lineDecorations };
}
