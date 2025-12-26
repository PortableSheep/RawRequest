export type RequestNameRegexes = {
  nameRx: RegExp;
  metaRx: RegExp;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function buildRequestNameRegexes(targetName: string): RequestNameRegexes | null {
  const target = targetName.trim();
  if (!target) return null;

  const escaped = escapeRegExp(target);
  return {
    nameRx: new RegExp(`^@name\\s+${escaped}\\s*$`, 'i'),
    metaRx: new RegExp(`^###\\s*name:\\s*${escaped}\\s*###\\s*$`, 'i')
  };
}

export function findRequestNameLineNumber(lines: string[], targetName: string): number | null {
  const regexes = buildRequestNameRegexes(targetName);
  if (!regexes) return null;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (regexes.nameRx.test(trimmed) || regexes.metaRx.test(trimmed)) {
      return i + 1; // 1-based line numbers
    }
  }
  return null;
}

export type AccidentalSelectionDecision = {
  hadSelectionBefore: boolean;
  selectionEmptyAfter: boolean;
  fromLineNumber: number;
  toLineNumber: number;
  maxLineSpan?: number;
};

export function shouldCollapseAccidentalSelection(decision: AccidentalSelectionDecision): boolean {
  const maxLineSpan = decision.maxLineSpan ?? 2;
  if (decision.hadSelectionBefore) return false;
  if (decision.selectionEmptyAfter) return false;
  return Math.abs(decision.toLineNumber - decision.fromLineNumber) > maxLineSpan;
}

export type ContextMenuPositionInput = {
  caretLeft: number | null | undefined;
  caretBottom: number | null | undefined;
  eventClientX: number;
  eventClientY: number;
  viewportWidth: number;
  viewportHeight: number;
  menuWidth?: number;
  menuHeight?: number;
  padding?: number;
  wrapperLeft?: number | null;
  wrapperTop?: number | null;
};

export function computeContextMenuLocalPosition(input: ContextMenuPositionInput): { x: number; y: number } {
  const menuWidth = input.menuWidth ?? 220;
  const menuHeight = input.menuHeight ?? 190;
  const padding = input.padding ?? 8;

  let desiredX = (input.caretLeft ?? input.eventClientX) as number;
  let desiredY = (input.caretBottom ?? input.eventClientY) as number;

  desiredX = Math.max(padding, Math.min(desiredX, input.viewportWidth - menuWidth - padding));
  desiredY = Math.max(padding, Math.min(desiredY, input.viewportHeight - menuHeight - padding));

  const localX = (input.wrapperLeft ?? null) !== null ? desiredX - (input.wrapperLeft as number) : desiredX;
  const localY = (input.wrapperTop ?? null) !== null ? desiredY - (input.wrapperTop as number) : desiredY;

  return {
    x: Math.max(0, localX),
    y: Math.max(0, localY)
  };
}
