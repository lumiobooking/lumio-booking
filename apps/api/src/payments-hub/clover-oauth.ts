/**
 * rt233 — "Connect with Clover" for driving the salon's Clover device.
 *
 * Clover's v2 OAuth (docs.clover.com, "Generate expiring tokens using v2
 * OAuth flow"): the salon owner signs in on Clover and approves Lumio's app;
 * Clover sends them back with ?code=…&merchant_id=…; Lumio swaps the code for
 * an access token + refresh token (high-trust app: client_id + client_secret)
 * and refreshes before the access token expires.
 *
 * The `state` carries the salon (tenant) and who pressed the button, signed
 * and short-lived, so a callback can only ever connect the salon that asked.
 * Pure.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { cloverHosts } from './connectors/clover-device';

export interface CloverAppConfig { clientId: string; clientSecret: string; env: 'sandbox' | 'production'; redirectUri: string }

export const STATE_TTL_MS = 15 * 60_000;

/** The app's settings from the environment, or null while Clover has not approved it yet. */
export function cloverAppConfig(env: NodeJS.ProcessEnv, apiBase: string): CloverAppConfig | null {
  const clientId = String(env.CLOVER_APP_ID ?? '').trim();
  const clientSecret = String(env.CLOVER_APP_SECRET ?? '').trim();
  if (!clientId || !clientSecret) return null;
  return {
    clientId, clientSecret,
    env: env.CLOVER_ENV === 'sandbox' ? 'sandbox' : 'production',
    redirectUri: String(env.CLOVER_REDIRECT_URI || `${apiBase.replace(/\/+$/, '')}/api/payments-hub/clover/callback`),
  };
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url').toString('utf8');
const mac = (payload: string, secret: string) => createHmac('sha256', secret).update(payload).digest('base64url');

export function signState(p: { tenantId: string; userId: string }, secret: string, now = Date.now()): string {
  const payload = b64(JSON.stringify({ t: p.tenantId, u: p.userId, at: now }));
  return `${payload}.${mac(payload, secret)}`;
}

export function verifyState(state: string, secret: string, now = Date.now()): { tenantId: string; userId: string } | null {
  const [payload, sig] = String(state ?? '').split('.');
  if (!payload || !sig) return null;
  const want = mac(payload, secret);
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const o = JSON.parse(unb64(payload)) as { t?: string; u?: string; at?: number };
    if (!o.t || !o.u || typeof o.at !== 'number') return null;
    if (now - o.at > STATE_TTL_MS || o.at - now > 60_000) return null;
    return { tenantId: o.t, userId: o.u };
  } catch { return null; }
}

export function authorizeUrl(c: CloverAppConfig, state: string): string {
  const q = new URLSearchParams({ client_id: c.clientId, redirect_uri: c.redirectUri, response_type: 'code', state });
  return `${cloverHosts(c.env).web}/oauth/v2/authorize?${q.toString()}`;
}

export interface CloverTokens { access: string; accessExp: number; refresh: string; refreshExp: number }

/** Clover's token answer → our record. Expirations are Unix seconds (ms tolerated). */
export function readTokens(json: any, now = Date.now()): CloverTokens | null {
  const access = String(json?.access_token ?? '');
  const refresh = String(json?.refresh_token ?? '');
  if (!access) return null;
  const ms = (v: unknown, fallback: number) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return n < 1e12 ? n * 1000 : n;
  };
  return { access, refresh, accessExp: ms(json?.access_token_expiration, now + 30 * 60_000), refreshExp: ms(json?.refresh_token_expiration, now + 365 * 86_400_000) };
}

/** Refresh a few minutes early so a sale never starts with a token about to die. */
export function needsRefresh(accessExp: number | undefined, now = Date.now()): boolean {
  return !accessExp || accessExp - now < 5 * 60_000;
}
