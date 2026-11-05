/**
 * The bank account a tenant is paid to (VietQR), kept once in its POS
 * settings. Pure: the settings screen, the salon till and the restaurant till
 * all read it through these two functions, always for one tenant's own rows.
 */
import { BadRequestException } from '@nestjs/common';
import { cleanAccount } from '../common/vietqr';

/** The restaurant till's own settings row, where older restaurants typed their account. */
export const RESTAURANT_SETTINGS_KEY = 'restaurant_service';

export type PayAccount = { bin: string; accountNo: string; accountName: string };

/**
 * The account in force: the POS one once it has ever been saved (even as
 * "none"), else the restaurant till's older one. Printing the QR is on unless
 * switched off.
 */
export function resolvePayAccount(
  pos: { bankAccount?: unknown; printPayQr?: unknown } | null | undefined,
  legacy: unknown,
): { bank: PayAccount | null; printPayQr: boolean } {
  const own = !!pos && Object.prototype.hasOwnProperty.call(pos, 'bankAccount');
  const a = cleanAccount(own ? pos?.bankAccount : legacy);
  return { bank: a ? { bin: a.bin, accountNo: a.accountNo, accountName: a.accountName ?? '' } : null, printPayQr: pos?.printPayQr !== false };
}

/**
 * What a POS save does to the account: not sent → kept as it was; null or an
 * empty form → removed; a filled form → cleaned, or refused when the bank or
 * the number is not usable (a half-typed account would print a QR that fails).
 */
export function nextBankAccount(
  dto: { bankAccount?: unknown },
  cur: { bankAccount?: PayAccount | null },
): { bankAccount?: PayAccount | null } {
  if (!Object.prototype.hasOwnProperty.call(dto, 'bankAccount')) {
    return Object.prototype.hasOwnProperty.call(cur, 'bankAccount') ? { bankAccount: cur.bankAccount ?? null } : {};
  }
  const raw = dto.bankAccount as Record<string, unknown> | null | undefined;
  const empty = !raw || typeof raw !== 'object' || (!String(raw.bin ?? '').trim() && !String(raw.accountNo ?? '').trim());
  if (empty) return { bankAccount: null };
  const a = cleanAccount(raw);
  if (!a) throw new BadRequestException('BANK_ACCOUNT_INVALID');
  return { bankAccount: { bin: a.bin, accountNo: a.accountNo, accountName: a.accountName ?? '' } };
}

/**
 * Per-method details as typed on the settings screen, made safe to show to
 * every guest: known method keys only, text ≤ 500 characters, and a QR that
 * is an https link or a small uploaded picture (data:image, ≤ 240 kB).
 */
export function cleanPaymentDetails(raw: unknown): Record<string, { instructions: string; qrUrl: string }> {
  const out: Record<string, { instructions: string; qrUrl: string }> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 12)) {
    if (!/^[A-Z_]{2,20}$/.test(k)) continue;
    const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    const instructions = String(o.instructions ?? '').replace(/\r/g, '').slice(0, 500);
    const q = String(o.qrUrl ?? '').trim();
    const qrUrl = /^https:\/\/[^\s"'<>]{3,1000}$/i.test(q) || (/^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(q) && q.length <= 240_000) ? q : '';
    out[k] = { instructions, qrUrl };
  }
  return out;
}
