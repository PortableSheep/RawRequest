import { writeClipboardText, readClipboardText } from './editor-clipboard.utils';

describe('editor-clipboard.utils', () => {
  let originalClipboard: Clipboard;

  beforeEach(() => {
    originalClipboard = navigator.clipboard;
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      writable: true,
      configurable: true
    });
  });

  describe('writeClipboardText', () => {
    it('returns true when Clipboard API succeeds', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
        writable: true,
        configurable: true
      });
      expect(await writeClipboardText('hello')).toBe(true);
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello');
    });

    it('falls back to execCommand when Clipboard API fails, staging the text in a selected off-screen textarea', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
        writable: true,
        configurable: true
      });

      let capturedTextarea: HTMLTextAreaElement | null = null;
      let capturedSelection: { start: number | null; end: number | null } | null = null;
      (document as any).execCommand = vi.fn().mockImplementation(() => {
        capturedTextarea = document.activeElement as HTMLTextAreaElement;
        capturedSelection = {
          start: capturedTextarea?.selectionStart ?? null,
          end: capturedTextarea?.selectionEnd ?? null
        };
        return true;
      });

      expect(await writeClipboardText('test')).toBe(true);
      expect(document.execCommand).toHaveBeenCalledWith('copy');

      expect(capturedTextarea?.tagName).toBe('TEXTAREA');
      expect(capturedTextarea?.value).toBe('test');
      expect(capturedSelection).toEqual({ start: 0, end: 4 });
      // The staged textarea must be removed from the DOM afterward.
      expect(document.body.contains(capturedTextarea)).toBe(false);

      delete (document as any).execCommand;
    });

    it('returns false and still cleans up the staged textarea when execCommand reports failure', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
        writable: true,
        configurable: true
      });
      (document as any).execCommand = vi.fn().mockReturnValue(false);

      const childCountBefore = document.body.childElementCount;
      expect(await writeClipboardText('test')).toBe(false);
      expect(document.body.childElementCount).toBe(childCountBefore);

      delete (document as any).execCommand;
    });

    it('returns false and still cleans up the staged textarea when execCommand throws', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
        writable: true,
        configurable: true
      });
      (document as any).execCommand = vi.fn().mockImplementation(() => {
        throw new Error('blocked');
      });

      const childCountBefore = document.body.childElementCount;
      expect(await writeClipboardText('test')).toBe(false);
      expect(document.body.childElementCount).toBe(childCountBefore);

      delete (document as any).execCommand;
    });

    it('restores the previously focused element after the fallback copy attempt', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
        writable: true,
        configurable: true
      });
      (document as any).execCommand = vi.fn().mockReturnValue(true);

      const button = document.createElement('button');
      document.body.appendChild(button);
      button.focus();
      expect(document.activeElement).toBe(button);

      await writeClipboardText('test');

      expect(document.activeElement).toBe(button);

      document.body.removeChild(button);
      delete (document as any).execCommand;
    });
  });

  describe('readClipboardText', () => {
    it('returns text when Clipboard API succeeds', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { readText: vi.fn().mockResolvedValue('pasted') },
        writable: true,
        configurable: true
      });
      expect(await readClipboardText()).toBe('pasted');
    });

    it('returns null when Clipboard API fails', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { readText: vi.fn().mockRejectedValue(new Error('denied')) },
        writable: true,
        configurable: true
      });
      expect(await readClipboardText()).toBeNull();
    });
  });
});
