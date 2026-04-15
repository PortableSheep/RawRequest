const SECRET_PATTERN = /\{\{\s*secret:[^}]+\}\}/;

export const MASKED_VALUE = '••••••••';

export function detectSensitiveHeaderKeys(headers: { [key: string]: string } | undefined): string[] {
  if (!headers) {
    return [];
  }
  const keys: string[] = [];
  for (const [key, value] of Object.entries(headers)) {
    if (SECRET_PATTERN.test(value)) {
      keys.push(key);
    }
  }
  return keys;
}

export function maskHeaderValues(
  headers: { [key: string]: string },
  sensitiveKeys: string[]
): { [key: string]: string } {
  if (!sensitiveKeys.length) {
    return headers;
  }
  const sensitiveSet = new Set(sensitiveKeys);
  const result: { [key: string]: string } = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key] = sensitiveSet.has(key) ? MASKED_VALUE : value;
  }
  return result;
}
