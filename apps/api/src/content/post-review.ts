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

/** Past this, the queue will never send the post (social-publish.ts LATE_GRACE_MS). */
const MISSED_AFTER_MS = 6 * 60 * 60 * 1000;

export function clientStatusOf(
  p: { status: string; heldAt?: Date | null; approvedAt?: Date | null; scheduledAt?: Date | null },
  now: Date = new Date(),
): ClientStatus | null {
  if (p.status === 'posted') return 'posted';
  if (p.status !== 'scheduled' && p.status !== 'publishing') return null; // not the client's to see
  // Still "scheduled" hours after its time — the queue has given up on it (a
  // post the team never finished, or one that failed every attempt). Asking
  // the owner to approve a post for a day that has passed is the one thing
  // the calendar must never do; the team reschedules it, and until then the
  // day shows only what was planned.
  if (p.status === 'scheduled' && p.scheduledAt && now.getTime() - p.scheduledAt.getTime() > MISSED_AFTER_MS) return null;
  if (p.heldAt) return 'held';
  if (p.approvedAt) return 'approved';
  return 'wait';
}

/** What a posted post earned, added up across the networks it went to. null = no network has reported it. */
export interface PostStats { views: number | null; likes: number | null; comments: number | null }

/**
 * One scheduled post can land on Facebook AND Instagram — two social_posts
 * rows pointing at it. The owner asks "how did it do", not "how did it do on
 * each", so the numbers are added up. A network that never gave a number
 * stays out of the sum (null is "not reported", which is not zero). Views
 * fall back to reach for the rows that only have reach.
 */
export function statsByPost(rows: {
  scheduledPostId?: string | null;
  views?: number | null;
  reach?: number | null;
  likes?: number | null;
  comments?: number | null;
}[]): Map<string, PostStats> {
  const add = (a: number | null, b: number | null | undefined) => (typeof b === 'number' && Number.isFinite(b) ? (a ?? 0) + b : a);
  const out = new Map<string, PostStats>();
  for (const r of rows) {
    if (!r.scheduledPostId) continue;
    const cur = out.get(r.scheduledPostId) ?? { views: null, likes: null, comments: null };
    out.set(r.scheduledPostId, {
      views: add(cur.views, typeof r.views === 'number' ? r.views : r.reach),
      likes: add(cur.likes, r.likes),
      comments: add(cur.comments, r.comments),
    });
  }
  return out;
}
