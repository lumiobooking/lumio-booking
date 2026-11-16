/**
 * ONE GOOGLE ACCOUNT, ONE LIVE TOKEN — SHARED BY EVERY SALON IT MANAGES.
 *
 * Why salons kept "losing" Google (16/11/2026: 14 salons on
 * "invalid_grant — Token has been expired or revoked"): the agency connects
 * dozens of salons with the SAME Google account (partners@ 42 salons,
 * service.lumioagency@ 37), and every connect stored its own refresh token
 * on that salon. Google keeps at most 100 live refresh tokens per Google
 * account per OAuth client and silently revokes the OLDEST when a new one is
 * issued. So every reconnect (prompt=consent always mints a new one) killed
 * some other salon's token, which then had to be reconnected, which killed
 * another — the endless "connect lại liên tục".
 *
 * A refresh token belongs to the ACCOUNT, not to the location: any live one
 * for partners@ reads every location partners@ manages. So the newest token
 * per account is kept in one place (platform_config `gbp_token:<email>`) and
 * every salon connected with that account uses it first, its own stored
 * token second. When both fail, the newest working token of another salon
 * connected with the SAME account is found and kept (healing the ones that
 * broke before this fix, with no reconnect). Only the same Google account's
 * tokens are ever used — a salon connected with its own Google login never
 * borrows the agency's, and vice versa.
 */
export function poolKey(email: string | null | undefined): string | null {
  const e = String(email ?? '').trim().toLowerCase();
  return e && e.includes('@') ? `gbp_token:${e}` : null;
}

/** The tokens to try, in order: the account's newest, then the salon's own. No blanks, no repeats. */
export function tokenCandidates(pooled: string | null | undefined, own: string | null | undefined): string[] {
  const out: string[] = [];
  for (const t of [pooled, own]) {
    const v = String(t ?? '').trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Google's answer for a refresh token that is gone for good (vs a hiccup worth retrying later). */
export function isDeadToken(status: number, body: string): boolean {
  return status === 400 && /invalid_grant/i.test(body);
}
