import { shouldCollapseAccidentalSelection } from './editor.component.logic';
import { buildActiveRequestPreview, buildActiveRequestMeta } from '../../logic/app/app.component.logic';

describe('Editor Regression Tests', () => {
  describe('Bug: accidental selection on scroll+click', () => {
    it('should collapse any selection created without prior selection', () => {
      expect(
        shouldCollapseAccidentalSelection({
          hadSelectionBefore: false,
          selectionEmptyAfter: false,
          fromLineNumber: 5,
          toLineNumber: 6
        })
      ).toBe(true);
    });

    it('should collapse even single-line selections from scroll+click', () => {
      expect(
        shouldCollapseAccidentalSelection({
          hadSelectionBefore: false,
          selectionEmptyAfter: false,
          fromLineNumber: 1,
          toLineNumber: 1
        })
      ).toBe(true);
    });

    it('should not collapse when user had an intentional selection', () => {
      expect(
        shouldCollapseAccidentalSelection({
          hadSelectionBefore: true,
          selectionEmptyAfter: false,
          fromLineNumber: 1,
          toLineNumber: 50
        })
      ).toBe(false);
    });

    it('should not collapse when click resulted in empty selection (cursor placement)', () => {
      expect(
        shouldCollapseAccidentalSelection({
          hadSelectionBefore: false,
          selectionEmptyAfter: true,
          fromLineNumber: 10,
          toLineNumber: 10
        })
      ).toBe(false);
    });
  });

  describe('Bug: unresolved variable in URL display', () => {
    it('should prefer processedUrl over raw variable syntax in preview', () => {
      const preview = buildActiveRequestPreview(
        { method: 'GET', url: '{{baseUrl}}/users', headers: {} } as any,
        'https://api.example.com/users'
      );
      expect(preview).not.toContain('{{');
      expect(preview).toContain('https://api.example.com/users');
    });

    it('should fall back to raw URL when no processedUrl available', () => {
      const preview = buildActiveRequestPreview(
        { method: 'GET', url: '{{baseUrl}}/users', headers: {} } as any
      );
      expect(preview).toContain('{{baseUrl}}');
    });

    it('should prefer processedUrl in idle meta line', () => {
      const meta = buildActiveRequestMeta({
        activeRequestInfo: { type: 'single', startedAt: 0 },
        isRequestRunning: false,
        isCancellingActiveRequest: false,
        nowMs: 0,
        activeRunProgress: null,
        activeRequestTimeoutMs: null,
        request: { method: 'GET', url: '{{host}}/api', headers: {} } as any,
        processedUrl: 'https://resolved.example.com/api'
      });
      expect(meta).not.toContain('{{');
      expect(meta).toContain('https://resolved.example.com/api');
    });

    it('should fall back to raw URL in meta when processedUrl is null', () => {
      const meta = buildActiveRequestMeta({
        activeRequestInfo: { type: 'single', startedAt: 0 },
        isRequestRunning: false,
        isCancellingActiveRequest: false,
        nowMs: 0,
        activeRunProgress: null,
        activeRequestTimeoutMs: null,
        request: { method: 'POST', url: '{{baseUrl}}/data', headers: {} } as any,
        processedUrl: null
      });
      expect(meta).toContain('{{baseUrl}}');
    });

    it('should resolve multiple template variables in processedUrl without body', () => {
      const preview = buildActiveRequestPreview(
        { method: 'POST', url: '{{host}}/{{version}}/{{path}}', headers: {}, body: '{"a":1}' } as any,
        'https://api.example.com/v2/users'
      );
      expect(preview).not.toContain('{{');
      expect(preview).toContain('https://api.example.com/v2/users');
      expect(preview).not.toContain('{"a":1}');
    });
  });
});
