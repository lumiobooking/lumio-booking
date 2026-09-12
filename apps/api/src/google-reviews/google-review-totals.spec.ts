import { GoogleReviewsService, pagesToWalk, replyTimeOf, GBR_PAGE_SIZE, GBR_MAX_PAGES } from './google-reviews.service';

/**
 * Why these two tiny functions have a file to themselves.
 *
 * Both were one-liners inside the sync, both were wrong, and both were wrong
 * INVISIBLY — the kind of wrong that produces a screen full of plausible
 * numbers. "Pull one page" looked like "pull the reviews". "Stamp it now"
 * looked like "record when it was replied". Neither throws, neither logs, and
 * neither shows up until an owner counts the reviews on their own Maps listing
 * and asks why the number is different.
 */
describe('how far back the sync reaches', () => {
  it('pulls one page when Lumio already has everything Google has', () => {
    expect(pagesToWalk(187, 187)).toBe(1);
    expect(pagesToWalk(200, 187)).toBe(1); // more on file than Google reports: nothing to catch up
  });

  it('walks far enough to reach reviews below the newest fifty', () => {
    // The bug this replaces: 55 reviews on Google, one page of 50 pulled, and
    // the five oldest never mirrored, never counted, never given a draft —
    // which is exactly where the two unanswered one-stars were sitting.
    expect(pagesToWalk(50, 55)).toBe(2);
    expect(pagesToWalk(0, 187)).toBe(4);
    expect(pagesToWalk(120, 187)).toBe(4);
  });

  it('is bounded, so one salon cannot turn a tick into sixty calls', () => {
    expect(pagesToWalk(0, 100000)).toBe(GBR_MAX_PAGES);
    expect(GBR_PAGE_SIZE * GBR_MAX_PAGES).toBe(1000);
  });

  it('asks for one page when Google did not say how many there are', () => {
    // No total is not evidence of a backlog. Guessing "walk everything" here
    // would put every salon into catch-up mode on every tick, for ever.
    expect(pagesToWalk(0, null)).toBe(1);
    expect(pagesToWalk(0, 0)).toBe(1);
    expect(pagesToWalk(30, undefined as unknown as null)).toBe(1);
  });

  it('never returns zero — a sync that pulls nothing is not a sync', () => {
    for (const [m, t] of [[0, 1], [1, 1], [5, 3], [0, null]] as [number, number | null][]) {
      expect(pagesToWalk(m, t)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('when a reply that was already on Google went up', () => {
  it('uses the time Google recorded for the reply', () => {
    const d = replyTimeOf({ reviewReply: { updateTime: '2024-03-04T10:00:00Z' }, createTime: '2024-03-01T09:00:00Z' });
    expect(d?.toISOString()).toBe('2024-03-04T10:00:00.000Z');
  });

  it('falls back to the review’s own date, which is nearer the truth than today', () => {
    const d = replyTimeOf({ reviewReply: {}, createTime: '2023-11-20T08:00:00Z' });
    expect(d?.toISOString()).toBe('2023-11-20T08:00:00.000Z');
  });

  it('DOES NOT stamp three years of replies with this morning', () => {
    // The bug: every pre-existing reply got `new Date()` on first sync, so the
    // whole inbox lit up "just replied" and the salon was shown a morning's
    // work it had not done.
    const d = replyTimeOf({ reviewReply: { updateTime: '2022-01-05T00:00:00Z' } });
    expect(Date.now() - (d as Date).getTime()).toBeGreaterThan(365 * 24 * 3600 * 1000);
  });

  it('says null rather than inventing a date it does not have', () => {
    expect(replyTimeOf({})).toBeNull();
    expect(replyTimeOf({ reviewReply: { updateTime: 'not a date' } })).toBeNull();
    expect(replyTimeOf({ reviewReply: { updateTime: '' }, createTime: '' })).toBeNull();
  });
});

/**
 * The walk, end to end.
 *
 * The two functions above are the rule; this is the loop that obeys it. It is
 * worth its own test because the failure it replaces was not in the rule — it
 * was that no loop existed at all, and one page looked exactly like all of them.
 */
describe('syncing a salon that has more reviews than one page', () => {
  const review = (i: number, over: Record<string, unknown> = {}) => ({
    reviewId: `g${i}`,
    reviewer: { displayName: `Customer ${i}` },
    starRating: 'FIVE',
    comment: `Review number ${i}`,
    createTime: '2026-06-19T10:00:00Z',
    ...over,
  });

  const harness = (pages: Record<string, unknown>[], existingIds: string[] = []) => {
    const created: string[] = [];
    const asked: (string | undefined)[] = [];
    const written: Record<string, unknown>[] = [];
    const svc = new GoogleReviewsService(
      {
        googleReview: {
          count: async () => existingIds.length,
          findUnique: async ({ where }: { where: { tenantId_googleReviewId: { googleReviewId: string } } }) =>
            (existingIds.includes(where.tenantId_googleReviewId.googleReviewId) ? { id: 'x', status: 'REPLIED', draftReply: 'd', repliedAt: new Date() } : null),
          create: async ({ data }: { data: { googleReviewId: string } }) => { created.push(data.googleReviewId); return { id: data.googleReviewId }; },
          update: async () => ({}),
        },
        auditLog: { count: async () => 0, create: async () => ({}) },
      } as never,
      {} as never, {} as never, {} as never,
    );
    const priv = svc as never as Record<string, unknown>;
    priv.getSettings = async () => ({
      connected: true, accountId: 'accounts/1', locationId: 'locations/1',
      approveFirst: true, autoMinStars: 4, alertMaxStars: 3, tone: 'warm',
    });
    priv.accessToken = async () => 'tok';
    priv.salonName = async () => 'Lumio Salon';
    priv.generateReply = async () => 'Thanks!';
    priv.alertManager = async () => undefined;
    priv.writeSettings = async (_t: string, patch: Record<string, unknown>) => { written.push(patch); };
    priv.fetchReviewPage = async (_p: string, _t: string, pageToken?: string) => {
      asked.push(pageToken);
      const i = pageToken ? Number(pageToken) : 0;
      return pages[i] ?? { reviews: [] };
    };
    return { svc, created, asked, written };
  };

  it('keeps walking until it has the reviews below the newest page', async () => {
    const h = harness([
      { reviews: [review(1), review(2)], nextPageToken: '1', totalReviewCount: 120, averageRating: 4.6 },
      { reviews: [review(3)], nextPageToken: '2' },
      { reviews: [review(4)] },
    ]);
    const r = await h.svc.syncReviews('t1');
    expect(h.asked).toEqual([undefined, '1', '2']); // three pages, not one
    expect(h.created).toEqual(['g1', 'g2', 'g3', 'g4']);
    expect(r.fetched).toBe(4);
  });

  it('records what Google says the salon really has', async () => {
    const h = harness([{ reviews: [review(1)], totalReviewCount: 187, averageRating: 4.55 }]);
    await h.svc.syncReviews('t1');
    expect(h.written[0]).toMatchObject({ googleTotal: 187, googleRating: 4.55 });
    expect(typeof (h.written[0] as { googleStatsAt: string }).googleStatsAt).toBe('string');
  });

  it('does not erase yesterday’s total when Google omits it', async () => {
    // A page without the counters must leave the stored figure alone, or the
    // screen flips to "0 đánh giá" on one odd response.
    const h = harness([{ reviews: [review(1)] }]);
    await h.svc.syncReviews('t1');
    expect('googleTotal' in (h.written[0] as object)).toBe(false);
    expect('googleRating' in (h.written[0] as object)).toBe(false);
  });

  it('stops at one page once Lumio has caught up', async () => {
    const h = harness(
      [{ reviews: [review(1)], nextPageToken: '1', totalReviewCount: 2 }, { reviews: [review(2)] }],
      ['g1', 'g2'],
    );
    await h.svc.syncReviews('t1');
    expect(h.asked).toEqual([undefined]);
  });

  it('KEEPS the pages it already has when a later one fails', async () => {
    const pages: Record<string, unknown>[] = [
      { reviews: [review(1)], nextPageToken: '1', totalReviewCount: 200 },
    ];
    const h = harness(pages);
    const priv = h.svc as never as Record<string, unknown>;
    const ok = priv.fetchReviewPage as (p: string, t: string, k?: string) => Promise<unknown>;
    priv.fetchReviewPage = async (p: string, t: string, k?: string) => {
      if (k) throw new Error('Google 429: quota');
      return ok(p, t, k);
    };
    const r = await h.svc.syncReviews('t1');
    expect(r.fetched).toBe(1);
    expect(h.created).toEqual(['g1']);
    // And the run still counts as a sync, so the next tick resumes from here.
    expect(typeof (h.written[0] as { lastSyncAt: string }).lastSyncAt).toBe('string');
  });
});
