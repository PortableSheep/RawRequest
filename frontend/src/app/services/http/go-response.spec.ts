import { parseGoResponse } from './go-response';

describe('go-response', () => {
  it('returns a Request Error for Go error strings', () => {
    const r = parseGoResponse('Error: something went wrong', 123);
    expect(r.status).toBe(0);
    expect(r.statusText).toBe('Request Error');
    expect(r.responseTime).toBe(123);
  });

  it('parses status, headers metadata, and JSON body', () => {
    const responseStr = [
      'Status: 200 OK',
      'Request: {"method":"GET","url":"https://example.com","headers":{"X-Test":"1"}}',
      'Headers: {"headers":{"Content-Type":"application/json"},"timing":{"total":42},"size":10}',
      'Body: {"ok":true}'
    ].join('\n');

    const r = parseGoResponse(responseStr, 999);
    expect(r.status).toBe(200);
    expect(r.statusText).toBe('OK');
    expect(r.headers['Content-Type']).toBe('application/json');
    expect(r.responseTime).toBe(42);
    expect(r.size).toBe(10);
    expect(r.json).toEqual({ ok: true });
    expect(r.requestPreview).toEqual({
      method: 'GET',
      url: 'https://example.com',
      headers: { 'X-Test': '1' }
    });
  });

  it('parses assertions when present', () => {
    const responseStr = [
      'Status: 200 OK',
      'Request: {"method":"GET","url":"https://example.com","headers":{}}',
      'Headers: {"headers":{},"timing":{"total":1},"size":0}',
      'Asserts: [{"passed":true,"message":"ok","stage":"post"},{"passed":false,"message":"nope","stage":"post"}]',
      'Body: hi'
    ].join('\n');

    const r = parseGoResponse(responseStr, 999);
    expect(r.assertions).toEqual([
      { passed: true, message: 'ok', stage: 'post' },
      { passed: false, message: 'nope', stage: 'post' }
    ]);
  });

  it('treats unparseable content as Parse Error', () => {
    const r = parseGoResponse('totally not in the expected format', 1);
    expect(r.status).toBe(0);
    expect(r.statusText).toBe('Parse Error');
    expect(r.body).toContain('totally not in the expected format');
  });

  it('parses binary response metadata and skips JSON parsing', () => {
    const responseStr = [
      'Status: 200 OK',
      'Request: {"method":"GET","url":"https://example.com/file.pdf","headers":{}}',
      'Headers: {"headers":{"content-type":"application/pdf"},"timing":{"total":100},"size":2048,"isBinary":true,"contentType":"application/pdf"}',
      'Body: dGVzdA=='
    ].join('\n');

    const r = parseGoResponse(responseStr, 999);
    expect(r.status).toBe(200);
    expect(r.isBinary).toBe(true);
    expect(r.contentType).toBe('application/pdf');
    expect(r.body).toBe('dGVzdA==');
    expect(r.size).toBe(2048);
    expect(r.json).toBeUndefined();
  });

  it('does not set isBinary for text responses', () => {
    const responseStr = [
      'Status: 200 OK',
      'Headers: {"headers":{"content-type":"application/json"},"timing":{"total":10},"size":5}',
      'Body: {"a":1}'
    ].join('\n');

    const r = parseGoResponse(responseStr, 1);
    expect(r.isBinary).toBeFalsy();
    expect(r.contentType).toBeFalsy();
    expect(r.json).toEqual({ a: 1 });
  });
});
