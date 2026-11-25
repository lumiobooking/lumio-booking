/**
 * THE INBOX, SORTED BY WHO MUST ACT (17/11/2026).
 *
 * The first inbox sorted by read and unread. That says who LOOKED at a
 * conversation, not who owes the customer an answer — and with an AI replying
 * first, almost every row is "unread" and almost none of them is work. On
 * 17/11 the agency's own page showed 95 unread of 100 and "waiting for a
 * person: 0", while one customer's question from 05:58 had sat unanswered for
 * five hours and three more were waiting on a teammate who had taken them over.
 *
 * So every conversation is put in exactly one pile:
 *
 *   needs — a person must answer (nobody claimed it; the teammate holding it
 *           has not answered the customer's last message; the AI is off; or
 *           the AI was given its five minutes and said nothing)
 *   ai    — the AI has it; nothing to do
 *   held  — a person answered last; the ball is with the customer
 *   done / spam
 *
 * Pure rules, no React — the screen (components/InboxView) only draws them.
 */
import { followUpState, isSpamRow, stateOf, systemEventOf, type InboxRow } from './inbox-view';

export type InboxQueue = 'needs' | 'ai' | 'followup' | 'closing' | 'mine' | 'done' | 'all' | 'spam';
export type Pile = 'needs' | 'ai' | 'held' | 'done' | 'spam';
export type PileWhy =
  | 'unclaimed' | 'holder' | 'ai-off' | 'ai-missed'   // needs
  | 'ai-working' | 'ai-answered' | 'closer'           // ai
  | 'answered' | 'done' | 'spam';

/** The AI is given this long before an unanswered customer is called a person's job. */
export const AI_MISSED_AFTER_MIN = 5;
/** Past Meta's seven-day window nobody can reply at all — it is not work any more. */
export const STALE_AFTER_MIN = 7 * 24 * 60;

/** rt236: show a conversation as "closing" when Meta's 7-day window shuts within this many hours. */
export const CLOSING_WITHIN_H = 48;

/**
 * rt236 — Hours until Lumio can no longer message this customer (Meta's 7
 * days from the CUSTOMER's last message), or null when not in the last
 * CLOSING_WITHIN_H hours of it. Whoever wrote last does not matter: the clock
 * runs from the customer's message.
 */
export function closingInHours(row: Pick<InboxRow, 'lastCustomerAt'>, now: Date = new Date()): number | null {
  const at = Date.parse(String(row.lastCustomerAt ?? ''));
  if (!Number.isFinite(at)) return null;
  const left = (at + STALE_AFTER_MIN * 60_000 - now.getTime()) / 3_600_000;
  return left > 0 && left <= CLOSING_WITHIN_H ? Math.max(1, Math.floor(left)) : null;
}

/** How long the customer has been waiting on their own last message, in minutes. Null when they did not write last. */
export function waitedMinutes(row: Pick<InboxRow, 'customerLast' | 'lastCustomerAt'>, now: Date = new Date()): number | null {
  if (!row.customerLast || !row.lastCustomerAt) return null;
  const at = Date.parse(row.lastCustomerAt);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.floor((now.getTime() - at) / 60_000));
}

export function pileOf(row: InboxRow, now: Date = new Date()): { pile: Pile; why: PileWhy; waited: number | null } {
  if (isSpamRow(row)) return { pile: 'spam', why: 'spam', waited: null };
  const state = stateOf(row);
  if (state === 'done') return { pile: 'done', why: 'done', waited: null };
  const waited = waitedMinutes(row, now);
  if (state === 'unclaimed') return { pile: 'needs', why: 'unclaimed', waited: waited ?? (typeof row.waitingMinutes === 'number' ? row.waitingMinutes : null) };
  // Owed = the customer wrote last, it was a real message, and a reply can still be sent.
  const owed = waited !== null && waited <= STALE_AFTER_MIN && !row.closer && !systemEventOf(row.lastText);
  if (state === 'human') return owed ? { pile: 'needs', why: 'holder', waited } : { pile: 'held', why: 'answered', waited: null };
  if (row.botOff) return owed ? { pile: 'needs', why: 'ai-off', waited } : { pile: 'held', why: 'answered', waited: null };
  if (owed && (waited as number) >= AI_MISSED_AFTER_MIN) return { pile: 'needs', why: 'ai-missed', waited };
  if (owed) return { pile: 'ai', why: 'ai-working', waited };
  return { pile: 'ai', why: row.customerLast && row.closer ? 'closer' : 'ai-answered', waited: null };
}

/** "4 phút", "5 giờ", "2 ngày" — one unit, the way a person says it. */
export function waitText(mins: number, vi: boolean): string {
  if (mins < 1) return vi ? 'vừa xong' : 'just now';
  if (mins < 60) return vi ? `${mins} phút` : `${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return vi ? `${h} giờ` : `${h}h`;
  const d = Math.floor(h / 24);
  return vi ? `${d} ngày` : `${d}d`;
}

export type PileTone = 'bad' | 'warn' | 'ai' | 'muted';

/** The one status line under a row: who has it, and for how long the customer has waited. */
export function pileLabel(row: InboxRow, vi: boolean, now: Date = new Date()): { text: string; tone: PileTone } {
  const { why, waited } = pileOf(row, now);
  const w = waited === null ? '' : ` · ${waitText(waited, vi)}`;
  const tone: PileTone = waited !== null && waited >= 60 ? 'bad' : 'warn';
  const who = String(row.assignedName ?? '').trim();
  switch (why) {
    case 'unclaimed': return { text: (vi ? 'Chờ người trả lời' : 'Waiting for a person') + w, tone };
    case 'holder': return { text: (who ? (vi ? `Chờ ${who} trả lời` : `Waiting for ${who}`) : (vi ? 'Chờ người trả lời' : 'Waiting for a person')) + w, tone };
    case 'ai-off': return { text: (vi ? 'AI đang tắt' : 'AI is off') + w, tone };
    case 'ai-missed': return { text: (vi ? 'AI chưa trả lời' : 'AI has not answered') + w, tone };
    case 'ai-working': return { text: vi ? 'AI đang trả lời' : 'AI is answering', tone: 'ai' };
    case 'closer': return { text: vi ? 'Khách đã chào · AI không hỏi thêm' : 'Customer signed off · AI left it', tone: 'ai' };
    case 'ai-answered': return { text: vi ? 'AI đã trả lời' : 'AI answered', tone: 'ai' };
    case 'answered': return { text: who ? (vi ? `${who} đã trả lời · chờ khách` : `${who} answered · waiting on customer`) : (vi ? 'Đã trả lời · chờ khách' : 'Answered · waiting on customer'), tone: 'muted' };
    case 'done': return { text: vi ? 'Đã xong' : 'Done', tone: 'muted' };
    default: return { text: 'Spam', tone: 'muted' };
  }
}

/** Longest wait first — the person who has waited five hours is not below the one who has waited four minutes. */
function byWait(now: Date) {
  return (a: InboxRow, b: InboxRow) => (pileOf(b, now).waited ?? 0) - (pileOf(a, now).waited ?? 0);
}

/** The rows of one queue, in the order they are worked. `rows` arrive already filtered by channel / search / label and newest first. */
export function queueRows(rows: InboxRow[], queue: InboxQueue, meId: string | null | undefined, now: Date = new Date()): InboxRow[] {
  if (queue === 'spam') return rows.filter(isSpamRow);
  const live = rows.filter((r) => !isSpamRow(r));
  switch (queue) {
    case 'needs': return live.filter((r) => pileOf(r, now).pile === 'needs').sort(byWait(now));
    case 'ai': return live.filter((r) => pileOf(r, now).pile === 'ai');
    case 'done': return live.filter((r) => pileOf(r, now).pile === 'done');
    case 'closing': return live.filter((r) => pileOf(r, now).pile !== 'done' && closingInHours(r, now) !== null)
      .sort((a, b) => (closingInHours(a, now) ?? 0) - (closingInHours(b, now) ?? 0));
    case 'followup': return live.filter((r) => followUpState(r.followUpAt, now) !== 'none')
      .sort((a, b) => (Date.parse(String(a.followUpAt)) || 0) - (Date.parse(String(b.followUpAt)) || 0));
    // With no id to compare against, "mine" would be silently empty; everything is the honest failure.
    case 'mine': return meId ? live.filter((r) => r.assignedUserId === meId && pileOf(r, now).pile !== 'done') : live;
    default: return live;
  }
}

export interface QueueCounts { needs: number; ai: number; followup: number; due: number; closing: number; mine: number; done: number; all: number; spam: number; longest: number }

export function queueCounts(rows: InboxRow[], meId: string | null | undefined, now: Date = new Date()): QueueCounts {
  const c: QueueCounts = { needs: 0, ai: 0, followup: 0, due: 0, closing: 0, mine: 0, done: 0, all: 0, spam: 0, longest: 0 };
  for (const r of rows ?? []) {
    const p = pileOf(r, now);
    if (p.pile === 'spam') { c.spam += 1; continue; }
    c.all += 1;
    if (p.pile === 'needs') { c.needs += 1; c.longest = Math.max(c.longest, p.waited ?? 0); }
    if (p.pile === 'ai') c.ai += 1;
    if (p.pile === 'done') c.done += 1;
    const fu = followUpState(r.followUpAt, now);
    if (fu !== 'none') c.followup += 1;
    if (fu === 'overdue' || fu === 'today') c.due += 1;
    if (meId && r.assignedUserId === meId && p.pile !== 'done') c.mine += 1;
    if (p.pile !== 'done' && closingInHours(r, now) !== null) c.closing += 1;
  }
  return c;
}

/**
 * The list as the screen draws it: the people who are waiting first (longest
 * wait on top), then what the AI is handling, then the rest. In the "needs"
 * queue the AI's conversations still follow underneath — the person answering
 * should see at a glance that the others are being looked after.
 */
export function inboxSections(rows: InboxRow[], queue: InboxQueue, meId: string | null | undefined, now: Date = new Date()): { key: 'needs' | 'ai' | 'rest'; rows: InboxRow[] }[] {
  if (queue === 'needs' || queue === 'all') {
    const needs = queueRows(rows, 'needs', meId, now);
    const ai = queueRows(rows, 'ai', meId, now);
    const out: { key: 'needs' | 'ai' | 'rest'; rows: InboxRow[] }[] = [];
    if (needs.length) out.push({ key: 'needs', rows: needs });
    if (ai.length) out.push({ key: 'ai', rows: ai });
    if (queue === 'all') {
      const taken = new Set([...needs, ...ai].map((r) => r.id));
      const rest = rows.filter((r) => !isSpamRow(r) && !taken.has(r.id));
      if (rest.length) out.push({ key: 'rest', rows: rest });
    }
    return out;
  }
  const flat = queueRows(rows, queue, meId, now);
  return flat.length ? [{ key: 'rest', rows: flat }] : [];
}

/**
 * Why the AI sent nothing on this conversation (the server keeps the reason
 * as a code — api messenger/ai-why). Said to the person about to answer, in
 * their language; an unknown code says nothing rather than something wrong.
 */
export function aiWhyText(code: string | null | undefined, vi: boolean): string | null {
  switch (code) {
    case 'silent_rule': return vi ? 'AI không trả lời vì dặn dò của tiệm nói loại tin này để người trả lời' : 'The AI stayed silent: your instructions say a person answers this kind of message';
    case 'silent_choice': return vi ? 'AI không trả lời vì thấy tin này cần người của tiệm trả lời' : 'The AI stayed silent: it judged this message needs a person';
    case 'held_rule': return vi ? 'AI đã soạn câu trả lời nhưng câu đó trái dặn dò của tiệm nên không gửi' : 'The AI wrote a reply, but it went against your instructions, so it was not sent';
    case 'held_safety': return vi ? 'AI đã soạn câu trả lời nhưng không chắc là đúng nên không gửi' : 'The AI wrote a reply but was not sure it was right, so it was not sent';
    case 'failed': return vi ? 'AI gặp lỗi khi trả lời tin này' : 'The AI hit an error on this message';
    default: return null;
  }
}
