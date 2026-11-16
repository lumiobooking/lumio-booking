import { jsonArray, materialLang, questionPrompt } from './knowledge-test';

describe('knowledge test helpers', () => {
  it('reads the JSON array out of a chatty reply', () => {
    expect(jsonArray<{ a: number }>('Here you go:\n```json\n[{"a":1},{"a":2}]\n```')).toEqual([{ a: 1 }, { a: 2 }]);
    expect(jsonArray('no json')).toEqual([]);
  });
  it('knows a Vietnamese price list from an English one', () => {
    expect(materialLang('Gói Boost — $179/tháng. Khối lượng mỗi tháng: 12 bài đăng, 4 video ngắn, kênh đăng Facebook, Instagram, TikTok. Điều kiện gói: cam kết từ 6 tháng.')).toBe('vi');
    expect(materialLang('Boost — $179 per month. 12 posts and 4 short videos a month on Facebook, Instagram and TikTok.')).toBe('en');
  });
  it('asks for questions across the whole material, including unlisted ones', () => {
    const p = questionPrompt('### A\n### Z', 'vi', 12);
    expect(p.user).toContain('WHOLE material');
    expect(p.user).toContain('not_listed');
    expect(p.user).toContain('Vietnamese');
  });
});
