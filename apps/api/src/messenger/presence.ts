/**
 * "SEEN" AND THE TYPING DOTS — the customer knows somebody is answering.
 *
 * Until 17/11/2026 a customer who wrote to a salon saw nothing at all for the
 * whole time the AI worked — a median of 14 seconds on production — and then
 * a reply appeared out of silence. A person at a desk does not behave like
 * that: the message shows "Seen", the three dots appear, and the wait is
 * understood. Messenger and Instagram both let a Page do the same
 * (sender_action: mark_seen / typing_on / typing_off).
 *
 * Rules kept here, pure:
 *  - only on the channels that have it (the website widget draws its own
 *    dots; Zalo has no such call);
 *  - never to somebody who asked us to stop writing — nothing follows;
 *  - Meta drops the dots by itself after about twenty seconds, so they are
 *    renewed while the AI is still working, and never kept longer than a
 *    minute — dots that never end are worse than none;
 *  - a failure here is never the customer's problem: nothing waits on it.
 */

export type SenderAction = 'mark_seen' | 'typing_on' | 'typing_off';

/** Renew the dots this often while the AI works (Meta clears them by itself after a while). */
export const TYPING_REFRESH_MS = 6_000;
/**
 * "Seen" first, the dots a moment later — as a person reads, then starts to
 * type. On 17/11/2026 both were sent in the same instant: Meta accepted both,
 * the customer saw "Seen" on phone and desktop, and the dots never appeared.
 * The read receipt and the typing signal are no longer sent back to back.
 */
export const SEEN_TO_TYPING_MS = 800;
/** Never show dots longer than this for one reply. */
export const TYPING_MAX_MS = 60_000;

export function supportsSenderAction(channel: string | null | undefined, pageId?: string | null): boolean {
  const p = String(pageId ?? '');
  if (p.startsWith('web:') || p.startsWith('zalo:')) return false;
  const c = String(channel ?? 'messenger').toLowerCase();
  return c === 'messenger' || c === 'instagram';
}

/** The whole request body: a sender action travels alone, with nothing else of the Send API. */
export function senderActionBody(recipientId: string, action: SenderAction): { recipient: { id: string }; sender_action: SenderAction } {
  return { recipient: { id: recipientId }, sender_action: action };
}

/** Should the dots be renewed, or has this reply taken too long to keep pretending? */
export function typingStep(startedAtMs: number, nowMs: number): 'renew' | 'stop' {
  return nowMs - startedAtMs >= TYPING_MAX_MS ? 'stop' : 'renew';
}

/**
 * Platform counters, so support can see the calls reach Meta — and in what
 * order — without the server's logs. No salon's data, no token.
 */
export interface PresenceStats {
  sent: number; failed: number; lastOkAt: number | null; lastFailAt: number | null; lastError: string | null;
  /** Per action: how many Meta accepted or refused, and when the last accepted one went out. */
  byAction: Record<SenderAction, { ok: number; failed: number; lastOkAt: number | null }>;
}
const fresh = (): PresenceStats => ({
  sent: 0, failed: 0, lastOkAt: null, lastFailAt: null, lastError: null,
  byAction: { mark_seen: { ok: 0, failed: 0, lastOkAt: null }, typing_on: { ok: 0, failed: 0, lastOkAt: null }, typing_off: { ok: 0, failed: 0, lastOkAt: null } },
});
let stats: PresenceStats = fresh();
export function notePresence(ok: boolean, error?: string | null, nowMs = Date.now(), action?: SenderAction): void {
  const per = action ? stats.byAction[action] : null;
  if (ok) {
    stats.sent += 1; stats.lastOkAt = nowMs;
    if (per) { per.ok += 1; per.lastOkAt = nowMs; }
    return;
  }
  stats.failed += 1; stats.lastFailAt = nowMs;
  if (per) per.failed += 1;
  stats.lastError = String(error ?? '').replace(/access_token=[^&\s"]+/gi, 'access_token=…').slice(0, 200) || null;
}
export function presenceStats(): PresenceStats {
  return { ...stats, byAction: { mark_seen: { ...stats.byAction.mark_seen }, typing_on: { ...stats.byAction.typing_on }, typing_off: { ...stats.byAction.typing_off } } };
}
export function resetPresenceStats(): void { stats = fresh(); }
