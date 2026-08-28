/**
 * Deciding when to interrupt somebody.
 *
 * WHY THIS IS A TESTED FUNCTION AND NOT A useEffect
 *
 * An alert has exactly two failure modes and both are severe:
 *
 *   Too quiet — a customer waits, nobody knows, and the salon finds out when
 *               the customer books somewhere else. Silent, so nobody reports it.
 *
 *   Too loud  — the app makes a noise for things that are not new: for the
 *               twenty old conversations already on screen at login, for the
 *               conversation the person is reading right now, for the reply
 *               they just typed themselves. Staff turn the sound off within a
 *               day, and then it is permanently in the first failure mode
 *               anyway — except now nobody can turn it back on without being
 *               annoyed again.
 *
 * The second is what kills notification features, and it is entirely a matter
 * of rules that are easy to state and easy to get wrong. So they live here,
 * with a test each, rather than inside a component where nobody can assert on
 * them.
 */

export interface AlertRow {
  id: string;
  senderName?: string | null;
  lastText?: string | null;
  pageName?: string | null;
  lastMessageAt?: string | null;
  updatedAt: string;
  unread?: boolean;
}

export interface Alert {
  id: string;
  name: string;
  text: string;
  pageName: string | null;
}

export interface AlertMemory {
  /** Conversation id → the message stamp we have already reacted to. */
  seen: Record<string, string>;
  /**
   * Whether we have seen the inbox at least once.
   *
   * False on the very first load, and that load NEVER makes a sound. Opening
   * the app is not news; every conversation in the list looks new to a memory
   * that has never seen anything.
   */
  primed: boolean;
}

export const emptyMemory = (): AlertMemory => ({ seen: {}, primed: false });

const stampOf = (r: AlertRow) => String(r?.lastMessageAt || r?.updatedAt || '');

export interface AlertOptions {
  /** The conversation on screen right now. Reading it IS the acknowledgement. */
  openId?: string | null;
}

/**
 * What changed since last time, and what deserves a noise.
 *
 * Always returns the updated memory, including for the rows it stays silent
 * about — being silent about a message must still count as having seen it, or
 * the same message would come back on the next refresh and every refresh after.
 */
export function nextAlerts(
  memory: AlertMemory,
  rows: AlertRow[],
  opts: AlertOptions = {},
): { memory: AlertMemory; alerts: Alert[] } {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const seen: Record<string, string> = {};
  const alerts: Alert[] = [];

  for (const r of list) {
    const id = String(r.id ?? '');
    if (!id) continue;
    const stamp = stampOf(r);
    seen[id] = stamp;

    if (!memory.primed) continue;                 // first sight of the inbox
    if (memory.seen[id] === stamp) continue;      // nothing new on this one
    if (!r.unread) continue;                      // already answered or read
    if (opts.openId && id === opts.openId) continue; // they are looking at it

    alerts.push({
      id,
      name: String(r.senderName ?? '').trim() || 'Khách',
      text: String(r.lastText ?? '').trim().slice(0, 120),
      pageName: String(r.pageName ?? '').trim() || null,
    });
  }

  // Rows not in `seen` have been dropped from the list; their entries go with
  // them, so the memory cannot grow forever on a busy Page.
  return { memory: { seen, primed: true }, alerts };
}

/** How many conversations are waiting to be read. Drives the red number. */
export function unreadCount(rows: AlertRow[]): number {
  return (Array.isArray(rows) ? rows : []).reduce((n, r) => n + (r && r.unread ? 1 : 0), 0);
}

/**
 * The browser tab's title.
 *
 * The count goes FIRST. A tab is about 15 characters wide when a few are open,
 * so "Lumio — Inbox (3)" shows as "Lumio — In…" and the number, which is the
 * only part that matters, is the part that gets cut off.
 */
export function tabTitle(base: string, count: number): string {
  const b = String(base ?? '').trim() || 'Lumio';
  return count > 0 ? `(${count}) ${b}` : b;
}

/** One line for a system notification. Never the message itself — see below. */
export function alertHeadline(alerts: Alert[], vi: boolean): string {
  if (!alerts.length) return '';
  if (alerts.length === 1) {
    const a = alerts[0];
    return vi ? `${a.name} vừa nhắn tin` : `${a.name} sent a message`;
  }
  return vi ? `${alerts.length} khách vừa nhắn tin` : `${alerts.length} new messages`;
}
