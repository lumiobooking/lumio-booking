import { clientStatusOf, makeReviewToken, parseReviewToken, tokenFresh, REVIEW_LINK_TTL_DAYS } from './post-review';

describe('the review link token', () => {
  const TENANT = '0b1f6c1e-2222-4444-8888-aaaaaaaaaaaa';
  const SECRET = 'a'.repeat(48);

  it('round-trips through chat apps untouched', () => {
    const t = makeReviewToken(TENANT, SECRET);
    expect(/^[A-Za-z0-9_-]+$/.test(t)).toBe(true); // base64url: no chars a chat app mangles
    expect(parseReviewToken(t)).toEqual({ tenantId: TENANT, secret: SECRET });
  });

  it('rejects garbage without throwing — the public door sees a lot of garbage', () => {
    expect(parseReviewToken('')).toBeNull();
    expect(parseReviewToken('not-base64!!!')).toBeNull();
    expect(parseReviewToken(Buffer.from('no-colon-here').toString('base64url'))).toBeNull();
    expect(parseReviewToken(Buffer.from(':leading').toString('base64url'))).toBeNull();
    expect(parseReviewToken(Buffer.from(`${TENANT}:UPPERCASE-IS-NOT-HEX`).toString('base64url'))).toBeNull();
  });

  it('dies of old age at 30 days — a forgotten group post is not a permanent door', () => {
    const now = new Date('2026-09-02T00:00:00Z');
    const fresh = new Date(now.getTime() - (REVIEW_LINK_TTL_DAYS - 1) * 86_400_000);
    const stale = new Date(now.getTime() - (REVIEW_LINK_TTL_DAYS + 1) * 86_400_000);
    expect(tokenFresh(fresh, now)).toBe(true);
    expect(tokenFresh(stale, now)).toBe(false);
    expect(tokenFresh(null, now)).toBe(false);
    expect(tokenFresh('not a date', now)).toBe(false);
  });
});

describe('what the client is allowed to see a post as', () => {
  it('speaks four words and hides the rest', () => {
    expect(clientStatusOf({ status: 'scheduled' })).toBe('wait');
    expect(clientStatusOf({ status: 'scheduled', approvedAt: new Date() })).toBe('approved');
    expect(clientStatusOf({ status: 'scheduled', heldAt: new Date() })).toBe('held');
    expect(clientStatusOf({ status: 'posted' })).toBe('posted');
    // The agency's business, not the client's screen:
    for (const st of ['draft', 'failed', 'expired', 'cancelled']) {
      expect(clientStatusOf({ status: st })).toBeNull();
    }
  });

  it('a hold outranks an old approval — the comment is newer information', () => {
    expect(clientStatusOf({ status: 'scheduled', approvedAt: new Date(), heldAt: new Date() })).toBe('held');
  });

  it('never asks for approval on a day that has passed', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    const h = 60 * 60 * 1000;
    // Still within the queue's grace: it may yet go out, so it is still hers to approve.
    expect(clientStatusOf({ status: 'scheduled', scheduledAt: new Date(now.getTime() - 2 * h) }, now)).toBe('wait');
    // Hours past: the queue has given up; the owner is not asked. Held or approved, same.
    expect(clientStatusOf({ status: 'scheduled', scheduledAt: new Date(now.getTime() - 7 * h) }, now)).toBeNull();
    expect(clientStatusOf({ status: 'scheduled', scheduledAt: new Date(now.getTime() - 48 * h), approvedAt: now }, now)).toBeNull();
    expect(clientStatusOf({ status: 'scheduled', scheduledAt: new Date(now.getTime() - 48 * h), heldAt: now }, now)).toBeNull();
    // Mid-publish or already out: shown as what it is.
    expect(clientStatusOf({ status: 'publishing', scheduledAt: new Date(now.getTime() - 7 * h) }, now)).toBe('wait');
    expect(clientStatusOf({ status: 'posted', scheduledAt: new Date(now.getTime() - 48 * h) }, now)).toBe('posted');
  });
});
