import { slugify, uniqueSlug } from './slug.util';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Anna Nail Spa')).toBe('anna-nail-spa');
  });

  it('strips punctuation and apostrophes', () => {
    expect(slugify("Anna's Nail Spa!")).toBe('annas-nail-spa');
  });

  it('collapses repeated separators and trims', () => {
    expect(slugify('  Glam   &   Glow  ')).toBe('glam-glow');
  });

  it('removes diacritics', () => {
    expect(slugify('Café Déluxe')).toBe('cafe-deluxe');
  });
});

describe('uniqueSlug', () => {
  it('returns the base slug when free', () => {
    expect(uniqueSlug('Salon A', new Set())).toBe('salon-a');
  });

  it('appends a counter when the slug is taken', () => {
    const taken = new Set(['salon-a']);
    expect(uniqueSlug('Salon A', taken)).toBe('salon-a-2');
  });

  it('skips multiple taken slugs', () => {
    const taken = new Set(['salon-a', 'salon-a-2', 'salon-a-3']);
    expect(uniqueSlug('Salon A', taken)).toBe('salon-a-4');
  });

  it('falls back to "salon" when name has no usable characters', () => {
    expect(uniqueSlug('!!!', new Set())).toBe('salon');
  });
});
