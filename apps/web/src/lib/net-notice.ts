/**
 * When a request cannot reach the server, what — if anything — to tell the person.
 *
 * WHY THIS EXISTS
 *
 * "Lâu lâu báo mất kết nối mạng." Every fetch that threw used to raise the
 * same red "Mất kết nối mạng" toast, and most of those were not a lost
 * connection at all:
 *
 *   - the browser cancelling requests on purpose because the page is leaving
 *     (pressing "Connect TikTok", a reload, a link) — the toast flashed on the
 *     way out of every OAuth screen;
 *   - a background refresh (inbox, bell, walk-in board) that ran the moment a
 *     laptop woke from sleep, before Wi-Fi was back;
 *   - the few seconds Render takes to swap in a new deploy, when its proxy
 *     answers without CORS headers and the browser reports a network error.
 *
 * Three of those fix themselves a second later, and a red alarm for them
 * teaches staff to ignore the one that matters. So: cancelled requests are
 * silent; a failed GET is retried once quietly (api.ts) and only then
 * reported, softly, at most once per NET_TOAST_GAP_MS; a failed SAVE is always
 * reported, because the person must know their change did not land — and the
 * words say which it was: the device is offline, or the server did not answer.
 */

export const NET_TOAST_GAP_MS = 20_000;
export const GET_RETRY_DELAY_MS = 1_200;

export interface NetFailure {
  method: string;
  /** The request was cancelled (AbortController / page navigation). */
  aborted: boolean;
  /** The page is unloading — a reload, a link, an OAuth redirect. */
  unloading: boolean;
  /** navigator.onLine; null when unknown. */
  online: boolean | null;
  now: number;
  /** When the last network notice was shown (0 = never). */
  lastShownAt: number;
  vi: boolean;
}

export type NetNotice = { kind: 'error' | 'info'; text: string } | null;

export function isAbortError(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name;
  return name === 'AbortError';
}

export function networkNotice(f: NetFailure): NetNotice {
  if (f.aborted || f.unloading) return null;
  const write = String(f.method).toUpperCase() !== 'GET';
  const L = (vi: string, en: string) => (f.vi ? vi : en);
  if (write) {
    // A save that did not land is never silent and never throttled.
    return f.online === false
      ? { kind: 'error', text: L('Mất kết nối mạng — thao tác chưa được lưu. Kiểm tra Wi‑Fi rồi bấm lại.', 'You are offline — this was not saved. Check Wi‑Fi and try again.') }
      : { kind: 'error', text: L('Chưa gọi được máy chủ — thao tác chưa được lưu. Bấm lại sau vài giây.', 'Could not reach the server — this was not saved. Try again in a few seconds.') };
  }
  if (f.now - f.lastShownAt < NET_TOAST_GAP_MS) return null;
  return f.online === false
    ? { kind: 'error', text: L('Mất kết nối mạng — kiểm tra Wi‑Fi.', 'You are offline — check Wi‑Fi.') }
    : { kind: 'info', text: L('Máy chủ phản hồi chậm — hệ thống đang tự thử lại.', 'The server is slow to answer — retrying by itself.') };
}
