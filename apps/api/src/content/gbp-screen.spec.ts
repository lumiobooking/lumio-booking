import { gbpScreenPrompt, parseScreenVerdict, screenRefusal } from './gbp-screen';

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
      .toEqual({ ok: true, blockers: [], warnings: ['Ảnh hơi tối.'], sawImage: true });
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
