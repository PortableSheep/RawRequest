import { parseHttpFile } from './parse-http-file';

describe('parser/parse-http-file', () => {
  it('parses env vars, variables, tab name, requests, headers, and body', () => {
    const parsed = parseHttpFile([
      '@tab "My Tab"',
      '@env.dev.token abc',
      '@baseUrl=https://example.com',
      '',
      '@name First',
      'GET https://example.com',
      'Accept: application/json',
      '',
      '{"a": 1}',
    ].join('\n'));

    expect(parsed.fileDisplayName).toBe('My Tab');
    expect(parsed.environments['dev']['token']).toBe('abc');
    expect(parsed.variables['baseUrl']).toBe('https://example.com');

    expect(parsed.requests).toHaveLength(1);
    expect(parsed.requests[0].name).toBe('First');
    expect(parsed.requests[0].method).toBe('GET');
    expect(parsed.requests[0].headers['Accept']).toBe('application/json');
    expect(parsed.requests[0].body).toBe('{"a": 1}');
  });

  it('parses env vars defined with equals sign', () => {
    const parsed = parseHttpFile([
      '@env.dev.token=abc',
      '@env.dev.baseUrl = https://example.com',
      '',
      'GET {{env.dev.baseUrl}}',
    ].join('\n'));

    expect(parsed.environments['dev']['token']).toBe('abc');
    expect(parsed.environments['dev']['baseUrl']).toBe('https://example.com');
    expect(parsed.requests).toHaveLength(1);
  });

  it('detects scripts only for < or > blocks with braces (avoids XML confusion)', () => {
    const parsed = parseHttpFile([
      'POST https://example.com',
      'Content-Type: application/xml',
      '',
      '<?xml version="1.0"?>',
      '<root>hi</root>',
      '',
      '< {',
      '  console.log("pre");',
      '}',
      '',
      '> {',
      '  console.log("post");',
      '}',
    ].join('\n'));

    expect(parsed.requests).toHaveLength(1);
    expect(parsed.requests[0].preScript).toContain('console.log("pre")');
    expect(parsed.requests[0].postScript).toContain('console.log("post")');
    // body should still contain XML-ish lines
    expect(parsed.requests[0].body).toContain('<root>hi</root>');
  });

  it('collects groups from ### group: meta ###', () => {
    const parsed = parseHttpFile([
      'GET u',
      '### group: Admin ###',
    ].join('\n'));

    expect(parsed.groups).toEqual(['Admin']);
    expect(parsed.requests[0].group).toBe('Admin');
  });

  it('does not treat a second method line as a new request without a separator', () => {
    const parsed = parseHttpFile([
      'GET https://example.com/one',
      'GET https://example.com/two',
    ].join('\n'));

    expect(parsed.requests).toHaveLength(1);
    expect(parsed.requests[0].url).toBe('https://example.com/one');
  });

  it('allows multiple requests when separated by a real separator line', () => {
    const parsed = parseHttpFile([
      'GET https://example.com/one',
      '### Next',
      'GET https://example.com/two',
    ].join('\n'));

    expect(parsed.requests).toHaveLength(2);
    expect(parsed.requests[0].url).toBe('https://example.com/one');
    expect(parsed.requests[1].url).toBe('https://example.com/two');
  });
});
