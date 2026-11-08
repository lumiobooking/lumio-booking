import { dhashFromGray } from './media-hash';

describe('browser picture hash (wrong-salon check)', () => {
  it('is 16 hex chars, stable, and survives a uniform brightness change', () => {
    const g = Array.from({ length: 72 }, (_, i) => (i * 37) % 255);
    const h = dhashFromGray(g)!;
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(dhashFromGray(g)).toBe(h);
    expect(dhashFromGray(g.map((v) => v * 0.8 + 10))).toBe(h); // re-encoded / brightened copy
  });
  it('a different picture gives a different hash; too little data gives none', () => {
    const a = Array.from({ length: 72 }, (_, i) => (i * 37) % 255);
    const b = Array.from({ length: 72 }, (_, i) => (i * 91 + 13) % 255);
    expect(dhashFromGray(a)).not.toBe(dhashFromGray(b));
    expect(dhashFromGray([1, 2, 3])).toBeNull();
  });
});
