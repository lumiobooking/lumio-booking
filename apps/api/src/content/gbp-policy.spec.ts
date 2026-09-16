import {
  checkGbpPost, gbpImageHeaderProblem, gbpImageIssues, gbpImageSizeProblem, gbpRefusal, gbpSummary, gbpTextIssues,
  GBP_SUMMARY_MAX,
} from './gbp-policy';

const img = (url = 'https://cdn.lumio.app/p/1.jpg') => ({ url, kind: 'image' as const });

const codes = (r: { blockers: { code: string }[]; risks?: { code: string }[]; warnings: { code: string }[] }) =>
  ({ block: r.blockers.map((b) => b.code), risk: (r.risks ?? []).map((x) => x.code), warn: r.warnings.map((w) => w.code) });

describe('the caption Google receives — the contact block is stripped, not refused', () => {
  const caption = `✨ Simple, classy, and always in style 💅
Book your Tuesday slot!

📍 5900 Balcones Drive STE 100, Austin, TX 78731
📞 (512) 886-8189
🌐 https://luxnailspa.com/book
📸 @lumio_bk
#nails #austinnails #gelx`;

  it('drops phone, link, handle and hashtags and says which', () => {
    const { text, removed } = gbpSummary(caption);
    expect(text).not.toMatch(/886-8189|https?:|@lumio|#/);
    expect(removed.sort()).toEqual(['handle', 'hashtag', 'link', 'phone']);
  });

  it('keeps the address and the words, and leaves no orphan "📞" line behind', () => {
    const { text } = gbpSummary(caption);
    expect(text).toMatch(/Balcones Drive/);
    expect(text).toMatch(/Book your Tuesday slot!/);
    expect(text).not.toMatch(/📞|🌐|📸/);
    expect(text.split('\n').filter((l) => l === '').length).toBeLessThanOrEqual(1);
  });

  it('does not mistake a price for a phone number', () => {
    const { text, removed } = gbpSummary('Full set from $1,200.00 — chỉ 350.000đ hôm nay');
    expect(text).toContain('$1,200.00');
    expect(removed).not.toContain('phone');
  });

  it('strips a Vietnamese mobile number too', () => {
    expect(gbpSummary('Gọi 0909 123 456 để đặt').removed).toContain('phone');
    expect(gbpSummary('Gọi +84 909 123 456 để đặt').text).toBe('Gọi để đặt');
  });

  it('never truncates — the planner refuses past the ceiling instead of sending a cut sentence', () => {
    expect(gbpSummary('a'.repeat(GBP_SUMMARY_MAX + 500)).text.length).toBe(GBP_SUMMARY_MAX + 500);
  });
});

describe('restricted goods: a mention is advice, a deal on the same line is a risk', () => {
  it('lets a restaurant mention beer on the menu', () => {
    const r = gbpTextIssues('Phở bò, bún chả, và có bia Sài Gòn lạnh.');
    expect(codes(r)).toEqual({ block: [], risk: [], warn: ['alcohol'] });
  });

  it('holds a beer promotion until somebody accepts it — it is never forbidden', () => {
    const r = gbpTextIssues('Happy hour: bia Sài Gòn chỉ 20k!');
    expect(codes(r).block).toEqual([]);
    expect(codes(r).risk).toEqual(['alcohol']);
  });

  it('holds a wine deal written in English with a dollar price', () => {
    expect(codes(gbpTextIssues('Wine night — glasses only $5')).risk).toEqual(['alcohol']);
  });

  it('reads the line, not the post: a discount beside vape, not one further down', () => {
    expect(codes(gbpTextIssues('Vape mới về.\nGiảm 20% dịch vụ nail tuần này.')).risk).toEqual([]);
    expect(codes(gbpTextIssues('Vape mới về giảm 20%')).risk).toEqual(['tobacco']);
  });
});

describe('what is FORBIDDEN — the short list nobody may override', () => {
  it.each([
    ['gambling', 'Tối nay có casino night, cá cược thoải mái!'],
    ['weapons', 'Bán kèm súng ngắn cho khách'],
    ['drugs', 'Sản phẩm cần sa giúp thư giãn'],
    ['adult', 'Escort service available'],
    ['hate', 'Con đĩ đó đừng quay lại'],
    ['cure-claim', 'Liệu trình chữa khỏi viêm da'],
    ['cure-claim', 'Our serum cures diabetes'],
  ])('%s: "%s"', (code, text) => {
    expect(codes(gbpTextIssues(text)).block).toContain(code);
  });

  it('does not fire inside other words — "guns" is a weapon, "Gunsmoke Grey" gel is not', () => {
    expect(codes(gbpTextIssues('New shade: Gunsmoke Grey')).block).toEqual([]);
    expect(codes(gbpTextIssues('New shade: Bet-on-Red')).block).toEqual([]);
    expect(codes(gbpTextIssues('cocktail dress nails')).block).toEqual([]);
  });

  it('a normal nail post has nothing to say', () => {
    const r = gbpTextIssues('Bộ nail gel-x mới về, còn giờ trống thứ Ba sáng. Đặt lịch ngay nhé!');
    expect(codes(r)).toEqual({ block: [], risk: [], warn: [] });
  });
});

describe('what is merely RESTRICTED — a risk the team may accept, never a dead end', () => {
  it.each([
    ['medical', 'Tiêm filler môi giá tốt'],
    ['medical', 'Botox specials this week'],
    ['finance', 'Cho vay nhanh trong ngày'],
    ['political', 'Mừng ngày bầu cử, giảm 10%'],
    ['body-claim', 'Liệu trình giúp giảm 5kg trong 1 tuần'],
    ['cbd', 'CBD oil massage add-on'],
    ['weapon-minor', 'Tặng kèm pepper spray cho khách nữ'],
  ])('%s is a risk, not a blocker: "%s"', (code, text) => {
    const r = gbpTextIssues(text);
    expect(codes(r).block).toEqual([]);
    expect(codes(r).risk).toContain(code);
  });

  it('a risk the team has accepted stops refusing; a NEW one still does', () => {
    const post = 'Tiêm filler môi — bác sĩ có chứng chỉ';
    expect(gbpRefusal(post, [img()])).toMatch(/y khoa/);
    expect(gbpRefusal(post, [img()], ['medical'])).toBeNull();
    // the same shop later writes something else restricted: not covered
    expect(gbpRefusal(`${post}. Cho vay trả góp tận nơi.`, [img()], ['medical'])).toMatch(/tài chính/);
  });

  it('accepting a risk never unlocks a forbidden one', () => {
    expect(gbpRefusal('Casino night, tiêm filler miễn phí', [img()], ['medical', 'gambling'])).toMatch(/Cờ bạc/);
  });
});

describe('the words a salon means innocently — swapped for Google, not refused', () => {
  it('turns "sexy" and "nude" into words Google’s classifier does not flinch at', () => {
    const { text, softened } = gbpSummary('Sexy red and nude almond set 💅');
    expect(text).toBe('gorgeous red and neutral almond set 💅');
    expect(softened.map((x) => x.vi).join(' ')).toMatch(/"sexy"/);
    expect(codes(gbpTextIssues(text))).toEqual({ block: [], risk: [], warn: [] });
  });

  it('so the whole check passes a post that used to be refused outright', () => {
    const c = checkGbpPost('Sexy nails for the weekend', [img()]);
    expect(c.blockers).toEqual([]);
    expect(c.risks).toEqual([]);
    expect(gbpRefusal('Sexy nails for the weekend', [img()])).toBeNull();
  });

  it('but a genuinely adult word is not a spelling problem — it is refused', () => {
    expect(codes(gbpTextIssues('Happy ending massage')).block).toContain('adult');
  });
});

describe('words a spa uses every day that used to block the post', () => {
  it.each([
    'Detox body scrub 60 phút',
    'Tiệm nhận thẻ tín dụng và Apple Pay',
    'Vote for your favourite colour of the month!',
    'This balm heals dry cuticles',
    'Nude pink ombre — bộ mới',
  ])('%s', (text) => {
    expect(gbpRefusal(text, [img()])).toBeNull();
  });
});

describe('the things Google’s spam filter looks at — warnings, not refusals', () => {
  it('flags all caps, stacked punctuation, an emoji flood, and superlatives', () => {
    const r = gbpTextIssues('BEST NAIL SALON IN TOWN!!! 💅💅💅💅💅💅💅💅💅 SỐ 1 AUSTIN');
    expect(codes(r).block).toEqual([]);
    expect(codes(r).warn).toEqual(expect.arrayContaining(['superlative', 'caps', 'punctuation', 'emoji']));
  });

  it('flags installments and raffles as things to word carefully', () => {
    expect(codes(gbpTextIssues('Sofa da trả góp 0% — bốc thăm trúng iPhone')).warn).toEqual(expect.arrayContaining(['financing', 'sweepstake']));
  });
});

describe('photos', () => {
  it('refuses a format Google cannot take, from the link', () => {
    expect(codes(gbpImageIssues([img('https://cdn/x.webp')])).block).toEqual(['format']);
    expect(codes(gbpImageIssues([img('https://cdn/x.gif?x=1')])).block).toEqual(['format']);
    expect(codes(gbpImageIssues([img('https://cdn/x.JPG')])).block).toEqual([]);
  });

  it('says only the first of several photos will go', () => {
    expect(codes(gbpImageIssues([img(), img('https://cdn/2.jpg')])).warn).toEqual(['one-photo']);
  });

  it('judges the file from its headers: type, then size', () => {
    expect(gbpImageHeaderProblem({ contentType: 'image/webp', contentLength: 50_000 })).toMatch(/JPG\/PNG/);
    expect(gbpImageHeaderProblem({ contentType: 'image/jpeg; charset=binary', contentLength: 4_000 })).toMatch(/quá nhỏ/);
    expect(gbpImageHeaderProblem({ contentType: 'image/png', contentLength: 6 * 1024 * 1024 })).toMatch(/quá nặng/);
    expect(gbpImageHeaderProblem({ contentType: 'image/jpeg', contentLength: 300_000 })).toBeNull();
    expect(gbpImageHeaderProblem({ contentType: null, contentLength: null })).toBeNull();
  });

  it('and from its pixels', () => {
    expect(gbpImageSizeProblem(200, 800)).toMatch(/250×250/);
    expect(gbpImageSizeProblem(1080, 1350)).toBeNull();
  });
});

describe('the whole verdict, as the planner and the composer use it', () => {
  it('a caption that is nothing but the contact block leaves nothing to post', () => {
    const c = checkGbpPost('📞 (512) 886-8189\nhttps://x.y\n#nails', [img()]);
    expect(c.summary).toBe('');
    expect(c.blockers[0].code).toBe('empty');
  });

  it('refuses with the first blocker in Vietnamese, naming the word', () => {
    expect(gbpRefusal('Happy ending massage', [img()])).toMatch(/^Google Business: .*"Happy ending"/);
    expect(gbpRefusal('Bộ nail mới về', [img()])).toBeNull();
  });

  it('carries the warnings alongside without turning them into refusals', () => {
    const c = checkGbpPost('THE BEST nails!!! #nails', [img(), img('https://cdn/2.jpg')]);
    expect(c.blockers).toEqual([]);
    expect(c.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['superlative', 'one-photo']));
    expect(c.removed).toEqual(['hashtag']);
  });
});
