import { Component, ChangeDetectionStrategy, ElementRef, ViewChild, AfterViewInit, input, output, OnDestroy, effect, inject } from '@angular/core';

import { basicSetup, EditorView } from 'codemirror';
import { EditorState, RangeSetBuilder, Compartment, Prec } from '@codemirror/state';
import { Decoration, DecorationSet, ViewPlugin, ViewUpdate, keymap } from '@codemirror/view';
import { oneDark } from '@codemirror/theme-one-dark';
import { foldKeymap, foldService, syntaxTree, LRLanguage, LanguageSupport } from '@codemirror/language';
import {
  SearchQuery,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  closeSearchPanel,
  replaceAll,
  replaceNext,
  search,
  selectMatches,
  setSearchQuery
} from '@codemirror/search';
import { EditorSearchService } from './editor-search.service';
import { EditorSearchPanelComponent } from './editor-search-panel/editor-search-panel.component';

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
import {
  computeRequestBlockIndex,
  findRequestIndexByPos,
  computeRequestIndexAtPosFallback,
  RequestBlock
} from './editor-request-indexer.logic';
import { writeClipboardText, readClipboardText } from './editor-clipboard.utils';

import type { SecretIndex } from '../../services/secret.service';
import { ThemeService } from '../../services/theme.service';
import {
  extractDependsTarget,
  extractMethodFromLine,
  isMethodLine,
  isSeparatorLine
} from '../../utils/http-file-analysis';

const rawRequestHttpLanguage = LRLanguage.define({ parser: rawRequestHttpParser });
const rawRequestHttpSupport = new LanguageSupport(rawRequestHttpLanguage);

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [EditorSearchPanelComponent],
  templateUrl: './editor.component.html',
  styleUrls: ['./editor.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EditorSearchService]
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
  private readOnlyCompartment = new Compartment();
  private themeCompartment = new Compartment();
  private readonly themeService = inject(ThemeService);
  private readonly searchService = inject(EditorSearchService);

  private requestBlockIndex: RequestBlock[] = [];

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
      // Make editor read-only while a request is running
      if (this.editorView) {
        this.editorView.dispatch({
          effects: this.readOnlyCompartment.reconfigure(EditorState.readOnly.of(disableAll))
        });
      }
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

    effect(() => {
      const theme = this.themeService.resolvedTheme();
      if (this.editorView) {
        this.editorView.dispatch({
          effects: this.themeCompartment.reconfigure(this.buildEditorThemeExtension(theme))
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
      await writeClipboardText(text);
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
    await writeClipboardText(text);
    this.editorView.dispatch({
      changes: { from, to, insert: '' },
      selection: { anchor: from }
    });
    this.closeEditorContextMenu();
  }

  async pasteFromClipboard(): Promise<void> {
    if (!this.editorView) return;
    const text = await readClipboardText();
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
        this.themeCompartment.of(this.buildEditorThemeExtension(this.themeService.resolvedTheme())),
        rawRequestHttpSupport,
        this.createRequestBlockIndexer(),
        this.createRequestFolding(),
        search({ top: true }),
        this.createRequestHighlighter(),
        this.createDependsLinker(),
        this.autocompleteCompartment.of(this.createAutocomplete()),
        this.createVariableHoverTooltip(),
        this.lintCompartment.of(this.createLintExtensions()),
        this.readOnlyCompartment.of(EditorState.readOnly.of(this.isBusy())),
        Prec.highest(
          keymap.of([
            {
              key: 'Mod-f',
              run: () => {
                this.openSearchUi(false);
                return true;
              }
            },
            {
              key: 'Mod-h',
              run: () => {
                this.openSearchUi(true);
                return true;
              }
            },
            {
              key: 'Escape',
              run: () => {
                if (this.searchService.searchUi().open) {
                  this.searchService.closeSearchUi();
                  return true;
                }
                return false;
              }
            },
            {
              key: 'F3',
              run: () => {
                if (!this.searchService.searchUi().open) this.openSearchUi(false);
                this.searchService.searchNext();
                return true;
              }
            },
            {
              key: 'Shift-F3',
              run: () => {
                if (!this.searchService.searchUi().open) this.openSearchUi(false);
                this.searchService.searchPrev();
                return true;
              }
            }
          ])
        ),
        createEditorKeymap({
          getRequestIndexAtPos: (state, pos) => this.getRequestIndexAtPos(state, pos),
          onExecuteRequest: (index) => this.requestExecute.emit(index)
        }),
        createRequestGutter(
          (index) => this.requestExecute.emit(index),
          () => this.requestBlockIndex
        ),
        
        EditorView.domEventHandlers({
          mousedown: (event, view) => {
            // Guard against scroll jumps when focus returns to the editor.
            // This handler fires BEFORE CM6's focusPreventScroll, so
            // scrollTop is still the correct user-intended position.
            // After CM6 processes focus + selection, we check via rAF whether
            // scroll jumped (e.g. WebKit async scroll-to-caret) and revert.
            if (!view.hasFocus) {
              const scrollBefore = view.scrollDOM.scrollTop;
              requestAnimationFrame(() => {
                if (!this.editorView) return;
                const scrollAfter = this.editorView.scrollDOM.scrollTop;
                const viewportH = this.editorView.scrollDOM.clientHeight;
                if (Math.abs(scrollAfter - scrollBefore) > viewportH / 2) {
                  this.editorView.scrollDOM.scrollTop = scrollBefore;
                }
              });
            }

            if (this.editorContextMenu.show) {
              this.closeEditorContextMenu();
            }
            // Click-to-jump for @depends targets (requires Ctrl/Cmd)
            if (event.button === 0 && !event.shiftKey && (event.ctrlKey || event.metaKey) && !event.altKey) {
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
                      view.dom.closest('.editor-wrapper')?.classList.remove('cm-ctrl-held');
                      event.preventDefault();
                      event.stopPropagation();
                      return true;
                    }
                  }
                }
              }
            }

            // Skip accidental-selection prevention for double/triple clicks
            // (event.detail >= 2) so word/line selection works naturally.
            if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && event.detail < 2) {
              const scrollTop = view.scrollDOM.scrollTop;
              const hadSelection = !view.state.selection.main.empty;
              const downX = event.clientX;
              const downY = event.clientY;
              // Capture the document position the user actually clicked on
              const clickedPos = view.posAtCoords({ x: event.clientX, y: event.clientY });
              
              // Track whether the user dragged (intentional selection)
              const onMouseUp = (upEvent: MouseEvent) => {
                document.removeEventListener('mouseup', onMouseUp, true);
                const dx = Math.abs(upEvent.clientX - downX);
                const dy = Math.abs(upEvent.clientY - downY);
                const wasDrag = dx > 4 || dy > 4;

                // Use setTimeout to check after CodeMirror processes the click
                setTimeout(() => {
                  const selection = view.state.selection.main;
                  
                  // If a selection was created but there wasn't one before,
                  // and user didn't drag, collapse it (accidental scroll+click selection)
                  if (!wasDrag && !hadSelection && !selection.empty) {
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
                      // Use the captured click position so cursor goes where the
                      // user actually clicked, not selection.to which may be the
                      // old cursor position if the user scrolled upward.
                      const targetPos = clickedPos ?? selection.head;
                      view.dispatch({
                        selection: { anchor: targetPos },
                        scrollIntoView: false
                      });
                    }
                  }
                }, 0);
              };
              document.addEventListener('mouseup', onMouseUp, true);
            }
            return false; // Don't prevent default handling
          },

          keydown: (event, view) => {
            if (event.key === 'Control' || event.key === 'Meta') {
              view.dom.closest('.editor-wrapper')?.classList.add('cm-ctrl-held');
            }
            return false;
          },
          keyup: (event, view) => {
            if (event.key === 'Control' || event.key === 'Meta') {
              view.dom.closest('.editor-wrapper')?.classList.remove('cm-ctrl-held');
            }
            return false;
          },
          blur: (event, view) => {
            view.dom.closest('.editor-wrapper')?.classList.remove('cm-ctrl-held');
            return false;
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

    this.searchService.init(this.editorView, this.wrapperContainer.nativeElement);
  }

  openSearchUi(showReplace: boolean) {
    this.searchService.openSearchUi(showReplace);
  }

  private buildEditorThemeExtension(theme: 'dark' | 'light') {
    if (theme === 'dark') {
      return oneDark;
    }

    // Lightweight light theme that matches the app’s light surface palette.
    // (We avoid adding a new dependency for a themed package.)
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
        let inRequestBlock = false;

        const tree = syntaxTree(view.state);

        // Determine viewport range with margin
        const { from: vpFrom, to: vpTo } = view.viewport;
        const vpStartLine = view.state.doc.lineAt(vpFrom).number;
        const vpEndLine = view.state.doc.lineAt(vpTo).number;
        const margin = 20;
        const startLine = Math.max(1, vpStartLine - margin);
        const endLine = Math.min(view.state.doc.lines, vpEndLine + margin);

        // Quick scan lines before viewport to establish inScript/inRequestBlock state
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

        // Decorate only lines in the viewport range (with margin)

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

          // Check for script block start: < { or > { (can have content after)
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

          // Check for standalone < or > (brace on next line)
          if (!inScript && (trimmedText === '<' || trimmedText === '>')) {
            const markerIndex = text.indexOf(trimmedText);
            decorations.push({ from: line.from + markerIndex, to: line.from + markerIndex + 1, cls: 'cm-script-marker' });
            lineDecorations.push({ at: line.from, cls: 'cm-script-line' });
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

          // Inside a script block
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

          // Look ahead for the next request method when on a separator line
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
      getRequests: () => this.requests(),
      getRequestNames: () => this.requestNames()
    });
  }

  updateContent(content: string) {
    if (this.editorView) {
      const scrollPos = this.editorView.scrollDOM.scrollTop;
      // Clamp cursor to new content length so the native caret doesn't
      // silently drift to end-of-document after a full replacement.
      const cursor = Math.min(this.editorView.state.selection.main.head, content.length);
      this.editorView.dispatch({
        changes: { from: 0, to: this.editorView.state.doc.length, insert: content },
        selection: { anchor: cursor }
      });
      // Restore scroll synchronously to avoid racing with CM6's own
      // requestAnimationFrame-based measure cycle.
      this.editorView.scrollDOM.scrollTop = scrollPos;
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
   * Scroll to a request by its index (0-based).
   */
  scrollToRequestIndex(requestIndex: number): void {
    if (!this.editorView) return;
    const block = this.requestBlockIndex.find(b => b.index === requestIndex);
    if (block) {
      this.editorView.dispatch({
        selection: { anchor: block.from },
        effects: EditorView.scrollIntoView(block.from, { y: 'start' })
      });
      this.editorView.focus();
    }
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

  private computeRequestBlockIndexFromTree(state: EditorState): RequestBlock[] {
    return computeRequestBlockIndex(state.doc);
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
    const fastResult = findRequestIndexByPos(this.requestBlockIndex, pos);
    if (fastResult !== null) return fastResult;

    // Fallback: compute request index by counting method lines up to `pos`.
    // This is slower (O(lines)) but robust when Lezer doesn't produce RequestBlock ranges
    // (e.g., when top-level annotations confuse the parser).
    return computeRequestIndexAtPosFallback(state.doc, pos, this.requests().length);
  }
}
