import {
  checkGbpPost, gbpImageHeaderProblem, gbpImageIssues, gbpImageSizeProblem, gbpRefusal, gbpSummary, gbpTextIssues,
  GBP_SUMMARY_MAX,
} from './gbp-policy';

const img = (url = 'https://cdn.lumio.app/p/1.jpg') => ({ url, kind: 'image' as const });

const codes = (r: { blockers: { code: string }[]; warnings: { code: string }[] }) =>
  ({ block: r.blockers.map((b) => b.code), warn: r.warnings.map((w) => w.code) });

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

describe('restricted goods: a mention passes, a deal on the same line does not', () => {
  it('lets a restaurant mention beer on the menu', () => {
    const r = gbpTextIssues('Phở bò, bún chả, và có bia Sài Gòn lạnh.');
    expect(codes(r)).toEqual({ block: [], warn: ['alcohol'] });
  });

  it('refuses a beer promotion', () => {
    const r = gbpTextIssues('Happy hour: bia Sài Gòn chỉ 20k!');
    expect(codes(r).block).toEqual(['alcohol']);
  });

  it('refuses a wine deal written in English with a dollar price', () => {
    expect(codes(gbpTextIssues('Wine night — glasses only $5')).block).toEqual(['alcohol']);
  });

  it('refuses a discount on the same line as vape, not on another line', () => {
    expect(codes(gbpTextIssues('Vape mới về.\nGiảm 20% dịch vụ nail tuần này.')).block).toEqual([]);
    expect(codes(gbpTextIssues('Vape mới về giảm 20%')).block).toEqual(['tobacco']);
  });
});

describe('what is refused on the word alone', () => {
  it.each([
    ['gambling', 'Tối nay có poker và casino night!'],
    ['weapons', 'Tặng kèm pepper spray cho khách nữ'],
    ['drugs', 'Sản phẩm CBD giúp thư giãn'],
    ['medical', 'Tiêm filler môi giá tốt'],
    ['medical', 'Botox specials this week'],
    ['health-claim', 'Liệu trình thải độc, giảm 5kg trong 1 tuần'],
    ['health-claim', 'Our massage cures back pain'],
    ['adult', 'Sexy red nails for the weekend'],
    ['finance', 'Cho vay nhanh trong ngày'],
    ['political', 'Vote for Trump and get 10% off'],
    ['hate', 'Thằng ngu nào cũng làm được'],
  ])('%s: "%s"', (code, text) => {
    expect(codes(gbpTextIssues(text)).block).toContain(code);
  });

  it('tells the writer the word, so a harmless "sexy" can be swapped', () => {
    const r = gbpTextIssues('Sexy red nails');
    expect(r.blockers[0].match).toBe('Sexy');
    expect(r.blockers[0].vi).toMatch(/quyến rũ/);
  });

  it('does not fire inside other words — "guns" is a weapon, "Gunsmoke Grey" gel is not', () => {
    expect(codes(gbpTextIssues('New shade: Gunsmoke Grey')).block).toEqual([]);
    expect(codes(gbpTextIssues('New shade: Bet-on-Red')).block).toEqual([]);
    expect(codes(gbpTextIssues('cocktail dress nails')).block).toEqual([]);
  });

  it('a normal nail post has nothing to say', () => {
    const r = gbpTextIssues('Bộ nail gel-x mới về, còn giờ trống thứ Ba sáng. Đặt lịch ngay nhé!');
    expect(codes(r)).toEqual({ block: [], warn: [] });
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
    expect(gbpRefusal('Sexy nails for the weekend', [img()])).toMatch(/^Google Business: .*"Sexy"/);
    expect(gbpRefusal('Bộ nail mới về', [img()])).toBeNull();
  });

  it('carries the warnings alongside without turning them into refusals', () => {
    const c = checkGbpPost('THE BEST nails!!! #nails', [img(), img('https://cdn/2.jpg')]);
    expect(c.blockers).toEqual([]);
    expect(c.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['superlative', 'one-photo']));
    expect(c.removed).toEqual(['hashtag']);
  });
});
