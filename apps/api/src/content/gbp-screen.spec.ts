import { HARD_RULES, gbpScreenPrompt, parseScreenVerdict, screenHardRefusal, screenRefusal } from './gbp-screen';

describe('the model’s look at a Google post', () => {
  it('names the policy, the shop and the trade, and says whether a photo is attached', () => {
    const p = gbpScreenPrompt({ summary: 'Bộ nail mới', hasPhoto: true, shopName: 'Lux Nail Spa', trade: 'nail salon' });
    expect(p.system).toMatch(/7213077/);
    expect(p.system).toMatch(/Lux Nail Spa/);
    expect(p.system).toMatch(/bàn tay, móng/);
    expect(p.user).toMatch(/ảnh DUY NHẤT/);
    expect(gbpScreenPrompt({ summary: '', hasPhoto: false, shopName: 'L', trade: 'x' }).user).toMatch(/không có ảnh/);
  });

  it('reads a clean verdict and a blocked one', () => {
    expect(parseScreenVerdict('{"ok":true,"blockers":[],"warnings":["Ảnh hơi tối."]}', true))
      .toEqual({ ok: true, hard: [], blockers: [], warnings: ['Ảnh hơi tối.'], sawImage: true });
    const v = parseScreenVerdict('Đây là kết quả: {"ok":false,"blockers":["Ảnh có chai bia với giá 20k."],"warnings":[]}', true)!;
    expect(v.ok).toBe(false);
    expect(screenRefusal(v)).toMatch(/AI kiểm duyệt.*chai bia/);
  });

  it('does not let a hedging "ok: true" with reasons attached pass', () => {
    const v = parseScreenVerdict('{"ok":true,"blockers":["Số điện thoại in trên ảnh."]}', true)!;
    expect(v.ok).toBe(false);
  });

  it('treats garbage as "could not tell", never as a refusal', () => {
    expect(parseScreenVerdict('Sorry, I cannot', false)).toBeNull();
    expect(parseScreenVerdict('{not json', false)).toBeNull();
    expect(screenRefusal(null)).toBeNull();
  });

  it('caps the lists so a runaway answer cannot flood the screen', () => {
    const v = parseScreenVerdict(JSON.stringify({ ok: false, blockers: Array.from({ length: 20 }, (_, i) => `lý do số ${i}`) }), true)!;
    expect(v.blockers.length).toBe(6);
  });
});

describe('accepting the AI objection sticks to the post, not the wording', () => {
  const { postAckCode } = jest.requireActual('./gbp-screen') as typeof import('./gbp-screen');
  it('gives one code for one caption + photo, however the model phrases its objection', () => {
    const a = postAckCode('Bộ nail mới cho mùa thu', 'https://cdn/x.jpg');
    expect(a).toBe(postAckCode('Bộ nail mới cho mùa thu', 'https://cdn/x.jpg'));
    expect(a).toMatch(/^ai-post-/);
  });
  it('lapses when the caption or the photo changes', () => {
    const a = postAckCode('Bộ nail mới', 'https://cdn/x.jpg');
    expect(postAckCode('Bộ nail mới!!', 'https://cdn/x.jpg')).toBe(a);
    expect(postAckCode('Bộ nail cũ', 'https://cdn/x.jpg')).not.toBe(a);
    expect(postAckCode('Bộ nail mới', 'https://cdn/y.jpg')).not.toBe(a);
  });
});

describe('the findings nobody may wave through', () => {
  it('are named in the prompt, one by one, with the order to be certain', () => {
    const p = gbpScreenPrompt({ summary: 'x', hasPhoto: true, shopName: 'L', trade: 'nail' });
    for (const r of HARD_RULES) expect(p.system).toContain(r);
    expect(p.system).toMatch(/"hard"/);
    expect(p.system).toMatch(/CHẮC CHẮN/);
  });

  it('come back on their own list, fail the verdict, and read as a refusal with no way past it', () => {
    const v = parseScreenVerdict('{"ok":false,"hard":["Ảnh có watermark Shutterstock rõ ràng."],"blockers":[],"warnings":[]}', true)!;
    expect(v.hard).toEqual(['Ảnh có watermark Shutterstock rõ ràng.']);
    expect(v.ok).toBe(false);
    expect(screenHardRefusal(v)).toMatch(/KHÔNG thể bỏ qua.*watermark.*bỏ Google Business/);
    expect(screenRefusal(v)).toMatch(/watermark/);
  });

  it('never lets "not about this shop" be hard — a bakery that sells pho is the team\'s call, so it becomes a blocker', () => {
    const v = parseScreenVerdict('{"ok":false,"hard":["Ảnh không liên quan đến doanh nghiệp SUNNY Bakery, ảnh này là mì gà thuộc nhóm ngành khác."],"blockers":[],"warnings":[]}', true)!;
    expect(v.hard).toEqual([]);
    expect(v.blockers).toEqual(['Ảnh không liên quan đến doanh nghiệp SUNNY Bakery, ảnh này là mì gà thuộc nhóm ngành khác.']);
    expect(screenHardRefusal(v)).toBeNull();
    expect(screenRefusal(v)).toMatch(/SUNNY Bakery/);
  });

  it('keeps a relevance sentence hard when it also names a real hard category', () => {
    const v = parseScreenVerdict('{"ok":false,"hard":["Ảnh không liên quan tiệm và có watermark của hãng khác."],"blockers":[],"warnings":[]}', true)!;
    expect(v.hard).toHaveLength(1);
  });

  it('is absent from an ordinary objection, which the team may still accept', () => {
    const v = parseScreenVerdict('{"ok":false,"blockers":["Ảnh ghép từ nhiều nguồn."],"warnings":[]}', true)!;
    expect(v.hard).toEqual([]);
    expect(screenHardRefusal(v)).toBeNull();
    expect(screenHardRefusal(null)).toBeNull();
  });
});
