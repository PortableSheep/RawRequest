import { Component, ChangeDetectionStrategy, ElementRef, ViewChild, AfterViewInit, input, output, OnDestroy, effect, inject } from '@angular/core';

import { basicSetup, EditorView } from 'codemirror';
import { EditorState, Compartment, Prec } from '@codemirror/state';
import { keymap, tooltips } from '@codemirror/view';
import { LanguageSupport, LRLanguage } from '@codemirror/language';
import {
  search,
} from '@codemirror/search';
import { EditorSearchService } from './editor-search.service';
import { EditorSearchPanelComponent } from './editor-search-panel/editor-search-panel.component';

import { createEditorKeymap } from './editor-keymap';
import { createRequestGutter } from './editor-request-gutter';
import { createAutocompleteExtension } from './editor.autocomplete';
import { createCodeLensesExtension } from './editor.lenses';
import { createEditorLintExtensions } from './editor.lint';
import { parser as rawRequestHttpParser } from './rawrequest-http-parser';
import { createVariableHoverTooltipExtension } from './editor.tooltips';
import { WorkspaceStateService } from '../../services/workspace-state.service';
import {
  computeContextMenuLocalPosition,
  shouldCollapseAccidentalSelection
} from './editor.component.logic';
import {
  computeRequestIndexAtPosFallback,
  findRequestIndexByPos,
  RequestBlock
} from './editor-request-indexer.logic';
import { writeClipboardText, readClipboardText } from './editor-clipboard.utils';
import {
  buildEditorThemeExtension,
  createDependsLinker,
  createRequestBlockIndexer,
  createRequestFolding,
  createRequestHighlighter,
  jumpToRequestByName
} from './editor.extensions';

import type { SecretIndex } from '../../services/secret.service';
import { ThemeService } from '../../services/theme.service';
import {
  extractDependsTarget,
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
  private readonly ws = inject(WorkspaceStateService);

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
          effects: this.themeCompartment.reconfigure(buildEditorThemeExtension(theme))
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
        this.themeCompartment.of(buildEditorThemeExtension(this.themeService.resolvedTheme())),
        rawRequestHttpSupport,
        createRequestBlockIndexer((blocks) => { this.requestBlockIndex = blocks; }),
        createRequestFolding(),
        search({ top: true }),
        createRequestHighlighter(),
        createDependsLinker((name) => jumpToRequestByName(this.editorView, name)),
        createCodeLensesExtension((index) => this.requestExecute.emit(index)),
        this.autocompleteCompartment.of(this.createAutocomplete()),
        tooltips({ position: 'fixed' }),
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
                    const jumped = jumpToRequestByName(view, depends.target);
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
            if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && event.detail < 2) {
              const hadSelection = !view.state.selection.main.empty;
              const downX = event.clientX;
              const downY = event.clientY;
              const clickedPos = view.posAtCoords({ x: event.clientX, y: event.clientY });
              
              const onMouseUp = (upEvent: MouseEvent) => {
                document.removeEventListener('mouseup', onMouseUp, true);
                const dx = Math.abs(upEvent.clientX - downX);
                const dy = Math.abs(upEvent.clientY - downY);
                const wasDrag = dx > 4 || dy > 4;

                setTimeout(() => {
                  const selection = view.state.selection.main;
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
            return false;
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
      const cursor = Math.min(this.editorView.state.selection.main.head, content.length);
      this.editorView.dispatch({
        changes: { from: 0, to: this.editorView.state.doc.length, insert: content },
        selection: { anchor: cursor }
      });
      this.editorView.scrollDOM.scrollTop = scrollPos;
    }
  }

  getCursorPosition(): number {
    if (!this.editorView) return 0;
    return this.editorView.state.selection.main.head;
  }

  insertAtCursor(text: string): void {
    if (!this.editorView) return;
    
    const pos = this.getCursorPosition();
    this.editorView.dispatch({
      changes: { from: pos, insert: text },
      selection: { anchor: pos + text.length }
    });
    this.editorView.focus();
  }

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
      getResponseData: () => this.ws.currentFileView().responseData,
      getRequests: () => this.requests(),
      getRequestIndexAtPos: (state, pos) => this.getRequestIndexAtPos(state, pos)
    });
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
    const fastResult = findRequestIndexByPos(this.requestBlockIndex, pos);
    if (fastResult !== null) return fastResult;
    return computeRequestIndexAtPosFallback(state.doc, pos, this.requests().length);
  }
}
