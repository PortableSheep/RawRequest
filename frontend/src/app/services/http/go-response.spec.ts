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

  it('treats unparseable content as Parse Error', () => {
    const r = parseGoResponse('totally not in the expected format', 1);
    expect(r.status).toBe(0);
    expect(r.statusText).toBe('Parse Error');
    expect(r.body).toContain('totally not in the expected format');
  });
});
