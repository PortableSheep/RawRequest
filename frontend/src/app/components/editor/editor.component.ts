import { Component, ElementRef, ViewChild, AfterViewInit, input, output, OnDestroy, effect } from '@angular/core';

import { basicSetup, EditorView } from 'codemirror';
import { EditorState, RangeSetBuilder, Compartment } from '@codemirror/state';
import { Decoration, DecorationSet, ViewPlugin, ViewUpdate, GutterMarker, gutter, BlockInfo, keymap } from '@codemirror/view';
import { oneDark } from '@codemirror/theme-one-dark';
import { autocompletion, CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';

const METHOD_REGEX = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|TRACE|CONNECT)\s+/i;
const DEPENDS_REGEX = /^@depends\s+/i;
const LOAD_REGEX = /^@load\s+/i;
const TIMEOUT_REGEX = /^@timeout\s+/i;
const ANNOTATION_REGEX = /^@(name|depends|load|timeout)\s+/i;
const SERPARATOR_REGEX = /^\s*###\s+/;

// Common HTTP headers for autocomplete
const HTTP_HEADERS = [
  'Accept', 'Accept-Charset', 'Accept-Encoding', 'Accept-Language',
  'Authorization', 'Cache-Control', 'Content-Length', 'Content-Type',
  'Cookie', 'Host', 'If-Match', 'If-Modified-Since', 'If-None-Match',
  'Origin', 'Pragma', 'Referer', 'User-Agent', 'X-Requested-With',
  'X-API-Key', 'X-Auth-Token', 'X-Correlation-ID', 'X-Request-ID'
];

// Common Content-Type values
const CONTENT_TYPES = [
  'application/json',
  'application/xml',
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
  'text/html',
  'text/xml'
];

// HTTP methods
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

// Annotations
const ANNOTATIONS = ['@name', '@depends', '@load', '@timeout', '@env'];

class PlayGutterMarker extends GutterMarker {
  constructor(private onClick: (requestIndex: number) => void, private requestIndex: number) {
    super();
  }

  override toDOM() {
    const button = document.createElement('button');
    button.innerHTML = '▶';
    button.className = 'gutter-play-btn';
    button.dataset['requestIndex'] = this.requestIndex.toString();
    button.title = 'Send request';
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.onClick(this.requestIndex);
    };
    return button;
  }
}

class ChainGutterMarker extends GutterMarker {
  override toDOM() {
    const icon = document.createElement('span');
    icon.innerHTML = '🔗';
    icon.className = 'gutter-chain-icon';
    icon.title = 'Chained request';
    return icon;
  }
}

class LightningGutterMarker extends GutterMarker {
  override toDOM() {
    const icon = document.createElement('span');
    icon.innerHTML = '⚡️';
    icon.className = 'gutter-lightning-icon';
    icon.title = 'Load test';
    return icon;
  }
}

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [],
  templateUrl: './editor.component.html',
  styleUrls: ['./editor.component.scss']
})
export class EditorComponent implements AfterViewInit, OnDestroy {
  @ViewChild('editor', { static: true }) editorContainer!: ElementRef;

  content = input.required<string>();
  requests = input.required<any[]>();
  variables = input<{ [key: string]: string }>({});
  environments = input<{ [env: string]: { [key: string]: string } }>({});
  requestNames = input<string[]>([]);
  executingRequestIndex = input<number | null>(null);
  isBusy = input<boolean>(false);
  contentChange = output<string>();
  requestExecute = output<number>();

  private editorView!: EditorView;
  private isUpdatingFromInput = false;
  private autocompleteCompartment = new Compartment();

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

    // Update autocomplete when variables/environments change
    effect(() => {
      const vars = this.variables();
      const envs = this.environments();
      const names = this.requestNames();
      if (this.editorView) {
        this.editorView.dispatch({
          effects: this.autocompleteCompartment.reconfigure(this.createAutocomplete())
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

  private initializeEditor() {
    const state = EditorState.create({
      doc: this.content(),
      extensions: [
        basicSetup,
        oneDark,
        this.createRequestHighlighter(),
        this.autocompleteCompartment.of(this.createAutocomplete()),
        gutter({
          class: 'cm-gutter-play',
          lineMarker: (view: EditorView, line: BlockInfo) => {
            const lineNo = view.state.doc.lineAt(line.from).number;
            const lineContent = view.state.doc.line(lineNo).text;
            const trimmedLine = lineContent.trimStart();

            const isRequestLine = (value: string) => METHOD_REGEX.test(value.trimStart());

            // Show play button on lines that define a request
            if (isRequestLine(lineContent)) {
              let requestIndex = 0;
              for (let i = 1; i < lineNo; i++) {
                const prevLine = view.state.doc.line(i).text;
                if (isRequestLine(prevLine)) {
                  requestIndex++;
                }
              }
              return new PlayGutterMarker((index) => this.requestExecute.emit(index), requestIndex);
            }

            if (DEPENDS_REGEX.test(trimmedLine)) {
              return new ChainGutterMarker();
            }

            if (LOAD_REGEX.test(trimmedLine)) {
              return new LightningGutterMarker();
            }

            return null;
          },
          // Only recalculate gutter markers when the document actually changes
          lineMarkerChange: (update: ViewUpdate) => update.docChanged
        }),
        // Disable scroll-past-end to prevent scroll position issues
        EditorView.scrollMargins.of(() => ({ top: 0, bottom: 0 })),
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
        const builder = new RangeSetBuilder<Decoration>();

        for (let i = 1; i <= view.state.doc.lines; i++) {
          const line = view.state.doc.line(i);
          const text = line.text;
          const trimmedText = text.trimStart();
          const leadingWhitespace = text.length - trimmedText.length;

          // Highlight HTTP methods
          const methodMatch = trimmedText.match(METHOD_REGEX);
          if (methodMatch) {
            builder.add(
              line.from + leadingWhitespace,
              line.from + leadingWhitespace + methodMatch[1].length,
              Decoration.mark({ class: 'cm-http-method' })
            );
          }

          // Highlight headers
          const headerMatch = text.match(/^([^:]+):\s*(.+)$/);
          if (headerMatch && !methodMatch && !trimmedText.startsWith('@')) {
            builder.add(
              line.from,
              line.from + headerMatch[1].length,
              Decoration.mark({ class: 'cm-http-header' })
            );
          }

          // Highlight variables
          const varRegex = /{{[^}]+}}/g;
          let varMatch;
          while ((varMatch = varRegex.exec(text)) !== null) {
            builder.add(
              line.from + varMatch.index,
              line.from + varMatch.index + varMatch[0].length,
              Decoration.mark({ class: 'cm-variable' })
            );
          }

          // Highlight environment variables
          const envRegex = /@env\.[^=\s]+/g;
          let envMatch;
          while ((envMatch = envRegex.exec(text)) !== null) {
            builder.add(
              line.from + envMatch.index,
              line.from + envMatch.index + envMatch[0].length,
              Decoration.mark({ class: 'cm-environment' })
            );
          }

          // Highlight @name, @depends, @load annotations
          const annotationMatch = trimmedText.match(ANNOTATION_REGEX);
          if (annotationMatch) {
            builder.add(
              line.from + leadingWhitespace,
              line.from + leadingWhitespace + annotationMatch[0].length,
              Decoration.mark({ class: 'cm-annotation' })
            );
          }

          // Highlight separators
          if (SERPARATOR_REGEX.test(trimmedText)) {
            builder.add(
              line.from,
              line.to,
              Decoration.mark({ class: 'cm-separator' })
            );
          }
        }

        return builder.finish();
      }
    }, {
      decorations: v => v.decorations
    });
  }

  private createAutocomplete() {
    return autocompletion({
      override: [
        (context: CompletionContext): CompletionResult | null => {
          return this.httpCompletions(context);
        }
      ],
      activateOnTyping: true
    });
  }

  private httpCompletions(context: CompletionContext): CompletionResult | null {
    const line = context.state.doc.lineAt(context.pos);
    const lineText = line.text;
    const cursorPos = context.pos - line.from;
    const textBeforeCursor = lineText.slice(0, cursorPos);

    // Check for variable completion: {{
    const variableMatch = textBeforeCursor.match(/\{\{([^}]*)$/);
    if (variableMatch) {
      const prefix = variableMatch[1];
      const from = context.pos - prefix.length;
      const completions: Completion[] = [];

      // Add variables
      const vars = this.variables();
      for (const key of Object.keys(vars)) {
        completions.push({
          label: key,
          type: 'variable',
          detail: vars[key]?.slice(0, 30) || '',
          apply: `${key}}}`
        });
      }

      // Add environment variables
      const envs = this.environments();
      for (const envName of Object.keys(envs)) {
        for (const key of Object.keys(envs[envName])) {
          completions.push({
            label: `env.${envName}.${key}`,
            type: 'variable',
            detail: envs[envName][key]?.slice(0, 30) || '',
            apply: `env.${envName}.${key}}}`
          });
        }
      }

      // Add request references for chaining
      const requestNamesList = this.requestNames();
      for (let i = 0; i < requestNamesList.length; i++) {
        const reqName = requestNamesList[i] || `request${i + 1}`;
        completions.push({
          label: `request${i + 1}.response.body`,
          type: 'function',
          detail: reqName,
          apply: `request${i + 1}.response.body}}`
        });
        completions.push({
          label: `request${i + 1}.response.status`,
          type: 'function',
          detail: reqName,
          apply: `request${i + 1}.response.status}}`
        });
      }

      if (completions.length === 0) return null;
      return { from, options: completions, validFor: /^[a-zA-Z0-9_.]*$/ };
    }

    // Check for annotation completion at start of line: @
    if (textBeforeCursor.match(/^@[a-z]*$/i)) {
      const prefix = textBeforeCursor.slice(1);
      const from = context.pos - prefix.length - 1;
      return {
        from,
        options: ANNOTATIONS.map(a => ({
          label: a,
          type: 'keyword',
          detail: a === '@timeout' ? 'timeout in ms' : ''
        })),
        validFor: /^@?[a-z]*$/i
      };
    }

    // Check for HTTP method at start of line
    if (textBeforeCursor.match(/^[A-Z]*$/i) && cursorPos === textBeforeCursor.length) {
      const prefix = textBeforeCursor;
      const from = line.from;
      return {
        from,
        options: HTTP_METHODS.map(m => ({
          label: m,
          type: 'keyword',
          apply: `${m} `
        })),
        validFor: /^[A-Z]*$/i
      };
    }

    // Check for header name completion (line contains : but we're before it)
    const colonIndex = lineText.indexOf(':');
    if (colonIndex === -1 && !lineText.match(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|@|#)/i)) {
      // Could be typing a header name
      const prefix = textBeforeCursor.trim();
      if (prefix.length > 0) {
        const from = line.from + (lineText.length - lineText.trimStart().length);
        return {
          from,
          options: HTTP_HEADERS.map(h => ({
            label: h,
            type: 'property',
            apply: `${h}: `
          })),
          validFor: /^[A-Za-z-]*$/
        };
      }
    }

    // Check for Content-Type value completion
    if (textBeforeCursor.match(/Content-Type:\s*[a-z/]*$/i)) {
      const valueMatch = textBeforeCursor.match(/Content-Type:\s*([a-z/]*)$/i);
      if (valueMatch) {
        const prefix = valueMatch[1];
        const from = context.pos - prefix.length;
        return {
          from,
          options: CONTENT_TYPES.map(ct => ({
            label: ct,
            type: 'text'
          })),
          validFor: /^[a-z/-]*$/i
        };
      }
    }

    return null;
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
}