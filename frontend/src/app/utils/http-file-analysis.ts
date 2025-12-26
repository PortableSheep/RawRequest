export const METHOD_LINE_REGEX = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|TRACE|CONNECT)\s+/i;
export const DEPENDS_LINE_REGEX = /^@depends\s+/i;
export const LOAD_LINE_REGEX = /^@load\s+/i;
export const ANNOTATION_LINE_REGEX = /^@(name|depends|load|timeout)\s+/i;
export const SEPARATOR_LINE_REGEX = /^\s*###\s+\S/;
export const SEPARATOR_PREFIX_REGEX = /^\s*###\s+/;

export const PLACEHOLDER_REGEX = /\{\{([^}]+)\}\}/g;
export const SECRET_PLACEHOLDER_REGEX = /^secret:([a-zA-Z0-9_\-\.]+)$/;
export const ENV_PLACEHOLDER_REGEX = /^env\.([^.]+)\.(.+)$/;
export const REQUEST_REF_PLACEHOLDER_REGEX = /^(request\d+)\.(response\.(body|status|headers|json|timing|size).*)/;

export interface PlaceholderMatch {
  raw: string;
  inner: string;
  start: number;
  end: number;
}

export function isMethodLine(text: string): boolean {
  return METHOD_LINE_REGEX.test(text.trimStart());
}

export function isSeparatorLine(text: string): boolean {
  const trimmed = text.trimStart();
  if (!SEPARATOR_LINE_REGEX.test(trimmed)) return false;

  // Treat `### <label>` as a separator only when the label isn't just hashes.
  // This avoids accidentally folding/splitting on visual dividers like:
  //   ### ########################
  const label = trimmed.replace(SEPARATOR_PREFIX_REGEX, '').trim();
  if (!label) return false;
  if (label.replace(/#/g, '').trim() === '') return false;
  return true;
}

export function extractPlaceholders(text: string): PlaceholderMatch[] {
  const matches: PlaceholderMatch[] = [];
  let match: RegExpExecArray | null;
  PLACEHOLDER_REGEX.lastIndex = 0;
  while ((match = PLACEHOLDER_REGEX.exec(text)) !== null) {
    matches.push({
      raw: match[0],
      inner: match[1].trim(),
      start: match.index,
      end: match.index + match[0].length
    });
  }
  return matches;
}

export function extractDependsTarget(line: string): { target: string; start: number; end: number } | null {
  const trimmedStartIndex = line.length - line.trimStart().length;
  const trimmed = line.trimStart();
  if (!DEPENDS_LINE_REGEX.test(trimmed)) {
    return null;
  }

  // Preserve original spacing for accurate ranges
  const dependsIndexInTrimmed = trimmed.toLowerCase().indexOf('@depends');
  const afterDepends = trimmed.slice(dependsIndexInTrimmed + '@depends'.length);
  const leadingSpaces = afterDepends.match(/^\s*/)?.[0].length ?? 0;
  const target = afterDepends.slice(leadingSpaces).trimEnd();
  if (!target) {
    return null;
  }

  const start = trimmedStartIndex + dependsIndexInTrimmed + '@depends'.length + leadingSpaces;
  const end = start + target.length;
  return { target, start, end };
}

export function extractSetVarKeys(script: string): Set<string> {
  const keys = new Set<string>();
  if (!script) return keys;

  // Only literal first arg: setVar('name', ...) or setVar("name", ...)
  const rx = /\bsetVar\s*\(\s*(['"])([^'"\\]+)\1/g;
  let match: RegExpExecArray | null;
  while ((match = rx.exec(script)) !== null) {
    if (isInJsLineComment(script, match.index)) {
      continue;
    }
    const key = match[2].trim();
    if (key) keys.add(key);
  }
  return keys;
}

function isInJsLineComment(text: string, index: number): boolean {
  // Detect whether `index` is inside a `// ...` comment, accounting for strings.
  // This is a best-effort heuristic for editor features (autocomplete/diagnostics).
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escaped = false;

  for (let i = lineStart; i < index; i++) {
    const ch = text[i];
    const next = i + 1 < index ? text[i + 1] : '';

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }

    if (inSingle) {
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '"') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (ch === '`') inTemplate = false;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      continue;
    }

    if (ch === '/' && next === '/') {
      return true;
    }
  }

  return false;
}
