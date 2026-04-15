import { detectSensitiveHeaderKeys, maskHeaderValues, MASKED_VALUE } from './secret-masking';

describe('secret-masking', () => {
  describe('detectSensitiveHeaderKeys', () => {
    it('returns empty array for undefined headers', () => {
      expect(detectSensitiveHeaderKeys(undefined)).toEqual([]);
    });

    it('returns empty array for empty headers', () => {
      expect(detectSensitiveHeaderKeys({})).toEqual([]);
    });

    it('returns empty array when no headers contain secrets', () => {
      expect(detectSensitiveHeaderKeys({
        'Content-Type': 'application/json',
        'X-Custom': '{{someVar}}'
      })).toEqual([]);
    });

    it('detects headers with secret patterns', () => {
      const result = detectSensitiveHeaderKeys({
        'Authorization': 'Bearer {{secret:api_key}}',
        'Content-Type': 'application/json',
        'X-API-Key': '{{secret:x_key}}'
      });
      expect(result).toEqual(['Authorization', 'X-API-Key']);
    });

    it('detects secret patterns with spaces', () => {
      const result = detectSensitiveHeaderKeys({
        'Authorization': '{{ secret:api_key }}'
      });
      expect(result).toEqual(['Authorization']);
    });
  });

  describe('maskHeaderValues', () => {
    it('returns headers unchanged when no sensitive keys', () => {
      const headers = { 'Content-Type': 'application/json', 'X-Custom': 'value' };
      expect(maskHeaderValues(headers, [])).toEqual(headers);
    });

    it('masks values of sensitive keys', () => {
      const result = maskHeaderValues(
        { 'Authorization': 'Bearer my-secret', 'Content-Type': 'application/json' },
        ['Authorization']
      );
      expect(result['Authorization']).toBe(MASKED_VALUE);
      expect(result['Content-Type']).toBe('application/json');
    });

    it('masks multiple sensitive keys', () => {
      const result = maskHeaderValues(
        { 'Authorization': 'Bearer token', 'X-API-Key': 'key123', 'Accept': '*/*' },
        ['Authorization', 'X-API-Key']
      );
      expect(result['Authorization']).toBe(MASKED_VALUE);
      expect(result['X-API-Key']).toBe(MASKED_VALUE);
      expect(result['Accept']).toBe('*/*');
    });
  });

  it('MASKED_VALUE is the expected mask string', () => {
    expect(MASKED_VALUE).toBe('••••••••');
  });
});
