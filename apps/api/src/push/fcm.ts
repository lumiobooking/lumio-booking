import { createSign } from 'crypto';

/**
 * Firebase Cloud Messaging, HTTP v1, with no SDK.
 *
 * The store apps (Capacitor) cannot use Web Push: iOS WKWebView has no
 * PushManager. They register an FCM token instead, which is stored in the
 * same table as a web subscription with the endpoint `fcm:<token>` — so the
 * audience rules (one wake per device, skip the sender) stay in one place.
 *
 * Auth is a service-account JWT exchanged for a one-hour access token, done
 * here with node:crypto rather than google-auth-library so the API gains no
 * dependency for a feature only the mobile builds use. Configure with
 * FCM_SERVICE_ACCOUNT_JSON (the JSON, or base64 of it) from the Firebase
 * console → Project settings → Service accounts.
 */

export const FCM_PREFIX = 'fcm:';

interface ServiceAccount { project_id: string; client_email: string; private_key: string }

export function loadServiceAccount(raw = process.env.FCM_SERVICE_ACCOUNT_JSON): ServiceAccount | null {
  if (!raw) return null;
  try {
    const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const j = JSON.parse(text) as Partial<ServiceAccount>;
    if (!j.project_id || !j.client_email || !j.private_key) return null;
    return { project_id: j.project_id, client_email: j.client_email, private_key: j.private_key };
  } catch {
    return null;
  }
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function signJwt(sa: ServiceAccount, now = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const sig = signer.sign(sa.private_key);
  return `${header}.${claims}.${b64url(sig)}`;
}

export class FcmClient {
  private token: { value: string; expiresAt: number } | null = null;
  constructor(private readonly sa: ServiceAccount) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signJwt(this.sa),
    });
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`fcm oauth ${res.status}`);
    const j = await res.json() as { access_token: string; expires_in: number };
    this.token = { value: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 };
    return j.access_token;
  }

  /**
   * Send one notification. Resolves `{ dead: true }` when FCM says the token
   * is gone (app uninstalled, token rotated) so the caller can drop it — the
   * same contract as a 404/410 from a web push service.
   */
  async send(token: string, payload: { title: string; body: string; url: string; tag: string }): Promise<{ ok: boolean; dead: boolean }> {
    const access = await this.accessToken();
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.sa.project_id)}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: payload.title, body: payload.body },
          // The path the tap opens; the app reads it from `data`.
          data: { url: payload.url, tag: payload.tag },
          android: { priority: 'high', notification: { tag: payload.tag, sound: 'default', channel_id: 'lumio' } },
          apns: { headers: { 'apns-priority': '10', 'apns-collapse-id': payload.tag.slice(0, 64) }, payload: { aps: { sound: 'default', 'mutable-content': 1 } } },
        },
      }),
    });
    if (res.ok) return { ok: true, dead: false };
    let dead = false;
    try {
      const j = await res.json() as { error?: { status?: string; details?: { errorCode?: string }[] } };
      const codes = [j.error?.status, ...(j.error?.details ?? []).map((d) => d.errorCode)].filter(Boolean) as string[];
      dead = res.status === 404 || codes.some((c) => /UNREGISTERED|NOT_FOUND|INVALID_ARGUMENT/.test(c));
    } catch { /* body unreadable: treat as transient */ }
    return { ok: false, dead };
  }
}

export function isFcmEndpoint(endpoint: string): boolean {
  return endpoint.startsWith(FCM_PREFIX);
}
