export function normalizeDisplayName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.length) {
    return '';
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.substring(1, trimmed.length - 1).trim();
  }
  return trimmed;
}
