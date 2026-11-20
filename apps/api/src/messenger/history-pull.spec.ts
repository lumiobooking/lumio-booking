import { graphLine, isRateLimited, isTooMuchData, resumable, smallerPage, PULL_CHECKPOINT, PULL_DONE, PULL_STARTED } from './history-pull';
import { MessengerService } from './messenger.service';

describe('rt229 — a message with no words still counts', () => {
  it('a photo comes in as a photo, with a short note', () => {
    const l = graphLine({ attachments: { data: [{ mime_type: 'image/jpeg', image_data: { url: 'https://cdn.fb/x.jpg' } }] } }, false);
    expect(l).toEqual({ content: '[Khách gửi 1 ảnh]', images: ['https://cdn.fb/x.jpg'] });
  });

  it('the salon’s own photo reads "Đã gửi"; words keep their photos', () => {
    expect(graphLine({ attachments: { data: [{ mime_type: 'image/png', image_data: { url: 'https://a/1' } }, { mime_type: 'image/png', image_data: { url: 'https://a/2' } }] } }, true)?.content).toBe('[Đã gửi 2 ảnh]');
    expect(graphLine({ message: ' gel x màu này ', attachments: { data: [{ image_data: { url: 'https://a/3' } }] } }, false)).toEqual({ content: 'gel x màu này', images: ['https://a/3'] });
  });

  it('sticker, voice, video, file and link each say what they were', () => {
    expect(graphLine({ sticker: 'https://s/1.png' }, false)).toEqual({ content: '[Khách gửi sticker]', images: ['https://s/1.png'] });
    expect(graphLine({ attachments: { data: [{ mime_type: 'audio/mpeg' }] } }, false)?.content).toBe('[Khách gửi tin nhắn thoại]');
    expect(graphLine({ attachments: { data: [{ mime_type: 'video/mp4', video_data: { url: 'https://v' } }] } }, false)?.content).toBe('[Khách gửi video]');
    expect(graphLine({ attachments: { data: [{ mime_type: 'application/pdf', file_url: 'https://f' }] } }, false)?.content).toBe('[Khách gửi file]');
    expect(graphLine({ shares: { data: [{ link: 'https://instagram.com/p/1' }] } }, false)?.content).toBe('[Khách gửi liên kết] https://instagram.com/p/1');
  });

  it('nothing at all is nothing; a non-https address is never shown', () => {
    expect(graphLine({}, false)).toBeNull();
    expect(graphLine(null, false)).toBeNull();
    expect(graphLine({ attachments: { data: [{ mime_type: 'image/jpeg', image_data: { url: 'javascript:alert(1)' } }] } }, false)).toEqual({ content: '[Khách gửi file]', images: [] });
  });
});

describe('rt229 — Meta’s refusals are told apart', () => {
  it('too much data → ask smaller; rate limit → wait', () => {
    expect(isTooMuchData({ code: 1, message: 'Please reduce the amount of data you\'re asking for, then retry your request' })).toBe(true);
    expect(isTooMuchData(null, true)).toBe(true);
    expect(isTooMuchData({ code: 190, message: 'Error validating access token' })).toBe(false);
    expect(isRateLimited({ code: 613 })).toBe(true);
    expect(isRateLimited({ code: 4, message: 'Application request limit reached' })).toBe(true);
    expect(isRateLimited({ code: 190 })).toBe(false);
    expect(smallerPage(25)).toBe(12);
    expect(smallerPage(6)).toBe(5);
  });
});

describe('rt229 — a pull cut short carries on', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  const cp = (mins: number, extra: Record<string, unknown> = {}) => ({ action: PULL_CHECKPOINT, createdAt: new Date(now.getTime() - mins * 60_000), metadata: { days: 0, since: null, startedAt: 'x', at: { p1: 'CUR' }, done: [], scanned: 200, imported: 50, updated: 10, ...extra } });

  it('the newest checkpoint is where it carries on', () => {
    const r = resumable([cp(5), cp(30, { scanned: 100 })], now);
    expect(r).toMatchObject({ days: 0, at: { p1: 'CUR' }, scanned: 200, imported: 50 });
  });

  it('finished, restarted, or too old: nothing to carry on', () => {
    expect(resumable([{ action: PULL_DONE, createdAt: now, metadata: {} }, cp(10)], now)).toBeNull();
    expect(resumable([{ action: PULL_STARTED, createdAt: now, metadata: { days: 30 } }, cp(10)], now)).toBeNull();
    expect(resumable([cp(13 * 60)], now)).toBeNull();
    expect(resumable([], now)).toBeNull();
  });
});

/** Runs the pull on a fake service: one salon's pages, Meta answered by a script. */
function fakePull(answers: unknown[]) {
  const audits: { tenantId: string; action: string; metadata?: Record<string, unknown> }[] = [];
  const urls: string[] = [];
  const pageQueries: unknown[] = [];
  const mirrored: { tenantId: string; n: number }[] = [];
  const self = {
    historyJobs: new Map(),
    logger: { log: jest.fn(), warn: jest.fn() },
    events: { publish: jest.fn() },
    prisma: {
      messengerPage: { findMany: jest.fn(async (a: unknown) => { pageQueries.push(a); return [{ pageId: 'P-A', pageToken: 'tok', pageName: 'Salon A', igId: null }]; }) },
      messengerConnection: { findUnique: jest.fn(async () => null) },
    },
    audit: jest.fn(async (tenantId: string, action: string, who?: { metadata?: Record<string, unknown> }) => { audits.push({ tenantId, action, metadata: who?.metadata }); }),
    mirrorConversations: jest.fn(async (tenantId: string, _pg: unknown, _src: unknown, convs: unknown[]) => { mirrored.push({ tenantId, n: convs.length }); return { imported: convs.length, updated: 0, skipped: 0, answered: 0, newest: '' }; }),
  };
  let i = 0;
  const realFetch = global.fetch;
  global.fetch = jest.fn(async (u: string) => { urls.push(String(u)); const a = answers[Math.min(i++, answers.length - 1)]; return { json: async () => a } as Response; }) as never;
  const proto = MessengerService.prototype as unknown as { runHistoryPull: (...a: unknown[]) => { running: boolean } };
  const job = proto.runHistoryPull.call(self, 'A', { days: 0, since: null, startedAt: 'now', at: {}, done: [], scanned: 0, imported: 0, updated: 0, userId: 'owner' }) as { running: boolean; imported: number; scanned: number; error: string | null };
  const done = async () => { for (let k = 0; k < 400 && job.running; k++) await new Promise((r) => setTimeout(r, 15)); global.fetch = realFetch; };
  return { job, done, audits, urls, pageQueries, mirrored };
}

const conv = (id: string) => ({ id, updated_time: '2026-11-01T00:00:00+0000', participants: { data: [{ id: 'P-A' }, { id: `u-${id}` }] }, messages: { data: [{ message: 'hi', created_time: '2026-11-01T00:00:00+0000', from: { id: `u-${id}` } }] } });

describe('rt229 — the pull walks one salon’s pages, page by page', () => {
  it('reads only this salon’s Pages, saves each page as it comes, and finishes', async () => {
    const f = fakePull([
      { data: [conv('1'), conv('2')], paging: { next: 'n', cursors: { after: 'C1' } } },
      { data: [conv('3')], paging: {} },
    ]);
    await f.done();
    expect(f.pageQueries[0]).toMatchObject({ where: { tenantId: 'A', enabled: true } });
    expect(f.mirrored).toEqual([{ tenantId: 'A', n: 2 }, { tenantId: 'A', n: 1 }]);
    expect(f.urls[1]).toContain('after=C1');
    expect(f.urls[0]).toContain('attachments');
    expect(f.job).toMatchObject({ running: false, imported: 3, scanned: 3, error: null });
    expect(f.audits.every((a) => a.tenantId === 'A')).toBe(true);
    expect(f.audits.map((a) => a.action)).toContain(PULL_DONE);
  });

  it('a page Meta finds too big is asked again smaller — nothing is skipped', async () => {
    const f = fakePull([
      { error: { code: 1, message: 'Please reduce the amount of data you\'re asking for' } },
      { data: [conv('1')], paging: {} },
    ]);
    await f.done();
    expect(f.urls[0]).toContain('limit=25');
    expect(f.urls[1]).toContain('limit=12');
    expect(f.job).toMatchObject({ imported: 1, error: null });
  }, 10_000);

  it('a hard refusal stops with the reason and keeps the place for next time (no "Xong")', async () => {
    const f = fakePull([
      { data: [conv('1')], paging: { next: 'n', cursors: { after: 'C1' } } },
      { error: { code: 190, message: 'Error validating access token' } },
    ]);
    await f.done();
    expect(f.job.error).toContain('Error validating access token');
    expect(f.audits.map((a) => a.action)).not.toContain(PULL_DONE);
    const last = f.audits.filter((a) => a.action === PULL_CHECKPOINT).pop();
    expect(last?.metadata).toMatchObject({ at: { 'P-A': 'C1' }, done: [] });
    // The page token never lands in the audit log.
    expect(JSON.stringify(f.audits)).not.toContain('tok');
  });
});
