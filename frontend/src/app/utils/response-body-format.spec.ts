import { formatResponseBody } from './response-body-format';

describe('formatResponseBody', () => {
  it('pretty-prints JSON objects and arrays', () => {
    expect(formatResponseBody('{"ok":true,"items":[1,2]}')).toBe(
      '{\n  "ok": true,\n  "items": [\n    1,\n    2\n  ]\n}'
    );
  });

  it('preserves non-JSON and malformed JSON bodies', () => {
    expect(formatResponseBody('plain text\nwith formatting')).toBe('plain text\nwith formatting');
    expect(formatResponseBody('{"broken":')).toBe('{"broken":');
  });
});
