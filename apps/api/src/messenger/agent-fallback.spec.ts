import { escalationPush, fallbackText, isTransientStatus, looksVietnamese } from './agent-fallback';

describe('which language the apology speaks', () => {
  it('diacritics decide instantly — the exact message that got the English shrug', () => {
    expect(looksVietnamese('Giá của Lumio AI Messenger là bao nhiêu?')).toBe(true);
  });

  it('unaccented Vietnamese (phone typing) is still Vietnamese', () => {
    expect(looksVietnamese('gia bao nhieu vay')).toBe(true);
    expect(looksVietnamese('dat lich duoc khong')).toBe(true);
  });

  it('clearly English conversations get English', () => {
    expect(looksVietnamese('What is the price for gel nails?')).toBe(false);
    expect(looksVietnamese('Hello, can you help me please')).toBe(false);
  });

  it('ambiguous defaults to Vietnamese — the market this product serves', () => {
    expect(looksVietnamese('8573188901')).toBe(true);
    expect(looksVietnamese('')).toBe(true);
  });

  it('judges the whole conversation, so one English word cannot flip it', () => {
    expect(looksVietnamese('Chị muốn hỏi giá ạ ok thanks')).toBe(true);
  });
});

describe('what the apology says', () => {
  it('Vietnamese: apologises, promises a person, never says "Thanks!"', () => {
    const s = fallbackText('Giá của Lumio AI Messenger là bao nhiêu?');
    expect(s).toContain('xin lỗi');
    expect(s).toContain('nhân viên');
    expect(s).not.toMatch(/thanks/i);
  });

  it('English: same honesty, no gratitude-for-nothing', () => {
    const s = fallbackText('What is the price?');
    expect(s).toMatch(/sorry/i);
    expect(s).toMatch(/teammate|team/i);
    expect(s).not.toMatch(/^thanks/i);
  });
});

describe('which API failures earn a quiet retry', () => {
  it('overloaded and server-side hiccups do', () => {
    for (const st of [408, 429, 500, 502, 503, 529]) expect(isTransientStatus(st)).toBe(true);
  });
  it('our own bad request does not — retrying it would fail identically', () => {
    for (const st of [400, 401, 403, 404]) expect(isTransientStatus(st)).toBe(false);
  });
});

describe('the staff alarm that makes the promise true', () => {
  it('names the waiting customer and where to go', () => {
    const p = escalationPush('Tuệ Đan Hiền', true);
    expect(p.title).toContain('Tuệ Đan Hiền');
    expect(p.title).toContain('⚠');
    expect(p.url).toBe('/staff/inbox');
  });
  it('its tag is NOT the routine inbox tag — a new-message push must not replace it', () => {
    expect(escalationPush('x', true).tag).not.toBe('lumio-inbox');
  });
  it('no name → a generic customer, never an empty title', () => {
    expect(escalationPush(null, true).title).toContain('Khách');
  });
});
