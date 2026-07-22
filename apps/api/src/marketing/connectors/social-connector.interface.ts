/**
 * Social / ads channel connectors. Given a tenant's own (encrypted) credentials,
 * a connector pulls last-month spend + reach/clicks/etc. from the platform API so
 * the numbers flow into the report automatically instead of being typed by hand.
 *
 * Zero fabrication: a connector only ever returns what the API returns. On any
 * auth/permission error it throws — the UI shows the error, never a fake number.
 */
export type SocialPlatform = 'meta' | 'gbp' | 'tiktok' | 'google_ads';

/** Decrypted credential bundle. Fields used depend on the platform. */
export interface ChannelCreds {
  /** Primary token (Meta long-lived token; a raw Google access token; etc.). */
  token?: string;
  /** OAuth refresh token (Google). */
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  developerToken?: string; // Google Ads
  /** Ad account / location / advertiser / customer id. */
  externalAccountId?: string;
}

export interface MonthlyMetrics {
  spendCents?: number | null;
  impressions?: number | null;
  reach?: number | null;
  clicks?: number | null;
  calls?: number | null;
  directions?: number | null;
  leads?: number | null;
  raw?: unknown;
}

export interface VerifyResult { ok: boolean; accountName?: string; error?: string }

export interface SocialConnector {
  readonly platform: SocialPlatform;
  readonly label: string;
  /** False = scaffolded but not finished; registry refuses to use it. */
  readonly enabled: boolean;
  /** Whether this platform reports ad spend (Google Maps does not). */
  readonly hasSpend: boolean;
  verify(creds: ChannelCreds): Promise<VerifyResult>;
  /** month = 'YYYY-MM'. */
  fetchMonthly(creds: ChannelCreds, month: string): Promise<MonthlyMetrics>;
}

/** 'YYYY-MM' -> ISO first/last day. */
export function monthBounds(month: string): { since: string; until: string; y: number; m: number } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const p = (n: number) => String(n).padStart(2, '0');
  return { since: `${y}-${p(m)}-01`, until: `${y}-${p(m)}-${p(last)}`, y, m };
}

const doFetch: any = (globalThis as any).fetch;
export async function getJson(url: string, headers: Record<string, string> = {}): Promise<{ ok: boolean; status: number; json: any }> {
  const res = await doFetch(url, { headers: { Accept: 'application/json', ...headers } });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { ok: res.status >= 200 && res.status < 300, status: res.status, json };
}
export async function postForm(url: string, body: Record<string, string>): Promise<any> {
  const res = await doFetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  return res.json().catch(() => ({}));
}
