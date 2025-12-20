export function basename(filePath: string): string {
  const normalized = String(filePath ?? '');
  if (!normalized) return '';

  // Trim trailing separators (but keep root '/')
  let end = normalized.length;
  while (end > 1) {
    const ch = normalized[end - 1];
    if (ch === '/' || ch === '\\') {
      end--;
      continue;
    }
    break;
  }

  const trimmed = normalized.slice(0, end);
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (idx < 0) return trimmed;
  return trimmed.slice(idx + 1);
}

export function dirname(filePath: string): string {
  const normalized = String(filePath ?? '');
  if (!normalized) return '';

  // Trim trailing separators (but keep root '/')
  let end = normalized.length;
  while (end > 1) {
    const ch = normalized[end - 1];
    if (ch === '/' || ch === '\\') {
      end--;
      continue;
    }
    break;
  }

  const trimmed = normalized.slice(0, end);
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (idx < 0) return '';
  if (idx === 0) return trimmed[0] === '/' ? '/' : '';
  return trimmed.slice(0, idx);
}
