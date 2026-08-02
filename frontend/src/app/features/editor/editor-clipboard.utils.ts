/**
 * Write text to the clipboard using the Clipboard API with an execCommand fallback.
 * Returns `true` if the write likely succeeded.
 */
export async function writeClipboardText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Best-effort fallback for restricted clipboard environments.
    return execCommandCopyFallback(text);
  }
}

/**
 * Copies `text` via document.execCommand('copy'). execCommand('copy') only
 * ever copies the document's *current selection* — calling it directly
 * (with nothing selected, or the wrong thing selected) silently copies
 * nothing useful. To make it actually copy `text`, stage it in a temporary,
 * off-screen textarea, select that textarea's contents, then copy.
 */
function execCommandCopyFallback(text: string): boolean {
  const previouslyFocused = document.activeElement as HTMLElement | null;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  // Keep it out of the visible layout/viewport (and out of tab order) while
  // still focusable/selectable, which execCommand('copy') requires.
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.width = '1px';
  textarea.style.height = '1px';
  textarea.style.padding = '0';
  textarea.style.border = 'none';
  textarea.style.outline = 'none';
  textarea.style.boxShadow = 'none';
  textarea.style.background = 'transparent';
  textarea.style.opacity = '0';
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.setAttribute('tabindex', '-1');

  document.body.appendChild(textarea);

  try {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
    if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
      previouslyFocused.focus();
    }
  }
}

/**
 * Read text from the clipboard. Returns `null` if the read fails.
 */
export async function readClipboardText(): Promise<string | null> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}
