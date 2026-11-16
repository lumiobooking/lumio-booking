import { SCENARIOS, mergeGrades, parseSimTranslation, pickScenarios, simFingerprint, simTranslatePrompt, regressionsOf, simJudgePrompt, simRunFrom, toolsFromTrace, type SimItem, type SimRun } from './simulations';

describe('customer simulations — fixed scripts, graded on conduct', () => {
  it('a bilingual salon gets twenty: every booking script in the first language, then the second until twenty', () => {
    const run = pickScenarios('booking', ['vi', 'en']);
    expect(run).toHaveLength(20);
    const booking = SCENARIOS.filter((s) => s.modes.includes('booking')).length;
    expect(booking).toBe(12);
    expect(run.slice(0, booking).every((x) => x.lang === 'vi')).toBe(true);
    expect(run[booking].lang).toBe('en');
    expect(new Set(run.map((x) => `${x.scenario.id}:${x.lang}`)).size).toBe(20);
  });

  it('one language allowed = one pass; a sales page never gets the booking scripts', () => {
    expect(pickScenarios('booking', ['en']).every((x) => x.lang === 'en')).toBe(true);
    const sales = pickScenarios('sales', ['vi']);
    expect(sales.some((x) => x.scenario.id === 'book-start')).toBe(false);
    expect(sales.some((x) => x.scenario.id === 'sales-price')).toBe(true);
    // A marketing agency is not asked a salon's opening hours or about chipped nails.
    expect(sales.some((x) => x.scenario.id === 'two-questions' || x.scenario.id === 'complaint')).toBe(false);
    expect(sales.some((x) => x.scenario.id === 'sales-complaint')).toBe(true);
    expect(pickScenarios('booking', []).every((x) => x.lang === 'en')).toBe(true);
  });

  it('every script has both languages, a rubric, and nothing about one particular salon', () => {
    for (const s of SCENARIOS) {
      expect(s.turns.vi.length).toBeGreaterThan(0);
      expect(s.turns.vi.length).toBe(s.turns.en.length);
      expect(s.rubric.length).toBeGreaterThan(30);
      expect(s.title.vi && s.title.en).toBeTruthy();
    }
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
  });

  it('the judge is given the salon’s own sources and the tools that really ran', () => {
    const p = simJudgePrompt([{ customer: ['Đặt cho mình 3 giờ chiều mai nha'], reply: 'Dạ em đã đặt lịch 3 giờ chiều mai cho chị rồi ạ', tools: [], rubric: 'R1', lang: 'vi' }], 'Gel tay: $35', 'vi');
    expect(p.user).toContain('Gel tay: $35');
    expect(p.user).toContain('TOOLS CALLED: (none)');
    expect(p.system).toContain('that is not in SOURCES');
    expect(p.system).toContain('Vietnamese, one short sentence');
  });

  it('reads tool names out of the sandbox trace', () => {
    expect(toolsFromTrace(['check_availability: Sat 2pm free', 'create_booking: SUCCESS (TEST…)', 'check_availability: again', 'not a tool line'])).toEqual(['check_availability', 'create_booking']);
    expect(toolsFromTrace(null)).toEqual([]);
  });

  it('a regression is a script that passed last run and fails now — same script, same language', () => {
    const item = (id: string, lang: 'vi' | 'en', pass: boolean): SimItem => ({ id, lang, title: id, customer: ['x'], reply: 'y', pass, why: '' });
    const prev = { at: 'a', ms: 1, total: 3, passed: 2, mode: 'booking', regressions: [], items: [item('price', 'vi', true), item('price', 'en', false), item('group', 'vi', true)] } as SimRun;
    expect(regressionsOf(prev, [item('price', 'vi', false), item('price', 'en', false), item('group', 'vi', true)])).toEqual(['price:vi']);
    expect(regressionsOf(null, [item('price', 'vi', false)])).toEqual([]);
  });

  it('a stored run is read back only when it looks like one', () => {
    expect(simRunFrom(null)).toBeNull();
    expect(simRunFrom({ at: 'x' })).toBeNull();
    expect(simRunFrom({ at: 'x', items: [] })).toEqual({ at: 'x', items: [] });
  });

  it('graded twice: a script fails only when both gradings fail it', () => {
    const a = [{ i: 0, pass: true, why: 'ok' }, { i: 1, pass: false, why: 'dài' }, { i: 2, pass: false, why: 'bịa giá' }];
    const b = [{ i: 0, pass: true, why: 'ok' }, { i: 1, pass: true, why: 'ổn' }, { i: 2, pass: false, why: 'giá không có trong bảng' }];
    const m = mergeGrades(a, b, 4);
    expect(m.map((g) => g?.pass)).toEqual([true, true, false, undefined]);
    expect(m[2]?.why).toBe('bịa giá');
    // Only one grading came back: its verdict stands.
    expect(mergeGrades([{ i: 0, pass: false, why: 'x' }], [], 1)[0]?.pass).toBe(false);
  });

  it('the judge no longer fails a reply for one sentence too many', () => {
    const p = simJudgePrompt([{ customer: ['hi'], reply: 'Hello', tools: [], rubric: 'R', lang: 'en' }], '', 'en');
    expect(p.system).toContain('never fails a case');
    expect(p.system).toContain('only for one of these SERIOUS faults');
  });

  it('the fingerprint changes when a link’s text, an instruction or the saved settings change — and only then', () => {
    const base = { brainVersion: 3, sources: [{ id: 's1', text: 'Gel tay: $35' }], instructions: [{ id: 'i1', on: true, kind: 'always', text: 'xưng em' }] };
    const fp = simFingerprint(base);
    expect(simFingerprint({ ...base, sources: [...base.sources] })).toBe(fp);
    expect(simFingerprint({ ...base, brainVersion: 4 })).not.toBe(fp);
    expect(simFingerprint({ ...base, sources: [{ id: 's1', text: 'Gel tay: $40' }] })).not.toBe(fp);
    expect(simFingerprint({ ...base, instructions: [{ id: 'i1', on: false, kind: 'always', text: 'xưng em' }] })).not.toBe(fp);
    expect(simFingerprint({ ...base, instructions: [...base.instructions, { id: 'i2', on: true, kind: 'never', text: 'giảm giá' }] })).not.toBe(fp);
  });

  it('scripts for another language are used only when the translation came back whole', () => {
    const p = simTranslatePrompt([{ id: 'greeting', turns: ['Hi there'] }], 'Spanish');
    expect(p.system).toContain('Spanish');
    expect(JSON.parse(p.user)).toEqual({ greeting: ['Hi there'] });
    expect(parseSimTranslation('```json\n{"greeting":["Hola"],"price":[],"unknown":"x","not-ready":["a","b"]}\n```', ['greeting', 'price', 'unknown', 'not-ready', 'missing']))
      .toEqual({ greeting: ['Hola'], 'not-ready': ['a', 'b'] });
    expect(parseSimTranslation('sorry', ['greeting'])).toEqual({});
  });
});

