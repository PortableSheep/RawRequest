import {
  extractDependsTarget,
  extractPlaceholders,
  extractSetVarKeys,
  isMethodLine,
  isSeparatorLine
} from './http-file-analysis';

describe('http-file-analysis', () => {
  it('detects method lines', () => {
    expect(isMethodLine('GET https://example.com')).toBe(true);
    expect(isMethodLine('  post /v1')).toBe(true);
    expect(isMethodLine('### Section')).toBe(false);
  });

  it('detects separator lines', () => {
    expect(isSeparatorLine('### Hello')).toBe(true);
    expect(isSeparatorLine('  ### Hello')).toBe(true);
    expect(isSeparatorLine('###')).toBe(false);
  });

  it('extracts placeholders with correct ranges', () => {
    const text = 'Authorization: Bearer {{token}} and {{ env.dev.key }}';
    const matches = extractPlaceholders(text);
    expect(matches.length).toBe(2);
    expect(matches[0].inner).toBe('token');
    expect(text.slice(matches[0].start, matches[0].end)).toBe('{{token}}');
    expect(matches[1].inner).toBe('env.dev.key');
  });

  it('extracts @depends target range', () => {
    const line = '  @depends   LoginRequest   ';
    const res = extractDependsTarget(line);
    expect(res).not.toBeNull();
    expect(res!.target).toBe('LoginRequest');
    expect(line.slice(res!.start, res!.end)).toBe('LoginRequest');
  });

  it('extracts setVar literal keys', () => {
    const script = `
setVar('token', 'abc');
setVar("userId", 123);
setVar(dynamicName, 1);
`;
    const keys = extractSetVarKeys(script);
    expect(keys.has('token')).toBe(true);
    expect(keys.has('userId')).toBe(true);
    expect(keys.has('dynamicName')).toBe(false);
  });
});
