/**
 * rt233 — Clover devices driven from Lumio (Clover "semi-integration", REST
 * Pay Display through the cloud).
 *
 * Until now Lumio took Clover deposits online only; at the counter the
 * Clover Flex/Mini was keyed by hand. With this, the till sends the amount to
 * the salon's Clover device, the customer taps or inserts the card there, and
 * the result (with the tip) comes back to the ticket.
 *
 * What Clover requires (docs.clover.com, REST Pay Display):
 *  - an OAuth token of OUR approved Clover app (merchant API tokens are not
 *    accepted for this) — the salon connects with "Connect with Clover";
 *  - the Cloud Pay Display app installed and started on the device;
 *  - each request names the device (X-Clover-Device-Id = its serial) and the
 *    POS (X-POS-Id).
 *
 * Everything here is pure: secrets packing, hosts, the request body, reading
 * Clover's answer. The connector does the HTTP.
 */
import { createHash } from 'crypto';

export interface CloverDeviceSecret { mid: string; token: string; env: 'sandbox' | 'production' }

const PREFIX = 'cdev:';

export function packDeviceSecret(s: { mid?: string | null; token: string; env?: string | null }): string {
  const env = s.env === 'sandbox' ? 'sandbox' : 'production';
  return PREFIX + Buffer.from(JSON.stringify({ mid: String(s.mid ?? '').trim(), token: s.token, env }), 'utf8').toString('base64url');
}

/** Read the packed secret, or (at connect time, before anything is stored) the parts given separately. */
export function readDeviceSecret(secret: string, opts?: Record<string, string | undefined>): CloverDeviceSecret {
  if (typeof secret === 'string' && secret.startsWith(PREFIX)) {
    try {
      const o = JSON.parse(Buffer.from(secret.slice(PREFIX.length), 'base64url').toString('utf8')) as Partial<CloverDeviceSecret>;
      return { mid: String(o.mid ?? ''), token: String(o.token ?? ''), env: o.env === 'sandbox' ? 'sandbox' : 'production' };
    } catch { /* fall through */ }
  }
  return { mid: String(opts?.publicId ?? '').trim(), token: String(secret ?? '').trim(), env: opts?.environment === 'sandbox' ? 'sandbox' : 'production' };
}

/** Clover hosts, North America. */
export function cloverHosts(env: 'sandbox' | 'production') {
  return env === 'sandbox'
    ? { api: 'https://apisandbox.dev.clover.com', connect: 'https://apisandbox.dev.clover.com/connect', web: 'https://sandbox.dev.clover.com' }
    : { api: 'https://api.clover.com', connect: 'https://api.clover.com/connect', web: 'https://www.clover.com' };
}

/**
 * Clover's externalPaymentId is at most 32 characters. Ours (the till's
 * clientRef) can be longer, so a stable 32-character fingerprint of it is
 * sent — the same ref always gives the same id, which is what lets a payment
 * be found again after a restart.
 */
export function externalPaymentIdOf(reference: string): string {
  const r = String(reference ?? '');
  return /^[A-Za-z0-9]{1,32}$/.test(r) ? r : createHash('sha256').update(r).digest('hex').slice(0, 32);
}

/** The id Lumio keeps for one card attempt: the device it went to + our reference. */
export function packIntentId(serial: string, reference: string): string { return `${serial}|${reference}`; }
export function readIntentId(id: string): { serial: string; reference: string } {
  const i = String(id ?? '').indexOf('|');
  return i < 0 ? { serial: '', reference: String(id ?? '') } : { serial: id.slice(0, i), reference: id.slice(i + 1) };
}

/**
 * The sale. `final: true` = a closed sale with the tip already known (the till
 * asked for it), so Clover records the tip as a tip, not as part of the price.
 */
export function payBody(input: { amountCents: number; tipCents?: number; reference: string; invoiceNumber?: string }): Record<string, unknown> {
  const tip = typeof input.tipCents === 'number' && input.tipCents > 0 ? Math.round(input.tipCents) : 0;
  return {
    amount: Math.round(input.amountCents),
    externalPaymentId: externalPaymentIdOf(input.reference),
    final: true,
    tipAmount: tip,
    ...(input.invoiceNumber ? { externalReferenceId: String(input.invoiceNumber).replace(/[^A-Za-z0-9-]/g, '').slice(0, 12) || undefined } : {}),
  };
}

export type CloverOutcome = { status: 'SUCCEEDED' | 'CANCELED' | 'FAILED'; paymentId?: string; amountCents?: number; tipCents?: number; last4?: string; error?: string };

/** Read Clover's answer to a sale (or an error body). */
export function readPayResult(httpOk: boolean, json: any): CloverOutcome {
  const p = json?.payment;
  if (httpOk && p && String(p.result ?? '').toUpperCase() === 'SUCCESS') {
    return {
      status: 'SUCCEEDED', paymentId: p.id ? String(p.id) : undefined,
      amountCents: typeof p.amount === 'number' ? p.amount : undefined,
      tipCents: typeof p.tipAmount === 'number' ? p.tipAmount : undefined,
      last4: p.cardTransaction?.last4 ? String(p.cardTransaction.last4) : undefined,
    };
  }
  const msg = String(json?.message ?? json?.error?.message ?? (p?.result ? `Clover: ${p.result}` : ''));
  // The customer or the salon cancelled on the device, or the card was never presented in time.
  if (/cancel/i.test(msg) || /cancel/i.test(String(json?.code ?? ''))) return { status: 'CANCELED', error: msg || 'Cancelled on the Clover device' };
  return { status: 'FAILED', error: friendlyCloverError(msg, json) };
}

/** Words a cashier can act on. */
export function friendlyCloverError(msg: string, json?: any): string {
  const m = `${msg} ${JSON.stringify(json ?? {})}`;
  if (/device.*(not|un)\s*(connected|available|reachable)|offline|not found/i.test(m)) return 'The Clover device is not reachable — open Cloud Pay Display on the device and tap Start.';
  if (/busy|in use|another (transaction|request)/i.test(m)) return 'The Clover device is busy with another payment — finish or cancel it on the device.';
  if (/401|unauthori[sz]ed|expired|invalid token/i.test(m)) return 'Clover sign-in expired — press "Connect with Clover" again in Card terminals.';
  if (/declin/i.test(m)) return 'Card declined on the Clover device.';
  return msg ? `Clover: ${msg.slice(0, 160)}` : 'Clover did not complete the payment.';
}

/** The devices Clover lists for the merchant → what the salon can pick. */
export function readDevices(json: any): { serial: string; label: string; model?: string }[] {
  const list = Array.isArray(json?.elements) ? json.elements : Array.isArray(json) ? json : [];
  return list
    .map((d: any) => ({ serial: String(d?.serial ?? '').trim(), label: String(d?.name || d?.model || d?.productName || 'Clover device'), model: d?.model ? String(d.model) : undefined }))
    .filter((d: { serial: string }) => !!d.serial);
}
