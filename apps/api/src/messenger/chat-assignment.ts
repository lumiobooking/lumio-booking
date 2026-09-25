/**
 * Which member of staff should answer this conversation.
 *
 * WHY NOT REUSE THE BOOKING ASSIGNMENT ENGINE
 *
 * That one ranks technicians for an APPOINTMENT: it needs the service, the
 * skills, the duration and the slot. A conversation has none of those — nobody
 * has said what they want yet, which is the whole reason a person is answering.
 * The two share an idea (fair round-robin among people who are working) and
 * nothing else, so this is its own small pure function rather than a parameter
 * bolted onto the other.
 *
 * THE RULE THAT PANCAKE CANNOT HAVE
 *
 * `preferUsualTech`. A returning customer goes back to the person who did their
 * last set. A generic inbox does not know who that was; Lumio does, because the
 * appointment is in the same database. It is the difference between "someone
 * from the salon replied" and "Hà replied" — and Hà already knows the shape of
 * her nails and what she said last time.
 *
 * WHEN NOBODY IS PICKED
 *
 * Returning null is a real answer, not a failure: it means the bot keeps the
 * conversation. Handing a customer to a person who is not working, or stacking
 * a fortieth chat on someone already drowning, is worse than a bot reply that
 * arrives immediately.
 */

export interface ChatAgent {
  userId: string;
  name?: string | null;
  /** Working right now, per StaffWorkingHour in the salon's timezone. */
  onShift: boolean;
  /** Conversations they already hold and have not closed. */
  openThreads: number;
}

export interface ChatAssignmentRules {
  /** 'off' = every conversation stays with the bot until a human takes it. */
  mode: 'off' | 'round-robin';
  /**
   * 'strict' = turns in a fixed order, A → B → C → A, skipping whoever is away
   * or full — the salon's own idea of "turn". 'least-busy' = whoever holds the
   * fewest open conversations, ties rotating.
   */
  rotation?: 'strict' | 'least-busy';
  /** 0 = no limit. Above this, a person is skipped. */
  maxOpenPerAgent: number;
  /** Send a returning customer back to the technician they know. */
  preferUsualTech: boolean;
}

export const DEFAULT_CHAT_RULES: ChatAssignmentRules = {
  // Off by default. Turning this on changes who answers customers, which is the
  // salon's decision to make, not a behaviour to acquire by upgrading.
  mode: 'off',
  maxOpenPerAgent: 5,
  preferUsualTech: true,
};

export type PickReason =
  | 'rules-off'
  | 'nobody-on-shift'
  | 'everyone-at-capacity'
  | 'usual-technician'
  | 'round-robin';

export interface Pick {
  userId: string | null;
  reason: PickReason;
}

function hasRoom(a: ChatAgent, cap: number): boolean {
  return cap <= 0 || a.openThreads < cap;
}

/**
 * Deterministic: the same inputs always give the same answer.
 *
 * Not a detail — an assignment that jitters cannot be tested, and cannot be
 * explained to a member of staff who asks why they got a conversation.
 */
export function pickAgent(args: {
  rules?: Partial<ChatAssignmentRules> | null;
  agents: ChatAgent[];
  /** The technician this customer usually sees, if they are a returning one. */
  usualUserId?: string | null;
  /** Who got the previous conversation — the rotation point for ties. */
  lastAssignedUserId?: string | null;
  /** Never this person (passing a conversation ON must not hand it back). */
  excludeUserId?: string | null;
}): Pick {
  const rules: ChatAssignmentRules = { ...DEFAULT_CHAT_RULES, ...(args.rules ?? {}) };
  if (rules.mode !== 'round-robin') return { userId: null, reason: 'rules-off' };

  const onShift = (args.agents ?? []).filter((a) => a && a.onShift && a.userId && a.userId !== args.excludeUserId);
  if (!onShift.length) return { userId: null, reason: 'nobody-on-shift' };

  const available = onShift.filter((a) => hasRoom(a, rules.maxOpenPerAgent));
  if (!available.length) return { userId: null, reason: 'everyone-at-capacity' };

  // The customer's own technician wins, but only if she is actually working and
  // not already full. Otherwise this rule would route people to someone who
  // cannot answer, which is worse than any stranger who can.
  if (rules.preferUsualTech && args.usualUserId) {
    const usual = available.find((a) => a.userId === args.usualUserId);
    if (usual) return { userId: usual.userId, reason: 'usual-technician' };
  }

  // Strict turns: walk the WHOLE team in a fixed order from the person after
  // the last one served, and give it to the first who can take it. The order
  // is the full list, not the available one, so somebody who was away keeps
  // their place in the queue instead of shuffling everyone behind them.
  if ((rules.rotation ?? 'least-busy') === 'strict') {
    // The caller's order IS the queue (the salon's list, or by name).
    const order = [...(args.agents ?? [])].filter((a) => a && a.userId);
    const can = new Set(available.map((a) => a.userId));
    const lastIdx = args.lastAssignedUserId ? order.findIndex((a) => a.userId === args.lastAssignedUserId) : -1;
    for (let i = 1; i <= order.length; i += 1) {
      const cand = order[(lastIdx + i + order.length) % order.length];
      if (cand && can.has(cand.userId)) return { userId: cand.userId, reason: 'round-robin' };
    }
    return { userId: null, reason: 'everyone-at-capacity' };
  }

  // Fewest open conversations first — that is the fairness that matters, since
  // a strict rotation hands work to someone already buried.
  const fewest = Math.min(...available.map((a) => a.openThreads));
  const tied = available.filter((a) => a.openThreads === fewest);
  if (tied.length === 1) return { userId: tied[0].userId, reason: 'round-robin' };

  // Ties rotate: start after whoever got the last one, so two idle people do
  // not both sit at zero while one of them takes everything.
  const order = [...tied].sort((a, b) => a.userId.localeCompare(b.userId));
  const lastIdx = args.lastAssignedUserId
    ? order.findIndex((a) => a.userId === args.lastAssignedUserId)
    : -1;
  const next = order[(lastIdx + 1) % order.length];
  return { userId: next.userId, reason: 'round-robin' };
}

/**
 * Is this member of staff working at `minutesLocal` on `weekday`?
 *
 * Times are stored as "09:00" strings in the salon's local time, so the caller
 * resolves the salon clock first — the same discipline the booking page needed
 * after it read a Vietnamese salon's Sunday off a Californian browser.
 */
export function isOnShift(
  hours: { dayOfWeek: number; startTime: string; endTime: string; isActive?: boolean }[] | null | undefined,
  weekday: number,
  minutesLocal: number,
): boolean {
  const toMins = (hm: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm ?? '').trim());
    if (!m) return null;
    const h = Number(m[1]);
    const mm = Number(m[2]);
    if (h > 23 || mm > 59) return null;
    return h * 60 + mm;
  };
  return (hours ?? []).some((w) => {
    if (!w || w.isActive === false || w.dayOfWeek !== weekday) return false;
    const open = toMins(w.startTime);
    const close = toMins(w.endTime);
    // A window that closes before it opens is bad data, not an all-day shift.
    if (open === null || close === null || close <= open) return false;
    return minutesLocal >= open && minutesLocal < close;
  });
}

/**
 * Is this person taking turns right now?
 *
 * Up to three tests, each switched on or off by the salon: they said they are
 * Available, they are inside their working hours, and they have Lumio open.
 * A person must pass every test that is on. Someone with no schedule at all
 * (an owner who is not on the roster) is not failed by the shift test — the
 * test has nothing to say about them.
 */
export interface DutyRules { needStatus: boolean; needShift: boolean; needOnline: boolean; onlineMins: number }
export const DEFAULT_DUTY: DutyRules = { needStatus: true, needShift: true, needOnline: true, onlineMins: 10 };

export function isOnDuty(p: {
  status?: string | null;
  /** null = no schedule on file. */
  onShift: boolean | null;
  lastSeenAt?: Date | string | null;
}, rules: Partial<DutyRules> | null | undefined, now: Date = new Date()): boolean {
  const r = { ...DEFAULT_DUTY, ...(rules ?? {}) };
  if (r.needStatus && String(p.status ?? 'available') === 'away') return false;
  if (r.needShift && p.onShift === false) return false;
  if (r.needOnline) {
    const t = p.lastSeenAt ? new Date(p.lastSeenAt).getTime() : NaN;
    if (!Number.isFinite(t)) return false;
    if (now.getTime() - t > Math.max(1, r.onlineMins) * 60_000) return false;
  }
  return true;
}

/**
 * Should this conversation be passed to the next person?
 *
 * Only a conversation that is open, was GIVEN to someone (assignedAt), has not
 * already been passed on the maximum number of times, and whose person has
 * not done the thing the salon asked for in time:
 *   - unread: nobody opened it since it was given (readAt before assignedAt);
 *   - unreplied: no human answered since it was given (handoffAt before it).
 * Someone who pressed Take over holds it for good — never passed on.
 */
export interface ReassignRules { unreadMins: number; unrepliedMins: number; maxHops: number }

export function reassignDue(t: {
  status?: string | null;
  assignedUserId?: string | null;
  assignedAt?: Date | string | null;
  readAt?: Date | string | null;
  handoffAt?: Date | string | null;
  handoffMode?: string | null;
  assignHops?: number | null;
}, rules: ReassignRules, now: Date = new Date()): null | 'reassign-unread' | 'reassign-unreplied' {
  if (String(t.status ?? 'open') !== 'open' || !t.assignedUserId || !t.assignedAt) return null;
  if (String(t.handoffMode ?? '') === 'locked') return null;
  if ((t.assignHops ?? 0) >= Math.max(0, rules.maxHops)) return null;
  const at = new Date(t.assignedAt).getTime();
  if (!Number.isFinite(at)) return null;
  const age = now.getTime() - at;
  const after = (v: Date | string | null | undefined) => (v ? new Date(v).getTime() >= at : false);
  if (rules.unreadMins > 0 && age >= rules.unreadMins * 60_000 && !after(t.readAt)) return 'reassign-unread';
  if (rules.unrepliedMins > 0 && age >= rules.unrepliedMins * 60_000 && !after(t.handoffAt)) return 'reassign-unreplied';
  return null;
}
