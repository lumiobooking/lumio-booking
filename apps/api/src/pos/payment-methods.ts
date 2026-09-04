/**
 * How money arrives at the counter, per market.
 *
 * THE BUG THIS EXISTS TO FIX
 *
 * The till had three buttons — Cash, Card, Transfer — but only three database
 * values, and Transfer was not one of them: the web app mapped it to `OTHER` on
 * the way in. That is harmless in the US, where transfer is a rare Zelle
 * payment. It is ruinous in Vietnam, where transfer is how most people pay:
 * VietQR, MoMo and ZaloPay would all land in the same `OTHER` bucket, and the
 * owner could never answer "how much came in by MoMo this month?".
 *
 * So the methods are now distinct values, and which buttons a till shows is a
 * property of the salon rather than a hardcoded array in the page.
 *
 * WHAT MUST NOT CHANGE
 *
 * A US salon must see the same three buttons in the same order as before, and
 * its end-of-day figures must not move by a cent. Transfer now stores
 * `TRANSFER` instead of `OTHER`, so the reporting buckets are defined to put
 * both in the same place — the US "other" line is identical before and after,
 * and historical `OTHER` rows keep counting exactly as they did.
 */

export type PaymentMethodCode =
  | 'CASH'
  | 'CARD'
  | 'TRANSFER'
  | 'VIETQR'
  | 'MOMO'
  | 'ZALOPAY'
  | 'OTHER';

export interface PaymentMethodDef {
  code: PaymentMethodCode;
  labelEn: string;
  labelVi: string;
  /**
   * Which bucket this belongs to in the end-of-day summary. Deliberately only
   * three, matching the fields the dashboard already reads, so adding a method
   * can never silently move a number the US salons look at every night.
   */
  bucket: 'cash' | 'card' | 'other';
  /** Markets whose tills show this button unless the salon says otherwise. */
  defaultFor: string[];
}

export const PAYMENT_METHODS: PaymentMethodDef[] = [
  { code: 'CASH', labelEn: 'Cash', labelVi: 'Tiền mặt', bucket: 'cash', defaultFor: ['US', 'CA', 'VN'] },
  { code: 'CARD', labelEn: 'Card', labelVi: 'Thẻ', bucket: 'card', defaultFor: ['US', 'CA', 'VN'] },
  // In the US this is Zelle or an Interac e-transfer; in Vietnam it is a plain
  // bank transfer, which is the ordinary way to pay for anything.
  { code: 'TRANSFER', labelEn: 'Transfer', labelVi: 'Chuyển khoản', bucket: 'other', defaultFor: ['US', 'CA', 'VN'] },
  { code: 'VIETQR', labelEn: 'VietQR', labelVi: 'Quét mã VietQR', bucket: 'other', defaultFor: ['VN'] },
  { code: 'MOMO', labelEn: 'MoMo', labelVi: 'Ví MoMo', bucket: 'other', defaultFor: ['VN'] },
  { code: 'ZALOPAY', labelEn: 'ZaloPay', labelVi: 'Ví ZaloPay', bucket: 'other', defaultFor: ['VN'] },
  // Never a default button. It exists so historical rows still resolve, and as
  // an escape hatch — a bucket labelled "other" that anyone can reach for is a
  // bucket that swallows the answer to every later question.
  { code: 'OTHER', labelEn: 'Other', labelVi: 'Khác', bucket: 'other', defaultFor: [] },
];

const BY_CODE = new Map(PAYMENT_METHODS.map((m) => [m.code, m]));

export function isPaymentMethod(code: string | null | undefined): code is PaymentMethodCode {
  return BY_CODE.has(String(code ?? '').trim().toUpperCase() as PaymentMethodCode);
}

/** Unknown resolves to OTHER: a row written by a newer version must not crash a report. */
export function paymentMethod(code: string | null | undefined): PaymentMethodDef {
  return BY_CODE.get(String(code ?? '').trim().toUpperCase() as PaymentMethodCode) ?? BY_CODE.get('OTHER')!;
}

/**
 * The buttons a till shows when the salon has not chosen its own.
 *
 * Order matters — it is the order of the buttons under a busy cashier's thumb,
 * so the most common method in that market comes first.
 */
export function defaultMethodsForMarket(market: string | null | undefined): PaymentMethodCode[] {
  const code = String(market ?? '').trim().toUpperCase() || 'US';
  const shown = PAYMENT_METHODS.filter((m) => m.defaultFor.includes(code));
  // An unrecognised market is US, consistent with common/markets.ts.
  if (!shown.length) return PAYMENT_METHODS.filter((m) => m.defaultFor.includes('US')).map((m) => m.code);
  return shown.map((m) => m.code);
}

/**
 * The buttons this salon actually shows: its own choice if it made one,
 * otherwise the market default.
 *
 * A stored list is filtered against the known methods rather than trusted, so a
 * value removed in a later version cannot render a dead button, and an empty
 * result falls back rather than leaving a cashier with nothing to press.
 */
export function methodsForSalon(
  market: string | null | undefined,
  chosen: unknown,
): PaymentMethodCode[] {
  if (!Array.isArray(chosen)) return defaultMethodsForMarket(market);
  const code = String(market ?? '').trim().toUpperCase() || 'US';
  const clean = chosen
    .map((c) => String(c ?? '').trim().toUpperCase())
    .filter((c): c is PaymentMethodCode => isPaymentMethod(c))
    // Available HERE, not merely a method that exists somewhere.
    //
    // The stored list was checked against the global catalogue only, so a US
    // salon could be handed MoMo, VietQR and ZaloPay — three Vietnamese wallets
    // — and a cashier in Garden Grove would find them under their thumb next to
    // Cash. Nothing prevented it: the market's own `defaultFor` list, which is
    // the record of where a method actually works, was never consulted.
    //
    // CASH, CARD and TRANSFER pass everywhere because they are listed for every
    // market. OTHER passes for nobody by list, and is kept deliberately: it is
    // how historical rows still resolve.
    .filter((c) => c === 'OTHER' || paymentMethod(c).defaultFor.includes(code));
  const unique = [...new Set(clean)];
  return unique.length ? unique : defaultMethodsForMarket(market);
}

/**
 * Which Payment-ledger provider string a tender is mirrored under.
 *
 * The three original strings are kept exactly as they were, because dashboard
 * revenue queries elsewhere match on them. Wallets get their own so Vietnamese
 * salons can tell MoMo from a bank transfer, which was the point.
 */
export function ledgerProviderFor(method: string | null | undefined): string {
  const m = paymentMethod(method);
  if (m.code === 'CASH') return 'pos-cash';
  if (m.code === 'CARD') return 'pos-card';
  if (m.code === 'MOMO' || m.code === 'ZALOPAY') return 'pos-wallet';
  return 'pos-transfer';
}

/** Which end-of-day line a tender lands on. */
export function bucketFor(method: string | null | undefined): 'cash' | 'card' | 'other' {
  return paymentMethod(method).bucket;
}

export function labelFor(method: string | null | undefined, lang: 'en' | 'vi'): string {
  const m = paymentMethod(method);
  return lang === 'vi' ? m.labelVi : m.labelEn;
}
