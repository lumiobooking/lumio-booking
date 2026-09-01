import {
  planPurge, isOurs, storagePathOf, DEFAULT_RETENTION_DAYS, type RetentionPost,
} from './media-retention';

const BASE = 'https://cdn.lumiobooking.com/media';
const NOW = new Date('2026-10-01T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const ours = (n: number) => `${BASE}/tenantA/${'abc' + n}.jpg`;

const post = (o: Partial<RetentionPost> = {}): RetentionPost => ({
  id: 'p1', status: 'posted', postedAt: daysAgo(DEFAULT_RETENTION_DAYS + 1),
  mediaPurgedAt: null, mediaUrls: [ours(1)], ...o,
});

describe('retention is measured from PUBLISHING, never from upload', () => {
  it('deletes the pictures of a post that went out long enough ago', () => {
    // Facebook and Instagram fetched the file at publish time and kept their own
    // copy. The post is unaffected by the URL disappearing.
    const plan = planPurge([post()], BASE, NOW);
    expect(plan.urls).toEqual([ours(1)]);
    expect(plan.postIds).toEqual(['p1']);
  });

  it('leaves a post that published yesterday alone', () => {
    expect(planPurge([post({ postedAt: daysAgo(1) })], BASE, NOW).urls).toEqual([]);
  });

  it('NEVER touches a post that has not published, however old the upload', () => {
    // A salon planning a month ahead uploads on the 1st for a post on the 30th.
    // Measuring retention from upload would erase the picture before it was
    // ever used — which is the exact workflow this feature exists to support.
    for (const status of ['draft', 'scheduled', 'failed', 'expired', 'cancelled', 'publishing']) {
      const old = post({ status, postedAt: null });
      expect(planPurge([old], BASE, NOW).urls).toEqual([]);
    }
  });

  it('does not reconsider a row it has already been through', () => {
    expect(planPurge([post({ mediaPurgedAt: daysAgo(2) })], BASE, NOW).postIds).toEqual([]);
  });

  it('marks an expired post even when it had nothing of ours to delete', () => {
    // Otherwise the sweep re-examines the same rows for ever.
    const external = post({ mediaUrls: ['https://luxnails.com/a.jpg'] });
    const plan = planPurge([external], BASE, NOW);
    expect(plan.urls).toEqual([]);
    expect(plan.postIds).toEqual(['p1']);
  });
});

describe('it only deletes files we put there', () => {
  it.each([
    ['https://luxnails.com/wp-content/uploads/a.jpg', 'the salon’s own website'],
    ['https://cdn.other-saas.com/media/tenantA/a.jpg', 'somebody else’s CDN'],
    ['https://cdn.lumiobooking.com/media-other/tenantA/a.jpg', 'a lookalike prefix'],
  ])('leaves %s alone (%s)', (url) => {
    // We did not put the file there and it is not ours to remove.
    expect(isOurs(url, BASE)).toBe(false);
    expect(planPurge([post({ mediaUrls: [url] })], BASE, NOW).urls).toEqual([]);
  });

  it('recognises our own base', () => {
    expect(isOurs(ours(1), BASE)).toBe(true);
    // A trailing slash on the configured base must not change the answer.
    expect(isOurs(ours(1), `${BASE}/`)).toBe(true);
  });

  it('does nothing at all when storage is not configured', () => {
    // With no base every URL is "not ours", and guessing would delete a salon's
    // own files.
    expect(planPurge([post()], null, NOW).urls).toEqual([]);
    expect(planPurge([post()], '', NOW).postIds).toEqual([]);
  });
});

describe('a file another post still needs is never deleted', () => {
  it('keeps a picture that an unpublished post also points at', () => {
    // Cheaper to keep one file than to break one post.
    const shared = ours(1);
    const plan = planPurge([
      post({ id: 'old', mediaUrls: [shared] }),
      post({ id: 'future', status: 'scheduled', postedAt: null, mediaUrls: [shared] }),
    ], BASE, NOW);
    expect(plan.urls).toEqual([]);
    // The old row is still marked — it has been through retention.
    expect(plan.postIds).toEqual(['old']);
  });

  it('keeps a picture a recently published post also points at', () => {
    const shared = ours(1);
    const plan = planPurge([
      post({ id: 'old', mediaUrls: [shared] }),
      post({ id: 'recent', postedAt: daysAgo(2), mediaUrls: [shared] }),
    ], BASE, NOW);
    expect(plan.urls).toEqual([]);
  });

  it('deletes the unshared files of that same post', () => {
    const shared = ours(1);
    const plan = planPurge([
      post({ id: 'old', mediaUrls: [shared, ours(2)] }),
      post({ id: 'future', status: 'scheduled', postedAt: null, mediaUrls: [shared] }),
    ], BASE, NOW);
    expect(plan.urls).toEqual([ours(2)]);
  });

  it('deletes a file shared by two posts that are BOTH past retention, once', () => {
    const shared = ours(1);
    const plan = planPurge([
      post({ id: 'a', mediaUrls: [shared] }),
      post({ id: 'b', mediaUrls: [shared] }),
    ], BASE, NOW);
    expect(plan.urls).toEqual([shared]);
    expect(plan.postIds.sort()).toEqual(['a', 'b']);
  });
});

describe('the storage path is derived, never trusted', () => {
  it('returns the tenant-scoped path for one of our files', () => {
    expect(storagePathOf(`${BASE}/tenantA/abc1.jpg`, BASE)).toBe('tenantA/abc1.jpg');
  });

  it.each([
    [`${BASE}/../../etc/passwd`, 'traversal'],
    [`${BASE}/tenantA/../tenantB/x.jpg`, 'traversal inside the bucket'],
    [`${BASE}/tenantA/x.jpg?a=b`, 'a query string'],
    [`${BASE}/x.jpg`, 'no tenant folder'],
    ['https://evil.com/x.jpg', 'somebody else’s host'],
  ])('refuses %s (%s)', (url) => {
    // An FTP delete built from an arbitrary URL is a way to delete somebody
    // else's file, so the check lives here rather than at the call site where
    // it can be forgotten.
    expect(storagePathOf(url, BASE)).toBeNull();
  });
});
