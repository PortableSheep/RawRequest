import { Component, ElementRef, ViewChild, AfterViewInit, input, output, OnDestroy, effect } from '@angular/core';

import { basicSetup, EditorView } from 'codemirror';
import { EditorState, RangeSetBuilder, Compartment } from '@codemirror/state';
import { Decoration, DecorationSet, ViewPlugin, ViewUpdate, Tooltip } from '@codemirror/view';
import { oneDark } from '@codemirror/theme-one-dark';
import { foldKeymap, foldService, syntaxTree, LRLanguage, LanguageSupport } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';

import { createEditorKeymap } from './editor-keymap';
import { createRequestGutter } from './editor-request-gutter';
import { createAutocompleteExtension } from './editor.autocomplete';
import { createEditorLintExtensions } from './editor.lint';
import { parser as rawRequestHttpParser } from './rawrequest-http-parser';
import { createVariableHoverTooltipExtension } from './editor.tooltips';
import {
  computeContextMenuLocalPosition,
  findRequestNameLineNumber,
  shouldCollapseAccidentalSelection
} from './editor.component.logic';
import { getJsDecorationsForSegment, getNonScriptLineDecorations } from './editor.highlighter.logic';

import type { SecretIndex } from '../../services/secret.service';
import {
  extractDependsTarget,
  extractSetVarKeys,
  isMethodLine,
  isSeparatorLine,
  ENV_PLACEHOLDER_REGEX,
  REQUEST_REF_PLACEHOLDER_REGEX,
  SECRET_PLACEHOLDER_REGEX
} from '../../utils/http-file-analysis';

const rawRequestHttpLanguage = LRLanguage.define({ parser: rawRequestHttpParser });
const rawRequestHttpSupport = new LanguageSupport(rawRequestHttpLanguage);

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [],
  templateUrl: './editor.component.html',
  styleUrls: ['./editor.component.scss']
})
export class EditorComponent implements AfterViewInit, OnDestroy {
  @ViewChild('wrapper', { static: true }) wrapperContainer!: ElementRef<HTMLElement>;
  @ViewChild('editor', { static: true }) editorContainer!: ElementRef;

  content = input.required<string>();
  requests = input.required<any[]>();
  variables = input<{ [key: string]: string }>({});
  environments = input<{ [env: string]: { [key: string]: string } }>({});
  currentEnv = input<string>('');
  secrets = input<SecretIndex>({});
  requestNames = input<string[]>([]);
  executingRequestIndex = input<number | null>(null);
  isBusy = input<boolean>(false);
  contentChange = output<string>();
  requestExecute = output<number>();

  private editorView!: EditorView;
  private isUpdatingFromInput = false;
  private autocompleteCompartment = new Compartment();
  private lintCompartment = new Compartment();

  private requestBlockIndex: Array<{ from: number; to: number; index: number }> = [];

  editorContextMenu = {
    show: false,
    x: 0,
    y: 0
  };

  constructor() {
    effect(() => {
      const newContent = this.content();
      if (this.editorView && !this.isUpdatingFromInput) {
        const currentContent = this.editorView.state.doc.toString();
        if (currentContent !== newContent) {
          this.updateContent(newContent);
        }
      }
    });

    effect(() => {
      const activeIndex = this.executingRequestIndex();
      const disableAll = this.isBusy();
      this.updateExecutingIndicator(activeIndex, disableAll);
    });

    // Update autocomplete + lint when relevant inputs change
    effect(() => {
      const vars = this.variables();
      const envs = this.environments();
      const names = this.requestNames();
      const reqs = this.requests();
      const env = this.currentEnv();
      const secrets = this.secrets();
      if (this.editorView) {
        this.editorView.dispatch({
          effects: [
            this.autocompleteCompartment.reconfigure(this.createAutocomplete()),
            this.lintCompartment.reconfigure(this.createLintExtensions())
          ]
        });
      }
    });
  }

  ngAfterViewInit() {
    this.initializeEditor();
  }

  ngOnDestroy() {
    if (this.editorView) {
      this.editorView.destroy();
    }
  }

  closeEditorContextMenu(): void {
    this.editorContextMenu.show = false;
  }

  private getSelectionRange(): { from: number; to: number } {
    const sel = this.editorView?.state?.selection?.main;
    if (!sel) {
      return { from: 0, to: 0 };
    }
    return { from: sel.from, to: sel.to };
  }

  private getSelectedText(): string {
    if (!this.editorView) return '';
    const { from, to } = this.getSelectionRange();
    if (from === to) return '';
    return this.editorView.state.sliceDoc(from, to);
  }

  async copySelection(): Promise<void> {
    if (!this.editorView) return;
    const text = this.getSelectedText();
    if (!text) {
      this.closeEditorContextMenu();
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Best-effort fallback for restricted clipboard environments
      try {
        document.execCommand('copy');
      } catch {
        // ignore
      }
    } finally {
      this.closeEditorContextMenu();
    }
  }

  async cutSelection(): Promise<void> {
    if (!this.editorView) return;
    const { from, to } = this.getSelectionRange();
    if (from === to) {
      this.closeEditorContextMenu();
      return;
    }
    const text = this.editorView.state.sliceDoc(from, to);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
    this.editorView.dispatch({
      changes: { from, to, insert: '' },
      selection: { anchor: from }
    });
    this.closeEditorContextMenu();
  }

  async pasteFromClipboard(): Promise<void> {
    if (!this.editorView) return;
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch {
      this.closeEditorContextMenu();
      return;
    }
    if (!text) {
      this.closeEditorContextMenu();
      return;
    }
    const { from, to } = this.getSelectionRange();
    this.editorView.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length }
    });
    this.closeEditorContextMenu();
  }

  selectAll(): void {
    if (!this.editorView) return;
    this.editorView.dispatch({
      selection: { anchor: 0, head: this.editorView.state.doc.length }
    });
    this.closeEditorContextMenu();
  }

  private initializeEditor() {
    const state = EditorState.create({
      doc: this.content(),
      extensions: [
        basicSetup,
        oneDark,
        rawRequestHttpSupport,
        this.createRequestBlockIndexer(),
        this.createRequestFolding(),
        highlightSelectionMatches(),
        this.createRequestHighlighter(),
        this.createDependsLinker(),
        this.autocompleteCompartment.of(this.createAutocomplete()),
        this.createVariableHoverTooltip(),
        this.lintCompartment.of(this.createLintExtensions()),
        createEditorKeymap({
          getRequestIndexAtPos: (state, pos) => this.getRequestIndexAtPos(state, pos),
          onExecuteRequest: (index) => this.requestExecute.emit(index)
        }),
        createRequestGutter((index) => this.requestExecute.emit(index)),
        
        EditorView.domEventHandlers({
          mousedown: (event, view) => {
            if (this.editorContextMenu.show) {
              this.closeEditorContextMenu();
            }
            // Click-to-jump for @depends targets
            if (event.button === 0 && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos !== null) {
                const line = view.state.doc.lineAt(pos);
                const depends = extractDependsTarget(line.text);
                if (depends) {
                  const from = line.from + depends.start;
                  const to = line.from + depends.end;
                  if (pos >= from && pos <= to) {
                    const jumped = this.jumpToRequestByName(view, depends.target);
                    if (jumped) {
                      event.preventDefault();
                      event.stopPropagation();
                      return true;
                    }
                  }
                }
              }
            }

            if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
              const scrollTop = view.scrollDOM.scrollTop;
              const hadSelection = !view.state.selection.main.empty;
              
              // Use setTimeout to check after CodeMirror processes the click
              setTimeout(() => {
                const newScrollTop = view.scrollDOM.scrollTop;
                const selection = view.state.selection.main;
                
                // If scroll jumped more than 100px, restore it
                if (Math.abs(newScrollTop - scrollTop) > 100) {
                  view.scrollDOM.scrollTop = scrollTop;
                }
                
                // If a selection was created but there wasn't one before,
                // and user didn't drag (mousedown only), collapse it to cursor
                if (!hadSelection && !selection.empty) {
                  // Check if this looks like an accidental selection (spans many lines)
                  const fromLine = view.state.doc.lineAt(selection.from).number;
                  const toLine = view.state.doc.lineAt(selection.to).number;
                  if (
                    shouldCollapseAccidentalSelection({
                      hadSelectionBefore: hadSelection,
                      selectionEmptyAfter: selection.empty,
                      fromLineNumber: fromLine,
                      toLineNumber: toLine
                    })
                  ) {
                    // Collapse selection to the click point (selection.to is where user clicked)
                    view.dispatch({
                      selection: { anchor: selection.to }
                    });
                  }
                }
              }, 0);
            }
            return false; // Don't prevent default handling
          },

          contextmenu: (event, view) => {
            // Many desktop webviews disable the native context menu; provide our own for copy/paste.
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos !== null) {
              const sel = view.state.selection.main;
              const insideSelection = !sel.empty && pos >= sel.from && pos <= sel.to;
              if (sel.empty || !insideSelection) {
                view.dispatch({ selection: { anchor: pos } });
              }
            }

            const anchorPos = pos ?? view.state.selection.main.head;
            const caretCoords = view.coordsAtPos(anchorPos);
            const wrapperRect = this.wrapperContainer?.nativeElement?.getBoundingClientRect();

            const { x: localX, y: localY } = computeContextMenuLocalPosition({
              caretLeft: caretCoords?.left,
              caretBottom: caretCoords?.bottom,
              eventClientX: event.clientX,
              eventClientY: event.clientY,
              viewportWidth: window.innerWidth,
              viewportHeight: window.innerHeight,
              wrapperLeft: wrapperRect?.left,
              wrapperTop: wrapperRect?.top
            });

            this.editorContextMenu = {
              show: true,
              x: localX,
              y: localY
            };
            event.preventDefault();
            event.stopPropagation();
            return true;
          }
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            this.isUpdatingFromInput = true;
            this.contentChange.emit(update.state.doc.toString());
            // Reset flag after a short delay to allow the change to propagate
            setTimeout(() => {
              this.isUpdatingFromInput = false;
            }, 0);
          }
        })
      ]
    });

    this.editorView = new EditorView({
      state,
      parent: this.editorContainer.nativeElement
    });

    this.editorView.dom.style.height = '100%';
  }

  private createDependsLinker() {
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

        // Use the Lezer tree to find AnnotationLine nodes in the viewport.
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

  private jumpToRequestByName(view: EditorView, targetName: string): boolean {
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

  private createRequestHighlighter() {
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
        // Collect all decorations, then sort, then build
        const decorations: Array<{ from: number; to: number; cls: string }> = [];
        const lineDecorations: Array<{ at: number; cls: string }> = [];
        let inScript = false;
        let scriptBraceDepth = 0;

        const tree = syntaxTree(view.state);

        for (let i = 1; i <= view.state.doc.lines; i++) {
          const line = view.state.doc.line(i);
          const text = line.text;
          const trimmedText = text.trimStart();
          const leadingWhitespace = text.length - trimmedText.length;

          const resolvePos = line.from + Math.min(leadingWhitespace, Math.max(0, text.length - 1));
          const resolved = tree.resolve(resolvePos, 1);
          const lineNodeName = resolved.name;

          // Check for script block start: < { or > { (can have content after)
          const scriptStartMatch = trimmedText.match(/^([<>])\s*\{/);
          if (scriptStartMatch && !inScript) {
            inScript = true;
            const markerIndex = text.indexOf(scriptStartMatch[1]);
            decorations.push({ from: line.from + markerIndex, to: line.from + markerIndex + 1, cls: 'cm-script-marker' });
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

          // Check for standalone < or > (brace on next line)
          if (!inScript && (trimmedText === '<' || trimmedText === '>')) {
            const markerIndex = text.indexOf(trimmedText);
            decorations.push({ from: line.from + markerIndex, to: line.from + markerIndex + 1, cls: 'cm-script-marker' });
            continue;
          }

          // Check for standalone opening brace after < or >
          if (!inScript && trimmedText.startsWith('{')) {
            const prevLine = i > 1 ? view.state.doc.line(i - 1).text.trim() : '';
            if (prevLine === '<' || prevLine === '>') {
              inScript = true;
              scriptBraceDepth = 0;
              for (const char of text) {
                if (char === '{') scriptBraceDepth++;
                if (char === '}') scriptBraceDepth--;
              }
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

          // Inside a script block
          if (inScript) {
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

          const nonScript = getNonScriptLineDecorations({
            lineFrom: line.from,
            text,
            leadingWhitespace,
            lineNodeName,
            nodeText: view.state.doc.sliceString(resolved.from, resolved.to)
          });
          decorations.push(...nonScript.decorations);
          lineDecorations.push(...nonScript.lineDecorations);
        }

        // Sort by position (required by RangeSetBuilder)
        decorations.sort((a, b) => a.from - b.from || a.to - b.to);

        // Build the final decoration set (must be added in ascending doc order)
        const entries: Array<{ from: number; to: number; deco: Decoration }> = [];
        for (const d of decorations) {
          entries.push({ from: d.from, to: d.to, deco: Decoration.mark({ class: d.cls }) });
        }
        for (const d of lineDecorations) {
          entries.push({ from: d.at, to: d.at, deco: Decoration.line({ class: d.cls }) });
        }
        entries.sort((a, b) => a.from - b.from || a.to - b.to);

        const builder = new RangeSetBuilder<Decoration>();
        for (const e of entries) {
          builder.add(e.from, e.to, e.deco);
        }
        return builder.finish();
      }

    }, {
      decorations: v => v.decorations
    });
  }

  private createAutocomplete() {
    return createAutocompleteExtension({
      getVariables: () => this.variables(),
      getEnvironments: () => this.environments(),
      getCurrentEnv: () => this.currentEnv(),
      getSecrets: () => this.secrets() || {},
      getRequestNames: () => this.requestNames()
    });
  }

  updateContent(content: string) {
    if (this.editorView) {
      // Preserve scroll position when updating content
      const scrollPos = this.editorView.scrollDOM.scrollTop;
      this.editorView.dispatch({
        changes: { from: 0, to: this.editorView.state.doc.length, insert: content }
      });
      // Restore scroll position after content update
      requestAnimationFrame(() => {
        if (this.editorView) {
          this.editorView.scrollDOM.scrollTop = scrollPos;
        }
      });
    }
  }

  /**
   * Get the current cursor position in the editor
   */
  getCursorPosition(): number {
    if (!this.editorView) return 0;
    return this.editorView.state.selection.main.head;
  }

  /**
   * Insert text at the current cursor position
   */
  insertAtCursor(text: string): void {
    if (!this.editorView) return;
    
    const pos = this.getCursorPosition();
    this.editorView.dispatch({
      changes: { from: pos, insert: text },
      selection: { anchor: pos + text.length }
    });
    this.editorView.focus();
  }

  /**
   * Insert text at a specific position
   */
  insertAt(position: number, text: string): void {
    if (!this.editorView) return;
    
    const safePos = Math.min(Math.max(0, position), this.editorView.state.doc.length);
    this.editorView.dispatch({
      changes: { from: safePos, insert: text },
      selection: { anchor: safePos + text.length }
    });
    this.editorView.focus();
  }

  private updateExecutingIndicator(activeIndex: number | null, disableAll: boolean) {
    if (!this.editorContainer?.nativeElement) {
      return;
    }
    const buttons = this.editorContainer.nativeElement.querySelectorAll('.gutter-play-btn') as NodeListOf<HTMLButtonElement>;
    buttons.forEach((btn: HTMLButtonElement) => {
      const idxAttr = btn.dataset['requestIndex'];
      if (typeof idxAttr === 'undefined') {
        return;
      }
      const idx = parseInt(idxAttr, 10);
      const isActive = activeIndex !== null && idx === activeIndex;
      btn.classList.toggle('loading', isActive);
      btn.disabled = disableAll;
    });
  }

  private createVariableHoverTooltip() {
    return createVariableHoverTooltipExtension({
      getVariables: () => this.variables(),
      getEnvironments: () => this.environments(),
      getCurrentEnv: () => this.currentEnv(),
      getSecrets: () => this.secrets() || {},
      getRequests: () => this.requests(),
      getRequestIndexAtPos: (state, pos) => this.getRequestIndexAtPos(state, pos)
    });
  }

  private createRequestFolding() {
    return foldService.of((state, lineStart, _lineEnd) => {
      // Prefer folding based on the Lezer syntax tree when available.
      // This lets us fold an entire request block starting from its method line.
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

	  // Guard: only treat strict "### <non-empty>" as a separator.
	  // This prevents folding on lines like "####" or "######".
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
          if (end <= start) {
            return null;
          }
          return { from: start, to: end };
        }
      }
      if (start >= state.doc.length) return null;
      return { from: start, to: state.doc.length };
    });
  }

  private createRequestBlockIndexer() {
    const rebuild = (state: EditorState) => {
      this.requestBlockIndex = this.computeRequestBlockIndexFromTree(state);
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

  private computeRequestBlockIndexFromTree(state: EditorState): Array<{ from: number; to: number; index: number }> {
    const tree = syntaxTree(state);
    const blocks: Array<{ from: number; to: number; index: number }> = [];

    let index = 0;
    const cursor = tree.cursor();
    do {
      if (cursor.name !== 'RequestBlock') continue;
      blocks.push({ from: cursor.from, to: cursor.to, index });
      index++;
    } while (cursor.next());

    return blocks;
  }

  private createLintExtensions() {
    return createEditorLintExtensions({
      getRequests: () => this.requests() || [],
      getVariables: () => this.variables() || {},
      getEnvironments: () => this.environments() || {},
      getCurrentEnv: () => this.currentEnv() || '',
      getSecrets: () => this.secrets() || {},
      getRequestIndexAtPos: (state, pos) => this.getRequestIndexAtPos(state, pos)
    });
  }

  private getRequestIndexAtPos(state: EditorState, pos: number): number | null {
    // Fast path: if Lezer parsed this position into a RequestBlock, use the cached range index.
    if (this.requestBlockIndex.length) {
      let lo = 0;
      let hi = this.requestBlockIndex.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const block = this.requestBlockIndex[mid];
        if (pos < block.from) {
          hi = mid - 1;
        } else if (pos > block.to) {
          lo = mid + 1;
        } else {
          return block.index;
        }
      }
    }

    // Fallback: compute request index by counting method lines up to `pos`.
    // This is slower (O(lines)) but robust when Lezer doesn't produce RequestBlock ranges
    // (e.g., when top-level annotations confuse the parser).
    let idx = -1;
    for (let lineNo = 1; lineNo <= state.doc.lines; lineNo++) {
      const line = state.doc.line(lineNo);
      if (isMethodLine(line.text)) {
        idx++;
      }
      if (pos <= line.to) {
        break;
      }
    }

    if (idx < 0) return null;
    if (idx >= this.requests().length) return null;
    return idx;
  }
}