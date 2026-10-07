/**
 * NO-SHOW POLICY — what a salon does about clients who book and don't come.
 *
 * The sweeper already marks a missed booking NO_SHOW and the customer list
 * counts them. The policy turns the count into something the desk sees:
 *   warnAt         — the desk sees "⚠ didn't show N times" while booking
 *                    (default 2; 0 = never warn);
 *   blockOnlineAt  — from this many no-shows, online/chat/phone-bot bookings
 *                    for that number are refused politely ("please call the
 *                    salon") and the desk decides (default null = never);
 *   months         — only no-shows in this window count (default 12).
 * No fee is charged by Lumio: a deposit is the salon's own payment setting.
 * Pure.
 */
export interface NoShowPolicy { warnAt: number; blockOnlineAt: number | null; months: number }

export const NO_SHOW_POLICY_KEY = 'no_show_policy';
export const DEFAULT_NO_SHOW_POLICY: NoShowPolicy = { warnAt: 2, blockOnlineAt: null, months: 12 };

const int = (v: unknown, lo: number, hi: number): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : null;
};

/** A stored or submitted policy, made safe; missing parts keep `base`. */
export function cleanNoShowPolicy(input: unknown, base: NoShowPolicy = DEFAULT_NO_SHOW_POLICY): NoShowPolicy {
  const o = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const warnAt = 'warnAt' in o ? int(o.warnAt, 0, 20) ?? base.warnAt : base.warnAt;
  let blockOnlineAt = base.blockOnlineAt;
  if ('blockOnlineAt' in o) {
    const b = o.blockOnlineAt === null || o.blockOnlineAt === '' ? null : int(o.blockOnlineAt, 1, 20);
    blockOnlineAt = b;
  }
  const months = 'months' in o ? int(o.months, 1, 36) ?? base.months : base.months;
  return { warnAt, blockOnlineAt, months };
}

export function windowStart(policy: NoShowPolicy, now = new Date()): Date {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - policy.months);
  return d;
}

export function noShowVerdict(count: number, policy: NoShowPolicy): { warn: boolean; blockOnline: boolean } {
  return {
    warn: policy.warnAt > 0 && count >= policy.warnAt,
    blockOnline: policy.blockOnlineAt !== null && count >= policy.blockOnlineAt,
  };
}

/** What the customer (or the chat bot / phone assistant on their behalf) is told. Never says why. */
export const NO_SHOW_BLOCK_MESSAGE = 'Online booking is not available for this phone number. Please call the salon to book.';
