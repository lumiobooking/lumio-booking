/**
 * Which conversations were left hanging, and may the bot answer them now.
 *
 * WHY THIS EXISTS
 *
 * Every "answer later" in the messenger runs on an in-memory timer: the 4 s
 * burst gather, and the 5-minute grace a GUESSED human gets before the bot
 * answers for them. The API restarts on every deploy. A customer who wrote in
 * those minutes had their line stored, the timer died with the old process,
 * and nothing ever looked again — the salon-update catch-up skips threads a
 * human is guessed to hold, and the conversation mirror only re-answers lines
 * it has never seen. The customer was left on "seen".
 *
 * A periodic sweep asks this function, thread by thread, whether the last
 * word is still the customer's long after every timer should have fired. The
 * rules are deliberately the bot's ordinary ones — nothing here lets the bot
 * speak where it could not have spoken on time:
 *   - the salon's bot is on, the conversation is open (not done, not spam);
 *   - the customer's line is the last one, inside Meta's 24-hour window;
 *   - nobody pressed "Take over" (a locked thread is a person's, forever);
 *   - a person given the conversation answers first unless "bot first" is on;
 *   - a GUESSED human gets their grace: the customer wrote after the human's
 *     last line, and the grace (plus a margin) has run out with no answer.
 *
 * Pure: tested in rescue-stuck.spec.ts.
 */

export interface StuckThreadLike {
  status?: string | null;
  handoff?: boolean | null;
  handoffAt?: Date | string | null;
  handoffMode?: string | null;
  assignedUserId?: string | null;
  lastCustomerAt?: Date | string | null;
  channel?: string | null;
  /** The role of the newest turn in the stored history. */
  lastRole?: 'user' | 'assistant' | string | null;
}

export interface RescueRules {
  botOn: boolean;
  botFirst: boolean;
  /** Grace a guessed human gets before the bot answers (minutes, salon setting). */
  graceMins: number;
  /** How long the live path is given before a line counts as dropped. */
  settleMs?: number;
}

export const RESCUE_WINDOW_MS = 24 * 3600 * 1000;
export const RESCUE_SETTLE_MS = 3 * 60_000;

export type RescueVerdict =
  | { rescue: true; release: boolean }
  | { rescue: false; why: 'bot-off' | 'closed' | 'answered' | 'too-new' | 'too-old' | 'locked' | 'assigned' | 'human-grace' | 'web' };

const ms = (v: Date | string | null | undefined): number | null => {
  if (!v) return null;
  const n = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isFinite(n) ? n : null;
};

export function rescueVerdict(t: StuckThreadLike, rules: RescueRules, now = Date.now()): RescueVerdict {
  // The website chat has its own switch and its visitor is polling a live page;
  // its replies are not deferred the way Meta's are. Left to its own path.
  if (t.channel === 'web') return { rescue: false, why: 'web' };
  if (!rules.botOn) return { rescue: false, why: 'bot-off' };
  if (String(t.status ?? 'open').toLowerCase() !== 'open') return { rescue: false, why: 'closed' };
  if (t.lastRole !== 'user') return { rescue: false, why: 'answered' };
  const wrote = ms(t.lastCustomerAt);
  if (wrote === null) return { rescue: false, why: 'answered' };
  const age = now - wrote;
  if (age > RESCUE_WINDOW_MS) return { rescue: false, why: 'too-old' };
  if (age < (rules.settleMs ?? RESCUE_SETTLE_MS)) return { rescue: false, why: 'too-new' };
  if (t.assignedUserId && !rules.botFirst) return { rescue: false, why: 'assigned' };
  if (!t.handoff) return { rescue: true, release: false };
  if (String(t.handoffMode ?? '').toLowerCase() === 'locked') return { rescue: false, why: 'locked' };
  // A guessed human. Their line must be older than the customer's (otherwise
  // the customer's message was answered by them) and the grace must be over.
  const human = ms(t.handoffAt);
  if (human !== null && human >= wrote) return { rescue: false, why: 'human-grace' };
  const graceMs = Math.max(0, rules.graceMins) * 60_000;
  if (age < graceMs + 60_000) return { rescue: false, why: 'human-grace' };
  return { rescue: true, release: true };
}

/** Meta's mirror may hand the live path a customer line only while it can still be answered. */
export function mayAnswerMirrored(lastAgeMs: number, settleMs: number): boolean {
  return lastAgeMs > settleMs && lastAgeMs < RESCUE_WINDOW_MS;
}
