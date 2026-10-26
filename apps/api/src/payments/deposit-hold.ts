/**
 * A DEPOSIT HOLDS THE SLOT — FOR A WHILE.
 *
 * A booking that asks a deposit is created the moment the customer presses
 * Book, before she pays, so nobody else takes her time while she is on the
 * provider's payment page. It carries one PENDING online payment row marked
 * HOLD_REF. Paid → that row becomes PAID. Not paid within the salon's
 * `holdMinutes` → the booking is cancelled and the slot freed (0 = never;
 * the booking then simply stays "pay at the salon", the old behaviour).
 * Pure.
 */
export const HOLD_REF = 'hold:deposit';
export const DEFAULT_HOLD_MINUTES = 30;
export const HOLD_CHOICES = [0, 10, 15, 20, 30, 45, 60, 120, 240] as const;
/** Online payments started within this window are still checked with the provider. */
export const RECONCILE_HOURS = 48;

/** The salon's hold, cleaned: one of HOLD_CHOICES, else the default. */
export function holdMinutesOf(d: { holdMinutes?: unknown } | null | undefined): number {
  const v = d?.holdMinutes;
  return typeof v === 'number' && (HOLD_CHOICES as readonly number[]).includes(v) ? v : DEFAULT_HOLD_MINUTES;
}

/** Has this hold run out? */
export function holdExpired(createdAt: Date, holdMinutes: number, now: Date): boolean {
  return holdMinutes > 0 && now.getTime() - createdAt.getTime() >= holdMinutes * 60_000;
}

/** The provider took at least what was due (1 cent of rounding allowed). */
export function amountCovers(paidCents: number | undefined, dueCents: number): boolean {
  return paidCents === undefined || paidCents + 1 >= dueCents;
}

/** Statuses a lapsed hold may cancel: a visit already under way or closed is never touched. */
export const HOLD_CANCELLABLE = ['PENDING', 'ASSIGNED', 'ACCEPTED', 'CONFIRMED'];
