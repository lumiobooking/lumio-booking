import { cardTier, fmtPhone, serviceColor, SERVICE_PALETTE, timeRange, TIER_MIN } from './cal-card';
import { contrast } from './theme';

describe('the phone on a card', () => {
  it('reads like a phone number', () => {
    expect(fmtPhone('+17145550142')).toBe('(714) 555-0142');
    expect(fmtPhone('714-555-0142')).toBe('(714) 555-0142');
    expect(fmtPhone('+84901234567')).toBe('0901 234 567');
    expect(fmtPhone('0901234567')).toBe('0901 234 567');
  });
  it('never changes what it does not recognise, and keeps a masked number masked', () => {
    expect(fmtPhone('••• 0142')).toBe('••• 0142');
    expect(fmtPhone('+44 20 7946 0958')).toBe('+44 20 7946 0958');
    expect(fmtPhone(null)).toBe('');
  });
});

describe('from when to when', () => {
  it('one AM/PM when both ends share it, both when they do not, 24-hour in Vietnamese', () => {
    expect(timeRange(690, 750, false)).toBe('11:30 AM – 12:30 PM');
    expect(timeRange(780, 840, false)).toBe('1:00 – 2:00 PM');
    expect(timeRange(690, 750, true)).toBe('11:30 – 12:30');
  });
});

describe('how many lines fit', () => {
  it('a 60-minute card shows all four lines on the desk (96 px an hour)', () => {
    expect(cardTier(96 - 3)).toBe(4);
    expect(cardTier(72 - 3)).toBe(3); // 45 min
    expect(cardTier(48 - 3)).toBe(2); // 30 min
    expect(cardTier(24 - 3)).toBe(1); // 15 min
  });
  it('the large phone card needs more room per line', () => {
    expect(cardTier(TIER_MIN.lg[0], 'lg')).toBe(4);
    expect(cardTier(TIER_MIN.lg[0] - 1, 'lg')).toBe(3);
    expect(cardTier(57, 'lg')).toBe(2);
  });
});

describe('colour by service', () => {
  it('the same service is always the same colour', () => {
    expect(serviceColor('svc-1')).toBe(serviceColor('svc-1'));
    expect(SERVICE_PALETTE).toContain(serviceColor('Deep Tissue Massage'));
  });
  it('every colour carries white text', () => {
    for (const c of SERVICE_PALETTE) expect(contrast(c, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});
