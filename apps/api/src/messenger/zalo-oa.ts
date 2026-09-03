import { createHash, timingSafeEqual } from 'crypto';

/**
 * Zalo Official Account plumbing — the parts with no opinions.
 *
 * Everything here is either pure (signature check, event parsing) or a single
 * HTTP call to Zalo. The decisions — which tenant, which thread, whether the
 * bot may speak — belong to ZaloOaService and the Messenger brain, which is
 * the point: Zalo is a MOUTH. The brain already exists.
 *
 * TOKENS, THE PART THAT BITES
 *
 * A Zalo OA access token lives ~25 hours; the refresh token is SINGLE-USE and
 * lives ~3 months. Refreshing hands back a new pair, and losing the new
 * refresh token in a crash between "refresh" and "persist" strands the OA
 * until the owner reconnects. So refreshZaloToken returns both and the caller
 * persists BEFORE using — never the other way around.
 */

const OPENAPI = 'https://openapi.zalo.me/v3.0/oa';
const OAUTH = 'https://oauth.zaloapp.com/v4/oa/access_token';

// ---------------------------------------------------------------------------
// Webhook signature
// ---------------------------------------------------------------------------

/**
 * X-ZEvent-Signature = "mac=" + sha256hex(appId + rawBody + timestamp + oaSecretKey).
 *
 * `rawBody` must be the bytes Zalo sent, not a re-serialisation — JSON key
 * order is not ours to choose. The "OA secret key" is the webhook secret shown
 * in the app's Official Account settings (NOT the app's login secret).
 */
export function verifyZaloSignature(args: {
  appId: string;
  rawBody: string;
  timestamp: string | number;
  oaSecretKey: string;
  header: string | undefined;
}): boolean {
  const given = String(args.header ?? '').trim().replace(/^mac=/, '');
  if (!given || !args.oaSecretKey) return false;
  const expected = createHash('sha256')
    .update(`${args.appId}${args.rawBody}${args.timestamp}${args.oaSecretKey}`)
    .digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(given.toLowerCase(), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Event parsing
// ---------------------------------------------------------------------------

export interface ZaloInbound {
  appId: string;
  /** The OA that received the message — routes to a tenant. */
  oaId: string;
  /** The Zalo user who wrote. */
  senderId: string;
  text: string;
  /** ms epoch, from Zalo's own event timestamp. */
  tsMs: number;
  eventName: string;
}

/**
 * Reads the one event this integration answers: a user sending the OA a text.
 * Everything else (follows, stickers, delivery receipts) returns null and is
 * acknowledged without action — Zalo retries unacknowledged events.
 */
export function parseZaloEvent(body: unknown): ZaloInbound | null {
  const b = body as {
    app_id?: unknown; event_name?: unknown; timestamp?: unknown;
    sender?: { id?: unknown }; recipient?: { id?: unknown };
    message?: { text?: unknown };
  } | null;
  if (!b || String(b.event_name ?? '') !== 'user_send_text') return null;
  const senderId = String(b.sender?.id ?? '').trim();
  const oaId = String(b.recipient?.id ?? '').trim();
  const text = String(b.message?.text ?? '').trim();
  if (!senderId || !oaId || !text) return null;
  const ts = Number(b.timestamp);
  return {
    appId: String(b.app_id ?? ''),
    oaId,
    senderId,
    text,
    tsMs: Number.isFinite(ts) && ts > 0 ? ts : Date.now(),
    eventName: 'user_send_text',
  };
}

// ---------------------------------------------------------------------------
// Zalo API calls
// ---------------------------------------------------------------------------

/** Send a plain text reply from the OA. Zalo's CS window mirrors Meta's:
 *  replies are free-form only within a window after the user's last message,
 *  which suits a bot that only ever speaks when spoken to. */
export async function sendZaloText(accessToken: string, userId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${OPENAPI}/message/cs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', access_token: accessToken },
      body: JSON.stringify({ recipient: { user_id: userId }, message: { text: text.slice(0, 2000) } }),
      signal: AbortSignal.timeout(12_000),
    });
    const out = (await res.json().catch(() => ({}))) as { error?: number; message?: string };
    if (Number(out?.error ?? 0) === 0) return { ok: true };
    return { ok: false, error: `Zalo ${out?.error}: ${out?.message ?? 'unknown'}` };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Best-effort display name, same contract as the Graph profile lookup:
 *  a failure is a null name, never a failed message. */
export async function fetchZaloProfileName(accessToken: string, userId: string): Promise<string | null> {
  try {
    const q = encodeURIComponent(JSON.stringify({ user_id: userId }));
    const res = await fetch(`${OPENAPI}/user/detail?data=${q}`, {
      headers: { access_token: accessToken },
      signal: AbortSignal.timeout(8_000),
    });
    const out = (await res.json().catch(() => ({}))) as { data?: { display_name?: string } };
    const name = String(out?.data?.display_name ?? '').trim();
    return name || null;
  } catch {
    return null;
  }
}

/** Exchange the single-use refresh token for a new pair. The `secret_key`
 *  header is the APP's secret key (the login one — not the webhook OA key). */
export async function refreshZaloToken(args: {
  appId: string;
  appSecret: string;
  refreshToken: string;
}): Promise<{ accessToken: string; refreshToken: string; expiresAtMs: number } | null> {
  try {
    const form = new URLSearchParams({
      app_id: args.appId,
      refresh_token: args.refreshToken,
      grant_type: 'refresh_token',
    });
    const res = await fetch(OAUTH, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', secret_key: args.appSecret },
      body: form.toString(),
      signal: AbortSignal.timeout(12_000),
    });
    const out = (await res.json().catch(() => ({}))) as {
      access_token?: string; refresh_token?: string; expires_in?: string | number; error?: unknown;
    };
    if (!out?.access_token || !out?.refresh_token) return null;
    const ttlS = Number(out.expires_in);
    return {
      accessToken: out.access_token,
      refreshToken: out.refresh_token,
      expiresAtMs: Date.now() + (Number.isFinite(ttlS) && ttlS > 0 ? ttlS : 90_000) * 1000,
    };
  } catch {
    return null;
  }
}
