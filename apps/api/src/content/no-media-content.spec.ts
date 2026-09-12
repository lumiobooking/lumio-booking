import { noMediaJobs, noMediaNote, MAX_NO_MEDIA } from './no-media-content';
import { buildWeekPlan } from './weekly-plan';
import { crewJobs, splitCrew } from './crew-board';
import { playbookFor } from './industry-playbook';
import { viOf, enOf } from './i18n';

const full = {
  bankItems: 40,
  reviews: [{ stars: 5, text: 'Chị Vy làm bộ dip powder đẹp hơn hẳn tiệm cũ tôi hay đi, giữ được gần một tháng chưa bong.', author: 'Linda T.' }],
  menu: [{ name: 'Dip Powder', priceCents: 5000 }, { name: 'Gel Manicure', priceCents: 5500 }, { name: 'Pedicure', priceCents: 4500 }],
  city: 'Kerrville',
  week: 0,
};

describe('a week the shop sends nothing still produces work', () => {
  it('every job it makes needs nothing new from the salon', () => {
    const jobs = noMediaJobs(full);
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((j) => j.fromBank === true)).toBe(true);
  });

  it('leads with the customer\'s own words, which outperform anything we write', () => {
    expect(viOf(noMediaJobs(full)[0].text)).toMatch(/Đăng lại đánh giá 5 sao/);
  });

  it('quotes the review rather than paraphrasing it', () => {
    const j = noMediaJobs(full)[0];
    expect(viOf(j.text)).toMatch(/Chị Vy làm bộ dip powder/);
    expect(viOf(j.brief!.steps[0])).toMatch(/không sửa chính tả của khách/);
  });

  it('NEVER asks to post a customer\'s face on a review card', () => {
    // Permission for a face is a conversation at the counter — the one thing
    // this whole lane exists to avoid needing.
    expect(viOf(noMediaJobs(full)[0].brief!.steps[2])).toMatch(/Không đăng ảnh mặt khách/);
  });

  it('caps the week rather than filling it out of the archive', () => {
    // A week built entirely from the bank gets thinner every month. This is a
    // floor, not a ceiling.
    expect(noMediaJobs(full).length).toBeLessThanOrEqual(MAX_NO_MEDIA);
    expect(MAX_NO_MEDIA).toBe(2);
  });

  it('rotates, so a salon does not open the same job every Monday', () => {
    const a = noMediaJobs({ ...full, week: 0 }).map((j) => viOf(j.text));
    const b = noMediaJobs({ ...full, week: 2 }).map((j) => viOf(j.text));
    expect(a).not.toEqual(b);
  });

  it('uses the shop\'s real prices on the price card, never a placeholder', () => {
    const card = noMediaJobs({ ...full, week: 2, reviews: [], bankItems: 0 })
      .find((j) => /Card bảng giá/.test(viOf(j.text)))!;
    expect(viOf(card.text)).toMatch(/Dip Powder \$50/);
    expect(viOf(card.text)).toMatch(/Gel Manicure \$55/);
  });

  it('names the actual town in the local post', () => {
    const local = noMediaJobs({ ...full, week: 3, reviews: [], menu: [] })
      .find((j) => /Bài địa phương/.test(viOf(j.text)))!;
    expect(viOf(local.text)).toMatch(/Làm nail ở Kerrville/);
    expect(viOf(local.why)).toMatch(/Kerrville/);
  });
});

describe('it refuses to invent a job out of nothing', () => {
  it('produces nothing at all for a salon we hold no material for', () => {
    expect(noMediaJobs({ bankItems: 0, reviews: [], menu: [], city: null, week: 0 })).toEqual([]);
    expect(noMediaNote([])).toBeNull();
  });

  it('skips the review card when the review is too short to carry a post', () => {
    const jobs = noMediaJobs({ ...full, reviews: [{ stars: 5, text: 'Tốt', author: 'A' }] });
    expect(jobs.every((j) => !/đánh giá 5 sao/.test(viOf(j.text)))).toBe(true);
  });

  it('skips the review card on anything under five stars', () => {
    const jobs = noMediaJobs({ ...full, reviews: [{ ...full.reviews[0], stars: 4 }] });
    expect(jobs.every((j) => !/đánh giá 5 sao/.test(viOf(j.text)))).toBe(true);
  });

  it('skips the price card on a one-line menu, which is not a card', () => {
    const jobs = noMediaJobs({ ...full, reviews: [], bankItems: 0, menu: [{ name: 'Gel', priceCents: 5000 }] });
    expect(jobs.every((j) => !/Card bảng giá/.test(viOf(j.text)))).toBe(true);
  });

  it('skips the local post when there is no photo to put under it', () => {
    const jobs = noMediaJobs({ ...full, bankItems: 0, reviews: [], menu: [] });
    expect(jobs).toEqual([]);
  });

  it('skips the bank repost for a salon that has never sent anything', () => {
    const jobs = noMediaJobs({ ...full, bankItems: 0 });
    expect(jobs.every((j) => !/kho ảnh cũ/.test(viOf(j.text)))).toBe(true);
  });

  it('says all of it in English too', () => {
    for (const j of noMediaJobs(full)) {
      expect(enOf(j.text)).not.toBe(viOf(j.text));
      expect(enOf(j.why)).not.toBe(viOf(j.why));
    }
  });
});

/**
 * THE WHOLE POINT, END TO END.
 *
 * A remote agency cannot make footage appear. Before this, a week where the
 * shop sent nothing produced nothing at all — every publishing job began with
 * "pick the clip" — and the client paid for that week too.
 */
describe('a silent week still ships', () => {
  const bank = {
    bankItems: 40,
    reviews: [{ stars: 5, text: 'Chị Vy làm bộ dip powder đẹp hơn hẳn tiệm cũ tôi hay đi, giữ gần một tháng chưa bong.', author: 'Linda T.' }],
    menu: [{ name: 'Dip Powder', priceCents: 5000 }, { name: 'Gel Manicure', priceCents: 5500 }],
    city: 'Kerrville',
    week: 0,
  };
  const planWith = (b: typeof bank | null) => buildWeekPlan({
    today: new Date('2026-09-14T00:00:00Z'), todayWeekday: 1,
    playbook: playbookFor('SALON'), week: 0, bank: b, city: 'Kerrville',
  } as never);
  const boardFor = (b: typeof bank | null) => splitCrew(crewJobs(
    [{ tenantId: 't1', salon: 'Lux', slug: 'lux', weekKey: 'w', startDate: '2026-09-14', days: planWith(b).days, crew: {} }] as never,
    // the worst case: nothing has arrived from this shop at all
    { today: '2026-09-16', horizonDays: 9, lastMediaByTenant: { t1: null } },
  ));

  it('leaves the team real work on a Monday when nothing has arrived', () => {
    const s = boardFor(bank);
    expect(s.ready.length).toBeGreaterThan(0);
    expect(s.ready.some((j) => /đánh giá 5 sao/.test(j.text))).toBe(true);
    expect(s.ready.some((j) => /kho ảnh cũ/.test(j.text))).toBe(true);
  });

  it('and the footage jobs are still honestly marked as blocked', () => {
    const s = boardFor(bank);
    expect(s.blocked.length).toBeGreaterThan(0);
    expect(s.blocked.every((j) => /Đăng clip|Đăng bộ ảnh/.test(j.text))).toBe(true);
    // one salon, one phone call, however many jobs are stuck behind it
    expect(s.chase).toHaveLength(1);
  });

  it('the floor survives the week budget — trimming it away is backwards', () => {
    // WEEK_BUDGET drops the lowest-priority jobs. The only work that can ship
    // must not be the first thing cut.
    const jobs = planWith(bank).days.flatMap((d) => d.jobs);
    expect(jobs.filter((j) => j.fromBank).length).toBe(MAX_NO_MEDIA);
  });

  it('without a bank, the week is exactly the week it always was', () => {
    const before = planWith(null).days.flatMap((d) => d.jobs);
    expect(before.some((j) => j.fromBank)).toBe(false);
    expect(boardFor(null).ready.every((j) => !/đánh giá 5 sao/.test(j.text))).toBe(true);
  });
});
