import { Component, ElementRef, ViewChild, AfterViewInit, input, output, OnDestroy, effect } from '@angular/core';

import { basicSetup, EditorView } from 'codemirror';
import { EditorState, RangeSetBuilder, Compartment, StateField, StateEffect } from '@codemirror/state';
import { Decoration, DecorationSet, ViewPlugin, ViewUpdate, GutterMarker, gutter, BlockInfo, keymap, hoverTooltip, Tooltip } from '@codemirror/view';
import { oneDark } from '@codemirror/theme-one-dark';
import { autocompletion, CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';

const METHOD_REGEX = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|TRACE|CONNECT)\s+/i;
const DEPENDS_REGEX = /^@depends\s+/i;
const LOAD_REGEX = /^@load\s+/i;
const TIMEOUT_REGEX = /^@timeout\s+/i;
const ANNOTATION_REGEX = /^@(name|depends|load|timeout)\s+/i;
const SERPARATOR_REGEX = /^\s*###\s+/;

// Script block markers
const SCRIPT_START_REGEX = /^\s*[<>]\s*\{?\s*$/;
const SCRIPT_END_REGEX = /^\s*\}\s*$/;

// JavaScript syntax patterns for script highlighting
const JS_KEYWORDS = /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|new|typeof|instanceof|in|of|async|await|class|extends|import|export|default|from|yield)\b/g;
const JS_BUILTINS = /\b(console|Math|Date|JSON|Object|Array|String|Number|Boolean|Promise|Error|RegExp|Map|Set|setTimeout|setInterval|crypto)\b/g;
const JS_SCRIPT_HELPERS = /\b(setVar|getVar|setHeader|updateRequest|assert|delay|response|request)\b/g;
const JS_STRINGS = /'[^']*'|"[^"]*"|`[^`]*`/g;
const JS_NUMBERS = /\b\d+\.?\d*\b/g;
const JS_COMMENTS = /\/\/.*$|\/\*[\s\S]*?\*\//gm;
const JS_PROPERTIES = /\.([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
const JS_FUNCTIONS = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;

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
  currentEnv = input<string>('');
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
        this.createVariableHoverTooltip(),
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
        // Prevent scroll jumping and unwanted selection caused by stale cursor state
        EditorView.domEventHandlers({
          mousedown: (event, view) => {
            // Only intervene if this is a plain click (no modifier keys)
            // Modifier keys indicate intentional selection behavior
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
                  if (Math.abs(toLine - fromLine) > 2) {
                    // Collapse selection to the click point (selection.to is where user clicked)
                    view.dispatch({
                      selection: { anchor: selection.to }
                    });
                  }
                }
              }, 0);
            }
            return false; // Don't prevent default handling
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
        let inScript = false;
        let scriptBraceDepth = 0;

        for (let i = 1; i <= view.state.doc.lines; i++) {
          const line = view.state.doc.line(i);
          const text = line.text;
          const trimmedText = text.trimStart();
          const leadingWhitespace = text.length - trimmedText.length;

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
              this.collectJSDecorations(decorations, line.from, text, braceIndex + 1);
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
                this.collectJSDecorations(decorations, line.from, text, braceIndex + 1);
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
                this.collectJSDecorations(decorations, line.from, text, 0, closingBraceIdx);
              }
            } else {
              this.collectJSDecorations(decorations, line.from, text, 0);
            }
            continue;
          }

          // Highlight HTTP methods
          const methodMatch = trimmedText.match(METHOD_REGEX);
          if (methodMatch) {
            decorations.push({
              from: line.from + leadingWhitespace,
              to: line.from + leadingWhitespace + methodMatch[1].length,
              cls: 'cm-http-method'
            });
          }

          // Highlight headers
          const headerMatch = text.match(/^([^:]+):\s*(.+)$/);
          if (headerMatch && !methodMatch && !trimmedText.startsWith('@')) {
            decorations.push({
              from: line.from,
              to: line.from + headerMatch[1].length,
              cls: 'cm-http-header'
            });
          }

          // Highlight variables
          const varRegex = /{{[^}]+}}/g;
          let varMatch;
          while ((varMatch = varRegex.exec(text)) !== null) {
            decorations.push({
              from: line.from + varMatch.index,
              to: line.from + varMatch.index + varMatch[0].length,
              cls: 'cm-variable'
            });
          }

          // Highlight environment variables
          const envRegex = /@env\.[^=\s]+/g;
          let envMatch;
          while ((envMatch = envRegex.exec(text)) !== null) {
            decorations.push({
              from: line.from + envMatch.index,
              to: line.from + envMatch.index + envMatch[0].length,
              cls: 'cm-environment'
            });
          }

          // Highlight @name, @depends, @load annotations
          const annotationMatch = trimmedText.match(ANNOTATION_REGEX);
          if (annotationMatch) {
            decorations.push({
              from: line.from + leadingWhitespace,
              to: line.from + leadingWhitespace + annotationMatch[0].length,
              cls: 'cm-annotation'
            });
          }

          // Highlight separators
          if (SERPARATOR_REGEX.test(trimmedText)) {
            decorations.push({
              from: line.from,
              to: line.to,
              cls: 'cm-separator'
            });
          }
        }

        // Sort by position (required by RangeSetBuilder)
        decorations.sort((a, b) => a.from - b.from || a.to - b.to);

        // Build the final decoration set
        const builder = new RangeSetBuilder<Decoration>();
        for (const d of decorations) {
          builder.add(d.from, d.to, Decoration.mark({ class: d.cls }));
        }
        return builder.finish();
      }

      collectJSDecorations(decorations: Array<{ from: number; to: number; cls: string }>, lineFrom: number, text: string, startOffset: number, endOffset?: number) {
        const segment = endOffset !== undefined ? text.substring(startOffset, endOffset) : text.substring(startOffset);
        if (!segment.trim()) return;

        const highlighted: Array<[number, number]> = [];
        const add = (start: number, end: number, cls: string) => {
          const absStart = startOffset + start;
          const absEnd = startOffset + end;
          for (const [hs, he] of highlighted) {
            if ((absStart >= hs && absStart < he) || (absEnd > hs && absEnd <= he)) return;
          }
          highlighted.push([absStart, absEnd]);
          decorations.push({ from: lineFrom + absStart, to: lineFrom + absEnd, cls });
        };

        let m;
        const commentRx = /\/\/.*$|\/\*[\s\S]*?\*\//g;
        while ((m = commentRx.exec(segment)) !== null) add(m.index, m.index + m[0].length, 'cm-js-comment');

        const stringRx = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
        while ((m = stringRx.exec(segment)) !== null) add(m.index, m.index + m[0].length, 'cm-js-string');

        const helperRx = /\b(setVar|getVar|setHeader|updateRequest|assert|delay|response|request)\b/g;
        while ((m = helperRx.exec(segment)) !== null) add(m.index, m.index + m[0].length, 'cm-js-helper');

        const kwRx = /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|new|typeof|instanceof|in|of|async|await|class|extends|import|export|default|from|yield)\b/g;
        while ((m = kwRx.exec(segment)) !== null) add(m.index, m.index + m[0].length, 'cm-js-keyword');

        const builtinRx = /\b(console|Math|Date|JSON|Object|Array|String|Number|Boolean|Promise|Error|RegExp|Map|Set|setTimeout|setInterval|crypto|true|false|null|undefined)\b/g;
        while ((m = builtinRx.exec(segment)) !== null) add(m.index, m.index + m[0].length, 'cm-js-builtin');

        const numRx = /\b\d+\.?\d*\b/g;
        while ((m = numRx.exec(segment)) !== null) add(m.index, m.index + m[0].length, 'cm-js-number');

        const funcRx = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
        while ((m = funcRx.exec(segment)) !== null) {
          if (!['if', 'for', 'while', 'switch', 'catch', 'function'].includes(m[1])) {
            add(m.index, m.index + m[1].length, 'cm-js-function');
          }
        }
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
    const getVariables = () => this.variables();
    const getEnvironments = () => this.environments();
    const getCurrentEnv = () => this.currentEnv();
    
    return hoverTooltip((view, pos) => {
      const line = view.state.doc.lineAt(pos);
      const lineText = line.text;
      
      // Find {{variable}} pattern at the hover position
      const varRegex = /\{\{([^}]+)\}\}/g;
      let match;
      
      while ((match = varRegex.exec(lineText)) !== null) {
        const start = line.from + match.index;
        const end = start + match[0].length;
        
        // Check if cursor is within this match
        if (pos >= start && pos <= end) {
          const varName = match[1].trim();
          const vars = getVariables();
          const envs = getEnvironments();
          const currentEnvName = getCurrentEnv();
          const currentEnvVars = currentEnvName ? envs[currentEnvName] || {} : {};
          
          // Check if it's a regular variable
          if (vars[varName] !== undefined) {
            return {
              pos: start,
              end: end,
              above: true,
              create() {
                const dom = document.createElement('div');
                dom.className = 'cm-variable-tooltip';
                const value = vars[varName];
                const displayValue = value.length > 100 ? value.slice(0, 100) + '...' : value;
                dom.innerHTML = `
                  <div class="tooltip-header">📦 Variable</div>
                  <div class="tooltip-name">${varName}</div>
                  <div class="tooltip-value">${escapeHtml(displayValue)}</div>
                `;
                return { dom };
              }
            };
          }
          
          // Check if it's defined in the current environment
          if (currentEnvVars[varName] !== undefined) {
            const value = currentEnvVars[varName];
            const displayValue = value.length > 100 ? value.slice(0, 100) + '...' : value;
            return {
              pos: start,
              end: end,
              above: true,
              create() {
                const dom = document.createElement('div');
                dom.className = 'cm-variable-tooltip';
                dom.innerHTML = `
                  <div class="tooltip-header">🌍 Environment Variable</div>
                  <div class="tooltip-name">${currentEnvName} → ${varName}</div>
                  <div class="tooltip-value">${escapeHtml(displayValue)}</div>
                `;
                return { dom };
              }
            };
          }
          
          // Check if it's an env.name.key pattern
          const envMatch = varName.match(/^env\.([^.]+)\.(.+)$/);
          if (envMatch) {
            const [, envName, key] = envMatch;
            if (envs[envName]?.[key] !== undefined) {
              return {
                pos: start,
                end: end,
                above: true,
                create() {
                  const dom = document.createElement('div');
                  dom.className = 'cm-variable-tooltip';
                  const value = envs[envName][key];
                  const displayValue = value.length > 100 ? value.slice(0, 100) + '...' : value;
                  dom.innerHTML = `
                    <div class="tooltip-header">🌍 Environment Variable</div>
                    <div class="tooltip-name">${envName} → ${key}</div>
                    <div class="tooltip-value">${escapeHtml(displayValue)}</div>
                  `;
                  return { dom };
                }
              };
            }
          }
          
          // Check if it's a request reference
          const reqMatch = varName.match(/^(request\d+)\.(response\.(body|status|headers).*)/);
          if (reqMatch) {
            return {
              pos: start,
              end: end,
              above: true,
              create() {
                const dom = document.createElement('div');
                dom.className = 'cm-variable-tooltip';
                dom.innerHTML = `
                  <div class="tooltip-header">🔗 Request Reference</div>
                  <div class="tooltip-name">${reqMatch[1]}.${reqMatch[2]}</div>
                  <div class="tooltip-hint">Value resolved at runtime from previous request</div>
                `;
                return { dom };
              }
            };
          }
          
          // Unknown variable
          return {
            pos: start,
            end: end,
            above: true,
            create() {
              const dom = document.createElement('div');
              dom.className = 'cm-variable-tooltip cm-variable-undefined';
              dom.innerHTML = `
                <div class="tooltip-header">⚠️ Undefined Variable</div>
                <div class="tooltip-name">${escapeHtml(varName)}</div>
                <div class="tooltip-hint">This variable is not defined</div>
              `;
              return { dom };
            }
          };
        }
      }
      
      return null;
    }, { hoverTime: 300 });
  }
}

// Helper function to escape HTML
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}