import { detectCapabilities } from './capabilities';

/**
 * Clipboard adapter — 15_API_AND_BROWSER_CAPABILITIES.md §9
 *
 * Write only. SyntaxLab never *reads* the clipboard: reading would pull in
 * content the user did not choose to hand over, and nothing in the product
 * needs it.
 *
 * `writeText` rejects rather than throwing synchronously when permission is
 * denied or the document is not focused, so both outcomes are folded into the
 * boolean and the caller shows a failure state instead of an unhandled
 * rejection.
 */
export async function writeClipboard(text: string): Promise<boolean> {
  if (!detectCapabilities().clipboard) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
