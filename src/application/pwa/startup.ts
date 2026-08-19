import { setJsonInput } from '../json/jsonWorkspace';
import { setPattern } from '../regex/regexWorkspace';
import { isAnalysisMode, setMode } from '../stores/workspaceStore';
import { takePendingInput } from './pwaStore';

/**
 * Startup that belongs to the PWA — 07_PWA_OFFLINE.md §4.1, §6
 *
 * Two small jobs, both of which run once before anything else is rendered.
 */

/**
 * Restores whatever an update reload interrupted.
 *
 * Accepting an update costs a page load, and a page load would otherwise cost
 * the user their editor contents. The buffers are written to `sessionStorage`
 * immediately before the reload and picked up here.
 *
 * **The stored value is untrusted**, exactly like a history record: it is in
 * web storage, so anything in the origin can rewrite it. Every field is
 * checked and applied through the ordinary setters rather than assigned into
 * the store, so a hostile value goes through the same path a typed one does.
 */
export function restorePendingInput(): boolean {
  const raw = takePendingInput();
  if (raw === null) return false;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null) return false;

  const record = parsed as Record<string, unknown>;
  const mode = record.mode;
  if (isAnalysisMode(mode)) setMode(mode);

  if (typeof record.pattern === 'string' && record.pattern !== '') setPattern(record.pattern);
  if (typeof record.jsonInput === 'string' && record.jsonInput !== '') {
    setJsonInput(record.jsonInput);
  }
  return true;
}

/**
 * Applies `?mode=` from a manifest shortcut — 07_PWA_OFFLINE.md §6.
 *
 * The one exception to "there is no router" (ADR-009), and it stays an
 * exception because it is an enum check rather than a parser: three known
 * values, anything else ignored. The parameter is then stripped with
 * `replaceState` so it does not linger in the address bar or in a shared link.
 */
export function applyModeFromUrl(): void {
  if (typeof window === 'undefined') return;

  let url: URL;
  try {
    url = new URL(window.location.href);
  } catch {
    return;
  }

  const requested = url.searchParams.get('mode');
  if (requested === null) return;

  if (isAnalysisMode(requested)) setMode(requested);

  url.searchParams.delete('mode');
  const search = url.searchParams.toString();
  window.history.replaceState(
    null,
    '',
    `${url.pathname}${search === '' ? '' : `?${search}`}${url.hash}`,
  );
}
