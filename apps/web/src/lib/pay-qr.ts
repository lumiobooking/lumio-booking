/**
 * Which QR a till shows for a payment button. Pure.
 *
 * One bank account is set once (Settings › Payments); from it the till makes
 * a VietQR with the exact amount. MoMo, ZaloPay and every banking app scan a
 * VietQR, so the wallet buttons use it too unless the owner added the wallet's
 * own QR image. Outside Vietnam (or without an account) nothing changes: the
 * owner's typed details and QR image, as before.
 */
import { bankLabel, cleanAccount, qrDataUrl, vietQrPayload, type VietQrAccount } from './vietqr';

export interface PayQr {
  /** An <img> src: a drawn VietQR, or the owner's own image. */
  src: string | null;
  /** True when the QR carries the amount (the guest only confirms). */
  exact: boolean;
  /** Lines under the QR: bank · number, holder, or the owner's own text. */
  lines: string[];
}

const BANK_METHODS = new Set(['TRANSFER', 'VIETQR']);
const WALLETS = new Set(['MOMO', 'ZALOPAY']);

export function payQrFor(opts: {
  method: string;
  account: VietQrAccount | null | undefined;
  details?: { instructions?: string; qrUrl?: string } | null;
  amount: number;
  currency: string;
  note?: string | null;
}): PayQr {
  const own = opts.details ?? {};
  const acct = cleanAccount(opts.account);
  const vnd = String(opts.currency ?? '').toUpperCase() === 'VND';
  const wallet = WALLETS.has(opts.method);
  const useBank = !!acct && vnd && (BANK_METHODS.has(opts.method) || (wallet && !own.qrUrl));
  if (useBank && acct) {
    const payload = vietQrPayload(acct, opts.amount > 0 ? opts.amount : 0, opts.note);
    if (payload) {
      return {
        src: qrDataUrl(payload),
        exact: opts.amount > 0,
        lines: [`${bankLabel(acct.bin)} · ${acct.accountNo}`, ...(acct.accountName ? [acct.accountName] : [])],
      };
    }
  }
  return {
    src: own.qrUrl?.trim() || null,
    exact: false,
    lines: own.instructions?.trim() ? own.instructions.trim().split('\n') : [],
  };
}
