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

import { formatMoney } from '../common/money';

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

/**
 * THE CEILINGS, PER CURRENCY — AND WHY ONE NUMBER COULD NOT SERVE BOTH.
 *
 * A ceiling exists so a typo that turns $199 into $19,900 cannot be stored.
 * It was written as a single number, 100,000, meaning "$1,000" — correct for
 * the dollar and nonsense for the đồng, which has no subunit: the stored
 * number IS the amount, so the same ceiling read as 100,000₫, about four
 * dollars. A Vietnamese shop's entry-level plan of 390,000₫ could not be
 * typed in, and the overage ceiling of 100 came out as 100₫ per reply —
 * BELOW what a reply costs us. The only figure the system would accept for a
 * Vietnamese shop was one that loses money on every message.
 *
 * Deliberately a table of literal amounts and NOT a conversion from USD: an
 * exchange rate baked into a validation ceiling silently changes what can be
 * stored every time the rate moves, and nobody would ever connect the two.
 */
const CAPS: Record<string, { monthly: number; overage: number }> = {
  USD: { monthly: 1_000_00, overage: 100 },        // $1,000 / $1.00
  CAD: { monthly: 1_000_00, overage: 100 },        // CA$1,000 / CA$1.00
  VND: { monthly: 50_000_000, overage: 20_000 },   // 50,000,000₫ / 20,000₫
};
const DEFAULT_CAPS = CAPS.USD;

export function capsFor(currency?: string | null): { monthly: number; overage: number } {
  return CAPS[String(currency ?? '').trim().toUpperCase()] ?? DEFAULT_CAPS;
}

/**
 * A stored plan, validated. Junk reads as "no plan", never as a charge.
 *
 * `currency` is optional and omitting it keeps the dollar ceilings, so every
 * caller written before this existed keeps the exact behaviour it had.
 */
export function cleanChatPlan(raw: unknown, currency?: string | null): ChatPlan {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const cap = capsFor(currency);
  return {
    monthlyCents: int(o.monthlyCents, 0, cap.monthly, 0),
    includedReplies: int(o.includedReplies, 0, 1_000_000, 0),
    overageCentsPerReply: int(o.overageCentsPerReply, 0, cap.overage, 0),
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
export function billFor(replies: number, plan: ChatPlan, currency?: string | null): ChatBill {
  const p = cleanChatPlan(plan, currency);
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
export function mayReply(replies: number, plan: ChatPlan, currency?: string | null): boolean {
  return !billFor(replies, plan, currency).stopped;
}

/**
 * The day-by-day line the salon's own screen draws. Counts in, money out —
 * the monthly fee is NOT spread across days, because it is not earned per day
 * and showing it that way invites "why was I charged on a day I was closed".
 */
export function dailyLines(
  byDay: Record<string, number>,
  plan: ChatPlan,
  currency?: string | null,
): { day: string; replies: number; overageReplies: number; overageCents: number }[] {
  const p = cleanChatPlan(plan, currency);
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

/**
 * The one place money becomes a string — now in the salon's own currency.
 *
 * It used to hard-code `$` and divide by 100, which is the same bug
 * common/money.ts was written to end: the đồng has no subunit, so 390,000₫
 * printed as "$3,900.00". Delegating means there is one rule, not two.
 */
export function money(minorUnits: number, currency = 'USD', locale?: string): string {
  return formatMoney(Math.round(Number(minorUnits) || 0), currency, locale ?? (currency === 'VND' ? 'vi-VN' : 'en-US'));
}

/**
 * WHAT A REPLY COSTS US, PER CURRENCY — AND WHY VIETNAM IS DEARER.
 *
 * Measured from the real prompt: about 3,700 cached tokens of system text and
 * tools, a thousand-odd fresh tokens of memory and recent turns, and a couple
 * of hundred tokens of answer, on Haiku. That lands between a third and two
 * thirds of a US cent per reply, so a whole cent is the planning figure — a
 * deliberate over-estimate, because a margin computed from an optimistic cost
 * is a margin that is not there.
 *
 * Vietnam costs more per reply in real terms — Vietnamese tokenises worse than
 * English, the diacritics split words into more pieces, so the same answer is
 * roughly a third dearer to generate, and for a Vietnamese shop the whole
 * conversation is Vietnamese rather than only some of it. Measured range is
 * about 100–160₫, and 200₫ is the planning figure.
 *
 * The two figures are NOT a conversion of one another and should not be read
 * as one: each is its own currency's measured cost rounded up. The dollar
 * figure carries the larger cushion, which is why margins shown for a US tier
 * are understated more than those for a Vietnamese one. What matters, and
 * what the spec enforces, is that every tier still clears a real margin at
 * these deliberately pessimistic numbers.
 */
export const API_COST_BY_CURRENCY: Record<string, number> = {
  USD: 1,
  CAD: 1,
  VND: 200,
};

/** Kept for callers written before the table existed. USD, one cent. */
export const API_COST_CENTS_PER_REPLY = API_COST_BY_CURRENCY.USD;

export function apiCostPerReply(currency?: string | null): number {
  return API_COST_BY_CURRENCY[String(currency ?? '').trim().toUpperCase()] ?? API_COST_BY_CURRENCY.USD;
}

export interface ChatTier {
  id: string;
  vi: string;
  en: string;
  /** The currency every figure in `plan` is denominated in. */
  currency: string;
  plan: ChatPlan;
}

/**
 * THE LADDER, AND THE TWO RULES IT IS BUILT ON.
 *
 * RULE ONE — GOING OVER IS NEVER DEARER THAN STAYING IN.
 *
 * The overage price sits BELOW the plan's own effective price per reply
 * ($99 for 1,000 is 9.9¢ each; the overage is 4¢). The monthly fee buys the
 * product — the bot, the inbox, the booking — and the allowance comes with
 * it; a shop that has a busy month is not being sold something more expensive
 * than what it already bought. An earlier draft of the Vietnamese table had
 * this backwards, charging 600₫ over a 490₫ in-plan rate, which punished a
 * Vietnamese shop for the exact behaviour a US shop was rewarded for.
 *
 * RULE TWO — OUTGROWING A TIER ALWAYS MAKES THE NEXT ONE WORTH BUYING.
 *
 * Run any tier up to the NEXT tier's allowance and the overage has already
 * cost more than the next tier's whole fee. So the upgrade sells itself on
 * arithmetic and nobody has to be talked into it. The tiers are a discount
 * for committing, not a penalty for growing. `ladderIsSound` below checks
 * both rules, and the spec runs it against every market.
 *
 * VIETNAM IS NOT A CONVERSION. $349 is 9.2 million đồng and no Vietnamese
 * shop pays that, while our cost per reply is higher there, not lower. So the
 * Vietnamese ladder runs on a thinner margin by design — roughly 45–60% where
 * the US one runs at 70–90% — and the floor that matters is that the overage
 * must stay clear of cost, which `ladderIsSound` also checks.
 */
export const CHAT_TIERS_BY_MARKET: Record<string, ChatTier[]> = {
  US: [
    { id: 'basic', vi: 'Cơ bản', en: 'Basic', currency: 'USD',
      plan: { monthlyCents: 9900, includedReplies: 1000, overageCentsPerReply: 4, hardCap: false, active: true } },
    { id: 'standard', vi: 'Tiêu chuẩn', en: 'Standard', currency: 'USD',
      plan: { monthlyCents: 16900, includedReplies: 3000, overageCentsPerReply: 3, hardCap: false, active: true } },
    { id: 'pro', vi: 'Cao cấp', en: 'Pro', currency: 'USD',
      plan: { monthlyCents: 34900, includedReplies: 10000, overageCentsPerReply: 2, hardCap: false, active: true } },
  ],
  CA: [
    { id: 'basic', vi: 'Cơ bản', en: 'Basic', currency: 'CAD',
      plan: { monthlyCents: 9900, includedReplies: 1000, overageCentsPerReply: 4, hardCap: false, active: true } },
    { id: 'standard', vi: 'Tiêu chuẩn', en: 'Standard', currency: 'CAD',
      plan: { monthlyCents: 16900, includedReplies: 3000, overageCentsPerReply: 3, hardCap: false, active: true } },
    { id: 'pro', vi: 'Cao cấp', en: 'Pro', currency: 'CAD',
      plan: { monthlyCents: 34900, includedReplies: 10000, overageCentsPerReply: 2, hardCap: false, active: true } },
  ],
  // Đồng has no subunit: these numbers ARE đồng, not hundredths of one.
  VN: [
    { id: 'basic', vi: 'Cơ bản', en: 'Basic', currency: 'VND',
      plan: { monthlyCents: 390_000, includedReplies: 1000, overageCentsPerReply: 350, hardCap: false, active: true } },
    { id: 'standard', vi: 'Tiêu chuẩn', en: 'Standard', currency: 'VND',
      plan: { monthlyCents: 890_000, includedReplies: 3000, overageCentsPerReply: 280, hardCap: false, active: true } },
    { id: 'pro', vi: 'Cao cấp', en: 'Pro', currency: 'VND',
      plan: { monthlyCents: 2_690_000, includedReplies: 10000, overageCentsPerReply: 250, hardCap: false, active: true } },
  ],
};

/** Kept so older imports still resolve. The US ladder. */
export const CHAT_TIERS = CHAT_TIERS_BY_MARKET.US;

/** The ladder for a market code, falling back to the US one. */
export function tiersFor(market?: string | null): ChatTier[] {
  return CHAT_TIERS_BY_MARKET[String(market ?? '').trim().toUpperCase()] ?? CHAT_TIERS_BY_MARKET.US;
}

/** What one reply effectively costs the salon inside a tier's own allowance. */
export function inPlanRate(plan: ChatPlan): number {
  return plan.includedReplies > 0 ? plan.monthlyCents / plan.includedReplies : 0;
}

/**
 * Do both ladder rules hold, and does every price clear cost?
 *
 * Returned as a list of complaints rather than a boolean, because a ladder
 * that fails should say which rung and why — a false is a bug report nobody
 * can act on. Empty means sound.
 */
export function ladderIsSound(tiers: ChatTier[], costPerReply: number): string[] {
  const bad: string[] = [];
  tiers.forEach((t, i) => {
    if (t.plan.overageCentsPerReply <= costPerReply) {
      bad.push(`${t.id}: overage ${t.plan.overageCentsPerReply} is at or below cost ${costPerReply}`);
    }
    if (t.plan.overageCentsPerReply >= inPlanRate(t.plan)) {
      bad.push(`${t.id}: overage ${t.plan.overageCentsPerReply} is dearer than the in-plan rate ${inPlanRate(t.plan).toFixed(1)}`);
    }
    const next = tiers[i + 1];
    if (next) {
      // What staying put costs once you have used the NEXT tier's allowance.
      // The tier's OWN currency, or the ceilings trim a đồng plan to dollar
      // size and the ladder appears broken when it is the check that is.
      const stay = billFor(next.plan.includedReplies, t.plan, t.currency).totalCents;
      if (stay <= next.plan.monthlyCents) {
        bad.push(`${t.id} → ${next.id}: staying on ${t.id} costs ${stay}, which is not more than ${next.plan.monthlyCents}`);
      }
    }
  });
  return bad;
}

/** Margin on a tier at a given volume, as a fraction of what the salon pays. */
export function marginOf(replies: number, plan: ChatPlan, currency?: string | null): number {
  const bill = billFor(replies, plan, currency);
  if (bill.totalCents <= 0) return 0;
  const cost = bill.replies * apiCostPerReply(currency);
  return (bill.totalCents - cost) / bill.totalCents;
}

/** The cheapest tier that covers this volume — what to recommend to a salon. */
export function suggestTier(repliesPerMonth: number, market?: string | null): ChatTier {
  const tiers = tiersFor(market);
  const n = Math.max(0, Math.round(Number(repliesPerMonth) || 0));
  return tiers.find((t) => n <= t.plan.includedReplies) ?? tiers[tiers.length - 1];
}

/** Which listed tier a stored plan matches, if any. Null for a custom deal. */
export function tierIdOf(plan: ChatPlan, market?: string | null): string | null {
  const p = cleanChatPlan(plan, tiersFor(market)[0]?.currency);
  const hit = tiersFor(market).find((t) =>
    t.plan.monthlyCents === p.monthlyCents
    && t.plan.includedReplies === p.includedReplies
    && t.plan.overageCentsPerReply === p.overageCentsPerReply);
  return hit ? hit.id : null;
}
