/**
 * "Khi nào chuyển cho người" (18/11/2026): each salon ticks the situations a
 * person must take. Only known ids are kept; nothing ticked changes nothing.
 */
import * as B from './brain-settings';

const from = (raw: unknown) => B.sanitizeBrain(raw, B.defaultBrain());

describe('the situations an owner hands to a person', () => {
  it('the catalogue tells the model what each one is, in plain words', () => {
    const ids = Object.keys(B.HANDOFF_SITUATIONS);
    expect(ids).toEqual(expect.arrayContaining(['complaint', 'refund', 'discount', 'person', 'health']));
    for (const id of ids) expect(B.HANDOFF_SITUATIONS[id].ai.length).toBeGreaterThan(20);
  });

  it('only known ids are stored, once each; garbage becomes nothing ticked', () => {
    expect(from({ handoff: { when: ['complaint', 'complaint', 'drop table', 7, 'refund', '__proto__'] } }).handoff.when).toEqual(['complaint', 'refund']);
    expect(from({ handoff: { when: 'complaint' } }).handoff.when).toEqual([]);
    expect(from({}).handoff.when).toEqual([]);
  });

  it('nothing ticked adds nothing to the prompt; ticked ones are said to the model, and only those', () => {
    const base = B.defaultBrain();
    const ctx = { channel: 'chat', lang: 'en' } as never;
    const plain = B.brainPromptBlocks(base, ctx).handoffNote;
    expect(plain).not.toContain('THE OWNER WANTS A PERSON');
    const picked = B.brainPromptBlocks({ ...base, handoff: { ...base.handoff, when: ['complaint', 'refund'] } }, ctx).handoffNote;
    expect(picked).toContain('THE OWNER WANTS A PERSON TO TAKE THESE');
    expect(picked).toContain('A complaint');
    expect(picked).toContain('A refund');
    expect(picked).not.toContain('Bargaining');
    expect(picked).toContain('request_callback');
  });
});
