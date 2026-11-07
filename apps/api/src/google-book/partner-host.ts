/**
 * The host the PARTNER feed's links use (RWG_LINK_HOST, e.g.
 * https://book.lumiobooking.com). Null when unset or not a plain https
 * origin — then the feed keeps the main domain, as before.
 */
export function partnerLinkHost(env: Record<string, string | undefined>): string | null {
  const raw = (env.RWG_LINK_HOST ?? '').trim();
  if (!raw) return null;
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    if (u.protocol !== 'https:' || !u.hostname.includes('.')) return null;
    return `https://${u.host.toLowerCase()}`;
  } catch {
    return null;
  }
}
