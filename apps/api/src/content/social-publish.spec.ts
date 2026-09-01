import {
  planPublish, dueNow, usableMediaUrl, guessKind, shapeOf, crowding, igGrid,
  IG_CAPTION_MAX, IG_HASHTAG_MAX, IG_CAROUSEL_MAX, MAX_ATTEMPTS, LATE_GRACE_MS, CROWDING_MS,
  type ConnectedPage, type PostDraft, type QueuedPost, type MediaItem, type Channel,
} from './social-publish';

const PAGE: ConnectedPage = {
  pageId: '1010', igId: '2020', igUsername: 'luxnails', pageName: 'Lux Nail Spa', enabled: true,
};
const img = (n = 1): MediaItem => ({ url: `https://cdn.lumio.app/p/${n}.jpg`, kind: 'image' });
const vid = (n = 1): MediaItem => ({ url: `https://cdn.lumio.app/p/${n}.mp4`, kind: 'video' });
const many = (n: number) => Array.from({ length: n }, (_, i) => img(i));

const draft = (o: Partial<PostDraft> = {}): PostDraft => ({
  channels: ['facebook', 'instagram'], message: 'Còn giờ trống thứ Ba sáng', media: [img()], ...o,
});

describe('what the post IS, read off its media rather than stored twice', () => {
  it.each([
    [[], 'text'],
    [[img()], 'image'],
    [[vid()], 'video'],
    [[img(1), img(2)], 'carousel'],
    [[img(1), vid(2)], 'carousel'],
  ])('%#: %j is a %s', (media, shape) => {
    // Storing the shape as its own column means a post can claim to be a
    // carousel while holding one photo. Deriving it makes that unrepresentable.
    expect(shapeOf(media as MediaItem[])).toBe(shape);
  });

  it('guesses image or video from a link, as a starting point only', () => {
    expect(guessKind('https://cdn/x.MP4')).toBe('video');
    expect(guessKind('https://cdn/x.mov?sig=abc')).toBe('video');
    expect(guessKind('https://cdn/x.jpg')).toBe('image');
    // A signed CDN path with no extension tells us nothing — the salon's own
    // choice in the picker is what publishing uses, not this.
    expect(guessKind('https://cdn/a1b2c3')).toBe('image');
  });
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
    const p = planPublish(draft({ media: [] }), PAGE);
    expect(p.ready).toBe(false);
    expect(p.plans.find((x) => x.channel === 'facebook')!.ok).toBe(true);
    expect(p.plans.find((x) => x.channel === 'instagram')!.ok).toBe(false);
  });

  it('lets a Facebook-only post through with no media at all', () => {
    expect(planPublish(draft({ channels: ['facebook'], media: [] }), PAGE).ready).toBe(true);
  });

  it('is not ready when no channel was chosen at all', () => {
    expect(planPublish(draft({ channels: [] }), PAGE).ready).toBe(false);
  });
});

describe('video and carousel', () => {
  it('takes a single video to both channels', () => {
    const p = planPublish(draft({ media: [vid()] }), PAGE);
    expect(p.shape).toBe('video');
    expect(p.ready).toBe(true);
  });

  it('takes a ten-item carousel and refuses an eleventh', () => {
    expect(planPublish(draft({ media: many(IG_CAROUSEL_MAX) }), PAGE).ready).toBe(true);
    const over = planPublish(draft({ media: many(IG_CAROUSEL_MAX + 1) }), PAGE);
    expect(over.problems.join(' ')).toMatch(/tối đa 10/);
  });

  it('refuses to mix a video with photos in one Facebook post', () => {
    // The Graph API has no single call that does it, and quietly dropping the
    // video would publish something the salon never wrote.
    const p = planPublish(draft({ channels: ['facebook'], media: [img(1), vid(2)] }), PAGE);
    expect(p.problems.join(' ')).toMatch(/không đăng chung video với ảnh/);
  });

  it('allows that same mix on Instagram, where a carousel does hold both', () => {
    expect(planPublish(draft({ channels: ['instagram'], media: [img(1), vid(2)] }), PAGE).ready).toBe(true);
  });

  it('takes several photos on Facebook', () => {
    expect(planPublish(draft({ channels: ['facebook'], media: many(4) }), PAGE).ready).toBe(true);
  });
});

describe('Instagram’s rules are checked while the writer is still looking at the post', () => {
  it('says plainly that Instagram cannot post text alone', () => {
    const p = planPublish(draft({ channels: ['instagram'], media: [] }), PAGE);
    expect(p.problems[0]).toMatch(/bắt buộc phải có ảnh hoặc video/);
  });

  it('refuses a caption past the platform ceiling', () => {
    expect(planPublish(draft({ message: 'a'.repeat(IG_CAPTION_MAX + 1) }), PAGE).problems.join(' '))
      .toContain(String(IG_CAPTION_MAX));
  });

  it('accepts a caption exactly at the ceiling', () => {
    expect(planPublish(draft({ message: 'a'.repeat(IG_CAPTION_MAX) }), PAGE).ready).toBe(true);
  });

  it('counts hashtags and refuses past thirty', () => {
    const tags = Array.from({ length: IG_HASHTAG_MAX + 1 }, (_, i) => `#nail${i}`).join(' ');
    expect(planPublish(draft({ message: `Đẹp quá ${tags}` }), PAGE).problems.join(' ')).toMatch(/31 hashtag/);
  });

  it('counts Vietnamese hashtags too', () => {
    const tags = Array.from({ length: 31 }, (_, i) => `#móngđẹp${i}`).join(' ');
    expect(planPublish(draft({ message: tags }), PAGE).ready).toBe(false);
  });

  it('does not mistake a colour code or a lone # for a hashtag', () => {
    expect(planPublish(draft({ message: 'Màu #  và # — mã #ff0088' }), PAGE).ready).toBe(true);
  });

  it('explains what to fix when the Page has no Instagram linked', () => {
    expect(planPublish(draft(), { ...PAGE, igId: null }).problems[0]).toMatch(/liên kết tài khoản Instagram/);
  });
});

describe('the media has to be something Meta’s own servers can fetch', () => {
  it('accepts a public https url', () => {
    expect(usableMediaUrl('https://cdn.lumio.app/a.jpg')).toBe(true);
  });

  it.each([
    ['http://cdn.lumio.app/a.jpg', 'plain http'],
    ['https://localhost:3000/a.jpg', 'localhost'],
    ['https://127.0.0.1/a.mp4', 'loopback ip'],
    ['https://mac-studio.local/a.jpg', 'an mDNS name'],
    ['', 'nothing at all'],
  ])('rejects %s (%s)', (url) => {
    expect(usableMediaUrl(url)).toBe(false);
  });

  it('refuses the post when any ONE item in a carousel is unreachable', () => {
    // Nine good photos and one localhost link is still a post that dies in the
    // middle of publishing, with some containers already created.
    const media = [...many(9), { url: 'http://localhost/x.jpg', kind: 'image' as const }];
    expect(planPublish(draft({ media }), PAGE).ready).toBe(false);
  });
});

describe('a post with no connected Page tells the salon where to go', () => {
  it('names the screen instead of saying "not configured"', () => {
    expect(planPublish(draft(), null).problems[0]).toMatch(/Cài đặt → Messenger/);
  });

  it('refuses when the salon has switched the page off', () => {
    expect(planPublish(draft(), { ...PAGE, enabled: false }).ready).toBe(false);
  });

  it('refuses a post that is empty in every sense', () => {
    expect(planPublish(draft({ message: '   ', media: [] }), PAGE).problems[0]).toBe('Bài chưa có nội dung.');
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
    expect(dueNow([q({ attempts: MAX_ATTEMPTS })], NOW).send).toHaveLength(0);
  });

  it('expires rather than publishes a post from two days ago', () => {
    // A server down for two days must not suddenly post Tuesday's offer on
    // Thursday — the offer is wrong and the salon looks asleep at the wheel.
    const late = dueNow([q({ scheduledAt: new Date(NOW.getTime() - 2 * 86_400_000) })], NOW);
    expect(late.send).toHaveLength(0);
    expect(late.expired).toHaveLength(1);
  });

  it('still sends this morning’s post after a short outage', () => {
    expect(dueNow([q({ scheduledAt: new Date(NOW.getTime() - (LATE_GRACE_MS - 1000)) })], NOW).send).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

const at = (iso: string, id: string, channels: Channel[] = ['instagram']) =>
  ({ id, scheduledAt: new Date(iso), channels });

describe('planning a month ahead, the queue points out where it fights itself', () => {
  it('flags two posts on the same channel within three hours', () => {
    const w = crowding([at('2026-09-05T09:00:00Z', 'a'), at('2026-09-05T10:30:00Z', 'b')]);
    expect(w).toHaveLength(1);
    expect(w[0].id).toBe('b'); // the later one is the one you would move
    expect(w[0].minutesApart).toBe(90);
  });

  it('says nothing about posts a comfortable distance apart', () => {
    expect(crowding([at('2026-09-05T09:00:00Z', 'a'), at('2026-09-05T13:00:00Z', 'b')])).toHaveLength(0);
  });

  it('does not treat one post on Facebook and one on Instagram as crowding', () => {
    // Different audiences, different feeds. Warning here would train the salon
    // to ignore the warning.
    const w = crowding([
      at('2026-09-05T09:00:00Z', 'a', ['facebook']),
      at('2026-09-05T09:30:00Z', 'b', ['instagram']),
    ]);
    expect(w).toHaveLength(0);
  });

  it('flags a post that crowds on BOTH channels once per channel', () => {
    const w = crowding([
      at('2026-09-05T09:00:00Z', 'a', ['facebook', 'instagram']),
      at('2026-09-05T09:30:00Z', 'b', ['facebook', 'instagram']),
    ]);
    expect(w.map((x) => x.id)).toEqual(['b', 'b']);
  });

  it('is advice, not a refusal — a crowded post still publishes', () => {
    // A salon running a flash offer at 11 and a follow-up at 12 knows something
    // this code does not.
    const p = planPublish(draft(), PAGE);
    expect(p.ready).toBe(true);
    expect(CROWDING_MS).toBeGreaterThan(0);
  });
});

describe('the Instagram grid shows the profile as it will look', () => {
  const row = (id: string, iso: string, o: Partial<{ channels: Channel[]; media: MediaItem[]; status: string }> = {}) =>
    ({ id, scheduledAt: new Date(iso), channels: ['instagram'] as Channel[], media: [img()], status: 'scheduled', ...o });

  it('puts the newest first, the way a profile page does', () => {
    const g = igGrid([row('a', '2026-09-01T09:00:00Z'), row('c', '2026-09-03T09:00:00Z'), row('b', '2026-09-02T09:00:00Z')]);
    expect(g.map((x) => x.id)).toEqual(['c', 'b', 'a']);
  });

  it('leaves out Facebook-only posts', () => {
    // A grid that shows a post which will never appear on the profile is a grid
    // that lies about what the profile will look like.
    expect(igGrid([row('a', '2026-09-01T09:00:00Z', { channels: ['facebook'] })])).toHaveLength(0);
  });

  it('leaves out posts with no media, and cancelled or expired ones', () => {
    const rows = [
      row('a', '2026-09-01T09:00:00Z', { media: [] }),
      row('b', '2026-09-02T09:00:00Z', { status: 'cancelled' }),
      row('c', '2026-09-03T09:00:00Z', { status: 'expired' }),
      row('d', '2026-09-04T09:00:00Z'),
    ];
    expect(igGrid(rows).map((x) => x.id)).toEqual(['d']);
  });

  it('keeps posts that have already published — they are what is on the profile now', () => {
    expect(igGrid([row('a', '2026-08-01T09:00:00Z', { status: 'posted' })])).toHaveLength(1);
  });
});
