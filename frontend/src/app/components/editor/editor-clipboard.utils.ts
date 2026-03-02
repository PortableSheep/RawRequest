/**
 * Write text to the clipboard using the Clipboard API with an execCommand fallback.
 * Returns `true` if the write likely succeeded.
 */
export async function writeClipboardText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Best-effort fallback for restricted clipboard environments
    try {
      document.execCommand('copy');
      return true;
    } catch {
      return false;
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
