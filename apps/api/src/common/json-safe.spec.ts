import { clip, jsonSafe, safeText } from './json-safe';

describe('text a JSON column accepts', () => {
  const emoji = '💅';

  it('reproduces the break: slice() cuts an emoji in half', () => {
    const cut = `${'a'.repeat(119)}${emoji}`.slice(0, 120);
    expect(cut.charCodeAt(119)).toBeGreaterThanOrEqual(0xd800);
    expect(JSON.stringify(cut)).toMatch(/\\ud83d"$/);
  });

  it('clip never splits an emoji', () => {
    const s = `${'a'.repeat(119)}${emoji}${emoji}`;
    expect(clip(s, 120)).toBe(`${'a'.repeat(119)}${emoji}`);
    expect(clip('ngắn', 120)).toBe('ngắn');
  });

  it('jsonSafe removes lone halves and NUL, keeps whole emoji and Vietnamese', () => {
    const broken = `Móng đẹp ${emoji} ${'x'.slice(0)}\ud83d\u0000`;
    expect(safeText(broken)).toBe(`Móng đẹp ${emoji} x`);
    const deep = jsonSafe({ posts: [{ caption: 'a\ud83d', n: 3, at: null }], ok: true });
    expect(deep).toEqual({ posts: [{ caption: 'a', n: 3, at: null }], ok: true });
  });
});
