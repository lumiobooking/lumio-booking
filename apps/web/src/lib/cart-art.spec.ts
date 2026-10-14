import { CART_TEMPLATES, cartCopy, resolveTemplate, templatesFor } from './cart-art';
import { INDUSTRY_OPTIONS } from './ui-industry';

describe('empty-cart templates by trade', () => {
  it('the default is the calendar for every trade; the trade\'s own template comes right after it', () => {
    for (const o of INDUSTRY_OPTIONS) {
      const list = templatesFor(o.key);
      expect(list[0].key).toBe('calendar');
      expect(list[1].industries).toContain(o.key);
      expect(resolveTemplate('auto', o.key).key).toBe('calendar');
      expect(resolveTemplate(undefined, o.key).key).toBe('calendar');
      expect(list.filter((t) => t.key === 'calendar')).toHaveLength(1);
    }
  });
  it('a salon that already picked a template keeps it', () => {
    expect(resolveTemplate('spa-lotus', 'MASSAGE').key).toBe('spa-lotus');
    expect(resolveTemplate('nail-polish', 'NAIL').key).toBe('nail-polish');
    expect(resolveTemplate('classic', 'NAIL').key).toBe('classic');
  });
  it('a nail salon is offered nail and beauty templates plus the general ones, never a café cup', () => {
    const keys = templatesFor('NAIL').map((t) => t.key);
    expect(keys.slice(0, 2)).toEqual(['calendar', 'nail-polish']);
    expect(keys).toContain('classic');
    expect(keys.indexOf('cafe-cup')).toBe(-1);
  });
  it('a removed or unknown pick falls back to the calendar', () => {
    expect(resolveTemplate('gone', 'DENTAL').key).toBe('calendar');
    expect(resolveTemplate(null, 'CAFE').key).toBe('calendar');
  });
  it("the calendar's reasons to book follow the trade", () => {
    expect(cartCopy({ industry: 'NAIL', lang: 'en' }).perks[2].title).toBe('Pick your tech');
    expect(cartCopy({ industry: 'DENTAL', lang: 'en' }).perks[2].title).toBe('Choose your doctor');
    expect(cartCopy({ industry: 'CAFE', lang: 'en' }).perks[2].title).toBe('Your way');
    expect(cartCopy({ industry: 'NAIL', lang: 'en' }).art).toBe('calendar');
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
