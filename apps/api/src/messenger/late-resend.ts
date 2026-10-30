/**
 * A reply Meta refused seconds after the customer wrote — sent again later.
 *
 * Lumio Agency, 30 Oct 2026 (Demy Nguyen, an ad conversation): Meta answered
 * "outside of allowed window" to the bot's reply for over a minute although
 * the customer had just written. The bot gave up after three tries and
 * nothing ever tried again: the rescue sweep only looks at threads whose last
 * line is the CUSTOMER's, and here the last line was the bot's refused reply.
 * The owner saw "the AI does not answer any more", repeatedly.
 *
 * Now the refused reply keeps a schedule (send-errors FRESH_RETRY_AFTER_MIN)
 * and the sweep sends the SAME text again when it is due — no new model call,
 * no second different answer. It stops the moment it should:
 *   - the reply is no longer the last line (a person answered, or the
 *     customer wrote again and got a fresh reply);
 *   - the conversation is locked to a person, done, or the bot is off;
 *   - the customer's 24 hours are over, or the schedule is spent.
 *
 * Pure (late-resend.spec.ts).
 */
import { FRESH_RETRY_AFTER_MIN } from './send-errors';

export interface RetryTurnLike {
  role: string;
  failed?: boolean;
  retry?: { first: string; n: number; next: string; customerAt?: string | null } | null;
}

export interface RetryThreadLike {
  status?: string | null;
  handoff?: boolean | null;
  handoffMode?: string | null;
  lastCustomerAt?: Date | string | null;
}

export type ResendVerdict =
  | { send: true }
  | { send: false; why: 'not-last' | 'not-refused' | 'not-due' | 'bot-off' | 'closed' | 'locked' | 'too-old' | 'spent' };

const ms = (v: Date | string | null | undefined): number => (v ? (v instanceof Date ? v.getTime() : Date.parse(String(v))) : NaN);

/** Is the kept reply (the thread's last turn) due to be sent again now? */
export function resendVerdict(last: RetryTurnLike | null | undefined, t: RetryThreadLike, botOn: boolean, now = Date.now()): ResendVerdict {
  if (!last || last.role !== 'assistant') return { send: false, why: 'not-last' };
  if (!last.failed || !last.retry) return { send: false, why: 'not-refused' };
  if (!botOn) return { send: false, why: 'bot-off' };
  if (String(t.status ?? 'open').toLowerCase() !== 'open') return { send: false, why: 'closed' };
  if (t.handoff && String(t.handoffMode ?? '').toLowerCase() === 'locked') return { send: false, why: 'locked' };
  const wrote = ms(last.retry.customerAt ?? t.lastCustomerAt ?? null);
  if (!Number.isFinite(wrote) || now - wrote > 23.5 * 3600 * 1000) return { send: false, why: 'too-old' };
  if (last.retry.n >= FRESH_RETRY_AFTER_MIN.length) return { send: false, why: 'spent' };
  const due = ms(last.retry.next);
  if (Number.isFinite(due) && now < due) return { send: false, why: 'not-due' };
  return { send: true };
}

/** After one more resend failed: the next time, or null when the schedule is spent. */
export function nextRetry(retry: { first: string; n: number }, nowMs = Date.now()): { n: number; next: string | null } {
  const n = retry.n + 1;
  if (n >= FRESH_RETRY_AFTER_MIN.length) return { n, next: null };
  const at = Math.max(nowMs + 60_000, Date.parse(retry.first) + FRESH_RETRY_AFTER_MIN[n] * 60_000);
  return { n, next: new Date(at).toISOString() };
}
