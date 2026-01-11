import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { Diagnostic, linter, lintGutter } from '@codemirror/lint';

import {
  extractDependsTarget,
  extractPlaceholders,
  extractSetVarKeys,
  ENV_PLACEHOLDER_REGEX,
  isMethodLine,
  isSeparatorLine,
  REQUEST_REF_PLACEHOLDER_REGEX,
  SECRET_PLACEHOLDER_REGEX
} from '../../utils/http-file-analysis';

import { LOAD_TEST_KEYS } from './editor.constants';
import {
  buildChainVarsCache,
  buildDependsIndex,
  buildKnownLoadKeysSet,
  buildNameToIndex,
  buildSetVarsByRequest,
  collectDependsCycleDiagnostics,
  collectTimeoutDiagnosticsForLine,
  collectUnknownDependsDiagnostics,
  collectUnknownLoadKeyDiagnosticsForLine,
  collectUnknownVariableDiagnosticsForLine
} from './editor.lint.logic';

export type LintDeps = {
  getRequests: () => any[];
  getVariables: () => { [key: string]: string };
  getEnvironments: () => { [env: string]: { [key: string]: string } };
  getCurrentEnv: () => string;
  getSecrets: () => Partial<Record<string, string[]>>;
  getRequestIndexAtPos: (state: EditorState, pos: number) => number | null;
};

export function createEditorLintExtensions(deps: LintDeps) {
  return [
    lintGutter(),
    linter((view) => computeDiagnostics(view, deps), { delay: 250 })
  ];
}

function computeDiagnostics(view: EditorView, deps: LintDeps): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const requests = deps.getRequests() || [];

  const tree = syntaxTree(view.state);
  const knownLoadKeys = buildKnownLoadKeysSet(LOAD_TEST_KEYS);

  const nameToIndex = buildNameToIndex(requests);

  const vars = deps.getVariables() || {};
  const envs = deps.getEnvironments() || {};
  const envName = (deps.getCurrentEnv() || 'default').trim() || 'default';
  const currentEnvVars = envName ? envs[envName] || {} : {};

  const secrets = deps.getSecrets() || {};
  const secretKeys = new Set<string>([...(secrets[envName] || []), ...(secrets['default'] || [])]);

  const setVarsByRequest = buildSetVarsByRequest(requests);

  // Associate @depends lines to the next request method line so we can underline exactly the target token.
  const dependsTokenByRequestIndex: Array<{ target: string; from: number; to: number } | null> = [];
  let pendingDepends: { target: string; from: number; to: number } | null = null;
  let requestIndexForLine = -1;
  let inRequestBlock = false;

  for (let lineNo = 1; lineNo <= view.state.doc.lines; lineNo++) {
    const line = view.state.doc.line(lineNo);
    const text = line.text;

    if (isSeparatorLine(text)) {
      inRequestBlock = false;
    }

    const trimmedStartIndex = text.length - text.trimStart().length;
    const lineType = tree.resolve(line.from + trimmedStartIndex, 1).name;

    // @load diagnostics (unknown keys)
    const trimmed = text.trimStart();
    if (lineType === 'AnnotationLine' && trimmed.toLowerCase().startsWith('@load')) {
      diagnostics.push(
        ...collectUnknownLoadKeyDiagnosticsForLine({
          lineFrom: line.from,
          trimmedStartIndex,
          trimmedText: trimmed,
          knownLoadKeys
        })
      );
    }

    // @timeout diagnostics (non-numeric)
    if (lineType === 'AnnotationLine' && trimmed.toLowerCase().startsWith('@timeout')) {
      diagnostics.push(
        ...collectTimeoutDiagnosticsForLine({
          lineFrom: line.from,
          trimmedStartIndex,
          trimmedText: trimmed
        })
      );
    }

    const depends = lineType === 'AnnotationLine' ? extractDependsTarget(text) : null;
    if (depends) {
      pendingDepends = { target: depends.target, from: line.from + depends.start, to: line.from + depends.end };
    }

    // Only count real request-start method lines; additional method lines within the same
    // request block are treated as invalid (must be separated by a real separator line).
    if (lineType === 'MethodLine' && isMethodLine(text)) {
      if (inRequestBlock) {
        const from = line.from + trimmedStartIndex;
        const to = Math.min(line.to, from + text.trimStart().length);
        diagnostics.push({
          from,
          to,
          severity: 'warning',
          message: 'Only one request line allowed per block; add a separator (### ...) before the next request or comment it out'
        });
      } else {
        requestIndexForLine++;
        inRequestBlock = true;

        if (pendingDepends) {
          dependsTokenByRequestIndex[requestIndexForLine] = pendingDepends;
          pendingDepends = null;
        }

        // Method-line diagnostics (must include URL-ish token after method)
        const methodMatch = text.trimStart().match(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\S+)/i);
        if (!methodMatch) {
          const from = line.from + trimmedStartIndex;
          const to = Math.min(line.to, from + text.trimStart().length);
          diagnostics.push({
            from,
            to,
            severity: 'warning',
            message: 'Method line should include a URL (e.g. GET https://example.com)'
          });
        }
      }
    }
  }

  // Build dependency graph using parsed requests, and emit errors for unknown targets/cycles.
  const dependsIndex = buildDependsIndex(requests, nameToIndex);

  diagnostics.push(
    ...collectUnknownDependsDiagnostics({
      requests,
      nameToIndex,
      dependsTokenByRequestIndex
    })
  );

  diagnostics.push(
    ...collectDependsCycleDiagnostics({
      dependsIndex,
      dependsTokenByRequestIndex
    })
  );

  // Structural request-block diagnostics using the Lezer tree.
  // These don't depend on the parsed request model and help catch structural mistakes early.
  {
    const doc = view.state.doc;
    tree.iterate({
      enter: (node) => {
        if (node.type.name !== 'RequestBlock') return;

        let reqNode: any = tree.resolve(node.from, 1);
        while (reqNode && reqNode.name !== 'RequestBlock') reqNode = reqNode.parent;
        if (!reqNode) return;

        let sawBody = false;
        let multipartLikely = false;
        let sawContentBodyLine = false;

    // Track whether we're inside a brace-based script block (< { ... } / > { ... }).
    // Lezer intentionally keeps the grammar simple and may classify script lines as HeaderLine
    // (e.g. JSON key/value pairs). We must suppress structural header/annotation diagnostics
    // while inside scripts.
    let pendingBraceScript = false;
    let inBraceScript = false;
    let braceDepth = 0;
    let braceStarted = false;
    const countChars = (text: string, ch: string): number => {
      let c = 0;
      for (let i = 0; i < text.length; i++) if (text[i] === ch) c++;
      return c;
    };
    const maybeUpdateScriptStateAndIsScriptLine = (fullLineText: string): boolean => {
      const trimmed = fullLineText.trimStart();

      const applyBraceCounts = () => {
        const openCount = countChars(fullLineText, '{');
        const closeCount = countChars(fullLineText, '}');
        if (openCount > 0) braceStarted = true;
        braceDepth += openCount - closeCount;
        if (braceStarted && braceDepth <= 0) {
          inBraceScript = false;
          braceDepth = 0;
          braceStarted = false;
        }
      };

      if (inBraceScript) {
        applyBraceCounts();
        return true;
      }

      if (pendingBraceScript) {
        // Common style: '<' then '{' on the next line.
        if (trimmed.startsWith('{')) {
          pendingBraceScript = false;
          inBraceScript = true;
          braceDepth = 0;
          braceStarted = false;
          applyBraceCounts();
          return true;
        }
        // If we didn't get '{' right after, stop treating this as a script block.
        pendingBraceScript = false;
      }

      if (trimmed === '<' || trimmed === '>') {
        pendingBraceScript = true;
        return true;
      }
      if ((trimmed.startsWith('<') || trimmed.startsWith('>')) && trimmed.includes('{')) {
        const rest = trimmed.slice(1).trimStart();
        if (rest.startsWith('{')) {
          inBraceScript = true;
          braceDepth = 0;
          braceStarted = false;
          applyBraceCounts();
          return true;
        }
      }
      return false;
    };
        const isIgnorableBodyLine = (text: string): boolean => {
          const t = text.trimStart();
          if (!t) return true;
          // Common comment styles in .http files / scripts.
          if (t.startsWith('#')) return true;
          if (t.startsWith('//')) return true;
          // Some users use ';' as a comment prefix.
          if (t.startsWith(';')) return true;
          return false;
        };
        const requestLines = reqNode.getChildren('RequestLine');
        for (const rl of requestLines) {
          const child = rl.firstChild;
          if (!child) continue;

          const kind = child.name;
          const raw = doc.sliceString(child.from, child.to);
          const trimmed = raw.trimStart();
          const lower = trimmed.toLowerCase();

      // Script blocks can be misclassified as headers/annotations (e.g. JSON with ':'),
      // but should not participate in structural ordering lint.
      const fullLineText = doc.lineAt(child.from).text;
      if (maybeUpdateScriptStateAndIsScriptLine(fullLineText)) {
        continue;
      }

          if (kind === 'BodyLine') {
            const bodyText = trimmed.trim();
            if (bodyText.length) {
              sawBody = true;
              if (!isIgnorableBodyLine(trimmed)) {
                sawContentBodyLine = true;
              }
              // Heuristics: common file upload / multipart payloads contain header-like lines in the body.
              if (bodyText.startsWith('--') || bodyText.includes('multipart/form-data')) {
                multipartLikely = true;
              }
              if (bodyText.startsWith('< ')) {
                multipartLikely = true;
              }
            }
            continue;
          }

          if (kind === 'HeaderLine') {
            // If the request itself declares multipart, don't warn about header-looking lines later.
            if (lower.startsWith('content-type:') && lower.includes('multipart/form-data')) {
              multipartLikely = true;
            }
          }

          if (sawBody && (kind === 'HeaderLine' || kind === 'AnnotationLine')) {
            if (kind === 'HeaderLine') {
              // Suppress for multipart/file-upload bodies where header-like lines are expected.
              if (!multipartLikely && sawContentBodyLine) {
                diagnostics.push({
                  from: child.from,
                  to: child.to,
                  severity: 'info',
                  message: 'Header appears after body content started'
                });
              }
              continue;
            }

            // AnnotationLine: only flag request-scoped annotations; ignore global var/env lines.
            if (
              sawContentBodyLine &&
              (lower.startsWith('@name') ||
                lower.startsWith('@depends') ||
                lower.startsWith('@timeout') ||
                lower.startsWith('@load'))
            ) {
              diagnostics.push({
                from: child.from,
                to: child.to,
                severity: 'info',
                message: 'Annotation appears after body content started'
              });
            }
            continue;
          }

          if (kind === 'AnnotationLine') {
            if (lower.startsWith('@name')) {
              const nameArg = trimmed.slice('@name'.length).trim();
              if (!nameArg) {
                diagnostics.push({
                  from: child.from,
                  to: child.to,
                  severity: 'warning',
                  message: 'Missing @name value'
                });
              }
            }

            if (lower.startsWith('@depends')) {
              const dep = extractDependsTarget(trimmed);
              if (!dep) {
                diagnostics.push({
                  from: child.from,
                  to: child.to,
                  severity: 'warning',
                  message: 'Missing @depends target'
                });
              }
            }
          }
        }
      }
    });
  }

  // Precompute chain-variable availability per request (ancestors scripts + current pre-script).
  const chainVarsCache = buildChainVarsCache({ requests, dependsIndex, setVarsByRequest });

  // Scan document placeholders and warn on unknown variables.
  for (let lineNo = 1; lineNo <= view.state.doc.lines; lineNo++) {
    const line = view.state.doc.line(lineNo);
    const text = line.text;

    const trimmedStartIndex = text.length - text.trimStart().length;
    const requestIndexForPlaceholderLine = deps.getRequestIndexAtPos(view.state, line.from + trimmedStartIndex);

    diagnostics.push(
      ...collectUnknownVariableDiagnosticsForLine({
        text,
        lineFrom: line.from,
        envName,
        vars,
        envs,
        currentEnvVars,
        secretKeys,
        requestIndexForPlaceholderLine,
        chainVarsCache
      })
    );
  }

  return diagnostics;
}
