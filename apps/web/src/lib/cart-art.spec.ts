import { CART_TEMPLATES, cartCopy, resolveTemplate, templatesFor } from './cart-art';
import { INDUSTRY_OPTIONS } from './ui-industry';

describe('empty-cart templates by trade', () => {
  it('every trade has its own template first, and auto picks it', () => {
    for (const o of INDUSTRY_OPTIONS) {
      const list = templatesFor(o.key);
      expect(list[0].industries).toContain(o.key);
      expect(resolveTemplate('auto', o.key).key).toBe(list[0].key);
    }
  });
  it('a nail salon is offered nail and beauty templates plus the general ones, never a café cup first', () => {
    const keys = templatesFor('NAIL').map((t) => t.key);
    expect(keys[0]).toBe('nail-polish');
    expect(keys).toContain('classic');
    expect(keys.indexOf('cafe-cup')).toBe(-1);
  });
  it('a removed or unknown pick falls back to the trade', () => {
    expect(resolveTemplate('gone', 'DENTAL').key).toBe('dental-tooth');
    expect(resolveTemplate(null, 'CAFE').key).toBe('cafe-cup');
  });
  it("the salon's own words win; blank keeps the template's; both languages complete", () => {
    const own = cartCopy({ key: 'food-plate', industry: 'RESTAURANT', lang: 'vi', title: '  Món ngon hôm nay?  ', hint: '' });
    expect(own.title).toBe('Món ngon hôm nay?');
    expect(own.hint).toBe('Bấm + ở món bất kỳ — gọi được nhiều món.');
    for (const t of CART_TEMPLATES) for (const lang of ['vi', 'en'] as const) {
      const c = cartCopy({ key: t.key, industry: 'NAIL', lang });
      expect(c.title.length).toBeGreaterThan(5);
      expect(c.perks).toHaveLength(4);
      for (const p of c.perks) expect(p.title && p.sub).toBeTruthy();
    }
  });
  it('custom text is capped', () => {
    expect(cartCopy({ key: 'calendar', industry: 'SERVICE', lang: 'en', title: 'x'.repeat(200) }).title).toHaveLength(80);
  });
});
