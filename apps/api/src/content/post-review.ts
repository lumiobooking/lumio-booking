/**
 * The client's review link and the client-facing shape of a post — the pure
 * half of the approval feature, kept out of the service so it can be tested
 * without a database.
 *
 * THE TOKEN
 *
 * One link per salon, shared into the salon's own group chat. Possession is
 * the credential: the token is the tenant id plus a per-tenant random secret,
 * base64url-encoded so it survives chat apps. The tenant id inside is an
 * opaque uuid, not a secret — the SECRET half is what the server compares,
 * timing-safe, against the one it stored. Rotating the stored secret revokes
 * every copy of the link at once, and a link older than 30 days dies on its
 * own, so a forgotten group post is not a permanent door.
 */

export const REVIEW_LINK_TTL_DAYS = 30;

export function makeReviewToken(tenantId: string, secret: string): string {
  return Buffer.from(`${tenantId}:${secret}`, 'utf8').toString('base64url');
}

export function parseReviewToken(token: string): { tenantId: string; secret: string } | null {
  try {
    const raw = Buffer.from(String(token ?? ''), 'base64url').toString('utf8');
    const i = raw.indexOf(':');
    if (i <= 0 || i === raw.length - 1) return null;
    const tenantId = raw.slice(0, i);
    const secret = raw.slice(i + 1);
    if (!/^[a-zA-Z0-9-]{10,60}$/.test(tenantId) || !/^[a-f0-9]{24,64}$/.test(secret)) return null;
    return { tenantId, secret };
  } catch {
    return null;
  }
}

export function tokenFresh(createdAt: Date | string | null | undefined, now = new Date()): boolean {
  if (!createdAt) return false;
  const t = createdAt instanceof Date ? createdAt.getTime() : Date.parse(String(createdAt));
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t <= REVIEW_LINK_TTL_DAYS * 86_400_000;
}

/**
 * The four words the client's calendar speaks. Everything else the post can
 * be — draft, failed, expired, cancelled — is the agency's business and is
 * not shown at all: a client-facing screen that says "failed" starts a
 * conversation the team should be starting.
 */
export type ClientStatus = 'held' | 'wait' | 'approved' | 'posted';

export function clientStatusOf(p: { status: string; heldAt?: Date | null; approvedAt?: Date | null }): ClientStatus | null {
  if (p.status === 'posted') return 'posted';
  if (p.status !== 'scheduled' && p.status !== 'publishing') return null; // not the client's to see
  if (p.heldAt) return 'held';
  if (p.approvedAt) return 'approved';
  return 'wait';
}
