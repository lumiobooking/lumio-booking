import {
  blockOf, buildRevenueProfile, lapsedSignal, offerAdvice,
  revenueToPrompt, serviceYields, slotLoads,
} from './revenue-signals';

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

// A salon that is packed on Saturday and dead on Tuesday afternoon —
// the shape almost every nail salon actually has.
const bookings = [
  ...Array.from({ length: 20 }, () => ({ weekday: 6, hour: 13, minutes: 60, revenueCents: 5500 })),
  ...Array.from({ length: 12 }, () => ({ weekday: 5, hour: 15, minutes: 60, revenueCents: 5000 })),
  ...Array.from({ length: 8 }, () => ({ weekday: 1, hour: 10, minutes: 60, revenueCents: 4500 })),
  ...Array.from({ length: 3 }, () => ({ weekday: 2, hour: 14, minutes: 60, revenueCents: 4000 })),
];

describe('reading the booking book', () => {
  it('sorts blocks from emptiest to fullest, indexed to the salon’s own peak', () => {
    const loads = slotLoads(bookings);
    expect(loads[0].label).toBe('Thứ 3 buổi chiều');
    expect(loads[0].fillIndex).toBe(15);
    expect(loads[loads.length - 1].label).toBe('Thứ 7 buổi chiều');
    expect(loads[loads.length - 1].fillIndex).toBe(100);
  });

  it('buckets hours into morning, afternoon and evening', () => {
    expect(blockOf(9)).toBe('morning');
    expect(blockOf(14)).toBe('afternoon');
    expect(blockOf(19)).toBe('evening');
  });

  it('an empty book produces nothing rather than a fake zero', () => {
    expect(slotLoads([])).toEqual([]);
    expect(slotLoads(null)).toEqual([]);
  });
});

describe('the discount decision — margin comes first', () => {
  it('targets the emptiest block and NAMES the blocks that must not be discounted', () => {
    const a = offerAdvice({ loads: slotLoads(bookings) });
    expect(a.kind).toBe('fill-slot');
    expect(a.headline).toContain('Thứ 3 buổi chiều');
    expect(a.protect).toContain('Thứ 7 buổi chiều');
    expect(a.detail).toMatch(/không giảm/i);
  });

  it('caps the discount at 20% — deeper cuts just train people to wait', () => {
    const a = offerAdvice({ loads: slotLoads(bookings) });
    expect(a.discountPct).toBeLessThanOrEqual(20);
    expect(a.discountPct).toBeGreaterThan(0);
  });

  it('a salon that is full everywhere is told to RAISE prices, not discount', () => {
    const full = [
      { weekday: 1, hour: 10, minutes: 100, revenueCents: 9000 },
      { weekday: 2, hour: 14, minutes: 95, revenueCents: 9000 },
      { weekday: 5, hour: 15, minutes: 90, revenueCents: 9000 },
      { weekday: 6, hour: 13, minutes: 100, revenueCents: 9000 },
    ];
    const a = offerAdvice({ loads: slotLoads(full) });
    expect(a.kind).toBe('raise-price');
    expect(a.discountPct).toBe(0);
    expect(a.detail).toMatch(/tăng giá|bớt lãi/);
  });

  it('when the calendar is fine but customers vanished, it says win-back not sale', () => {
    const nearlyFull = [
      { weekday: 1, hour: 10, minutes: 90, revenueCents: 9000 },
      { weekday: 2, hour: 14, minutes: 20, revenueCents: 2000 },
      { weekday: 5, hour: 15, minutes: 88, revenueCents: 9000 },
      { weekday: 6, hour: 13, minutes: 100, revenueCents: 9000 },
    ];
    const a = offerAdvice({ loads: slotLoads(nearlyFull), lapsedCount: 34 });
    expect(a.kind).toBe('win-back');
    expect(a.headline).toContain('34');
  });

  it('too little history means say so, not guess', () => {
    const a = offerAdvice({ loads: slotLoads([{ weekday: 1, hour: 10, minutes: 60, revenueCents: 100 }]) });
    expect(a.kind).toBe('hold');
    expect(a.discountPct).toBe(0);
    expect(a.headline).toMatch(/chưa đủ dữ liệu/i);
  });
});

describe('customers who stopped coming', () => {
  const rows = [
    { daysSinceLastVisit: 90, avgTicketCents: 5000 },
    { daysSinceLastVisit: 60, avgTicketCents: 6000 },
    { daysSinceLastVisit: 50, avgTicketCents: 4000 },
    { daysSinceLastVisit: 20, avgTicketCents: 5000 },
  ];

  it('counts only those past the refill cycle', () => {
    const s = lapsedSignal(rows);
    expect(s.count).toBe(3);
    expect(s.medianDaysAway).toBe(60);
  });

  it('values the list pessimistically — 10% response, never a rosy promise', () => {
    const s = lapsedSignal(rows);
    expect(s.winBackValueCents).toBe(1500); // 3 × 0.1 × $50 avg
  });

  it('nobody lapsed is a clean zero', () => {
    expect(lapsedSignal([{ daysSinceLastVisit: 10, avgTicketCents: 5000 }]).count).toBe(0);
    expect(lapsedSignal(null).medianDaysAway).toBeNull();
  });
});

describe('which service actually earns the chair', () => {
  it('ranks by revenue per hour, not by sticker price', () => {
    const y = serviceYields([
      { name: 'Full set dài 90 phút', priceCents: 6000, durationMinutes: 90 },
      { name: 'Gel fill 40 phút', priceCents: 4500, durationMinutes: 40 },
    ]);
    // $45/40min = $67.50/hr beats $60/90min = $40/hr — the cheaper service wins.
    expect(y[0].name).toContain('Gel fill');
    expect(y[0].perHourCents).toBe(6750);
  });

  it('ignores free or zero-length services instead of dividing by zero', () => {
    expect(serviceYields([{ name: 'Tư vấn', priceCents: 0, durationMinutes: 30 }])).toEqual([]);
    expect(serviceYields([{ name: 'Lỗi', priceCents: 5000, durationMinutes: 0 }])).toEqual([]);
  });
});

describe('the revenue half of the playbook, as the AI receives it', () => {
  const p = buildRevenueProfile({
    bookings,
    customers: [{ daysSinceLastVisit: 70, avgTicketCents: 5000 }, { daysSinceLastVisit: 80, avgTicketCents: 5000 }],
    services: [{ name: 'Gel fill', priceCents: 4500, durationMinutes: 40 }],
  });

  it('hands over the quiet block, the protected blocks and the exact discount', () => {
    const text = revenueToPrompt(p, money);
    expect(text).toContain('Thứ 3 buổi chiều');
    expect(text).toContain('Thứ 7 buổi chiều');
    expect(text).toMatch(/KHÔNG được đề xuất giảm giá cho/);
    expect(text).toMatch(/BÁM THEO/); // the model may not invent its own discount
  });

  it('states the win-back list and its cautious value', () => {
    expect(revenueToPrompt(p, money)).toContain('2 người');
  });

  it('shows revenue per chair-hour so the AI pushes the right service', () => {
    expect(revenueToPrompt(p, money)).toContain('/giờ');
  });

  it('a salon with no data at all still produces safe prompt text', () => {
    const empty = buildRevenueProfile({});
    expect(() => revenueToPrompt(empty, money)).not.toThrow();
    expect(empty.advice.kind).toBe('hold');
  });
});
