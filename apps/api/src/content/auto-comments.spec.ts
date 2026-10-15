import {
  cleanAutoComments, cleanPostComments, commentRetryable, commentSummary, defaultSettings, dueComments,
  explainCommentError, fillComment, planComments, promoLine,
} from './auto-comments';

const facts = { salon: 'Hayahay', bookingUrl: 'https://lumio.app/book/hayahay', phone: '368-889-9952', address: 'Unit 151, 2710 17 Ave SE', website: null, promo: null };
const posted = new Date('2026-10-15T15:00:00Z');

describe('first comments under a post', () => {
  it('fills a template, and refuses one whose placeholder has nothing to say', () => {
    expect(fillComment('Book: %booking_url%', facts)).toBe('Book: https://lumio.app/book/hayahay');
    expect(fillComment('🎁 %promo% — book %booking_url%', facts)).toBeNull(); // no promo today
    expect(fillComment('Hello %salon%', facts)).toBe('Hello Hayahay');
    expect(fillComment('   ', facts)).toBeNull();
  });

  it('plans per channel, in order, spaced out, capped, with the promo line skipped when nothing runs', () => {
    const settings = { ...defaultSettings(false), enabled: true };
    const jobs = planComments({ settings, override: null, facts, postedAt: posted, targets: [{ channel: 'facebook', id: '1_2' }, { channel: 'instagram', id: '99' }] });
    const fb = jobs.filter((j) => j.channel === 'facebook');
    const ig = jobs.filter((j) => j.channel === 'instagram');
    expect(fb.map((j) => j.text)).toEqual(['✨ Browse services and book online anytime: https://lumio.app/book/hayahay', 'Call or text 368-889-9952 and we\'ll save you a spot.'.replace(/^/, '📞 ')]);
    expect(fb.map((j) => j.dueAt)).toEqual(['2026-10-15T15:03:00.000Z', '2026-10-15T15:05:00.000Z']);
    expect(ig).toHaveLength(1); // the contact template is Facebook-only; promo has nothing
    expect(ig[0].targetId).toBe('99');
    expect(jobs.every((j) => j.status === 'pending')).toBe(true);
  });

  it('a running offer fills the promo template, and the cap holds', () => {
    const settings = { ...defaultSettings(true), enabled: true, max: 2 };
    const jobs = planComments({ settings, override: null, facts: { ...facts, promo: 'Giảm 20% · Grand Opening đến 31/10' }, postedAt: posted, targets: [{ channel: 'facebook', id: '1_2' }] });
    expect(jobs).toHaveLength(2);
    expect(jobs[1].text).toMatch(/Giảm 20% · Grand Opening/);
  });

  it('off = nothing; the post\'s own list beats the shop\'s templates; feature off = nothing', () => {
    const settings = { ...defaultSettings(false), enabled: true };
    expect(planComments({ settings, override: { off: true }, facts, postedAt: posted, targets: [{ channel: 'facebook', id: '1' }] })).toEqual([]);
    const own = planComments({ settings, override: { items: [{ text: 'Only this', channels: ['facebook', 'instagram'] }] }, facts, postedAt: posted, targets: [{ channel: 'facebook', id: '1' }] });
    expect(own.map((j) => j.text)).toEqual(['Only this']);
    expect(planComments({ settings: { ...settings, enabled: false }, override: null, facts, postedAt: posted, targets: [{ channel: 'facebook', id: '1' }] })).toEqual([]);
    // A post's own list still runs when the shop's switch is off: the writer asked for it on this post.
    expect(planComments({ settings: { ...settings, enabled: false }, override: { items: [{ text: 'Only this', channels: ['facebook'] }] }, facts, postedAt: posted, targets: [{ channel: 'facebook', id: '1' }] })).toHaveLength(1);
  });

  it('cleans settings and per-post overrides', () => {
    const s = cleanAutoComments({ enabled: true, delayMin: 999, gapMin: 0, max: 9, templates: [{ text: ' hi ', channels: ['tiktok'] }, { text: '' }, 7] }, true);
    expect(s).toMatchObject({ enabled: true, delayMin: 120, gapMin: 1, max: 5 });
    expect(s.templates).toEqual([{ id: 't1', text: 'hi', on: true, channels: ['facebook', 'instagram'] }]);
    expect(cleanAutoComments(null, true).templates.length).toBeGreaterThan(2);
    expect(cleanAutoComments(null, true).enabled).toBe(false);
    expect(cleanPostComments(undefined)).toBeNull();
    expect(cleanPostComments({ off: true })).toEqual({ off: true });
    expect(cleanPostComments({ items: [{ text: 'x', channels: ['instagram'] }, { text: '' }] })).toEqual({ items: [{ text: 'x', channels: ['instagram'] }] });
  });

  it('the promo line: named date promo > weekday > first visit > group; none when nothing runs', () => {
    const base = { today: '2026-10-15', weekday: 4 };
    expect(promoLine({ ...base, dates: { enabled: true, rules: [{ startDate: '2026-10-10', endDate: '2026-10-31', percent: 20, label: 'Grand Opening' }] } }, true)).toBe('Giảm 20% · Grand Opening đến 31/10');
    expect(promoLine({ ...base, dates: { enabled: true, rules: [{ startDate: '2026-11-01', endDate: null, percent: 20 }] }, weekdays: { enabled: true, rules: [{ weekday: 4, percent: 10 }] } }, false)).toBe('10% off today');
    expect(promoLine({ ...base, weekdays: { enabled: true, rules: [{ weekday: 4, percent: 10 }], endDate: '2026-10-01' }, firstVisit: { enabled: true, percent: 15 } }, true)).toBe('Khách mới giảm 15%');
    expect(promoLine({ ...base, group: { enabled: true, tiers: [{ minSize: 4, percent: 10 }, { minSize: 2, percent: 5 }] } }, false)).toBe('Groups of 2+ get 5% off');
    expect(promoLine(base, true)).toBeNull();
  });

  it('errors are explained and classified', () => {
    expect(explainCommentError('(#200) Requires pages_manage_engagement permission')).toMatch(/Testers/);
    expect(commentRetryable('(#200) Requires pages_manage_engagement permission')).toBe(false);
    expect(commentRetryable('(#4) Application request limit reached')).toBe(true);
    expect(explainCommentError('(#4) Application request limit reached', false)).toMatch(/rate-limiting/);
  });

  it('the sweep takes only pending, due, not-given-up jobs', () => {
    const jobs = [
      { channel: 'facebook' as const, targetId: '1', text: 'a', dueAt: '2026-10-15T15:03:00.000Z', status: 'pending' as const, attempts: 0 },
      { channel: 'facebook' as const, targetId: '1', text: 'b', dueAt: '2026-10-15T15:05:00.000Z', status: 'pending' as const, attempts: 0 },
      { channel: 'facebook' as const, targetId: '1', text: 'c', dueAt: '2026-10-15T15:00:00.000Z', status: 'pending' as const, attempts: 3 },
      { channel: 'facebook' as const, targetId: '1', text: 'd', dueAt: '2026-10-15T15:00:00.000Z', status: 'posted' as const, id: 'c1' },
    ];
    expect(dueComments(jobs, new Date('2026-10-15T15:04:00Z')).map((j) => j.text)).toEqual(['a']);
    expect(commentSummary(jobs)).toEqual({ posted: 1, failed: 0, pending: 3 });
  });
});
