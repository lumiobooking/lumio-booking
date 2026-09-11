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
