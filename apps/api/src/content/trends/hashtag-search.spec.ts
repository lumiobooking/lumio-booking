import { cleanHashtag, igSearchError } from './trend-feed.service';

describe('the hashtag a salon typed', () => {
  it('accepts what Instagram accepts, and lowercases it', () => {
    expect(cleanHashtag('nailart')).toBe('nailart');
    expect(cleanHashtag('#NailArt')).toBe('nailart');
    expect(cleanHashtag('  ##gel_manicure  ')).toBe('gel_manicure');
    expect(cleanHashtag('nail art')).toBe('nailart');
  });

  it('refuses rather than guesses — a junk tag costs one of the week’s thirty', () => {
    expect(cleanHashtag('')).toBeNull();
    expect(cleanHashtag('#')).toBeNull();
    expect(cleanHashtag('a')).toBeNull();
    expect(cleanHashtag('nail-art')).toBeNull();
    expect(cleanHashtag('móng')).toBeNull();
    expect(cleanHashtag('x'.repeat(61))).toBeNull();
    expect(cleanHashtag(null)).toBeNull();
  });
});

describe('what Instagram’s refusals mean', () => {
  const cases: [string, string][] = [
    ['(#10) Application does not have permission for this action', 'permission'],
    ['instagram_basic permission is required', 'permission'],
    ['(#4) Application request limit reached', 'rate_limit'],
    ['Error validating access token: Session has expired', 'expired'],
    ['(#803) Some of the aliases you requested do not exist', 'not_found'],
    ['Something nobody has seen before', 'unknown'],
  ];
  it.each(cases)('reads %s as %s', (raw, code) => {
    expect(igSearchError(raw).code).toBe(code);
  });

  it('answers in both languages, because two very different people read it', () => {
    const e = igSearchError('(#10) permission');
    expect(e.en).toMatch(/Instagram Public Content Access/);
    expect(e.vi).toMatch(/Instagram Public Content Access/);
    expect(e.en).not.toBe(e.vi);
  });

  it('keeps Meta’s own words when it has no better answer', () => {
    expect(igSearchError('weird thing').en).toContain('weird thing');
  });
});

// ===========================================================================
// The crash this file now guards.
//
// growthLabel / perDayLabel / ageLabel each return a Txt — `{ vi, en }`, not a
// string. Every endpoint in this module is supposed to end with the
// localizeDeep envelope that flattens those. searchHashtag shipped without it,
// so a SUCCESSFUL search handed React an object where it expected text. React
// will not render an object: it threw #31 — "object with keys {vi, en}" — and
// that does not degrade the panel, it takes the whole /salon/content route
// down. The salon pressed Search and the screen died.
//
// Tested on the shaping functions rather than through the service, because the
// bug was never in the network call: it was in what the shaped card carries.
// ===========================================================================
import { growthLabel, perDayLabel, ageLabel } from './trend-feed';
import { localizeDeep, isBi } from '../i18n';

/** Every {vi,en} left anywhere in a payload, by path. Empty is the pass. */
function biPaths(v: unknown, path = '$'): string[] {
  if (v === null || v === undefined) return [];
  if (isBi(v)) return [path];
  if (Array.isArray(v)) return v.flatMap((x, i) => biPaths(x, `${path}[${i}]`));
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => biPaths(x, `${path}.${k}`));
  }
  return [];
}

describe('a searched card never reaches React carrying {vi, en}', () => {
  const NOW = new Date('2026-09-11T12:00:00Z');
  const card = () => ({
    id: 'm1', source: 'instagram' as const, title: 'gel set', url: 'https://x',
    thumbUrl: null, count: 4200, publishedAt: '2026-09-09T12:00:00Z', breakout: false,
    growthLabel: growthLabel(38, false),
    perDayLabel: perDayLabel(2100, 'instagram'),
    ageLabel: ageLabel('2026-09-09T12:00:00Z', NOW),
  });

  it('the raw shaped card DOES carry them — this is the trap', () => {
    expect(biPaths(card()).sort()).toEqual(['$.ageLabel', '$.growthLabel', '$.perDayLabel']);
  });

  it('the Vietnamese side the endpoint returns carries none', () => {
    expect(biPaths(localizeDeep(card(), 'vi'))).toEqual([]);
  });

  it('the English side carries none either', () => {
    expect(biPaths(localizeDeep(card(), 'en'))).toEqual([]);
  });

  it('and the two sides really are different text, not one language twice', () => {
    const v = localizeDeep(card(), 'vi') as Record<string, string>;
    const e = localizeDeep(card(), 'en') as Record<string, string>;
    expect(v.ageLabel).not.toBe(e.ageLabel);
    expect(typeof v.growthLabel).toBe('string');
    expect(typeof e.perDayLabel).toBe('string');
  });

  it('a whole list of cards is flattened, not just the first', () => {
    expect(biPaths(localizeDeep([card(), card(), card()], 'vi'))).toEqual([]);
  });
});
