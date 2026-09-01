import {
  planPublish, dueNow, usableImageUrl,
  IG_CAPTION_MAX, IG_HASHTAG_MAX, MAX_ATTEMPTS, LATE_GRACE_MS,
  type ConnectedPage, type PostDraft, type QueuedPost,
} from './social-publish';

const PAGE: ConnectedPage = {
  pageId: '1010', igId: '2020', igUsername: 'luxnails', pageName: 'Lux Nail Spa', enabled: true,
};
const IMG = 'https://cdn.lumio.app/posts/abc.jpg';
const draft = (o: Partial<PostDraft> = {}): PostDraft => ({
  channels: ['facebook', 'instagram'], message: 'Còn giờ trống thứ Ba sáng', imageUrl: IMG, ...o,
});

describe('a post goes everywhere it was promised, or it waits', () => {
  it('publishes to both when both can take it', () => {
    const p = planPublish(draft(), PAGE);
    expect(p.ready).toBe(true);
    expect(p.plans.find((x) => x.channel === 'facebook')!.targetId).toBe('1010');
    expect(p.plans.find((x) => x.channel === 'instagram')!.targetId).toBe('2020');
  });

  it('refuses the whole post when one of the two channels cannot take it', () => {
    // Publishing to Facebook alone and calling it a success would tell the salon
    // their Instagram is being kept alive when it is not. Half-delivery that
    // reports success is worse than a refusal somebody can act on.
    const p = planPublish(draft({ imageUrl: null }), PAGE);
    expect(p.ready).toBe(false);
    expect(p.plans.find((x) => x.channel === 'facebook')!.ok).toBe(true);
    expect(p.plans.find((x) => x.channel === 'instagram')!.ok).toBe(false);
  });

  it('lets a Facebook-only post through with no image', () => {
    expect(planPublish(draft({ channels: ['facebook'], imageUrl: null }), PAGE).ready).toBe(true);
  });

  it('is not ready when no channel was chosen at all', () => {
    expect(planPublish(draft({ channels: [] }), PAGE).ready).toBe(false);
  });

  it('does not count the same channel twice', () => {
    expect(planPublish(draft({ channels: ['facebook', 'facebook'] }), PAGE).plans).toHaveLength(1);
  });
});

describe('Instagram’s rules are checked while the writer is still looking at the post', () => {
  it('says plainly that Instagram cannot post text alone', () => {
    const p = planPublish(draft({ channels: ['instagram'], imageUrl: null }), PAGE);
    // There is no way to make this work by trying harder — the Content
    // Publishing API has no text-only post — so it is refused at write time
    // rather than failing in a scheduler run at 9am.
    expect(p.problems[0]).toMatch(/bắt buộc phải có ảnh hoặc video/);
  });

  it('refuses a caption past the platform ceiling', () => {
    const p = planPublish(draft({ message: 'a'.repeat(IG_CAPTION_MAX + 1) }), PAGE);
    expect(p.problems.join(' ')).toContain(String(IG_CAPTION_MAX));
  });

  it('accepts a caption exactly at the ceiling', () => {
    expect(planPublish(draft({ message: 'a'.repeat(IG_CAPTION_MAX) }), PAGE).ready).toBe(true);
  });

  it('counts hashtags and refuses past thirty', () => {
    const tags = Array.from({ length: IG_HASHTAG_MAX + 1 }, (_, i) => `#nail${i}`).join(' ');
    const p = planPublish(draft({ message: `Đẹp quá ${tags}` }), PAGE);
    expect(p.problems.join(' ')).toMatch(/31 hashtag/);
  });

  it('counts Vietnamese hashtags too', () => {
    const tags = Array.from({ length: 31 }, (_, i) => `#móngđẹp${i}`).join(' ');
    expect(planPublish(draft({ message: tags }), PAGE).ready).toBe(false);
  });

  it('does not mistake a colour code or a lone # for a hashtag', () => {
    expect(planPublish(draft({ message: 'Màu #  và # — mã #ff0088' }), PAGE).ready).toBe(true);
  });

  it('explains what to fix when the Page has no Instagram linked', () => {
    const p = planPublish(draft(), { ...PAGE, igId: null });
    expect(p.problems[0]).toMatch(/liên kết tài khoản Instagram/);
  });
});

describe('the image has to be one Meta’s own servers can fetch', () => {
  it('accepts a public https url', () => {
    expect(usableImageUrl(IMG)).toBe(true);
  });

  it.each([
    ['http://cdn.lumio.app/a.jpg', 'plain http'],
    ['https://localhost:3000/a.jpg', 'localhost'],
    ['https://127.0.0.1/a.jpg', 'loopback ip'],
    ['https://mac-studio.local/a.jpg', 'an mDNS name'],
    ['', 'nothing at all'],
  ])('rejects %s (%s)', (url) => {
    // Meta fetches the image from its own servers, so an address only the
    // developer's machine can resolve produces a container error minutes after
    // the salon has walked away from the screen.
    expect(usableImageUrl(url)).toBe(false);
  });
});

describe('a post with no connected Page tells the salon where to go', () => {
  it('names the screen instead of saying "not configured"', () => {
    const p = planPublish(draft(), null);
    expect(p.problems[0]).toMatch(/Cài đặt → Messenger/);
  });

  it('refuses when the salon has switched the page off', () => {
    expect(planPublish(draft(), { ...PAGE, enabled: false }).ready).toBe(false);
  });

  it('refuses an empty post before it refuses anything else', () => {
    expect(planPublish(draft({ message: '   ' }), PAGE).problems[0]).toBe('Bài chưa có nội dung.');
  });
});

// ---------------------------------------------------------------------------

const q = (o: Partial<QueuedPost> = {}): QueuedPost =>
  ({ id: 'p1', status: 'scheduled', scheduledAt: new Date('2026-09-01T14:00:00Z'), attempts: 0, ...o });
const NOW = new Date('2026-09-01T14:00:00Z');

describe('the scheduler sends what is due and nothing else', () => {
  it('sends a post whose moment has arrived', () => {
    expect(dueNow([q()], NOW).send).toHaveLength(1);
  });

  it('leaves a post scheduled for later alone', () => {
    expect(dueNow([q({ scheduledAt: new Date('2026-09-01T14:00:01Z') })], NOW).send).toHaveLength(0);
  });

  it('ignores drafts, cancelled posts and ones already sent', () => {
    const rows = ['draft', 'cancelled', 'posted', 'publishing', 'failed'].map((status, i) => q({ id: `p${i}`, status }));
    expect(dueNow(rows, NOW).send).toHaveLength(0);
  });

  it('stops retrying a post that has already failed three times', () => {
    // Otherwise a post with a permanently bad image URL is retried every minute
    // forever, and every retry is a real API call against the salon's rate limit.
    expect(dueNow([q({ attempts: MAX_ATTEMPTS })], NOW).send).toHaveLength(0);
  });
});

describe('a post that missed its slot does not surface days later', () => {
  const late = (ms: number) => dueNow([q({ scheduledAt: new Date(NOW.getTime() - ms) })], NOW);

  it('still sends this morning’s post after a short outage', () => {
    expect(late(LATE_GRACE_MS - 1000).send).toHaveLength(1);
    expect(late(LATE_GRACE_MS - 1000).expired).toHaveLength(0);
  });

  it('expires rather than publishes a post from two days ago', () => {
    // A server down for two days must not suddenly post Tuesday's offer on
    // Thursday — the offer is wrong and the salon looks asleep at the wheel.
    const r = late(2 * 24 * 60 * 60 * 1000);
    expect(r.send).toHaveLength(0);
    expect(r.expired).toHaveLength(1);
  });
});
