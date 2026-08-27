/**
 * Who has the floor in a conversation, and whether the bot may speak.
 *
 * WHY THIS REPLACES A BOOLEAN
 *
 * There was one flag, `handoff`, meaning "a human is here". It could not tell
 * apart the two situations that need opposite treatment:
 *
 *   - The system GUESSED a human is here, because a reply appeared in the Meta
 *     inbox that we did not send. That guess goes stale: the person may have
 *     answered one message and walked away. Handing the thread back to the bot
 *     after a while is right.
 *
 *   - A person DELIBERATELY took the conversation. That is not a guess and it
 *     does not go stale. Taking it back from them is wrong.
 *
 * Treating both as the same flag meant "Take over" bought fifteen minutes and
 * then the bot spoke over the human anyway. It contradicted a salesperson
 * mid-pitch in front of a customer, and it answered "Hi Hai" into a live
 * conversation. Both were reported as the bot behaving strangely; both were
 * this one missing distinction.
 *
 * WHAT THE STATES ARE FOR
 *
 * `unclaimed` is the one that did not exist before and matters most for a team.
 * A conversation routed to a person who has not opened it yet is not "a human
 * is handling this" — it is a customer waiting with nobody reading. The old
 * badge said "human handling" for threads whose last human message was nine
 * hours old. A label that cannot distinguish "being handled" from "abandoned"
 * is worse than no label, because it stops people looking.
 *
 * Pure functions, no database: these rules are the ones worth testing, and the
 * ones a wrong answer costs a customer.
 */

export type Ownership = 'bot' | 'unclaimed' | 'human' | 'done';

/** How a human came to have the floor. */
export type HandoffMode =
  /** Inferred from an echo we did not send. Expires — the person may be gone. */
  | 'auto'
  /** Someone pressed "Take over". Never expires; only they can release it. */
  | 'locked';

export interface ThreadLike {
  handoff?: boolean | null;
  handoffAt?: Date | string | null;
  handoffMode?: string | null;
  assignedUserId?: string | null;
  status?: string | null;
  /** When the customer last wrote. Drives the waiting timer and the 24h window. */
  lastCustomerAt?: Date | string | null;
}

export interface OwnershipView {
  state: Ownership;
  /** Who is expected to answer, if anyone. */
  assignedUserId: string | null;
  /** May the bot send into this thread right now? */
  botMaySpeak: boolean;
  /**
   * Why, in a form the inbox can turn into a badge. Never invented at the call
   * site, so the dashboard and the webhook can never describe the same thread
   * differently.
   */
  reason:
    | 'no-human-involved'
    | 'human-holding'
    | 'human-recently-active'
    | 'human-went-quiet'
    | 'waiting-for-assignee'
    | 'closed';
}

/** Minutes a GUESSED human keeps the floor after their last message. */
export const DEFAULT_ACTIVE_MINS = 15;

function asTime(v: Date | string | null | undefined): number | null {
  if (!v) return null;
  const ms = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isFinite(ms) ? ms : null;
}

export function handoffModeOf(raw: unknown): HandoffMode {
  // Anything unrecognised is 'auto' — the expiring kind. A stored value nobody
  // recognises must not silently grant a permanent lock.
  return String(raw ?? '').trim().toLowerCase() === 'locked' ? 'locked' : 'auto';
}

export function ownershipOf(thread: ThreadLike | null | undefined, opts?: {
  now?: Date;
  activeMins?: number;
}): OwnershipView {
  const assignedUserId = thread?.assignedUserId ? String(thread.assignedUserId) : null;
  const base = { assignedUserId };

  if (!thread) {
    return { ...base, state: 'bot', botMaySpeak: true, reason: 'no-human-involved' };
  }

  // Closed by hand. A new customer message reopens it — that is the caller's
  // job on receipt, not something to infer here, because "the customer wrote
  // again" is an event, not a property of the row.
  if (String(thread.status ?? '').trim().toLowerCase() === 'done') {
    return { ...base, state: 'done', botMaySpeak: false, reason: 'closed' };
  }

  if (thread.handoff) {
    const mode = handoffModeOf(thread.handoffMode);
    if (mode === 'locked') {
      // The whole point. No timer, no grace, no way for the bot to take this
      // back on its own.
      return { ...base, state: 'human', botMaySpeak: false, reason: 'human-holding' };
    }

    const now = (opts?.now ?? new Date()).getTime();
    const at = asTime(thread.handoffAt);
    const activeMs = Math.max(1, opts?.activeMins ?? DEFAULT_ACTIVE_MINS) * 60_000;

    // No timestamp means we cannot show the guess has gone stale, so we do not
    // claim it has. Yielding too long costs minutes; talking over a colleague
    // mid-sentence cannot be undone in front of the customer.
    if (at === null) {
      return { ...base, state: 'human', botMaySpeak: false, reason: 'human-recently-active' };
    }
    if (now - at < activeMs) {
      return { ...base, state: 'human', botMaySpeak: false, reason: 'human-recently-active' };
    }
    // The guess has gone stale. This is the case the old badge kept calling
    // "human handling" hours after everyone had left.
    return { ...base, state: 'bot', botMaySpeak: true, reason: 'human-went-quiet' };
  }

  // Routed to somebody who has not taken it yet. The customer is waiting and
  // nobody is reading — the state the old flag had no way to express.
  if (assignedUserId) {
    return { ...base, state: 'unclaimed', botMaySpeak: false, reason: 'waiting-for-assignee' };
  }

  return { ...base, state: 'bot', botMaySpeak: true, reason: 'no-human-involved' };
}

/**
 * How long the customer has been waiting for a person, in whole minutes.
 *
 * Only meaningful while somebody owes them an answer, so it returns null for a
 * thread the bot is handling — a number there would be read as a problem when
 * the bot has already replied.
 */
export function waitingMinutes(thread: ThreadLike | null | undefined, now: Date = new Date()): number | null {
  const view = ownershipOf(thread, { now });
  if (view.state !== 'unclaimed' && view.state !== 'human') return null;
  const at = asTime(thread?.lastCustomerAt);
  if (at === null) return null;
  const mins = Math.floor((now.getTime() - at) / 60_000);
  return mins < 0 ? 0 : mins;
}

/**
 * Meta only allows a normal reply within 24 hours of the customer's last
 * message. Past that the send is refused, so the composer has to say so BEFORE
 * someone types a long answer — finding out after pressing send is how a reply
 * gets lost and the customer hears nothing.
 */
export const MESSAGING_WINDOW_HOURS = 24;

export function replyWindow(thread: ThreadLike | null | undefined, now: Date = new Date()): {
  open: boolean;
  minutesLeft: number | null;
} {
  const at = asTime(thread?.lastCustomerAt);
  // Never heard from them, so there is no window to be inside of.
  if (at === null) return { open: false, minutesLeft: null };
  const closesAt = at + MESSAGING_WINDOW_HOURS * 3_600_000;
  const left = Math.floor((closesAt - now.getTime()) / 60_000);
  return left > 0 ? { open: true, minutesLeft: left } : { open: false, minutesLeft: 0 };
}
