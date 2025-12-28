import { ChainEntryPreview, Request, ResponseData } from '../../models/http.models';
import {
  formatBytesForResponsePanel,
  getChainItemsForResponsePanel,
  getStatusClassForEntry,
  getStatusLabelForEntry
} from './response-panel.logic';

describe('response-panel.logic', () => {
  describe('getChainItemsForResponsePanel', () => {
    it('returns responseData.chainItems when provided', () => {
      const chainItems: ChainEntryPreview[] = [
        {
          id: 'x',
          label: 'X',
          request: { method: 'GET', url: 'https://example.com', headers: {} },
          response: null,
          isPrimary: true
        }
      ];
      const result = getChainItemsForResponsePanel({
        status: 200,
        statusText: 'OK',
        headers: {},
        body: '',
        responseTime: 10,
        chainItems
      }, null);

      expect(result).toBe(chainItems);
    });

    it('builds a single entry from requestPreview when request is null', () => {
      const responseData: ResponseData = {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: '{"ok":true}',
        responseTime: 12,
        assertions: [{ passed: true, message: 'ok', stage: 'post' }],
        requestPreview: {
          name: 'Test',
          method: 'GET',
          url: 'https://example.com',
          headers: { a: 'b' },
          body: '{"in":1}'
        }
      };

      const result = getChainItemsForResponsePanel(responseData, null);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('Test');
      expect(result[0].label).toBe('Test');
      expect(result[0].request).toEqual({
        name: 'Test',
        method: 'GET',
        url: 'https://example.com',
        headers: { a: 'b' },
        body: '{"in":1}'
      });
      expect(result[0].response?.status).toBe(200);
      expect(result[0].response?.assertions).toEqual([{ passed: true, message: 'ok', stage: 'post' }]);
      expect(result[0].isPrimary).toBe(true);

      // Ensure clone semantics for headers
      expect(result[0].request.headers).not.toBe(responseData.requestPreview!.headers);
    });

    it('returns [] when request is null and requestPreview missing', () => {
      const result = getChainItemsForResponsePanel(
        { status: 0, statusText: '', headers: {}, body: '', responseTime: 0 },
        null
      );
      expect(result).toEqual([]);
    });

    it('builds a single entry from Request when provided', () => {
      const request: Request = {
        name: 'From Request',
        method: 'POST',
        url: 'https://example.com/p',
        headers: { h: 'v' },
        body: 'hello'
      };
      const result = getChainItemsForResponsePanel(null, request);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('From Request');
      expect(result[0].label).toBe('From Request');
      expect(result[0].request.body).toBe('hello');
      expect(result[0].request.headers).toEqual({ h: 'v' });
      expect(result[0].isPrimary).toBe(true);
    });
  });

  describe('status formatting', () => {
    it('returns pending label/class when no response', () => {
      const entry: ChainEntryPreview = {
        id: '1',
        label: 'One',
        request: { method: 'GET', url: 'x', headers: {} },
        response: null
      };
      expect(getStatusLabelForEntry(entry)).toBe('Pending');
      expect(getStatusClassForEntry(entry)).toBe('pending');
    });

    it('classifies status ranges correctly', () => {
      const mk = (status: number): ChainEntryPreview => ({
        id: 'x',
        label: 'X',
        request: { method: 'GET', url: 'x', headers: {} },
        response: {
          status,
          statusText: 'T',
          headers: {},
          body: '',
          responseTime: 1
        }
      });

      expect(getStatusClassForEntry(mk(204))).toBe('bg-green-500 text-black');
      expect(getStatusClassForEntry(mk(301))).toBe('bg-yellow-500 text-black');
      expect(getStatusClassForEntry(mk(404))).toBe('bg-red-500 text-white');
      expect(getStatusClassForEntry(mk(0))).toBe('bg-red-500 text-white');
    });
  });

  describe('formatBytesForResponsePanel', () => {
    it('formats bytes using 1024 units', () => {
      expect(formatBytesForResponsePanel(0)).toBe('0 B');
      expect(formatBytesForResponsePanel(1)).toBe('1 B');
      expect(formatBytesForResponsePanel(1024)).toBe('1.0 KB');
      expect(formatBytesForResponsePanel(1024 * 1024)).toBe('1.0 MB');
    });
  });
});
