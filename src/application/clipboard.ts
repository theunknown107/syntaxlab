import { writeClipboard } from '@/infrastructure/browser/clipboard';

/**
 * Copy, as the presentation layer sees it.
 *
 * The layer rules keep components out of infrastructure, and that separation
 * earns its keep here rather than being bureaucracy: this is where the
 * "copying always produces plain text" rule lives. Nothing in the product
 * writes `text/html` to the clipboard, so a pasted explanation can never carry
 * markup into another application (05_SECURITY.md §8).
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  return writeClipboard(text);
}
