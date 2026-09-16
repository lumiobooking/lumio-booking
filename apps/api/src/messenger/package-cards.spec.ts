import {
  BUTTON_TITLE_MAX, buttonTitleFor, carouselTitles, packageFromPayload, packagePayload,
  packageShortName, tapAsCustomerLine,
} from './package-cards';

/** The three cards the sales carousel actually sends. */
const REAL = ['Gói Starter $99/th', 'Gói Boost $179/th', 'Gói Growth Map $279/th'];

describe('the bug: three buttons that all read the same', () => {
  it('gives every card a DIFFERENT title — the whole point', () => {
    const titles = carouselTitles(REAL);
    expect(new Set(titles).size).toBe(REAL.length);
    expect(titles).toEqual(['Starter $99', 'Boost $179', 'Growth Map $279']);
  });

  it('never exceeds what Messenger will show, so nothing arrives cut mid-word', () => {
    for (const t of carouselTitles([...REAL, 'Gói Tự động hoá toàn bộ tiệm cao cấp $999/tháng'])) {
      expect(t.length).toBeLessThanOrEqual(BUTTON_TITLE_MAX);
      expect(t).toBe(t.trim());
    }
  });

  it('keeps the name AND the price when the label is too long for both in full', () => {
    const t = buttonTitleFor('Gói Tự động hoá toàn bộ $999/tháng');
    expect(t.length).toBeLessThanOrEqual(BUTTON_TITLE_MAX);
    expect(t).toContain('$999');
    expect(t).toMatch(/^Tự động/);
  });

  it('pulls two packages apart when shortening would have collided', () => {
    const titles = carouselTitles(['Gói Boost 3 tháng $179', 'Gói Boost 6 tháng $329']);
    expect(titles[0]).not.toBe(titles[1]);
    expect(new Set(titles).size).toBe(2);
  });

  it('pulls them apart even when the labels differ only past the limit', () => {
    const titles = carouselTitles([
      'Gói chăm sóc toàn diện phiên bản A',
      'Gói chăm sóc toàn diện phiên bản B',
      'Gói chăm sóc toàn diện phiên bản C',
    ]);
    expect(new Set(titles).size).toBe(3);
    for (const t of titles) expect(t.length).toBeLessThanOrEqual(BUTTON_TITLE_MAX);
  });
});

describe('stripping the boilerplate every package shares', () => {
  it.each([
    ['Gói Starter $99/th', 'Starter $99'],
    ['gói Boost $179/tháng', 'Boost $179'],
    ['Growth Map $279/mo', 'Growth Map $279'],
    ['Gói Starter', 'Starter'],
  ])('%s -> %s', (label, want) => {
    expect(packageShortName(label)).toBe(want);
  });

  it('survives a label that is nothing but boilerplate', () => {
    expect(buttonTitleFor('Gói')).toBe('Xem gói này');
    expect(buttonTitleFor('')).toBe('Xem gói này');
    expect(buttonTitleFor(null as unknown as string)).toBe('Xem gói này');
  });
});

describe('the payload, which is what the bot actually reads', () => {
  it('carries the FULL label, not the shortened title', () => {
    const p = packagePayload('Gói Growth Map $279/th');
    expect(packageFromPayload(p)).toBe('Gói Growth Map $279/th');
  });

  it('is not confused by another kind of button', () => {
    expect(packageFromPayload('GET_STARTED')).toBeNull();
    expect(packageFromPayload('')).toBeNull();
    expect(packageFromPayload('ASK_PKG:')).toBeNull();
  });

  it('cannot be made enormous by a runaway label', () => {
    expect(packagePayload('x'.repeat(5000)).length).toBeLessThanOrEqual(908);
  });
});

describe('what the next person to open the thread reads', () => {
  it('names the package instead of saying "this one"', () => {
    expect(tapAsCustomerLine('Gói Growth Map $279/th')).toBe('Tôi muốn tư vấn gói Growth Map $279');
    expect(tapAsCustomerLine('Gói Boost $179/th')).toContain('Boost $179');
  });

  it('two different taps never produce the same line', () => {
    const lines = REAL.map(tapAsCustomerLine);
    expect(new Set(lines).size).toBe(REAL.length);
  });
});
