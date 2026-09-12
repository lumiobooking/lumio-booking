import { needsDraftBackfill, DRAFT_BACKFILL_PER_SYNC } from './google-reviews.service';

const row = (over: Record<string, unknown> = {}) => ({
  status: 'NEEDS_ATTENTION', draftReply: null, repliedAt: null, ...over,
});

/**
 * The dangerous half of this decision is the NO. A yes writes a sentence
 * nobody had; a wrong yes throws away what an owner typed at midnight about a
 * customer who said they were bleeding.
 */
describe('filling in a suggestion that was never written', () => {
  it('writes one for a bad review that is still waiting for an answer', () => {
    expect(needsDraftBackfill(row())).toBe(true);
  });

  it('writes one for a good review whose draft went missing', () => {
    expect(needsDraftBackfill(row({ status: 'DRAFTED' }))).toBe(true);
  });

  it('NEVER overwrites a draft the salon edited', () => {
    expect(needsDraftBackfill(row({ draftReply: 'Chị Hằng ơi, em xin lỗi…' }))).toBe(false);
  });

  it('never overwrites a draft that is only whitespace-different from empty… but does fill a blank one', () => {
    expect(needsDraftBackfill(row({ draftReply: '   ' }))).toBe(true);
    expect(needsDraftBackfill(row({ draftReply: 'x' }))).toBe(false);
  });

  it('never touches a review that has been answered', () => {
    expect(needsDraftBackfill(row({ status: 'REPLIED', repliedAt: new Date() }))).toBe(false);
    expect(needsDraftBackfill(row({ repliedAt: new Date() }))).toBe(false);
  });

  it('never touches one answered on Google outside this system', () => {
    expect(needsDraftBackfill(row(), true)).toBe(false);
  });

  it('never touches one the salon deliberately skipped', () => {
    expect(needsDraftBackfill(row({ status: 'SKIPPED' }))).toBe(false);
  });

  it('leaves a brand-new row alone — the create path writes its own draft', () => {
    expect(needsDraftBackfill(row({ status: 'NEW' }))).toBe(false);
  });

  it('drains a backlog a few at a time rather than in one burst', () => {
    expect(DRAFT_BACKFILL_PER_SYNC).toBeGreaterThan(0);
    expect(DRAFT_BACKFILL_PER_SYNC).toBeLessThanOrEqual(25);
  });
});
