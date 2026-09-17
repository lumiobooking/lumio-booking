import { draftWorthWriting, DRAFT_MAX_AGE_DAYS } from './google-reviews.service';

// WHY THIS EXISTS: one day's meter read 1,713 review drafts ($1.49) that no
// salon had asked for — first syncs drafting replies to years-old reviews.
// The rule below is the money gate; the sync must never draft past it.
describe('draftWorthWriting — no automatic draft for an old review', () => {
  const now = new Date('2026-09-17T12:00:00Z');
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

  it('drafts a review from this week', () => {
    expect(draftWorthWriting(daysAgo(3), now)).toBe(true);
  });

  it('drafts right up to the limit', () => {
    expect(draftWorthWriting(daysAgo(DRAFT_MAX_AGE_DAYS), now)).toBe(true);
  });

  it('does NOT draft a review older than the limit', () => {
    expect(draftWorthWriting(daysAgo(DRAFT_MAX_AGE_DAYS + 1), now)).toBe(false);
    expect(draftWorthWriting(daysAgo(700), now)).toBe(false);
  });

  it('treats a missing or unreadable date as old — the money direction', () => {
    expect(draftWorthWriting(null, now)).toBe(false);
    expect(draftWorthWriting(undefined, now)).toBe(false);
    expect(draftWorthWriting(new Date('not a date'), now)).toBe(false);
  });

  it('keeps the limit in weeks, not years', () => {
    expect(DRAFT_MAX_AGE_DAYS).toBeLessThanOrEqual(60);
  });
});
