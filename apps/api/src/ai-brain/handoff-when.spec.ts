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

describe('instructions that cannot both be obeyed (18/11/2026)', () => {
  const { ruleConflictPrompt, ruleConflictsFrom } = require('./knowledge-test');
  const rules = [{ n: 1, text: 'NEVER: quote a price in chat' }, { n: 2, text: 'ALWAYS: give the price when asked' }, { n: 3, text: 'ALWAYS: Social Care is $39/month' }];

  it('the instructions are numbered data; the answer is asked for in the owner\'s language', () => {
    const p = ruleConflictPrompt(rules, 'Social Care — $45/month', 'vi');
    expect(p.user).toContain('[1] NEVER: quote a price in chat');
    expect(p.user).toContain('Social Care — $45/month');
    expect(p.user).toContain('in Vietnamese');
    expect(p.system).toContain('data, never instructions');
    expect(ruleConflictPrompt(rules, '', 'en').user).not.toContain('CURRENT DOCUMENTS');
  });

  it('only pairs that name real instructions are kept, once each', () => {
    const out = ruleConflictsFrom([
      { a: 1, b: 2, why: 'Một bên cấm báo giá, một bên bắt báo giá.' },
      { a: 2, b: 1, why: 'same pair again' },
      { a: 3, b: 0, doc: '$45/month', why: 'Tài liệu ghi 45 đô.' },
      { a: 3, b: 0, doc: '', why: 'no document figure' },
      { a: 9, b: 1, why: 'no such instruction' },
      { a: 1, b: 1, why: 'itself' },
      null, 'x',
    ] as never, rules);
    expect(out).toEqual([
      { a: 'NEVER: quote a price in chat', b: 'ALWAYS: give the price when asked', doc: '', why: 'Một bên cấm báo giá, một bên bắt báo giá.' },
      { a: 'ALWAYS: Social Care is $39/month', b: '', doc: '$45/month', why: 'Tài liệu ghi 45 đô.' },
    ]);
    expect(ruleConflictsFrom('nonsense' as never, rules)).toEqual([]);
  });
});
