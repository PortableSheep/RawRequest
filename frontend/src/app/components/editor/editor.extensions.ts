import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { EditorState, RangeSetBuilder } from '@codemirror/state';
import { foldService, syntaxTree } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';

import {
  extractDependsTarget,
  extractMethodFromLine,
  isMethodLine,
  isSeparatorLine
} from '../../utils/http-file-analysis';
import { getJsDecorationsForSegment, getNonScriptLineDecorations } from './editor.highlighter.logic';
import { computeRequestBlockIndex, RequestBlock } from './editor-request-indexer.logic';
import { findRequestNameLineNumber } from './editor.component.logic';

export function buildEditorThemeExtension(theme: 'dark' | 'light') {
  if (theme === 'dark') {
    return oneDark;
  }

  return EditorView.theme(
    {
      '&': {
        backgroundColor: '#ffffff',
        color: '#0f172a'
      },
      '.cm-content': {
        caretColor: '#2563eb'
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: '#2563eb'
      },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
        backgroundColor: 'rgba(37, 99, 235, 0.18)'
      },
      '.cm-gutters': {
        backgroundColor: '#f8fafc',
        color: '#64748b',
        borderRightColor: '#e2e8f0'
      },
      '.cm-activeLine': {
        backgroundColor: 'rgba(15, 23, 42, 0.04)'
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'rgba(15, 23, 42, 0.04)',
        color: '#475569'
      }
    },
    { dark: false }
  );
}

export function createDependsLinker(jumpToRequestByName: (name: string) => boolean) {
  const linkMark = Decoration.mark({ class: 'cm-depends-link' });
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = this.buildDecorations(update.view);
      }
    }

    buildDecorations(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>();
      const tree = syntaxTree(view.state);
      for (const range of view.visibleRanges) {
        tree.iterate({
          from: range.from,
          to: range.to,
          enter: (node) => {
            if (node.type.name !== 'AnnotationLine') return;
            const text = view.state.doc.sliceString(node.from, node.to);
            const depends = extractDependsTarget(text);
            if (!depends) return;
            const from = node.from + depends.start;
            const to = node.from + depends.end;
            if (to > from) builder.add(from, to, linkMark);
          }
        });
      }
      return builder.finish();
    }
  }, {
    decorations: v => v.decorations
  });
}

export function jumpToRequestByName(view: EditorView, targetName: string): boolean {
  const state = view.state;
  const lines: string[] = [];
  for (let lineNo = 1; lineNo <= state.doc.lines; lineNo++) {
    lines.push(state.doc.line(lineNo).text);
  }

  const matchLineNo = findRequestNameLineNumber(lines, targetName);
  if (matchLineNo === null) return false;

  const line = state.doc.line(matchLineNo);
  const anchor = line.from;
  view.dispatch({
    selection: { anchor },
    effects: EditorView.scrollIntoView(anchor, { y: 'center' })
  });
  return true;
}

export function createRequestHighlighter() {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = this.buildDecorations(update.view);
      }
    }

    buildDecorations(view: EditorView): DecorationSet {
      try {
        const decorations: Array<{ from: number; to: number; cls: string }> = [];
        const lineDecorations: Array<{ at: number; cls: string }> = [];
        let inScript = false;
        let scriptBraceDepth = 0;
        let inRequestBlock = false;

        const tree = syntaxTree(view.state);
        const { from: vpFrom, to: vpTo } = view.viewport;
        const vpStartLine = view.state.doc.lineAt(vpFrom).number;
        const vpEndLine = view.state.doc.lineAt(vpTo).number;
        const margin = 20;
        const startLine = Math.max(1, vpStartLine - margin);
        const endLine = Math.min(view.state.doc.lines, vpEndLine + margin);

        for (let i = 1; i < startLine; i++) {
          const text = view.state.doc.line(i).text;
          const trimmedText = text.trimStart();
          if (isSeparatorLine(text)) { inRequestBlock = false; }
          if (isMethodLine(text) && !inRequestBlock) { inRequestBlock = true; }
          const scriptStartMatch = trimmedText.match(/^([<>])\s*\{/);
          if (scriptStartMatch && !inScript) {
            inScript = true;
            scriptBraceDepth = 0;
            for (const char of text) {
              if (char === '{') scriptBraceDepth++;
              if (char === '}') scriptBraceDepth--;
            }
            if (scriptBraceDepth <= 0) inScript = false;
            continue;
          }
          if (!inScript && (trimmedText === '<' || trimmedText === '>')) continue;
          if (!inScript && trimmedText.startsWith('{')) {
            const prevLine = i > 1 ? view.state.doc.line(i - 1).text.trim() : '';
            if (prevLine === '<' || prevLine === '>') {
              inScript = true;
              scriptBraceDepth = 0;
              for (const char of text) {
                if (char === '{') scriptBraceDepth++;
                if (char === '}') scriptBraceDepth--;
              }
              if (scriptBraceDepth <= 0) inScript = false;
              continue;
            }
          }
          if (inScript) {
            for (const char of text) {
              if (char === '{') scriptBraceDepth++;
              if (char === '}') scriptBraceDepth--;
            }
            if (scriptBraceDepth <= 0) inScript = false;
          }
        }

        for (let i = startLine; i <= endLine; i++) {
          const line = view.state.doc.line(i);
          const text = line.text;
          const trimmedText = text.trimStart();
          const leadingWhitespace = text.length - trimmedText.length;

          if (isSeparatorLine(text)) {
            inRequestBlock = false;
          }

          const resolvePos = line.from + Math.min(leadingWhitespace, Math.max(0, text.length - 1));
          const resolved = tree.resolve(resolvePos, 1);
          const lineNodeName = resolved.name;

          const scriptStartMatch = trimmedText.match(/^([<>])\s*\{/);
          if (scriptStartMatch && !inScript) {
            inScript = true;
            const markerIndex = text.indexOf(scriptStartMatch[1]);
            decorations.push({ from: line.from + markerIndex, to: line.from + markerIndex + 1, cls: 'cm-script-marker' });
            lineDecorations.push({ at: line.from, cls: 'cm-script-line' });
            scriptBraceDepth = 0;
            for (const char of text) {
              if (char === '{') scriptBraceDepth++;
              if (char === '}') scriptBraceDepth--;
            }
            const braceIndex = text.indexOf('{', markerIndex);
            if (braceIndex >= 0 && braceIndex < text.length - 1) {
                decorations.push(
                  ...getJsDecorationsForSegment({
                    lineFrom: line.from,
                    text,
                    startOffset: braceIndex + 1
                  })
                );
            }
            if (scriptBraceDepth <= 0) inScript = false;
            continue;
          }

          if (!inScript && (trimmedText === '<' || trimmedText === '>')) {
            const markerIndex = text.indexOf(trimmedText);
            decorations.push({ from: line.from + markerIndex, to: line.from + markerIndex + 1, cls: 'cm-script-marker' });
            lineDecorations.push({ at: line.from, cls: 'cm-script-line' });
            continue;
          }

          if (!inScript && trimmedText.startsWith('{')) {
            const prevLine = i > 1 ? view.state.doc.line(i - 1).text.trim() : '';
            if (prevLine === '<' || prevLine === '>') {
              inScript = true;
              scriptBraceDepth = 0;
              for (const char of text) {
                if (char === '{') scriptBraceDepth++;
                if (char === '}') scriptBraceDepth--;
              }
              lineDecorations.push({ at: line.from, cls: 'cm-script-line' });
              const braceIndex = text.indexOf('{');
              if (braceIndex >= 0 && braceIndex < text.length - 1) {
                decorations.push(
                  ...getJsDecorationsForSegment({
                    lineFrom: line.from,
                    text,
                    startOffset: braceIndex + 1
                  })
                );
              }
              if (scriptBraceDepth <= 0) inScript = false;
              continue;
            }
          }

          if (inScript) {
            lineDecorations.push({ at: line.from, cls: 'cm-script-line' });
            let lineOpenBraces = 0;
            let lineCloseBraces = 0;
            for (const char of text) {
              if (char === '{') lineOpenBraces++;
              if (char === '}') lineCloseBraces++;
            }
            scriptBraceDepth += lineOpenBraces - lineCloseBraces;

            if (scriptBraceDepth <= 0) {
              inScript = false;
              const closingBraceIdx = text.lastIndexOf('}');
              if (closingBraceIdx > 0) {
                decorations.push(
                  ...getJsDecorationsForSegment({
                    lineFrom: line.from,
                    text,
                    startOffset: 0,
                    endOffset: closingBraceIdx
                  })
                );
              }
            } else {
              decorations.push(
                ...getJsDecorationsForSegment({
                  lineFrom: line.from,
                  text,
                  startOffset: 0
                })
              );
            }
            continue;
          }

          let nextRequestMethod: string | undefined;
          if (lineNodeName === 'SeparatorLine' && isSeparatorLine(text)) {
            for (let j = i + 1; j <= endLine + 20 && j <= view.state.doc.lines; j++) {
              const peekText = view.state.doc.line(j).text;
              if (isSeparatorLine(peekText)) break;
              const method = extractMethodFromLine(peekText);
              if (method) { nextRequestMethod = method; break; }
            }
          }

          const nonScript = getNonScriptLineDecorations({
            lineFrom: line.from,
            text,
            leadingWhitespace,
            lineNodeName,
            nodeText: view.state.doc.sliceString(resolved.from, resolved.to),
            isRequestStart: isMethodLine(text) && !inRequestBlock,
            nextRequestMethod
          });
          decorations.push(...nonScript.decorations);
          lineDecorations.push(...nonScript.lineDecorations);

          if (isMethodLine(text) && !inRequestBlock) {
            inRequestBlock = true;
          }
        }

        decorations.sort((a, b) => a.from - b.from || a.to - b.to);
        const entries: Array<{ from: number; to: number; deco: Decoration }> = [];
        
        // Separate line decorations and mark decorations
        for (const d of decorations) {
          entries.push({ from: d.from, to: d.to, deco: Decoration.mark({ class: d.cls }) });
        }
        for (const d of lineDecorations) {
          entries.push({ from: d.at, to: d.at, deco: Decoration.line({ class: d.cls }) });
        }

        // Sort everything by document position. 
        // For same position, Decoration.line must come before Decoration.mark (length 0 first).
        entries.sort((a, b) => a.from - b.from || (a.to - a.from) - (b.to - b.from));

        const builder = new RangeSetBuilder<Decoration>();
        for (const e of entries) {
          try {
            builder.add(e.from, e.to, e.deco);
          } catch (err) {
            console.error('Failed to add decoration:', e, err);
          }
        }
        return builder.finish();
      } catch (e) {
        console.error('Failed to build request highlighter decorations', e);
        return Decoration.none;
      }
    }
  }, {
    decorations: v => v.decorations
  });
}

export function createRequestFolding() {
  return foldService.of((state, lineStart, _lineEnd) => {
    const tree = syntaxTree(state);
    const resolved = tree.resolve(lineStart, 1);

    if (resolved.name === 'MethodLine') {
      let cur: typeof resolved | null = resolved;
      while (cur && cur.name !== 'RequestBlock') cur = cur.parent;
      if (cur && cur.name === 'RequestBlock') {
        const methodNode = cur.getChild('MethodLine');
        const from = methodNode ? methodNode.to : cur.from;
        const to = cur.to;
        if (to > from) return { from, to };
      }
    }

    const line = state.doc.lineAt(lineStart);
    const text = line.text;
    const trimmed = text.trimStart();
    const leadingWhitespace = text.length - trimmed.length;
    const lineType = tree.resolve(line.from + Math.min(leadingWhitespace, Math.max(0, text.length - 1)), 1).name;
    if (lineType !== 'SeparatorLine') return null;
    if (!isSeparatorLine(text)) return null;

    const start = line.to;
    for (let lineNo = line.number + 1; lineNo <= state.doc.lines; lineNo++) {
      const next = state.doc.line(lineNo);
      const nextText = next.text;
      const nextTrimmed = nextText.trimStart();
      const nextLeadingWhitespace = nextText.length - nextTrimmed.length;
      const nextType = tree.resolve(next.from + Math.min(nextLeadingWhitespace, Math.max(0, nextText.length - 1)), 1).name;
      if (nextType === 'SeparatorLine' && isSeparatorLine(nextText)) {
        const end = next.from - 1;
        if (end <= start) return null;
        return { from: start, to: end };
      }
    }
    if (start >= state.doc.length) return null;
    return { from: start, to: state.doc.length };
  });
}

export function createRequestBlockIndexer(onRebuild: (blocks: RequestBlock[]) => void) {
  const rebuild = (state: EditorState) => {
    onRebuild(computeRequestBlockIndex(state.doc));
  };

  return ViewPlugin.fromClass(class {
    constructor(view: EditorView) {
      rebuild(view.state);
    }

    update(update: ViewUpdate) {
      if (update.docChanged) {
        rebuild(update.state);
      }
    }
  });
}
