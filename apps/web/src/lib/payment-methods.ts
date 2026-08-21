/**
 * Payment method labels for the till.
 *
 * The list of methods and which ones a salon shows is decided on the server —
 * see apps/api/src/pos/payment-methods.ts — and arrives with the settings as
 * `pos.resolvedPaymentMethods`. This file only knows how to WRITE each one on a
 * button, because that is the part the browser needs and the server does not.
 *
 * The codes are duplicated here as a type, which is the one thing worth
 * duplicating: it means a method removed on the server becomes a compile error
 * here rather than a button that silently does nothing.
 */

export type PayMethod = 'CASH' | 'CARD' | 'TRANSFER' | 'VIETQR' | 'MOMO' | 'ZALOPAY' | 'OTHER';

export const PAY_METHODS: Record<PayMethod, { en: string; vi: string }> = {
  CASH: { en: 'Cash', vi: 'Tiền mặt' },
  CARD: { en: 'Card', vi: 'Thẻ' },
  TRANSFER: { en: 'Transfer', vi: 'Chuyển khoản' },
  VIETQR: { en: 'VietQR', vi: 'VietQR' },
  MOMO: { en: 'MoMo', vi: 'MoMo' },
  ZALOPAY: { en: 'ZaloPay', vi: 'ZaloPay' },
  OTHER: { en: 'Other', vi: 'Khác' },
};

/**
 * A method the server sent that this build does not know about still gets a
 * button rather than a blank one — an older tab open during a deploy should
 * degrade to showing the raw code, not to a row of empty squares.
 */
export function payLabel(method: string, lang: 'en' | 'vi'): string {
  const def = PAY_METHODS[method as PayMethod];
  if (!def) return method;
  return lang === 'vi' ? def.vi : def.en;
}

/** Guard for values arriving from settings. */
export function isPayMethod(v: unknown): v is PayMethod {
  return typeof v === 'string' && v in PAY_METHODS;
}

/**
 * The buttons to render, from what the server resolved.
 *
 * Falls back to the three methods every till has always had rather than to an
 * empty row: a cashier with a customer waiting needs a button to press, even if
 * the settings call failed.
 */
export function tillMethodsFrom(resolved: unknown): PayMethod[] {
  if (!Array.isArray(resolved)) return ['CASH', 'CARD', 'TRANSFER'];
  const clean = resolved.filter(isPayMethod);
  return clean.length ? clean : ['CASH', 'CARD', 'TRANSFER'];
}
