/**
 * "THE SALON JUST POSTED" — a signal from the Page webhook to the marketing
 * sync queue, with no module dependency between the two.
 *
 * Meta's `feed` webhook tells us a Page published something. We do not parse
 * the post out of the event (the payload is thin and the shapes vary); we ask
 * the queue to read that salon's month again, which brings the post in with
 * its first numbers. The messenger module calls requestChannelSync(pageId);
 * the marketing module listens. Same pattern as messenger/bot-refresh.ts.
 */

type Listener = (pageId: string, kind: 'feed' | 'media') => void;
const listeners = new Set<Listener>();

export function onChannelSyncRequest(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function requestChannelSync(pageId: string, kind: 'feed' | 'media' = 'feed'): void {
  for (const fn of listeners) {
    try { fn(pageId, kind); } catch { /* a listener's failure is its own */ }
  }
}

/** Does a Page `feed` change mean the PAGE published a post? (Not a visitor, not a like/comment.) */
export function isPagePostChange(value: { item?: string; verb?: string; from?: { id?: string } | null } | null | undefined, pageId: string): boolean {
  if (!value || value.verb !== 'add') return false;
  if (!['post', 'photo', 'video', 'status', 'share', 'reel'].includes(String(value.item ?? ''))) return false;
  if (value.from?.id && String(value.from.id) !== String(pageId)) return false;
  return true;
}
