import { MAX_EXAMPLES, PERSPECTIVE_RULES, ownNames, rememberEdit, voiceBlock } from './review-voice';

const now = new Date('2026-11-27T03:00:00Z');

describe('rt246 the salon shapes its review replies', () => {
  it('learns only from a real rewrite, newest first, capped', () => {
    expect(rememberEdit([], { stars: 5, review: 'Great', draft: 'Thanks!', final: 'Thanks!' }, now)).toEqual([]);
    expect(rememberEdit([], { stars: 5, review: 'Great', draft: null, final: 'Thank you so much for visiting us' }, now)).toEqual([]);
    const one = rememberEdit([], { stars: 5, review: 'Thank the team!', draft: 'Please pass along our thanks to the team.', final: "We'll pass your kind words on to our team. Thank you!" }, now);
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ stars: 5, final: "We'll pass your kind words on to our team. Thank you!" });
    let list = one;
    for (let i = 0; i < 10; i += 1) list = rememberEdit(list, { stars: 4, review: `r${i}`, draft: 'draft text here', final: `owner text number ${i}` }, now);
    expect(list).toHaveLength(MAX_EXAMPLES);
    expect(list[0].review).toBe('r9');
  });

  it('the same review rewritten again replaces the older example', () => {
    const a = rememberEdit([], { stars: 5, review: 'Yummy', draft: 'draft one here', final: 'first owner version' }, now);
    const b = rememberEdit(a, { stars: 5, review: 'Yummy', draft: 'draft two here', final: 'second owner version' }, now);
    expect(b).toHaveLength(1);
    expect(b[0].final).toBe('second owner version');
  });

  it('keeps the salon names as written, accents and all, once each', () => {
    expect(ownNames(['Bánh Mì Thịt', 'bánh mì thịt', 'Phở Đặc Biệt', '', null, 'A'])).toEqual(['Bánh Mì Thịt', 'Phở Đặc Biệt']);
  });

  it('puts the owner rules, names, rewrites and one-off note in the prompt', () => {
    const block = voiceBlock({
      instruction: 'Ký tên "Đội ngũ Phở Hằng"',
      names: ['Bánh Mì', 'Phở'],
      examples: rememberEdit([], { stars: 5, review: 'Thanks to the team', draft: 'Please pass along our thanks.', final: "We'll pass your kind words on to our team!" }, now),
      note: 'ngắn hơn',
    });
    expect(block).toContain("THE OWNER'S STYLE RULES");
    expect(block).toContain('Đội ngũ Phở Hằng');
    expect(block).toContain('Bánh Mì · Phở');
    expect(block).toContain('never copy a misspelling');
    expect(block).toContain("Owner posted: \"We'll pass your kind words on to our team!\"");
    expect(block).toContain('FOR THIS REPLY ONLY');
    expect(voiceBlock({})).toBe('');
  });

  it('says who thanks whom', () => {
    expect(PERSPECTIVE_RULES).toContain('pass your kind words on');
    expect(PERSPECTIVE_RULES).toContain('NEVER ask the reviewer to pass anything along');
  });

  it('per salon: one salon\'s rewrites never feed another\'s list', () => {
    const a = rememberEdit([], { stars: 5, review: 'A', draft: 'draft for salon A', final: 'Salon A owner voice' }, now);
    const b = rememberEdit([], { stars: 5, review: 'B', draft: 'draft for salon B', final: 'Salon B owner voice' }, now);
    expect(voiceBlock({ examples: a })).not.toContain('Salon B');
    expect(voiceBlock({ examples: b })).not.toContain('Salon A');
  });
});
