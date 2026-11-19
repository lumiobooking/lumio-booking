/**
 * Chia turn đợt 1 (19/11/2026) — pure rules.
 *
 *  1. A team member's OWN Messenger as a notification channel, within Meta's
 *     rules: the Page may only write to a person who wrote to it in the last
 *     24 hours. So the person links their Messenger once (a short code from
 *     Lumio, sent to the Page), and at the start of a shift sends "vào ca" —
 *     that opens the 24-hour window, and new turns are announced there with
 *     "Nhận khách" / "Bỏ qua" buttons. "ra ca" ends it.
 *  2. A customer who came from an ad is passed on sooner.
 *  3. A customer left waiting too long is escalated to the owner/managers once.
 */

export const LINKS_KEY = 'messenger.staff_links';
export const CODES_KEY = 'messenger.staff_link_codes';
export const CLAIM_PREFIX = 'LUMIO_CLAIM:';
export const SKIP_PREFIX = 'LUMIO_SKIP:';
/** Meta's window is 24 h; we stop a little before so a send never bounces. */
export const WINDOW_MS = 23.5 * 3600_000;

export type StaffLink = { userId: string; pageId: string; psid: string; linkedAt: string; lastAt: string; on: boolean };
export type LinkCode = { userId: string; exp: string };

const fold = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase().replace(/\s+/g, ' ').trim();

export type StaffCommand =
  | { kind: 'link'; code: string }
  | { kind: 'on' }
  | { kind: 'off' }
  | { kind: 'claim'; threadId: string }
  | { kind: 'skip'; threadId: string }
  | { kind: 'other' };

/** What a message to the Page means when it may come from a team member. */
export function parseStaffCommand(text: unknown, payload?: unknown): StaffCommand | null {
  const p = String(payload ?? '');
  const id = (pre: string) => (p.startsWith(pre) ? p.slice(pre.length) : '');
  if (id(CLAIM_PREFIX) && /^[A-Za-z0-9_-]{1,64}$/.test(id(CLAIM_PREFIX))) return { kind: 'claim', threadId: id(CLAIM_PREFIX) };
  if (id(SKIP_PREFIX) && /^[A-Za-z0-9_-]{1,64}$/.test(id(SKIP_PREFIX))) return { kind: 'skip', threadId: id(SKIP_PREFIX) };
  const t = fold(text);
  const m = /^lumio\s*[-:#]?\s*(\d{6})$/.exec(t);
  if (m) return { kind: 'link', code: m[1] };
  if (/^(vao ca|bat dau ca|vao lam|start shift|on shift)$/.test(t)) return { kind: 'on' };
  if (/^(ra ca|het ca|tan ca|nghi ca|end shift|off shift)$/.test(t)) return { kind: 'off' };
  return null;
}

export function cleanLinks(raw: unknown): Record<string, StaffLink> {
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const out: Record<string, StaffLink> = {};
  for (const [userId, v] of Object.entries(o)) {
    const x = (v ?? {}) as Record<string, unknown>;
    const psid = String(x.psid ?? ''); const pageId = String(x.pageId ?? '');
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(userId) || !/^\d{3,40}$/.test(psid) || !/^\d{3,40}$/.test(pageId)) continue;
    out[userId] = { userId, psid, pageId, linkedAt: String(x.linkedAt ?? ''), lastAt: String(x.lastAt ?? ''), on: x.on === true };
  }
  return out;
}

export function cleanCodes(raw: unknown, now: Date): Record<string, LinkCode> {
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const out: Record<string, LinkCode> = {};
  for (const [code, v] of Object.entries(o)) {
    const x = (v ?? {}) as Record<string, unknown>;
    const exp = new Date(String(x.exp ?? ''));
    if (/^\d{6}$/.test(code) && typeof x.userId === 'string' && Number.isFinite(exp.getTime()) && exp > now) out[code] = { userId: x.userId, exp: exp.toISOString() };
  }
  return out;
}

/** The team member this Messenger sender is, on this Page (null = a customer). */
export function linkOf(links: Record<string, StaffLink>, pageId: string, psid: string): StaffLink | null {
  return Object.values(links).find((l) => l.pageId === pageId && l.psid === psid) ?? null;
}

/** May the Page write to this person now: on shift, and they wrote within the window. */
export function windowOpen(l: StaffLink | null | undefined, now: Date): boolean {
  if (!l?.on) return false;
  const at = new Date(l.lastAt).getTime();
  return Number.isFinite(at) && now.getTime() - at < WINDOW_MS;
}

/** The alert for a new or passed-on turn. */
export function turnAlert(o: { customer: string; lastText: string | null; channel: string; fromAd: boolean; hop: boolean; mins: number }): string {
  const head = o.fromAd ? '🔔 Khách mới từ QUẢNG CÁO' : o.hop ? '🔁 Turn chuyển sang bạn' : '🔔 Bạn có khách mới';
  const ch = o.channel === 'instagram' ? 'Instagram' : o.channel === 'zalo' ? 'Zalo' : o.channel === 'web' ? 'Chat web' : 'Messenger';
  const said = o.lastText ? `\n“${String(o.lastText).replace(/\s+/g, ' ').slice(0, 140)}”` : '';
  const due = o.mins > 0 ? `\n⏱ Trả lời trong ${o.mins} phút, quá giờ sẽ chuyển người khác.` : '';
  return `${head}\n${o.customer} · ${ch}${said}${due}`;
}

/**
 * Does this webhook event say the customer came from an ad? Click-to-Messenger
 * and Instagram ads put a referral with source "ADS" (and an ad id) on the
 * first message; where Meta puts it varies, so every place is looked at.
 */
export function adIdOf(ev: unknown): string | null {
  const e = (ev ?? {}) as { referral?: unknown; message?: { referral?: unknown }; postback?: { referral?: unknown } };
  for (const r of [e.referral, e.message?.referral, e.postback?.referral]) {
    const x = (r ?? null) as { source?: unknown; ad_id?: unknown; ads_context_data?: { ad_title?: unknown } } | null;
    if (!x) continue;
    const ad = x.ad_id != null ? String(x.ad_id) : '';
    if (ad && /^[A-Za-z0-9_-]{1,64}$/.test(ad)) return ad;
    if (String(x.source ?? '').toUpperCase() === 'ADS') return 'ad';
  }
  return null;
}

/** An ad customer counts as one for a day after the ad brought them. */
export function isAdThread(t: { adId?: string | null; adAt?: Date | string | null }, now: Date): boolean {
  if (!t.adId || !t.adAt) return false;
  const at = new Date(t.adAt).getTime();
  return Number.isFinite(at) && now.getTime() - at < 24 * 3600_000;
}

/** The "unanswered" minutes for this thread: the ad setting when it applies and is set. */
export function unrepliedMinsFor(t: { adId?: string | null; adAt?: Date | string | null }, set: { reassignUnrepliedMins: number; reassignAdMins: number }, now: Date): number {
  return isAdThread(t, now) && set.reassignAdMins > 0 ? set.reassignAdMins : set.reassignUnrepliedMins;
}

/**
 * When the turn passes on if nobody acts — for the countdown in the Inbox.
 * Null when it will not pass on (not assigned, already answered, hops used up,
 * nothing set).
 */
export function turnDueAt(t: {
  status?: string | null; assignedUserId?: string | null; assignedAt?: Date | string | null; readAt?: Date | string | null;
  handoffAt?: Date | string | null; assignHops?: number | null; adId?: string | null; adAt?: Date | string | null;
}, set: { reassignUnreadMins: number; reassignUnrepliedMins: number; reassignAdMins: number; maxHops: number }, now: Date): Date | null {
  if (String(t.status ?? 'open') !== 'open' || !t.assignedUserId || !t.assignedAt) return null;
  if ((t.assignHops ?? 0) >= Math.max(0, set.maxHops)) return null;
  const at = new Date(t.assignedAt).getTime();
  if (!Number.isFinite(at)) return null;
  const after = (v: Date | string | null | undefined) => (v ? new Date(v).getTime() >= at : false);
  if (after(t.handoffAt)) return null;
  const cand: number[] = [];
  const un = unrepliedMinsFor(t, { reassignUnrepliedMins: set.reassignUnrepliedMins, reassignAdMins: set.reassignAdMins }, now);
  if (un > 0) cand.push(at + un * 60_000);
  if (set.reassignUnreadMins > 0 && !after(t.readAt)) cand.push(at + Math.min(set.reassignUnreadMins, un > 0 ? un : Infinity) * 60_000);
  return cand.length ? new Date(Math.min(...cand)) : null;
}

/**
 * Should the owner/managers be told now? A customer has waited `mins` since
 * their last message with no human answer after it, and nobody was told
 * about this wait yet.
 */
export function escalationDue(t: { status?: string | null; lastCustomerAt?: Date | string | null; handoffAt?: Date | string | null; escalatedAt?: Date | string | null }, mins: number, now: Date): boolean {
  if (!(mins > 0) || String(t.status ?? 'open') !== 'open' || !t.lastCustomerAt) return false;
  const last = new Date(t.lastCustomerAt).getTime();
  if (!Number.isFinite(last) || now.getTime() - last < mins * 60_000) return false;
  if (t.handoffAt && new Date(t.handoffAt).getTime() >= last) return false;
  if (t.escalatedAt && new Date(t.escalatedAt).getTime() >= last) return false;
  return true;
}
