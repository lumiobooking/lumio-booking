/**
 * Mã QR đặt cọc trong cuộc chat (19/11/2026) — pure.
 *
 * A PERSON in the Inbox sends the customer a VietQR for an exact amount with a
 * short code in the transfer note ("LB482913"). Three things can then happen,
 * and each is only ever information for the salon, never a confirmation:
 *   - the customer sends a picture of the transfer → the picture is read, the
 *     amount and code compared ("khách báo đã chuyển");
 *   - the salon's bank feed (SePay / Casso, the same one the restaurant till
 *     uses) reports a credit whose note carries the code → "ngân hàng đã nhận";
 *   - nothing — the request stays open and is shown as such.
 * The AI never sends a QR and never says money has arrived.
 */

export const PAY_KEY = 'messenger.pay_requests';

export type PayStatus = 'sent' | 'claimed' | 'paid' | 'partial';
export type PayRequest = {
  code: string;
  threadId: string;
  appointmentId: string | null;
  amountCents: number;
  at: string;
  by: string | null;
  status: PayStatus;
  /** What the customer's transfer picture said. */
  claim?: { amountCents: number | null; codeSeen: boolean; at: string } | null;
  /** What the bank feed reported. */
  bank?: { amountCents: number; ref: string; at: string } | null;
};

/** "LB" + six digits, not one this salon already has open. */
export function newPayCode(taken: Set<string>, rnd: () => number = Math.random): string {
  for (let i = 0; i < 50; i++) {
    const c = `LB${String(Math.floor(rnd() * 900000) + 100000)}`;
    if (!taken.has(c)) return c;
  }
  return `LB${String(Date.now()).slice(-6)}`;
}

/** The chat deposit code in a bank note or a receipt, wherever it sits ("...LB 482913 chuyen tien"). */
export function payCodeInText(text: unknown): string | null {
  const m = /(?:^|[^A-Z0-9])LB\s?(\d{6})(?!\d)/.exec(String(text ?? '').toUpperCase());
  return m ? `LB${m[1]}` : null;
}

/** Amounts a receipt shows: "100.000đ", "100,000 VND", "+500.000", "1.250.000 ₫". Đồng, ≥ 1.000. */
export function amountsIn(text: unknown): number[] {
  const out: number[] = [];
  const re = /(\d{1,3}(?:[.,\s]\d{3})+|\d{4,10})\s*(?:đ|₫|vnd|vnđ|dong|đồng)?/gi;
  for (const m of String(text ?? '').matchAll(re)) {
    const n = Number(m[1].replace(/[.,\s]/g, ''));
    if (Number.isFinite(n) && n >= 1000 && n <= 10_000_000_000 && !out.includes(n)) out.push(n);
  }
  return out;
}

/** Read a receipt note against the request: the requested amount when it appears, else the largest amount shown. */
export function readClaim(req: Pick<PayRequest, 'code' | 'amountCents'>, note: string): { amountCents: number | null; codeSeen: boolean } {
  const amounts = amountsIn(note);
  const amount = amounts.includes(req.amountCents) ? req.amountCents : amounts.length ? Math.max(...amounts) : null;
  return { amountCents: amount, codeSeen: payCodeInText(note) === req.code };
}

export function cleanRequests(raw: unknown): PayRequest[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: PayRequest[] = [];
  for (const r of list) {
    const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
    const code = String(o.code ?? '');
    const threadId = String(o.threadId ?? '');
    const amountCents = Math.round(Number(o.amountCents ?? 0));
    if (!/^LB\d{6}$/.test(code) || !/^[A-Za-z0-9_-]{1,64}$/.test(threadId) || !(amountCents > 0)) continue;
    const status: PayStatus = o.status === 'claimed' || o.status === 'paid' || o.status === 'partial' ? o.status : 'sent';
    const claim = o.claim && typeof o.claim === 'object' ? o.claim as PayRequest['claim'] : null;
    const bank = o.bank && typeof o.bank === 'object' ? o.bank as PayRequest['bank'] : null;
    out.push({
      code, threadId, amountCents, status, claim, bank,
      appointmentId: typeof o.appointmentId === 'string' ? o.appointmentId : null,
      at: String(o.at ?? ''), by: typeof o.by === 'string' ? o.by.slice(0, 60) : null,
    });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100);
}

/** A bank credit arrived with this code: paid when it covers the amount, partial when short. Counted once per bank ref. */
export function applyBankCredit(list: PayRequest[], code: string, amount: number, ref: string, at: string): { list: PayRequest[]; hit: PayRequest | null } {
  let hit: PayRequest | null = null;
  const next = list.map((r) => {
    if (r.code !== code || hit) return r;
    if (r.bank?.ref === ref) { hit = null; return r; }
    const total = (r.bank?.amountCents ?? 0) + amount;
    const u: PayRequest = { ...r, bank: { amountCents: total, ref, at }, status: total >= r.amountCents ? 'paid' : 'partial' };
    hit = u;
    return u;
  });
  return { list: next, hit };
}

/** The deposit the salon's own rule suggests for a price (staff can change it). */
export function suggestedDeposit(d: { enabled?: boolean; type?: string; percent?: number; fixedCents?: number } | null | undefined, priceCents: number): number | null {
  if (!d?.enabled) return null;
  const v = d.type === 'fixed' ? Number(d.fixedCents ?? 0) : Math.round((priceCents * Number(d.percent ?? 0)) / 100);
  return v > 0 ? Math.min(v, priceCents > 0 ? priceCents : v) : null;
}

/** The QR picture (napas 247 via img.vietqr.io): a public https image Meta and Zalo can fetch. */
export function payQrImageUrl(bank: { bin: string; accountNo: string; accountName?: string | null }, amount: number, code: string): string {
  const q = new URLSearchParams({ amount: String(Math.max(0, Math.round(amount))), addInfo: code, ...(bank.accountName ? { accountName: bank.accountName } : {}) });
  return `https://img.vietqr.io/image/${encodeURIComponent(bank.bin)}-${encodeURIComponent(bank.accountNo)}-compact2.png?${q.toString()}`;
}

/** The line sent with the QR, so the customer can also type it by hand. */
export function payText(amount: number, code: string, bankName: string, accountNo: string, accountName: string): string {
  const money = `${Math.round(amount).toLocaleString('vi-VN')}đ`;
  return `Dạ thông tin chuyển khoản đặt cọc ạ:\n▸ Số tiền: ${money}\n▸ Nội dung: ${code}\n▸ ${bankName} · ${accountNo}${accountName ? ` · ${accountName}` : ''}\nQuét mã QR ở trên là điền sẵn đủ ạ.`;
}
