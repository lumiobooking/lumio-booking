/**
 * WHAT A SALON PAYS FOR ITS CHATBOT, AND WHAT IT IS TOLD.
 *
 * WHY THE UNIT IS "A REPLY THE BOT SENT"
 *
 * Three units were possible and two of them are wrong:
 *
 *   - TOKENS are what Anthropic bills us. They are also meaningless to a nail
 *     salon owner. A bill she cannot check is a bill she disputes.
 *   - INBOUND MESSAGES include stickers, "hi", "👍", and the four lines
 *     somebody sends while typing one thought. Charging for those means
 *     charging for things the bot did not do.
 *   - A REPLY THE BOT SENT is the unit of work delivered, it is countable, it
 *     is visible in her own inbox, and she can audit it by scrolling. That is
 *     the one.
 *
 * A reply a HUMAN typed is never billed, for the same reason the phone agent
 * does not bill calls staff picked up: she is paying for the robot's work, not
 * for her own.
 *
 * WHY A BUNDLE AND NOT PURE PER-MESSAGE
 *
 * Pure per-message billing makes a quiet month look like a broken product and
 * a busy month like a punishment for success. A monthly fee with an included
 * allowance, and a small per-reply charge past it, is what the voice line
 * already does, what the salon already understands from her phone bill, and
 * what lets her plan. `hardCap` exists so a runaway month cannot produce a
 * bill nobody agreed to.
 *
 * MONEY IS IN CENTS, ALWAYS, AND INTEGER
 *
 * Floating-point dollars accumulate error across thousands of rows and produce
 * invoices that are a cent out — which costs more in support time than the
 * cent. Every figure here is an integer number of US cents.
 */

export interface ChatPlan {
  /** What the salon pays every month regardless of use. */
  monthlyCents: number;
  /** Replies included in that fee. 0 = everything is charged per reply. */
  includedReplies: number;
  /** Charged for each reply past the allowance. */
  overageCentsPerReply: number;
  /**
   * Stop the bot when the allowance runs out instead of charging overage.
   * Off by default: a shop that hits its limit at lunchtime on a Saturday and
   * silently stops answering customers has been harmed, not protected. On is
   * for a shop that explicitly asked never to be surprised.
   */
  hardCap: boolean;
  /** Nothing is billed until the agency turns the plan on for this salon. */
  active: boolean;
}

export const DEFAULT_CHAT_PLAN: ChatPlan = {
  monthlyCents: 0,
  includedReplies: 0,
  overageCentsPerReply: 0,
  hardCap: false,
  active: false,
};

const int = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;
};

/** A stored plan, validated. Junk reads as "no plan", never as a charge. */
export function cleanChatPlan(raw: unknown): ChatPlan {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    // Ceilings are deliberate: a typo that turns $199 into $19,900 should be
    // impossible to store, not merely unlikely to be typed.
    monthlyCents: int(o.monthlyCents, 0, 1_000_00, 0),
    includedReplies: int(o.includedReplies, 0, 1_000_000, 0),
    overageCentsPerReply: int(o.overageCentsPerReply, 0, 100, 0),
    hardCap: o.hardCap === true,
    active: o.active === true,
  };
}

export interface ChatBill {
  /** Replies the bot sent in the period. */
  replies: number;
  includedReplies: number;
  /** Replies past the allowance. */
  overageReplies: number;
  monthlyCents: number;
  overageCents: number;
  /** What the month costs in total. */
  totalCents: number;
  /** How much of the allowance is gone, 0-1. Above 1 when in overage. */
  used: number;
  /** True when a hard-capped plan has run out and the bot has stopped. */
  stopped: boolean;
}

/**
 * The bill for a period. Pure arithmetic on integers — no clock, no database,
 * so an invoice can be recomputed from stored counts years later and come out
 * to the same cent.
 */
export function billFor(replies: number, plan: ChatPlan): ChatBill {
  const p = cleanChatPlan(plan);
  const n = Math.max(0, Math.round(Number(replies) || 0));
  if (!p.active) {
    return { replies: n, includedReplies: 0, overageReplies: 0, monthlyCents: 0, overageCents: 0, totalCents: 0, used: 0, stopped: false };
  }
  const overageReplies = p.includedReplies > 0 ? Math.max(0, n - p.includedReplies) : n;
  // A hard cap does not bill overage — it refuses to produce any.
  const overageCents = p.hardCap ? 0 : overageReplies * p.overageCentsPerReply;
  return {
    replies: n,
    includedReplies: p.includedReplies,
    overageReplies: p.hardCap ? 0 : overageReplies,
    monthlyCents: p.monthlyCents,
    overageCents,
    totalCents: p.monthlyCents + overageCents,
    used: p.includedReplies > 0 ? n / p.includedReplies : (n > 0 ? 1 : 0),
    stopped: p.hardCap && p.includedReplies > 0 && n >= p.includedReplies,
  };
}

/**
 * May the bot answer right now?
 *
 * Only ever false for a hard-capped plan that has run out. Every other shape
 * of "over the limit" bills and keeps answering, because a customer asking
 * about a Saturday appointment must not meet silence over a billing threshold.
 */
export function mayReply(replies: number, plan: ChatPlan): boolean {
  return !billFor(replies, plan).stopped;
}

/**
 * The day-by-day line the salon's own screen draws. Counts in, money out —
 * the monthly fee is NOT spread across days, because it is not earned per day
 * and showing it that way invites "why was I charged on a day I was closed".
 */
export function dailyLines(
  byDay: Record<string, number>,
  plan: ChatPlan,
): { day: string; replies: number; overageReplies: number; overageCents: number }[] {
  const p = cleanChatPlan(plan);
  const days = Object.keys(byDay).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  let running = 0;
  return days.map((day) => {
    const replies = Math.max(0, Math.round(Number(byDay[day]) || 0));
    const before = running;
    running += replies;
    if (!p.active || p.hardCap) return { day, replies, overageReplies: 0, overageCents: 0 };
    // Only the part of THIS day that fell past the allowance — so the day the
    // allowance ran out shows the split rather than the whole day's count.
    const overageReplies = p.includedReplies > 0
      ? Math.max(0, running - Math.max(before, p.includedReplies))
      : replies;
    return { day, replies, overageReplies, overageCents: overageReplies * p.overageCentsPerReply };
  });
}

/** "$199.00" from 19900. The one place money becomes a string. */
export function money(cents: number): string {
  const n = Math.round(Number(cents) || 0);
  return `$${(n / 100).toFixed(2)}`;
}

/**
 * The tiers to offer, and what each really costs us.
 *
 * `apiCostCents` is OUR cost per reply at the measured rate (roughly a cent
 * per reply, see common/ai-usage and the Messenger prompt sizes). It is here
 * so a price can never be set below cost by accident, and so the Super Admin
 * screen can show the margin instead of asking somebody to work it out.
 */
export const API_COST_CENTS_PER_REPLY = 1;

export const CHAT_TIERS: { id: string; vi: string; en: string; plan: ChatPlan }[] = [
  {
    id: 'basic', vi: 'Cơ bản', en: 'Basic',
    plan: { monthlyCents: 9900, includedReplies: 1000, overageCentsPerReply: 5, hardCap: false, active: true },
  },
  {
    id: 'standard', vi: 'Tiêu chuẩn', en: 'Standard',
    plan: { monthlyCents: 19900, includedReplies: 3000, overageCentsPerReply: 4, hardCap: false, active: true },
  },
  {
    id: 'pro', vi: 'Cao cấp', en: 'Pro',
    plan: { monthlyCents: 39900, includedReplies: 10000, overageCentsPerReply: 3, hardCap: false, active: true },
  },
];

/** Margin on a tier at a given volume, as a fraction of what the salon pays. */
export function marginOf(replies: number, plan: ChatPlan): number {
  const bill = billFor(replies, plan);
  if (bill.totalCents <= 0) return 0;
  const cost = bill.replies * API_COST_CENTS_PER_REPLY;
  return (bill.totalCents - cost) / bill.totalCents;
}

/** The cheapest tier that covers this volume — what to recommend to a salon. */
export function suggestTier(repliesPerMonth: number): { id: string; vi: string; en: string; plan: ChatPlan } {
  const n = Math.max(0, Math.round(Number(repliesPerMonth) || 0));
  const fits = CHAT_TIERS.find((t) => n <= t.plan.includedReplies);
  return fits ?? CHAT_TIERS[CHAT_TIERS.length - 1];
}
