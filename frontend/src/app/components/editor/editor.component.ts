import { Component, ElementRef, ViewChild, AfterViewInit, input, output, OnDestroy, effect } from '@angular/core';

import { basicSetup, EditorView } from 'codemirror';
import { EditorState, RangeSetBuilder, Compartment } from '@codemirror/state';
import { Decoration, DecorationSet, ViewPlugin, ViewUpdate, hoverTooltip, Tooltip } from '@codemirror/view';
import { oneDark } from '@codemirror/theme-one-dark';
import { autocompletion, CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import { foldGutter, foldKeymap, foldService } from '@codemirror/language';
import { linter, lintGutter, Diagnostic } from '@codemirror/lint';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';

import { createEditorKeymap } from './editor-keymap';
import { createRequestGutter } from './editor-request-gutter';

import type { SecretIndex } from '../../services/secret.service';
import {
  isMethodLine,
  extractPlaceholders,
  extractDependsTarget,
  extractSetVarKeys,
  METHOD_LINE_REGEX,
  DEPENDS_LINE_REGEX,
  LOAD_LINE_REGEX,
  ANNOTATION_LINE_REGEX,
  SEPARATOR_PREFIX_REGEX,
  ENV_PLACEHOLDER_REGEX,
  REQUEST_REF_PLACEHOLDER_REGEX,
  SECRET_PLACEHOLDER_REGEX,
  isSeparatorLine
} from '../../utils/http-file-analysis';

// Common HTTP headers for autocomplete
const HTTP_HEADERS = [
  'Accept', 'Accept-Charset', 'Accept-Encoding', 'Accept-Language',
  'Authorization', 'Cache-Control', 'Content-Length', 'Content-Type',
  'Cookie', 'Host', 'If-Match', 'If-Modified-Since', 'If-None-Match',
  'Origin', 'Pragma', 'Referer', 'User-Agent', 'X-Requested-With',
  'X-API-Key', 'X-Auth-Token', 'X-Correlation-ID', 'X-Request-ID'
];

const CONTENT_TYPES = [
  'application/json',
  'application/xml',
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
  'text/html',
  'text/xml'
];

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
const ANNOTATIONS = ['@name', '@depends', '@load', '@timeout', '@env'];

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

  private initializeEditor() {
    const state = EditorState.create({
      doc: this.content(),
      extensions: [
        basicSetup,
        oneDark,
        foldGutter(),
        this.createRequestFolding(),
        highlightSelectionMatches(),
        this.createRequestHighlighter(),
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
          const methodMatch = trimmedText.match(METHOD_LINE_REGEX);
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
          for (const placeholder of extractPlaceholders(text)) {
            decorations.push({
              from: line.from + placeholder.start,
              to: line.from + placeholder.end,
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
          const annotationMatch = trimmedText.match(ANNOTATION_LINE_REGEX);
          if (annotationMatch) {
            decorations.push({
              from: line.from + leadingWhitespace,
              to: line.from + leadingWhitespace + annotationMatch[0].length,
              cls: 'cm-annotation'
            });
          }

          // Highlight separators
          if (SEPARATOR_PREFIX_REGEX.test(trimmedText)) {
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

    // Check for secret completion: {{secret:
    const secretMatch = textBeforeCursor.match(/\{\{\s*secret:([a-zA-Z0-9_\-\.]*)$/);
    if (secretMatch) {
      const prefix = secretMatch[1];
      const from = context.pos - prefix.length;
      const env = (this.currentEnv() || 'default').trim() || 'default';
      const snapshot = this.secrets() || {};
      const keys = new Set<string>([...(snapshot[env] || []), ...(snapshot['default'] || [])]);
      const options: Completion[] = Array.from(keys)
        .filter(k => k.toLowerCase().startsWith(prefix.toLowerCase()))
        .sort((a, b) => a.localeCompare(b))
        .map(k => ({
          label: k,
          type: 'variable',
          detail: `secret:${env}`,
          apply: `${k}}}`
        }));

      if (!options.length) return null;
      return { from, options, validFor: /^[a-zA-Z0-9_\-\.]*$/ };
    }

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
    const getSecrets = () => this.secrets();
    
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
          const secrets = getSecrets() || {};
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

          // Check if it's a secret reference (don't reveal value)
          const secretMatch = varName.match(/^secret:([a-zA-Z0-9_\-\.]+)$/);
          if (secretMatch) {
            const secretKey = secretMatch[1];
            const env = (currentEnvName || 'default').trim() || 'default';
            const keys = new Set<string>([...(secrets[env] || []), ...(secrets['default'] || [])]);
            const exists = keys.has(secretKey);
            return {
              pos: start,
              end: end,
              above: true,
              create() {
                const dom = document.createElement('div');
                dom.className = 'cm-variable-tooltip' + (exists ? '' : ' cm-variable-undefined');
                dom.innerHTML = `
                  <div class="tooltip-header">🔐 Secret</div>
                  <div class="tooltip-name">${escapeHtml(secretKey)}</div>
                  <div class="tooltip-hint">${exists ? 'Resolved at runtime from vault' : 'Missing secret in current environment'}</div>
                `;
                return { dom };
              }
            };
          }
          
          // Check if it's a request reference
          const reqMatch = varName.match(/^(request\d+)\.(response\.(body|status|headers|json|timing|size).*)/);
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

  private createRequestFolding() {
    return foldService.of((state, lineStart, _lineEnd) => {
      const line = state.doc.lineAt(lineStart);
      const text = line.text;
      if (!isSeparatorLine(text)) {
        return null;
      }

      const start = line.to;
      for (let lineNo = line.number + 1; lineNo <= state.doc.lines; lineNo++) {
        const next = state.doc.line(lineNo);
        if (isSeparatorLine(next.text)) {
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

  private createLintExtensions() {
    return [
      lintGutter(),
      linter((view) => this.computeDiagnostics(view), { delay: 250 })
    ];
  }

  private computeDiagnostics(view: EditorView): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const requests = this.requests() || [];

    const nameToIndex = new Map<string, number>();
    for (let i = 0; i < requests.length; i++) {
      const name = (requests[i]?.name || '').trim();
      if (name) nameToIndex.set(name, i);
    }

    const vars = this.variables() || {};
    const envs = this.environments() || {};
    const envName = (this.currentEnv() || 'default').trim() || 'default';
    const currentEnvVars = envName ? envs[envName] || {} : {};

    const secrets = this.secrets() || {};
    const secretKeys = new Set<string>([...(secrets[envName] || []), ...(secrets['default'] || [])]);

    const setVarsByRequest: Array<Set<string>> = requests.map((r: any) => {
      const keys = new Set<string>();
      for (const k of extractSetVarKeys(String(r?.preScript || ''))) keys.add(k);
      for (const k of extractSetVarKeys(String(r?.postScript || ''))) keys.add(k);
      return keys;
    });

    // Associate @depends lines to the next request method line so we can underline exactly the target token.
    const dependsTokenByRequestIndex: Array<{ target: string; from: number; to: number } | null> = [];
    let pendingDepends: { target: string; from: number; to: number } | null = null;
    let requestIndexForLine = -1;

    for (let lineNo = 1; lineNo <= view.state.doc.lines; lineNo++) {
      const line = view.state.doc.line(lineNo);
      const text = line.text;

      const depends = extractDependsTarget(text);
      if (depends) {
        pendingDepends = {
          target: depends.target,
          from: line.from + depends.start,
          to: line.from + depends.end
        };
      }

      if (isMethodLine(text)) {
        requestIndexForLine++;
        if (pendingDepends) {
          dependsTokenByRequestIndex[requestIndexForLine] = pendingDepends;
          pendingDepends = null;
        }
      }
    }

    // Build dependency graph using parsed requests, and emit errors for unknown targets/cycles.
    const dependsIndex: Array<number | null> = requests.map((r: any) => {
      const dependsName = (r?.depends || '').trim();
      if (!dependsName) return null;
      return nameToIndex.get(dependsName) ?? null;
    });

    for (let i = 0; i < requests.length; i++) {
      const dependsName = (requests[i]?.depends || '').trim();
      if (!dependsName) continue;
      if (nameToIndex.has(dependsName)) continue;

      const token = dependsTokenByRequestIndex[i];
      const from = token?.from ?? 0;
      const to = token?.to ?? 0;
      if (from && to && to > from) {
        diagnostics.push({
          from,
          to,
          severity: 'error',
          message: `Unknown @depends target "${dependsName}"`
        });
      }
    }

    // Cycle detection
    const visiting = new Set<number>();
    const visited = new Set<number>();
    const dfs = (node: number): boolean => {
      if (visited.has(node)) return false;
      if (visiting.has(node)) return true;
      visiting.add(node);
      const next = dependsIndex[node];
      if (next !== null && next !== undefined) {
        if (dfs(next)) {
          // Mark cycle error on this node's @depends token if present
          const token = dependsTokenByRequestIndex[node];
          if (token && token.to > token.from) {
            diagnostics.push({
              from: token.from,
              to: token.to,
              severity: 'error',
              message: 'Cyclic @depends chain'
            });
          }
          visiting.delete(node);
          visited.add(node);
          return true;
        }
      }
      visiting.delete(node);
      visited.add(node);
      return false;
    };
    for (let i = 0; i < requests.length; i++) {
      dfs(i);
    }

    // Precompute chain-variable availability per request (ancestors scripts + current pre-script).
    const chainVarsCache: Array<Set<string>> = requests.map(() => new Set<string>());
    const chainStack = new Set<number>();
    const buildChainVars = (idx: number): Set<string> => {
      if (chainVarsCache[idx].size) return chainVarsCache[idx];
      if (chainStack.has(idx)) return chainVarsCache[idx];

      chainStack.add(idx);
      const result = new Set<string>();

      const dep = dependsIndex[idx];
      if (dep !== null && dep !== undefined) {
        const depVars = buildChainVars(dep);
        for (const k of depVars) result.add(k);
        for (const k of setVarsByRequest[dep] || []) result.add(k);
      }

      // Only current pre-script is guaranteed to run before hydration.
      for (const k of extractSetVarKeys(String(requests[idx]?.preScript || ''))) result.add(k);

      chainVarsCache[idx] = result;
      chainStack.delete(idx);
      return result;
    };
    for (let i = 0; i < requests.length; i++) buildChainVars(i);

    // Scan document placeholders and warn on unknown variables.
    requestIndexForLine = -1;
    for (let lineNo = 1; lineNo <= view.state.doc.lines; lineNo++) {
      const line = view.state.doc.line(lineNo);
      const text = line.text;

      if (isMethodLine(text)) {
        requestIndexForLine++;
      }

      const placeholders = extractPlaceholders(text);
      if (!placeholders.length) continue;

      for (const ph of placeholders) {
        const inner = ph.inner;
        const from = line.from + ph.start;
        const to = line.from + ph.end;

        // Reserved runtime placeholders (request references)
        if (REQUEST_REF_PLACEHOLDER_REGEX.test(inner)) continue;

        // secret:foo
        const secretMatch = inner.match(SECRET_PLACEHOLDER_REGEX);
        if (secretMatch) {
          const key = secretMatch[1];
          if (secretKeys.has(key)) continue;
          diagnostics.push({ from, to, severity: 'warning', message: `Unknown secret "${key}" for environment "${envName}"` });
          continue;
        }

        // env.name.key
        const envMatch = inner.match(ENV_PLACEHOLDER_REGEX);
        if (envMatch) {
          const [, e, k] = envMatch;
          if (envs?.[e]?.[k] !== undefined) continue;
          diagnostics.push({ from, to, severity: 'warning', message: `Unknown env var "${e}.${k}"` });
          continue;
        }

        // file vars / current env vars
        if (vars[inner] !== undefined) continue;
        if (currentEnvVars[inner] !== undefined) continue;

        // Possibly defined by setVar in current pre-script or any earlier request in chain.
        if (requestIndexForLine >= 0 && requestIndexForLine < chainVarsCache.length) {
          if (chainVarsCache[requestIndexForLine].has(inner)) continue;
        }

        diagnostics.push({ from, to, severity: 'warning', message: `Unknown variable "${inner}"` });
      }
    }

    return diagnostics;
  }

  private getRequestIndexAtPos(state: EditorState, pos: number): number | null {
    const cursorLineNo = state.doc.lineAt(pos).number;
    let methodLineNo: number | null = null;
    for (let lineNo = cursorLineNo; lineNo >= 1; lineNo--) {
      const line = state.doc.line(lineNo).text;
      if (isMethodLine(line)) {
        methodLineNo = lineNo;
        break;
      }
      if (isSeparatorLine(line)) {
        // allow cursor above first method in block; keep scanning upward
        continue;
      }
    }
    if (methodLineNo === null) return null;

    let requestIndex = 0;
    for (let i = 1; i < methodLineNo; i++) {
      if (isMethodLine(state.doc.line(i).text)) requestIndex++;
    }
    return requestIndex;
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