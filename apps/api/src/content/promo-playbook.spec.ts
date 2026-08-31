import { breakEven, safeDiscount, marginBasis, promoAdvice, promoToPrompt, playsFor, capAdvice } from './promo-playbook';

describe('the break-even arithmetic is right', () => {
  it('matches the formula lift = d / (m - d)', () => {
    // 50% margin, 20% off → 20/(50-20) = 0.667 → +67%
    expect(breakEven(20, 50).liftNeededPct).toBe(67);
    // 50% margin, 30% off → 30/20 = 1.5 → +150%
    expect(breakEven(30, 50).liftNeededPct).toBe(150);
    // 40% margin, 10% off → 10/30 = 0.333 → +34% (rounded up)
    expect(breakEven(10, 40).liftNeededPct).toBe(34);
  });

  it('rounds the lift UP, never down', () => {
    // Rounding a break-even down flatters the promotion. This number exists to
    // be the unflattering one.
    const e = breakEven(10, 40);
    expect(e.liftNeededPct).toBeGreaterThanOrEqual((10 / 30) * 100);
  });

  it('refuses a discount at or above the margin instead of warning about it', () => {
    for (const d of [40, 45, 60]) {
      const e = breakEven(d, 40);
      expect(e.impossible).toBe(true);
      expect(e.verdict).toBe('impossible');
      expect(e.liftNeededPct).toBeNull();
      expect(e.plain).toMatch(/không có lượng khách nào cứu được/i);
    }
  });

  it('calls a steep-but-possible discount steep', () => {
    expect(breakEven(30, 50).verdict).toBe('steep');
    expect(breakEven(15, 50).verdict).toBe('safe');
  });

  it('says it does not know rather than assuming a margin', () => {
    const e = breakEven(20, null);
    expect(e.verdict).toBe('unknown');
    expect(e.liftNeededPct).toBeNull();
    expect(e.plain).toMatch(/Chưa biết biên lãi/);
  });
});

describe('the safe ceiling is derived, not picked', () => {
  it('solves d = m·L / (1 + L) at a plausible lift', () => {
    // 50% margin, +40% lift → 50·0.4/1.4 = 14.28 → 14
    expect(safeDiscount(50, 40)).toBe(14);
    // 40% margin → 40·0.4/1.4 = 11.4 → 11
    expect(safeDiscount(40, 40)).toBe(11);
  });

  it('is always survivable by its own break-even test', () => {
    for (const m of [30, 40, 50, 60, 70]) {
      const d = safeDiscount(m) as number;
      const e = breakEven(d, m);
      expect(e.impossible).toBe(false);
      expect(e.liftNeededPct).toBeLessThanOrEqual(45);
    }
  });

  it('returns nothing when the margin is unknown', () => {
    expect(safeDiscount(null)).toBeNull();
  });
});

describe('margin comes from a number someone entered', () => {
  it('reads gross margin as 100 minus the commission', () => {
    expect(marginBasis(60).grossMarginPct).toBe(40);
    expect(marginBasis(50).grossMarginPct).toBe(50);
    expect(marginBasis(60).source).toBe('entered');
  });

  it('refuses to default — a made-up margin makes a made-up break-even', () => {
    for (const bad of [null, undefined, 0, 100, -5, 120]) {
      const m = marginBasis(bad as number);
      expect(m.grossMarginPct).toBeNull();
      expect(m.source).toBe('unknown');
    }
  });
});

describe('the advice leads with the cheap plays, not the discount', () => {
  const salon = promoAdvice({ industry: 'SALON', commissionPct: 60, proposedDiscountPct: 20 });

  it('puts the blanket discount last, never first', () => {
    expect(salon.tryFirst).not.toContain('Giảm giá toàn menu (nên tránh)');
    expect(salon.tryFirst).toHaveLength(3);
  });

  it('flags a 20% cut as unaffordable at a 40% margin', () => {
    // 20/(40-20) = 1.0 → needs to double. Steep, and it should say so.
    expect(salon.proposed?.liftNeededPct).toBe(100);
    expect(salon.proposed?.verdict).toBe('steep');
  });

  it('names a ceiling the salon can actually defend', () => {
    expect(salon.ceiling).toBe(11);
  });

  it('explains itself when the commission is missing', () => {
    const blind = promoAdvice({ industry: 'SALON', commissionPct: null, proposedDiscountPct: 20 });
    expect(blind.ceiling).toBeNull();
    expect(blind.proposed?.verdict).toBe('unknown');
    expect(blind.note).toMatch(/bịa ra/);
  });

  it('gives each trade its own plays', () => {
    expect(playsFor('RESTAURANT').some((p) => /thực đơn|món/i.test(p.name + p.offer))).toBe(true);
    expect(playsFor('REAL_ESTATE').some((p) => /hoa hồng|định giá/i.test(p.name))).toBe(true);
    expect(playsFor('REAL_ESTATE').some((p) => /móng/i.test(p.name))).toBe(false);
  });

  it('every play says when NOT to use it', () => {
    for (const t of ['SALON', 'RESTAURANT', 'REAL_ESTATE']) {
      for (const p of playsFor(t)) {
        expect(p.avoidWhen.length).toBeGreaterThan(15);
        expect(p.why.length).toBeGreaterThan(25);
      }
    }
  });
});

describe('the model is fenced by the same arithmetic', () => {
  it('forbids proposing any discount when the margin is unknown', () => {
    const p = promoToPrompt(promoAdvice({ industry: 'SALON', commissionPct: null }));
    expect(p).toMatch(/TUYỆT ĐỐI không đề xuất mức giảm/);
    expect(p).not.toMatch(/Không bao giờ đề xuất giảm quá \d/);
  });

  it('names the ceiling and the impossible line when the margin is known', () => {
    const p = promoToPrompt(promoAdvice({ industry: 'SALON', commissionPct: 60 }));
    expect(p).toContain('không được đề xuất');
    expect(p).toMatch(/quá 11%/);
    expect(p).toMatch(/40%.*là lỗ dù bán bao nhiêu/);
  });

  it('tells the model the cheap plays come first', () => {
    expect(promoToPrompt(promoAdvice({ commissionPct: 50 }))).toMatch(/rẻ nhất trước/);
  });
});

describe('a proposed discount is cut down to what the margin survives', () => {
  const advice = (over: Partial<{ kind: string; discountPct: number; headline: string; detail: string }> = {}) => ({
    kind: 'fill-slot', discountPct: 20,
    headline: 'Ưu đãi giờ vàng: Thứ 7 buổi sáng, giảm 20%',
    detail: 'Thứ 7 buổi sáng chỉ chạy ở mức 15%.',
    ...over,
  });

  it('lowers the number and rewrites the headline to match', () => {
    const a = advice();
    const r = capAdvice(a, promoAdvice({ commissionPct: 60 }));
    expect(r.changed).toBe(true);
    expect(a.discountPct).toBe(11);
    // The headline is what a salon actually reads. Leaving "giảm 20%" in it
    // while the field says 11 would be worse than not capping at all.
    expect(a.headline).toContain('giảm 11%');
    expect(a.headline).not.toContain('20%');
  });

  it('explains the cut with the arithmetic behind it', () => {
    const a = advice();
    capAdvice(a, promoAdvice({ commissionPct: 60 }));
    expect(a.detail).toMatch(/hạ từ 20% xuống 11%/);
    expect(a.detail).toMatch(/100% lượt khách/); // 20/(40-20) = 100%
  });

  it('leaves a discount the margin can carry alone', () => {
    const a = advice({ discountPct: 8 });
    const r = capAdvice(a, promoAdvice({ commissionPct: 40 })); // 60% margin, ceiling 17
    expect(r.changed).toBe(false);
    expect(a.discountPct).toBe(8);
  });

  it('does not cap when the margin is unknown — it says it cannot check', () => {
    const a = advice();
    const r = capAdvice(a, promoAdvice({ commissionPct: null }));
    expect(r.changed).toBe(false);
    expect(a.discountPct).toBe(20);
    expect(a.detail).toMatch(/chưa kiểm được/);
  });

  it('ignores advice that is not a discount at all', () => {
    for (const kind of ['raise-price', 'win-back', 'hold']) {
      const a = advice({ kind, discountPct: 0 });
      expect(capAdvice(a, promoAdvice({ commissionPct: 60 })).changed).toBe(false);
      expect(a.detail).not.toMatch(/hạ từ/);
    }
  });

  it('mutates the one copy everyone reads, rather than returning a duplicate', () => {
    // Returning a corrected copy is how the uncorrected original survives to
    // be rendered somewhere else on the page.
    const a = advice();
    capAdvice(a, promoAdvice({ commissionPct: 70 }));
    expect(a.discountPct).toBeLessThan(20);
  });
});
