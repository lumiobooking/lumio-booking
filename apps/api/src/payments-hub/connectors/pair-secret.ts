/**
 * Two-part credentials in the ONE secret string every connector receives.
 *
 * PayPal needs a client id AND a secret; Clover a merchant id AND a private
 * token; both have a sandbox. PaymentConnector carries a single `secret` (the
 * contract all the other providers share), so the credential store packs the
 * pair into it on the way out — the same move Dejavoo's TPN + Authkey makes.
 * At connect time (before anything is stored) the parts arrive separately in
 * `opts`; `pairOf` reads either shape.
 *
 * Pure.
 */
export interface PairSecret { id: string; secret: string; env: 'sandbox' | 'production' }

const PREFIX = 'pair:';

export function packPair(p: { id?: string | null; secret: string; env?: string | null }): string {
  const env = p.env === 'sandbox' ? 'sandbox' : 'production';
  return PREFIX + Buffer.from(JSON.stringify({ id: String(p.id ?? '').trim(), secret: p.secret, env }), 'utf8').toString('base64url');
}

export function pairOf(secret: string, opts?: Record<string, string | undefined>): PairSecret {
  if (typeof secret === 'string' && secret.startsWith(PREFIX)) {
    try {
      const o = JSON.parse(Buffer.from(secret.slice(PREFIX.length), 'base64url').toString('utf8')) as Partial<PairSecret>;
      return { id: String(o.id ?? ''), secret: String(o.secret ?? ''), env: o.env === 'sandbox' ? 'sandbox' : 'production' };
    } catch { /* fall through: treat as a bare secret */ }
  }
  return {
    id: String(opts?.publicId ?? '').trim(),
    secret: String(secret ?? '').trim(),
    env: opts?.environment === 'sandbox' ? 'sandbox' : 'production',
  };
}

/** Cents → "12.50" for the APIs that want a decimal string. */
export const decimalAmount = (cents: number) => (Math.round(cents) / 100).toFixed(2);
