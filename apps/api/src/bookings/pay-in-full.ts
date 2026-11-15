/**
 * PAY THE WHOLE VISIT INSTEAD OF THE DEPOSIT.
 *
 * A salon that asks a deposit may let the client pay everything online at
 * booking (DepositSettings.allowPayInFull). The client's choice only says
 * WHICH of two server-computed amounts is charged — never how much: the
 * deposit the salon's rule asks, or the booking's own price. It is written
 * once, by the server, as the amount of the booking's held online row, and
 * every later step (checkout, the provider check, the sweep) reads it back
 * from there. Pure: no database (pay-in-full.spec.ts).
 */
import type { MoneyChoice } from './deposit-policy';

/** What the held online row is created for: the deposit, or the whole price when allowed and asked. */
export function holdAmount(i: { depositCents: number; priceCents: number; allow: boolean; asked: boolean }): { cents: number; full: boolean } {
  const dep = Math.max(0, Math.round(i.depositCents || 0));
  const price = Math.max(0, Math.round(i.priceCents || 0));
  if (dep > 0 && i.allow && i.asked && price > dep) return { cents: price, full: true };
  return { cents: dep, full: false };
}

/**
 * What a booking with a deposit rule owes online, read back from its held row:
 * the whole price only when that row was written for it (above the deposit,
 * at most the price). Anything else — no row, a row for the deposit, a row
 * that does not fit — is the deposit.
 */
export function dueFromHold(i: { depositCents: number; priceCents: number; holdCents: number | null | undefined }): { base: number; kind: 'deposit' | 'full' } {
  const dep = Math.max(0, Math.round(i.depositCents || 0));
  const hold = Math.round(i.holdCents ?? 0);
  if (dep > 0 && hold > dep && hold <= Math.round(i.priceCents || 0)) return { base: hold, kind: 'full' };
  return { base: dep, kind: 'deposit' };
}

/**
 * The deposit a late cancellation keeps. A client who paid the whole visit
 * (at least its price) and the salon's 'all' rule: everything paid. Anyone
 * else — a deposit payer, card fee included — the deposit, as before.
 */
export function keptOnLate(i: { depositCents: number; paidCents: number; priceCents: number; fullLateKeep?: 'deposit' | 'all' | null }): number {
  const dep = Math.max(0, Math.round(i.depositCents || 0));
  const paid = Math.max(0, Math.round(i.paidCents || 0));
  const price = Math.max(0, Math.round(i.priceCents || 0));
  if (i.fullLateKeep === 'all' && dep > 0 && price > 0 && paid >= price) return paid;
  return dep;
}

export type { MoneyChoice };
