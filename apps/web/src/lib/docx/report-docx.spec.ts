import { crc32, zipStore } from './zip';
import { esc } from './oox';
import { buildReportEntries, buildReportXml, engRate, fmtNum, monthLabel, pctOf, topPosts, MonthlyT, ContentT } from './report-docx';
import { docxFileName, growthSeriesOf, viewItemsOf } from './index';

const enc = new TextEncoder();

// ---- the zip layer ----------------------------------------------------------

describe('the zip that IS the docx', () => {
  it('crc32 matches the published check value', () => {
    // The IEEE test vector every implementation agrees on.
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes a structurally valid stored archive', () => {
    const z = zipStore([
      { name: '[Content_Types].xml', data: enc.encode('<Types/>') },
      { name: 'word/document.xml', data: enc.encode('<doc/>') },
    ]);
    const u32 = (at: number) => z[at] | (z[at + 1] << 8) | (z[at + 2] << 16) | ((z[at + 3] << 24) >>> 0);
    // first local header signature
    expect(u32(0)).toBe(0x04034b50);
    // end-of-central-directory signature 22 bytes from the end (no comment)
    expect(u32(z.length - 22)).toBe(0x06054b50);
    // entry count recorded twice
    expect(z[z.length - 22 + 10] | (z[z.length - 22 + 11] << 8)).toBe(2);
    // Word wants [Content_Types].xml as the first entry
    const name = new TextDecoder().decode(z.slice(30, 30 + 19));
    expect(name).toBe('[Content_Types].xml');
  });

  it('identical input → identical bytes (fixed timestamp, no randomness)', () => {
    const mk = () => zipStore([{ name: 'a.xml', data: enc.encode('<a/>') }]);
    expect(Buffer.from(mk()).equals(Buffer.from(mk()))).toBe(true);
  });
});

// ---- xml hygiene ------------------------------------------------------------

describe('what user text may do to the XML: nothing', () => {
  it('escapes the five metacharacters', () => {
    expect(esc('Ngọc & Bích <spa> "đẹp"')).toBe('Ngọc &amp; Bích &lt;spa&gt; &quot;đẹp&quot;');
  });
  it('strips control characters — one of them corrupts the whole file', () => {
    expect(esc('a\u0000b\u0007c')).toBe('abc');
  });
  it('leaves Vietnamese intact', () => {
    expect(esc('Tăng trưởng người theo dõi')).toBe('Tăng trưởng người theo dõi');
  });
});

// ---- shared derivations -----------------------------------------------------

describe('the numbers the document derives', () => {
  it('engagement rate prefers reach, then views, then followers', () => {
    expect(engRate({ platform: 'ig', engagement: 21, reach: 1474, views: 2070, followers: 121, newFollowers: null, postsCount: null })).toBe('1.4%');
    expect(engRate({ platform: 'fb', engagement: 195, reach: null, views: 17083, followers: 746, newFollowers: null, postsCount: null })).toBe('1.1%');
  });

  it('the TikTok trap: a rate above 100% prints as an em-dash, not a number', () => {
    // 254 engagements ÷ 21 followers once printed "1209.5%" in a client PDF.
    expect(engRate({ platform: 'tiktok', engagement: 254, reach: null, views: null, followers: 21, newFollowers: null, postsCount: null })).toBe('—');
  });

  it('no engagement or no denominator → em-dash', () => {
    expect(engRate(undefined)).toBe('—');
    expect(engRate({ platform: 'x', engagement: null, reach: 9, views: 9, followers: 9, newFollowers: null, postsCount: null })).toBe('—');
    expect(engRate({ platform: 'x', engagement: 5, reach: null, views: null, followers: null, newFollowers: null, postsCount: null })).toBe('—');
  });

  it('top posts mix FB and IG and rank by views', () => {
    const fb = [{ type: 'reel', caption: 'fb1', views: 998, reach: null, likes: 4, comments: 0 }];
    const ig = [
      { type: 'reel', caption: 'ig1', views: 1404, reach: null, likes: 7, comments: 0 },
      { type: 'photo', caption: 'ig2', views: 5, reach: null, likes: 0, comments: 0 },
    ];
    const top = topPosts(fb, ig, 2);
    expect(top.map((p) => `${p.pf}:${p.caption}`)).toEqual(['IG:ig1', 'FB:fb1']);
  });

  it('formatting: vi locale grouping, null → em-dash, month label, share %', () => {
    expect(fmtNum(17083, true)).toBe('17.083');
    expect(fmtNum(null, true)).toBe('—');
    expect(monthLabel('2026-08', true)).toBe('Tháng 08/2026');
    expect(pctOf(792, 1030)).toBe(77);
    expect(pctOf(1, 0)).toBeNull();
  });

  it('file name carries salon + month and survives hostile salon names', () => {
    expect(docxFileName('Lux Nail Spa', '2026-08')).toBe('Bao cao Marketing - Lux Nail Spa - 08.2026.docx');
    expect(docxFileName('a/b\\c:d', '2026-08')).toBe('Bao cao Marketing - abcd - 08.2026.docx');
  });
});

// ---- chart input derivations ------------------------------------------------

describe('what the charts are fed', () => {
  it('IG daily series accumulates onto the CURRENT total (last point = today)', () => {
    const data = {
      month: '2026-08',
      outcome: { totals: { bookings: 0, showed: 0, revenueCents: 0 }, newCustomers: 0 },
      spend: [], blended: { totalSpendCents: 0, revenuePerSpend: null },
      socialInsights: [{
        platform: 'instagram', followers: 121, newFollowers: 6, reach: 1474, views: 2070, engagement: 21, postsCount: 15,
        series: [{ date: '2026-08-01', value: 2 }, { date: '2026-08-31', value: 4 }],
      }],
    } as unknown as MonthlyT;
    const s = growthSeriesOf(data);
    expect(s).toHaveLength(1);
    expect(s[0].values).toEqual([117, 121]);
  });

  it('platforms without views stay off the views chart', () => {
    const data = {
      month: '2026-08',
      outcome: { totals: { bookings: 0, showed: 0, revenueCents: 0 }, newCustomers: 0 },
      spend: [], blended: { totalSpendCents: 0, revenuePerSpend: null },
      socialInsights: [
        { platform: 'facebook', followers: 746, newFollowers: 11, reach: null, views: 17083, engagement: 195, postsCount: 40 },
        { platform: 'tiktok', followers: 21, newFollowers: 5, reach: null, views: null, engagement: 254, postsCount: 8 },
      ],
    } as unknown as MonthlyT;
    expect(viewItemsOf(data).map((x) => x.label)).toEqual(['Facebook']);
  });
});

// ---- the document itself ----------------------------------------------------

function fixture(): { data: MonthlyT; content: ContentT } {
  const data: MonthlyT = {
    month: '2026-08',
    outcome: { totals: { bookings: 17, showed: 1, revenueCents: 3500 }, newCustomers: 10 },
    spend: [{ channel: 'facebook', amountCents: 10000 }, { channel: 'google_ads', amountCents: 10000 }],
    blended: { totalSpendCents: 20000, revenuePerSpend: 0.18 },
    deltas: {
      bookings: { value: 17, prev: 22, pct: -23 }, showed: { value: 1, prev: 1, pct: 0 },
      revenueCents: { value: 3500, prev: 3500, pct: 0 }, newCustomers: { value: 10, prev: 19, pct: -47 },
      spendCents: { value: 20000, prev: 20000, pct: 0 },
    },
    socialInsights: [
      { platform: 'facebook', followers: 746, newFollowers: 11, reach: null, views: 17083, engagement: 195, postsCount: 40, posts: [{ type: 'reel', caption: 'A Busy Day at Lux <Nail> & Spa', views: 1404, reach: null, likes: 7, comments: 0 }], monthlySeries: [{ month: '2026-07', followers: 734 }, { month: '2026-08', followers: 746 }] },
      { platform: 'instagram', followers: 121, newFollowers: 6, reach: 1474, views: 2070, engagement: 21, postsCount: 15, posts: [], audience: { gender: { F: 34, M: 50, U: 16 }, age: { '18-24': 31, '25-34': 40 } } },
      { platform: 'tiktok', followers: 21, newFollowers: 5, reach: null, views: 355, engagement: 254, postsCount: 8 },
    ],
    gbp: {
      impressions: 1030, searchImpr: 792, mapsImpr: 238, mobileImpr: 934, desktopImpr: 96,
      calls: 38, directions: 35, websiteClicks: 96, bookings: 0, conversations: null,
      series: [{ month: '2026-07', impressions: 982 }, { month: '2026-08', impressions: 1030 }],
      reviews: { rating: 4.7, count: 55, newThisMonth: 3, badCount: 0, recent: [{ author: 'Amber', rating: 5, comment: 'Very clean & professional!' }] },
    },
    effectiveness: 'low',
  };
  const content: ContentT = {
    channels: [{ name: 'gbp', verdict: 'weak', vi: 'Reach 0, cần kiểm tra', en: 'Reach 0' }, { name: 'facebook', verdict: 'ok', vi: 'Ổn định', en: 'Stable' }],
    highlights: [{ vi: 'Lumio Link vẫn tạo đặt lịch', en: 'Lumio Link still books' }],
    issues: [{ vi: 'GBP giảm ~100%', en: 'GBP down' }],
    insights: [{ vi: 'Sụt giảm mạnh so tháng 7', en: 'Sharp drop vs July' }],
    nextMonth: { content: [{ vi: 'Duy trì 12 bài/tháng', en: '12 posts/mo' }], ads: [{ vi: 'Ngân sách nhỏ', en: 'Small budget' }], growth: [{ vi: 'Khắc phục GBP', en: 'Fix GBP' }], kpi: [{ vi: 'GBP reach ≥ 200', en: 'GBP ≥ 200' }] },
  };
  return { data, content };
}

const money = (c: number) => `${(c / 100).toFixed(2)} US$`;

describe('the assembled document', () => {
  const { data, content } = fixture();
  const { document, footer, imageCount } = buildReportXml({ data, content, vi: true, salonName: 'Lux Nail Spa', money });

  it('every opened tag is closed — one mismatch and Word refuses the file', () => {
    for (const tag of ['w:tbl', 'w:tr', 'w:tc', 'w:p', 'w:r', 'w:rPr', 'w:pPr']) {
      const open = (document.match(new RegExp(`<${tag}[ >]`, 'g')) ?? []).length;
      const close = (document.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;
      expect(`${tag}:${open}`).toBe(`${tag}:${close}`);
    }
  });

  it('user text is escaped where it lands', () => {
    expect(document).toContain('Lux &lt;Nail&gt; &amp; Spa');
    expect(document).toContain('Very clean &amp; professional!');
    expect(document).not.toContain('Lux <Nail>');
  });

  it('is A4 portrait with the template’s content width and a numbered footer', () => {
    expect(document).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
    expect(document).toContain('rIdFooter');
    expect(footer).toContain('w:instr="PAGE"');
    expect(footer).toContain('Báo cáo Marketing Tháng 08/2026');
  });

  it('carries the full template: chapters, sections, verdict, sign-off', () => {
    for (const s of ['KẾT QUẢ KINH DOANH THÁNG', 'TỔNG QUAN HIỆU QUẢ', 'TĂNG TRƯỞNG NGƯỜI THEO DÕI', 'NỘI DUNG',
      'GOOGLE BUSINESS PROFILE', 'NGUỒN HIỂN THỊ', 'ĐÁNH GIÁ &amp; XẾP HẠNG',
      'TỔNG KẾT &amp; KẾ HOẠCH THÁNG TỚI', 'ĐÁNH GIÁ TỪNG KÊNH', 'INSIGHT NỔI BẬT',
      'Cần cải thiện', 'Cảm ơn quý khách đã đồng hành cùng Lumio Agency.']) {
      expect(document).toContain(s);
    }
  });

  it('the TikTok trap stays fixed in the Word file too', () => {
    expect(document).not.toContain('1209');
    expect(document).toContain('17.083');
  });

  it('no chart bytes → no image XML, and rels stay consistent', () => {
    expect(imageCount).toBe(0);
    expect(document).not.toContain('rIdImg');
  });

  it('with charts, drawings and media entries line up one-to-one', () => {
    const png = new Uint8Array([137, 80, 78, 71]);
    const img = { png, wCm: 12.5, hCm: 5 };
    const entries = buildReportEntries({ data, content, vi: true, salonName: 'Lux', money, images: { views: img, growth: img, audience: img, gbp: img } });
    const names = entries.map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/_rels/document.xml.rels', 'word/styles.xml', 'word/footer1.xml', 'word/media/image1.png', 'word/media/image4.png']));
    const doc = new TextDecoder().decode(entries.find((e) => e.name === 'word/document.xml')!.data);
    for (const rid of ['rIdImg1', 'rIdImg2', 'rIdImg3', 'rIdImg4']) expect(doc).toContain(rid);
    const rels = new TextDecoder().decode(entries.find((e) => e.name === 'word/_rels/document.xml.rels')!.data);
    for (const rid of ['rIdImg1', 'rIdImg2', 'rIdImg3', 'rIdImg4']) expect(rels).toContain(rid);
  });

  it('a month with no TikTok simply has no TikTok column', () => {
    const d2 = { ...data, socialInsights: (data.socialInsights ?? []).filter((s) => s.platform !== 'tiktok') };
    const { document: doc2 } = buildReportXml({ data: d2, content, vi: true, salonName: 'Lux', money });
    expect(doc2).not.toContain('TikTok</w:t>');
  });
});
