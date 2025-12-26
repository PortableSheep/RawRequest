import { parseConcatenatedChainResponses } from './chain-response-parser';
import { RequestPreview, ResponseData } from '../../models/http.models';

describe('chain-response-parser', () => {
  it('parses concatenated responses and attaches previews by index', () => {
    const responseStr = ['r1', 'r2'].join('\n\n');
    const previews: RequestPreview[] = [
      { method: 'GET', url: 'u1', headers: {}, name: 'A' },
      { method: 'GET', url: 'u2', headers: {}, name: 'B' },
    ];

    const parseGoResponse = (s: string): ResponseData => ({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: s,
      responseTime: 0,
    });

    const responses = parseConcatenatedChainResponses(responseStr, previews, (s, t) => parseGoResponse(s), {});
    expect(responses).toHaveLength(2);
    expect(responses[0].body).toBe('r1');
    expect(responses[0].processedUrl).toBe('u1');
    expect(responses[0].requestPreview?.name).toBe('A');
    expect(responses[1].processedUrl).toBe('u2');
  });

  it('creates a fallback Parse Error response when parsing throws', () => {
    const responseStr = ['ok', 'boom'].join('\n\n');
    const previews: RequestPreview[] = [
      { method: 'GET', url: 'u1', headers: {} },
      { method: 'GET', url: 'u2', headers: {} },
    ];

    const parseGoResponse = (s: string): ResponseData => {
      if (s === 'boom') {
        throw new Error('nope');
      }
      return { status: 200, statusText: 'OK', headers: {}, body: s, responseTime: 0 };
    };

    const responses = parseConcatenatedChainResponses(responseStr, previews, (s, t) => parseGoResponse(s));
    expect(responses).toHaveLength(2);
    expect(responses[1].statusText).toBe('Parse Error');
    expect(responses[1].body).toContain('Failed to parse response');
    expect(responses[1].body).toContain('boom');
  });
});
