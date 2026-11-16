/**
 * GIA HẠN — what a longer visit costs (owner, 16/11/2026: "mục thêm thời lượng
 * làm việc thì tiền sẽ tính thế nào… còn phương án nào tiện hơn không").
 *
 * "+15m / +30m / +60m" on a visit used to move only the end time; the price
 * stayed. Now each salon picks how an extension is priced (one setting row):
 *
 *   prorate — the main service's own rate: $100 for 60 min → +30 min = $50.
 *             Nothing to set up. The default.
 *   per15   — a fixed price for every 15 minutes, set once by the owner.
 *   free    — time only, no money (the old behaviour).
 *
 * The desk still decides every time: the app shows "+30 phút · +$50?" with
 * "Tính thêm" and "Không tính". A charged extension is a line on the visit
 * ("Gia hạn 30 phút"), so it is on the bill, and taking the time back off
 * (−15m) gives the money back from that line.
 */

export const EXTENSION_KEY = 'extension_pricing';
export type ExtensionMode = 'prorate' | 'per15' | 'free';
export interface ExtensionPolicy { mode: ExtensionMode; per15Cents: number }

export const DEFAULT_POLICY: ExtensionPolicy = { mode: 'prorate', per15Cents: 0 };

export function policyFrom(v: unknown): ExtensionPolicy {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const mode: ExtensionMode = o.mode === 'per15' || o.mode === 'free' ? o.mode : 'prorate';
  const per15 = Math.max(0, Math.min(100_000_000, Math.round(Number(o.per15Cents) || 0)));
  return { mode, per15Cents: per15 };
}

/** The money unit a price is rounded to: whole dollars, whole thousand đồng. */
export function roundUnit(currency: string | null | undefined): number {
  const c = String(currency ?? 'USD').toUpperCase();
  if (c === 'VND') return 1000;
  if (c === 'JPY' || c === 'KRW') return 1;
  return 100;
}

/**
 * The price of `minutes` more (or less, negative) on a visit whose main
 * service costs `mainPriceCents` for `mainMinutes`. Never negative for a
 * positive extension; 0 when the policy is free or the rate is unknown.
 */
export function extensionCharge(
  policy: ExtensionPolicy,
  o: { minutes: number; mainPriceCents: number; mainMinutes: number; currency?: string | null },
): number {
  const m = Math.round(o.minutes);
  if (!m || policy.mode === 'free') return 0;
  const unit = roundUnit(o.currency);
  let raw = 0;
  if (policy.mode === 'per15') raw = (policy.per15Cents * m) / 15;
  else if (o.mainMinutes > 0 && o.mainPriceCents > 0) raw = (o.mainPriceCents * m) / o.mainMinutes;
  const rounded = Math.round(raw / unit) * unit;
  // A short extension on a cheap service still costs something, not zero.
  if (raw > 0 && rounded === 0) return unit;
  if (raw < 0 && rounded === 0) return -unit;
  return rounded;
}

export interface ExtLine { id?: string; name?: string; priceCents?: number; durationMinutes?: number; kind?: string; staffMemberId?: string | null }

export function extensionName(minutes: number, lang: 'vi' | 'en'): string {
  return lang === 'vi' ? `Gia hạn ${minutes} phút` : `Extra ${minutes} min`;
}

/**
 * Take `minutes` back off the visit's charged extension lines, newest first,
 * returning their money in proportion. Lines emptied are dropped. What could
 * not be taken from a charged line is returned as `left` (plain time).
 */
export function shrinkExtensions(lines: ExtLine[], minutes: number, lang: 'vi' | 'en'): { lines: ExtLine[]; refundCents: number; left: number } {
  let left = Math.max(0, Math.round(minutes));
  let refund = 0;
  const out = [...lines];
  for (let i = out.length - 1; i >= 0 && left > 0; i--) {
    const l = out[i];
    if (l.kind !== 'extension') continue;
    const mins = Math.max(0, l.durationMinutes ?? 0);
    const price = Math.max(0, l.priceCents ?? 0);
    if (!mins) continue;
    const take = Math.min(mins, left);
    const back = take === mins ? price : Math.round((price * take) / mins);
    refund += back;
    left -= take;
    if (take === mins) out.splice(i, 1);
    else out[i] = { ...l, durationMinutes: mins - take, priceCents: price - back, name: extensionName(mins - take, lang) };
  }
  return { lines: out, refundCents: refund, left };
}
