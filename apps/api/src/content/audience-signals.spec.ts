import { buildAudienceProfile, classify, audienceToPrompt, type VisitRow } from './audience-signals';
import { viOf, enOf } from './i18n';

const NOW = Date.UTC(2026, 7, 31);
const DAY = 86_400_000;
const ago = (d: number) => NOW - d * DAY;

let seq = 0;
const visit = (customerId: string, daysAgo: number, priceCents = 5000, weekday = 3, hour = 14, serviceName = 'Gel X'): VisitRow =>
  ({ customerId, at: ago(daysAgo), priceCents, weekday, hour, serviceName });

/** A book with enough people in it to be segmented at all. */
function book(): VisitRow[] {
  seq = 0;
  const rows: VisitRow[] = [];
  // 8 regulars: every ~28 days, last visit recent.
  for (let i = 0; i < 8; i += 1) {
    for (const d of [7, 35, 63, 91]) rows.push(visit(`reg-${i}`, d, 6000, 5, 15));
  }
  // 5 cooling: same 28-day rhythm, but away for 120 days.
  for (let i = 0; i < 5; i += 1) {
    for (const d of [120, 148, 176, 204]) rows.push(visit(`cool-${i}`, d, 6000, 2, 11));
  }
  // 12 one-offs: single visit, long ago.
  for (let i = 0; i < 12; i += 1) rows.push(visit(`once-${i}`, 150 + i, 4500, 6, 10));
  // 4 newcomers: single visit, recent.
  for (let i = 0; i < 4; i += 1) rows.push(visit(`new-${i}`, 10 + i, 4800, 1, 13));
  // 3 big spenders: many visits at a high ticket.
  for (let i = 0; i < 3; i += 1) {
    for (const d of [5, 30, 55, 80, 105]) rows.push(visit(`vip-${i}`, d, 22000, 4, 16, 'Full set + art'));
  }
  return rows;
}

describe('a book too small to read is admitted, not segmented', () => {
  it('refuses below the floor and says why', () => {
    const rows = Array.from({ length: 10 }, (_, i) => visit(`c-${i}`, 20));
    const p = buildAudienceProfile(rows, NOW);
    expect(p.thin).toBe(true);
    expect(p.segments).toEqual([]);
    expect(p.targets).toEqual([]);
    expect(viOf(p.basis)).toMatch(/suy đoán/);
  });

  it('tells the model to describe nobody', () => {
    const p = buildAudienceProfile([visit('a', 3)], NOW);
    expect(audienceToPrompt(p)).toMatch(/Không được mô tả tệp khách nào/);
  });

  it('hides any group smaller than three people', () => {
    const rows = book();
    // One person with a wildly different pattern must not become a "segment".
    rows.push(visit('unicorn', 400, 99999, 0, 9));
    const p = buildAudienceProfile(rows, NOW);
    for (const s of p.segments) expect(s.count).toBeGreaterThanOrEqual(3);
  });
});

describe('customers are sorted by what they actually did', () => {
  const p = buildAudienceProfile(book(), NOW);
  const seg = (k: string) => p.segments.find((s) => s.key === k);

  it('finds the one-and-never-again group, usually the biggest', () => {
    expect(seg('one-off')?.count).toBe(12);
    expect(seg('one-off')!.sharePct).toBeGreaterThan(30);
  });

  it('separates a recent first-timer from someone who never came back', () => {
    expect(seg('new')?.count).toBe(4);
    expect(seg('one-off')?.count).toBe(12);
  });

  it('spots regulars who are drifting, by their OWN rhythm', () => {
    expect(seg('cooling')?.count).toBe(5);
    expect(seg('regular')?.count).toBe(8);
  });

  it('does not call a twice-a-year customer cold after seven weeks', () => {
    // The failure a fixed 60-day rule would produce: shouting at someone who is
    // exactly on schedule.
    const slow = { id: 's', visits: 3, totalCents: 15000, firstAt: ago(400), lastAt: ago(50), gaps: [180, 175], weekdays: [3], hours: [14], services: [] };
    expect(classify(slow as never, NOW, Infinity)).not.toBe('cooling');
    const fast = { id: 'f', visits: 4, totalCents: 24000, firstAt: ago(200), lastAt: ago(90), gaps: [21, 22, 20], weekdays: [3], hours: [14], services: [] };
    expect(classify(fast as never, NOW, Infinity)).toBe('cooling');
  });

  it('defines high value relative to this salon, not in absolute dollars', () => {
    // A cheap shop and an expensive one both have a top decile.
    expect(seg('high-value')?.count).toBe(3);
    const cheap = book().map((r) => ({ ...r, priceCents: Math.round(r.priceCents / 10) }));
    expect(buildAudienceProfile(cheap, NOW).segments.find((s) => s.key === 'high-value')?.count).toBe(3);
  });

  it('reports a favourite time only when enough people share it', () => {
    for (const s of p.segments) {
      if (s.favouriteTime) expect(s.count).toBeGreaterThanOrEqual(5);
    }
  });

  it('shares add up to roughly the whole book', () => {
    const sum = p.segments.reduce((a, s) => a + s.count, 0);
    expect(sum).toBeLessThanOrEqual(p.totalCustomers);
    expect(sum).toBeGreaterThan(p.totalCustomers * 0.9);
  });
});

describe('the targets are moves, not adjectives', () => {
  const p = buildAudienceProfile(book(), NOW);

  it('puts the quietly-leaving regulars first', () => {
    expect(p.targets[0].segment).toBe('cooling');
    expect(viOf(p.targets[0].action)).toMatch(/không giảm giá/i);
  });

  it('never suggests discounting the top spenders', () => {
    const high = p.targets.find((t) => t.segment === 'high-value')!;
    expect(viOf(high.action)).toMatch(/TUYỆT ĐỐI không gửi mã giảm giá/);
  });

  it('gives every target a specific action and a stated assumption', () => {
    for (const t of p.targets) {
      expect(viOf(t.action).length).toBeGreaterThan(25);
      expect(viOf(t.why).length).toBeGreaterThan(25);
      expect(viOf(t.prize).length).toBeGreaterThan(15);
    }
  });

  it('states the assumption behind every money figure', () => {
    const oneOff = p.targets.find((t) => t.segment === 'one-off')!;
    expect(viOf(oneOff.prize)).toMatch(/1 trong 10/);
    const cooling = p.targets.find((t) => t.segment === 'cooling')!;
    expect(viOf(cooling.prize)).toMatch(/nửa nhóm|nhịp cũ/);
  });
});

describe('an owner reading in English gets English', () => {
  const p = buildAudienceProfile(book(), NOW);

  it('gives every segment label and every target an English side that is not the Vietnamese one', () => {
    for (const s of p.segments) {
      expect(enOf(s.label)).not.toBe(viOf(s.label));
    }
    for (const t of p.targets) {
      expect(enOf(t.action)).not.toBe(viOf(t.action));
      expect(enOf(t.why)).not.toBe(viOf(t.why));
      expect(enOf(t.prize)).not.toBe(viOf(t.prize));
    }
    const oneOff = p.segments.find((s) => s.key === 'one-off')!;
    expect(enOf(oneOff.label)).toMatch(/came once/i);
    const high = p.targets.find((t) => t.segment === 'high-value')!;
    expect(enOf(high.action)).toMatch(/NEVER send this group a discount code/);
  });

  it('writes the time of day the way an American owner says it', () => {
    const withTime = p.segments.filter((s) => s.favouriteTime);
    expect(withTime.length).toBeGreaterThan(0);
    for (const s of withTime) {
      expect(enOf(s.favouriteTime)).toMatch(/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday) (mornings|afternoons|evenings)$/);
    }
  });

  it('says the too-small-a-book message in English too, with the same numbers', () => {
    const thin = buildAudienceProfile(Array.from({ length: 10 }, (_, i) => visit(`c-${i}`, 20)), NOW);
    expect(enOf(thin.basis)).toMatch(/10 customers in the book/);
    expect(enOf(thin.basis)).toMatch(/guesswork/);
    expect(enOf(thin.basis)).not.toBe(viOf(thin.basis));
  });
});

describe('the prompt carries the numbers and the floor', () => {
  it('lists the real segments with real counts', () => {
    const text = audienceToPrompt(buildAudienceProfile(book(), NOW));
    expect(text).toMatch(/Đến một lần rồi thôi: 12 người/);
    expect(text).toMatch(/NÊN NHẮM VÀO/);
  });

  it('stays Vietnamese and never leaks a [object Object] from a bilingual field', () => {
    const text = audienceToPrompt(buildAudienceProfile(book(), NOW));
    expect(text).not.toContain('[object Object]');
    expect(text).toMatch(/hay đi Thứ [2-7]|hay đi Chủ nhật/);
    expect(text).not.toMatch(/Came once|Big spenders|mornings/);
  });

  it('never invents a demographic', () => {
    const text = audienceToPrompt(buildAudienceProfile(book(), NOW));
    for (const invented of ['tuổi', 'thu nhập', 'phụ nữ', 'nhân viên văn phòng']) {
      expect(text).not.toContain(invented);
    }
  });
});
