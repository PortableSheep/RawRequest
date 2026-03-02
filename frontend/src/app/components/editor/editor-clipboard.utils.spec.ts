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
        value: { writeText: jest.fn().mockResolvedValue(undefined) },
        writable: true,
        configurable: true
      });
      expect(await writeClipboardText('hello')).toBe(true);
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello');
    });

    it('falls back to execCommand when Clipboard API fails', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: jest.fn().mockRejectedValue(new Error('denied')) },
        writable: true,
        configurable: true
      });
      (document as any).execCommand = jest.fn().mockReturnValue(true);
      expect(await writeClipboardText('test')).toBe(true);
      expect(document.execCommand).toHaveBeenCalledWith('copy');
      delete (document as any).execCommand;
    });

    it('returns false when both methods fail', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: jest.fn().mockRejectedValue(new Error('denied')) },
        writable: true,
        configurable: true
      });
      (document as any).execCommand = jest.fn().mockImplementation(() => {
        throw new Error('blocked');
      });
      expect(await writeClipboardText('test')).toBe(false);
      delete (document as any).execCommand;
    });
  });

  describe('readClipboardText', () => {
    it('returns text when Clipboard API succeeds', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { readText: jest.fn().mockResolvedValue('pasted') },
        writable: true,
        configurable: true
      });
      expect(await readClipboardText()).toBe('pasted');
    });

    it('returns null when Clipboard API fails', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { readText: jest.fn().mockRejectedValue(new Error('denied')) },
        writable: true,
        configurable: true
      });
      expect(await readClipboardText()).toBeNull();
    });
  });
});
