import { autocompletion, Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';

import { ANNOTATIONS, CONTENT_TYPES, HTTP_HEADERS, HTTP_METHODS, LOAD_TEST_KEYS } from './editor.constants';

export type AutocompleteDeps = {
  getVariables: () => { [key: string]: string };
  getEnvironments: () => { [env: string]: { [key: string]: string } };
  getCurrentEnv: () => string;
  getSecrets: () => Partial<Record<string, string[]>>;
  getRequestNames: () => string[];
};

export function createAutocompleteExtension(deps: AutocompleteDeps) {
  return autocompletion({
    override: [
      (context: CompletionContext): CompletionResult | null => {
        return httpCompletions(context, deps);
      }
    ],
    activateOnTyping: true
  });
}

function httpCompletions(context: CompletionContext, deps: AutocompleteDeps): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const lineText = line.text;
  const cursorPos = context.pos - line.from;
  const textBeforeCursor = lineText.slice(0, cursorPos);

  const tree = syntaxTree(context.state);
  const trimmedStartIndex = lineText.length - lineText.trimStart().length;
  const lineType = tree.resolve(line.from + trimmedStartIndex, 1).name;

  let requestBlockNode: any = tree.resolve(context.pos, 1);
  while (requestBlockNode && requestBlockNode.name !== 'RequestBlock') requestBlockNode = requestBlockNode.parent;
  const inRequestBlock = !!requestBlockNode;

  let firstBodyFrom: number | null = null;
  if (requestBlockNode) {
    const requestLines = requestBlockNode.getChildren('RequestLine');
    for (const rl of requestLines) {
      const child = rl.firstChild;
      if (!child) continue;
      if (child.name === 'BodyLine') {
        firstBodyFrom = child.from;
        break;
      }
    }
  }
  const inHeaderSection = inRequestBlock && (firstBodyFrom === null || context.pos < firstBodyFrom);

  // @load key completion (when typing key names)
  // Examples:
  //   @load con|
  //   @load users=10 dur|
  const trimmedLine = lineText.trimStart();
  if (lineType === 'AnnotationLine' && trimmedLine.toLowerCase().startsWith('@load')) {
    const before = textBeforeCursor.trimStart();
    const loadMatch = before.match(/^@load\s+([\s\S]*)$/i);
    if (loadMatch) {
      const afterLoad = loadMatch[1] ?? '';
      // Token is the last chunk separated by whitespace or commas
      const tokenMatch = afterLoad.match(/(?:^|[\s,])([A-Za-z_][\w-]*)$/);
      if (tokenMatch) {
        const token = tokenMatch[1];
        const tokenStart = before.lastIndexOf(token);
        const from = line.from + tokenStart;
        const options = LOAD_TEST_KEYS
          .filter(k => k.label.toLowerCase().startsWith(token.toLowerCase()))
          .map(k => ({
            label: k.label,
            type: 'property',
            detail: k.detail,
            apply: `${k.label}=`
          } as Completion));
        if (options.length) {
          return { from, options, validFor: /^[A-Za-z_][\w-]*$/ };
        }
      }
    }
  }

  // Check for secret completion: {{secret:
  const secretMatch = textBeforeCursor.match(/\{\{\s*secret:([a-zA-Z0-9_\-\.]*)$/);
  if (secretMatch) {
    const prefix = secretMatch[1];
    const from = context.pos - prefix.length;
    const env = (deps.getCurrentEnv() || 'default').trim() || 'default';
    const snapshot = deps.getSecrets() || {};
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
    const vars = deps.getVariables();
    for (const key of Object.keys(vars)) {
      completions.push({
        label: key,
        type: 'variable',
        detail: vars[key]?.slice(0, 30) || '',
        apply: `${key}}}`
      });
    }

    // Add environment variables
    const envs = deps.getEnvironments();
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
    const requestNamesList = deps.getRequestNames();
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
  if (lineType === 'AnnotationLine' && textBeforeCursor.match(/^@[a-z\-]*$/i)) {
    const prefix = textBeforeCursor.slice(1);
    const from = context.pos - prefix.length - 1;
    return {
      from,
      options: ANNOTATIONS.map(a => ({
        label: a,
        type: 'keyword',
        detail: a === '@timeout' ? 'timeout in ms' : a === '@no-history' ? 'skip saving response to disk (PHI)' : ''
      })),
      validFor: /^@?[a-z\-]*$/i
    };
  }

  // Check for HTTP method at start of line
  if ((lineType === 'MethodLine' || !inRequestBlock) && textBeforeCursor.match(/^[A-Z]*$/i) && cursorPos === textBeforeCursor.length) {
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
  if (
    inHeaderSection &&
    colonIndex === -1 &&
    lineType !== 'MethodLine' &&
    lineType !== 'AnnotationLine' &&
    lineType !== 'SeparatorLine' &&
    !trimmedLine.match(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|@|#)/i) &&
    !trimmedLine.startsWith('{') &&
    !trimmedLine.startsWith('[')
  ) {
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
  if (lineType === 'HeaderLine' && textBeforeCursor.match(/Content-Type:\s*[a-z/]*$/i)) {
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
