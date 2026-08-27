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
}): Pick {
  const rules: ChatAssignmentRules = { ...DEFAULT_CHAT_RULES, ...(args.rules ?? {}) };
  if (rules.mode !== 'round-robin') return { userId: null, reason: 'rules-off' };

  const onShift = (args.agents ?? []).filter((a) => a && a.onShift && a.userId);
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
