/**
 * ĐẶT CỌC BÀN ĐÔNG — a per-guest deposit for big parties.
 *
 * A restaurant's reservation has no price (the meal is ordered at the
 * table), so the salon deposit — a % or a fixed sum of the booking's price,
 * capped at that price — was always 0 for a table. A party of 12 that never
 * comes empties a third of the room on a Saturday. This rule asks a deposit
 * of `perPersonCents` × party size from `fromParty` guests up, through the
 * same deposit flow (taken online, kept on no-show, refunded on cancel,
 * credited at the bill). OFF by default. Pure.
 */
export interface PartyDeposit { enabled: boolean; fromParty: number; perPersonCents: number }

export const PARTY_DEPOSIT_KEY = 'party_deposit';
export const DEFAULT_PARTY_DEPOSIT: PartyDeposit = { enabled: false, fromParty: 8, perPersonCents: 1000 };

const int = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : null;

export function cleanPartyDeposit(input: unknown, base: PartyDeposit = DEFAULT_PARTY_DEPOSIT): PartyDeposit {
  const o = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : base.enabled,
    fromParty: int(o.fromParty, 2, 100) ?? base.fromParty,
    perPersonCents: int(o.perPersonCents, 0, 100_000_000) ?? base.perPersonCents,
  };
}

/** The party deposit for this many guests; 0 when off or below the threshold. */
export function partyDepositCents(partySize: number | null | undefined, p: PartyDeposit): number {
  const n = Math.max(1, Math.round(Number(partySize) || 1));
  if (!p.enabled || p.perPersonCents <= 0 || n < p.fromParty) return 0;
  return n * p.perPersonCents;
}
