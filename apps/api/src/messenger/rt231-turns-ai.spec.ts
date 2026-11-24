import { answeredDoubleTap, personAnsweredSince } from './reply-guard';
import { skipSummary, tallySkips } from './turn-skips';
import { echoKind } from './automation-echo';

describe('rt231 — the AI does not answer on top of a person', () => {
  const t0 = Date.parse('2026-11-24T11:18:49Z');
  it('a person answering after the customer wrote stops the AI reply', () => {
    const hist = [
      { role: 'user', content: 'Chi phí AI Messenger cho tiệm là bao nhiêu?', at: new Date(t0).toISOString() },
      { role: 'assistant', content: 'Dạ tiệm ở khu vực nào ạ', manual: true, at: new Date(t0 + 4000).toISOString() },
    ];
    expect(personAnsweredSince(hist, t0)).toBe(true);
  });
  it('the Page’s automation, Meta’s lines, a failed send or an older reply do not', () => {
    const at = new Date(t0 + 2000).toISOString();
    expect(personAnsweredSince([{ role: 'assistant', content: 'FAQ', manual: true, source: 'automation', at }], t0)).toBe(false);
    expect(personAnsweredSince([{ role: 'assistant', content: 'x', manual: true, failed: true, at }], t0)).toBe(false);
    expect(personAnsweredSince([{ role: 'assistant', content: 'notice', manual: true, at }], t0, (s) => s === 'notice')).toBe(false);
    expect(personAnsweredSince([{ role: 'assistant', content: 'old', manual: true, at: new Date(t0 - 60_000).toISOString() }], t0)).toBe(false);
    expect(personAnsweredSince([{ role: 'assistant', content: 'ai', at }], t0)).toBe(false);
  });
});

describe('rt231 — a double tap gets one answer', () => {
  const q = 'Audit miễn phí gồm những gì?';
  const t0 = Date.parse('2026-11-24T11:28:33Z');
  it('the same question again within seconds is left to the first answer', () => {
    expect(answeredDoubleTap([{ role: 'user', content: q, at: new Date(t0).toISOString() }], q, t0 + 6000)).toBe(true);
  });
  it('after 30 s it needs the AI to have answered it already', () => {
    const prior = [{ role: 'user', content: q, at: new Date(t0).toISOString() }];
    expect(answeredDoubleTap(prior, q, t0 + 60_000)).toBe(false);
    expect(answeredDoubleTap([...prior, { role: 'assistant', content: 'Dạ…', at: new Date(t0 + 5000).toISOString() }], q, t0 + 60_000)).toBe(true);
    expect(answeredDoubleTap([...prior, { role: 'assistant', content: 'Dạ…' }], q, t0 + 5 * 60_000)).toBe(false);
  });
  it('short answers ("yes", "ok") and different words are always answered', () => {
    expect(answeredDoubleTap([{ role: 'user', content: 'yes', at: new Date(t0).toISOString() }], 'yes', t0 + 5000)).toBe(false);
    expect(answeredDoubleTap([{ role: 'user', content: q, at: new Date(t0).toISOString() }], 'Giá bao nhiêu vậy em ơi?', t0 + 5000)).toBe(false);
  });
});

describe('rt231 — the Page’s instant FAQ answer is automation, not staff taking over', () => {
  it('an echo 2 s after the customer (arrival noted on the webhook) is automation', () => {
    expect(echoKind({ notice: false, metaAi: false, nowMs: 10_000, lastCustomerMs: 8_000 })).toBe('automation');
    expect(echoKind({ notice: false, metaAi: false, nowMs: 10_000, lastCustomerMs: null })).toBe('person');
  });
});

describe('rt231 — why someone gets fewer customers, counted per salon', () => {
  const now = new Date('2026-11-24T12:00:00Z');
  const pool = [
    { userId: 'nhi', name: 'Nhi Yen', blockers: [] as string[], inRotation: true },
    { userId: 'nhan', name: 'Nhan Thanh', blockers: ['not-present'], inRotation: true },
    { userId: 'trang', name: 'Trang Thien', blockers: ['full', 'not-present'], inRotation: true },
    { userId: 'out', name: 'Out', blockers: ['not-in-list'], inRotation: false },
  ];
  it('counts the people passed over with their reasons; the one picked and people not in the list are not counted', () => {
    let b = tallySkips(null, pool, 'nhi', now);
    b = tallySkips(b, pool, 'nhi', now);
    const s = skipSummary(b, now);
    expect(s.map((x) => x.userId)).toEqual(['nhan', 'trang']);
    expect(s[0]).toMatchObject({ name: 'Nhan Thanh', total: 2, why: { 'not-present': 2 } });
    expect(s[1].why).toEqual({ full: 2, 'not-present': 2 });
  });
  it('keeps 7 days only', () => {
    const old = tallySkips(null, pool, 'nhi', new Date('2026-11-10T12:00:00Z'));
    const b = tallySkips(old, pool, 'nhi', now);
    expect(Object.keys(b.days)).toEqual(['2026-11-24']);
  });
});

describe('rt231 — the skip count stays inside one salon', () => {
  it('reads and writes only the calling salon’s own row', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ChatTurnsService } = require('./chat-turns.service');
    const calls: unknown[] = [];
    const self = { prisma: { setting: {
      findUnique: jest.fn(async (a: unknown) => { calls.push(a); return null; }),
      upsert: jest.fn(async (a: unknown) => { calls.push(a); return null; }),
    } } };
    await ChatTurnsService.prototype.noteSkips.call(self, 'A', [
      { userId: 'u1', name: 'Nhi', blockers: [], inRotation: true },
      { userId: 'u2', name: 'Nhan', blockers: ['not-present'], inRotation: true },
    ], 'u1');
    expect(JSON.stringify(calls)).toContain('"tenantId":"A"');
    expect(JSON.stringify(calls)).not.toContain('"tenantId":"B"');
    expect(calls).toHaveLength(2);
  });
});
