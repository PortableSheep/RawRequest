export type ExtractScriptResult = { script: string; linesConsumed: number };

export function extractScript(lines: string[], startIndex: number): ExtractScriptResult {
  let script = '';
  let braceCount = 0;
  let inScript = false;
  let linesConsumed = 0;
  const firstLine = lines[startIndex].trim();

  const hasBraceOnFirstLine = firstLine.match(/^[<>]\s*\{/);
  const isStandaloneMarker = firstLine === '<' || firstLine === '>';
  const nextLine = startIndex + 1 < lines.length ? lines[startIndex + 1].trim() : '';
  const nextLineStartsWithBrace = nextLine.startsWith('{');

  if (!hasBraceOnFirstLine && !(isStandaloneMarker && nextLineStartsWithBrace)) {
    return { script: '', linesConsumed: 0 };
  }

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    linesConsumed++;

    if (line.includes('{')) {
      inScript = true;
      braceCount += (line.match(/\{/g) || []).length;
    }

    if (inScript) {
      script += line + '\n';
      braceCount -= (line.match(/\}/g) || []).length;

      if (braceCount <= 0) {
        break;
      }
    }
  }

  return { script: script.trim(), linesConsumed };
}
