import { GoogleReviewsService, AUTO_REPLY_DELAY_MIN, AUTO_REPLY_DAILY_CAP } from './google-reviews.service';

/**
 * This code writes in public, under a salon's own name, on a profile strangers
 * use to decide whether to walk in. So every gate is tested from the outside:
 * what did it try to POST to Google, and for which review.
 */
const minsAgo = (n: number) => new Date(Date.now() - n * 60_000);

interface Row {
  id: string; googleReviewId: string; starRating: number; comment: string | null;
  status: string; draftReply: string | null; repliedAt: Date | null; reviewCreatedAt: Date | null;
}

function harness(rows: Row[], settings: Record<string, unknown> = {}, postedToday = 0) {
  const posted: { id: string; text: string }[] = [];
  const updated: string[] = [];
  const svc = new GoogleReviewsService(
    {
      googleReview: {
        findMany: async ({ where, take }: { where: Record<string, unknown>; take: number }) => rows.filter((r) => {
          const min = (where.starRating as { gte: number }).gte;
          const cutoff = (where.reviewCreatedAt as { lte: Date }).lte;
          return r.status === 'DRAFTED' && r.repliedAt === null && r.draftReply !== null
            && r.starRating >= min && r.reviewCreatedAt !== null && r.reviewCreatedAt <= cutoff;
        }).slice(0, take),
        update: async ({ where }: { where: { id: string } }) => { updated.push(where.id); return {}; },
      },
      auditLog: { count: async () => postedToday, create: async () => ({}) },
    } as never,
    {} as never, {} as never, {} as never,
  );
  // The one call that reaches Google, swappable so a test can make it fail.
  let poster = async (gid: string, text: string) => { posted.push({ id: gid, text }); };
  (svc as never as { postReply: unknown }).postReply = async (_s: unknown, gid: string, text: string) => poster(gid, text);
  const s = {
    approveFirst: false, autoMinStars: 4, alertMaxStars: 3,
    accountId: 'accounts/1', locationId: 'locations/1', ...settings,
  } as never;
  const run = () => (svc as never as { autoPostDue: (t: string, s: unknown, n: string) => Promise<number> })
    .autoPostDue('t1', s, 'Lumio Salon');
  const setPoster = (fn: (gid: string, text: string) => Promise<void>) => { poster = fn; };
  return { run, posted, updated, setPoster };
}

const row = (over: Partial<Row> = {}): Row => ({
  id: 'r1', googleReviewId: 'g1', starRating: 5, comment: 'Lovely work, thank you!',
  status: 'DRAFTED', draftReply: 'Thank you so much!', repliedAt: null,
  reviewCreatedAt: minsAgo(AUTO_REPLY_DELAY_MIN + 5), ...over,
});

describe('a five-star review answers itself, and nothing else does', () => {
  it('posts a happy review that has waited out the delay', async () => {
    const h = harness([row()]);
    expect(await h.run()).toBe(1);
    expect(h.posted).toEqual([{ id: 'g1', text: 'Thank you so much!' }]);
    expect(h.updated).toEqual(['r1']);
  });

  it('waits the full 30 minutes — a reply 8 seconds later reads as a machine', async () => {
    const h = harness([row({ reviewCreatedAt: minsAgo(AUTO_REPLY_DELAY_MIN - 1) })]);
    expect(await h.run()).toBe(0);
    expect(h.posted).toEqual([]);
  });

  it('never posts to three stars or fewer, whatever the draft says', async () => {
    for (const stars of [1, 2, 3]) {
      const h = harness([row({ starRating: stars, draftReply: 'Sorry about that!' })]);
      expect(await h.run()).toBe(0);
      expect(h.posted).toEqual([]);
    }
  });

  it('never posts a five-star review that carries a complaint', async () => {
    const h = harness([row({ comment: 'Nails are lovely but the wait was terrible and rude staff' })]);
    expect(await h.run()).toBe(0);
    expect(h.posted).toEqual([]);
  });

  it('stops completely for a salon that asked to approve first', async () => {
    const h = harness([row()], { approveFirst: true });
    expect(await h.run()).toBe(0);
    expect(h.posted).toEqual([]);
  });

  it('will not guess the age of a review Google gave no date for', async () => {
    const h = harness([row({ reviewCreatedAt: null })]);
    expect(await h.run()).toBe(0);
  });

  it('posts nothing when the draft is empty', async () => {
    const h = harness([row({ draftReply: '   ' })]);
    expect(await h.run()).toBe(0);
    expect(h.posted).toEqual([]);
  });

  it('obeys the daily cap, so a loop gone wrong stops at twenty', async () => {
    const many = Array.from({ length: 50 }, (_, i) => row({ id: `r${i}`, googleReviewId: `g${i}` }));
    const h = harness(many);
    expect(await h.run()).toBe(AUTO_REPLY_DAILY_CAP);
    expect(h.posted).toHaveLength(AUTO_REPLY_DAILY_CAP);
  });

  it('posts nothing at all once the cap is already spent', async () => {
    const h = harness([row()], {}, AUTO_REPLY_DAILY_CAP);
    expect(await h.run()).toBe(0);
    expect(h.posted).toEqual([]);
  });

  it('keeps going when Google rejects one review, and does not mark it replied', async () => {
    const rows = [row({ id: 'a', googleReviewId: 'ga' }), row({ id: 'b', googleReviewId: 'gb' })];
    const h = harness(rows);
    const posted: { id: string; text: string }[] = [];
    // The first call fails the way Google fails: an exception, mid-loop.
    let call = 0;
    h.setPoster(async (gid: string, text: string) => {
      call += 1;
      if (call === 1) throw new Error('Google reply failed (403).');
      posted.push({ id: gid, text });
    });
    expect(await h.run()).toBe(1);
    expect(posted.map((p) => p.id)).toEqual(['gb']);
    // The one that failed must NOT be recorded as answered, or it is lost.
    expect(h.updated).toEqual(['b']);
  });
});
