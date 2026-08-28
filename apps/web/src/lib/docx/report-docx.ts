/**
 * The monthly client report as a Word file — the same document, the same data.
 *
 * This builder takes EXACTLY what openPrint() takes (the Monthly payload, the
 * AI content block, language, the money formatter, the salon name) and emits
 * the zip entries of a .docx that mirrors the approved print template: navy
 * letterhead, numbered indigo section chips, chapter bands that open in the
 * flow, fixed-grid tables, chart images, a numbered footer, a sign-off block.
 *
 * It is deliberately synchronous and DOM-free: charts arrive pre-rendered as
 * PNG bytes (drawn on a canvas by charts.ts in the browser, absent in tests),
 * so every layout decision in here can be pinned by a plain node test.
 */

import {
  CM, PALETTE as C, chapterBand, contentTypesXml, documentRelsXml, documentXml,
  drawing, footerXml, para, rootRelsXml, run, sectionHead, stylesXml, tbl, tc, text, tr,
} from './oox';
import { ZipEntry, zipStore } from './zip';

// ---- the slice of the page's data model this document reads ----------------

export interface SocialDelta { value: number | null; prev: number | null; pct: number | null }
export interface DeltaT { value: number; prev: number; pct: number | null }
export interface PostRowT { type: string; caption: string | null; views: number | null; reach: number | null; likes: number | null; comments: number | null }
export interface SocialT {
  platform: string;
  followers: number | null; newFollowers: number | null; reach: number | null;
  views: number | null; engagement: number | null; postsCount: number | null;
  posts?: PostRowT[];
  monthlySeries?: { month: string; followers: number }[];
  series?: { date: string; value: number }[];
  audience?: { gender?: Record<string, number>; age?: Record<string, number> } | null;
  vsPrev?: { followers: SocialDelta | null; reach: SocialDelta | null; views: SocialDelta | null; engagement: SocialDelta | null; newFollowers: SocialDelta | null };
}
export interface GbpT {
  impressions?: number | null; mapsImpr?: number | null; searchImpr?: number | null;
  desktopImpr?: number | null; mobileImpr?: number | null;
  calls?: number | null; directions?: number | null; websiteClicks?: number | null;
  bookings?: number | null; conversations?: number | null;
  keywords?: { keyword: string; count: number | null }[];
  vsPrev?: { impressions: SocialDelta | null; calls: SocialDelta | null; directions: SocialDelta | null; websiteClicks: SocialDelta | null; bookings: SocialDelta | null; conversations: SocialDelta | null };
  series?: { month: string; impressions: number | null }[];
  reviews?: { rating: number | null; count: number | null; newThisMonth?: number | null; badCount?: number | null; recent?: { author: string; rating: number; comment: string }[] } | null;
}
export interface ItemT { vi: string; en: string }
export interface ContentT {
  channels?: { name: string; verdict: string; vi: string; en: string }[];
  highlights?: ItemT[]; issues?: ItemT[]; plan?: ItemT[]; insights?: ItemT[];
  tldr?: ItemT; summary?: ItemT;
  nextMonth?: { content?: ItemT[]; ads?: ItemT[]; growth?: ItemT[]; kpi?: ItemT[] };
}
export interface MonthlyT {
  month: string;
  outcome: { totals: { bookings: number; showed: number; revenueCents: number }; newCustomers: number };
  spend: { channel: string; amountCents: number }[];
  blended: { totalSpendCents: number; revenuePerSpend: number | null };
  deltas?: { bookings: DeltaT; showed: DeltaT; revenueCents: DeltaT; newCustomers: DeltaT; spendCents: DeltaT };
  socialInsights?: SocialT[];
  gbp?: GbpT;
  effectiveness?: 'good' | 'ok' | 'low' | 'organic';
}

export interface ChartImage { png: Uint8Array; wCm: number; hCm: number }
export interface ReportInput {
  data: MonthlyT;
  content: ContentT;
  vi: boolean;
  salonName: string;
  money: (cents: number) => string;
  images?: { views?: ChartImage; growth?: ChartImage; audience?: ChartImage; gbp?: ChartImage };
}

// ---- shared derivations (exported: the spec pins each one) ------------------

export const fmtNum = (n: number | null | undefined, vi: boolean): string =>
  n == null ? '—' : Number(n).toLocaleString(vi ? 'vi-VN' : 'en-US');

/** Engagement ÷ reach → views → followers; an answer above 100% is not an
 *  answer (TikTok ÷ 21 followers once printed "1209.5%" in a client PDF). */
export function engRate(x?: SocialT | null): string {
  if (!x || x.engagement == null) return '—';
  const denom = x.reach || x.views || x.followers;
  if (!denom) return '—';
  const r = Math.round((x.engagement / denom) * 1000) / 10;
  return r > 100 ? '—' : `${r}%`;
}

/** Top posts across FB + IG, by views — the same ranking the app shows. */
export function topPosts(fb: PostRowT[] | undefined, ig: PostRowT[] | undefined, n = 4): (PostRowT & { pf: 'FB' | 'IG' })[] {
  return [
    ...(fb ?? []).map((p) => ({ ...p, pf: 'FB' as const })),
    ...(ig ?? []).map((p) => ({ ...p, pf: 'IG' as const })),
  ].sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, n);
}

export const monthLabel = (month: string, vi: boolean): string => {
  const [y, m] = String(month || '').split('-');
  return vi ? `Tháng ${m}/${y}` : `${m}/${y}`;
};

export const pctOf = (part: number | null | undefined, total: number | null | undefined): number | null =>
  total && part != null ? Math.round((part / total) * 100) : null;

const deltaRun = (dl?: { pct: number | null } | null): string => {
  if (!dl || dl.pct == null) return '';
  const up = dl.pct >= 0;
  return run(` ${up ? '▲' : '▼'}${Math.abs(dl.pct)}%`, { b: true, size: 15, color: up ? C.GREEN : C.RED });
};

// ---- document assembly ------------------------------------------------------

const FULL = 17.4;

/** Value + caption + delta, stacked and centered — one KPI card cell. */
function kpiCell(w: number, value: string, cap: string, dl?: { pct: number | null } | null, tone?: string): string {
  const inner =
    para(run(value, { b: true, size: 30, color: tone || C.NAVY }), { after: 10, align: 'center' }) +
    para(run(cap, { size: 15, color: C.MUTED }) + deltaRun(dl), { after: 0, align: 'center' });
  return tc(CM(w), inner, { vAlign: 'center' });
}

/** A horizontal "bar" as a row of FULL BLOCK glyphs (U+2588) colored like
 *  text — no image needed. Not run-shading over spaces: renderers refuse to
 *  shade trailing whitespace, so a spaces-bar collapses to a sliver. */
function barPara(pct: number | null, color: string): string {
  const p = Math.max(0, Math.min(100, pct ?? 0));
  const chars = Math.max(1, Math.round((p / 100) * 34));
  return para(run('\u2588'.repeat(chars), { size: 15, color }), { after: 20 });
}

function bullet(mark: string, s: string, color?: string): string {
  return para(run(mark + '  ', { b: true, size: 20, color: color || C.BODY }) + run(s, { size: 20, color: C.BODY }), { after: 40, line: 276 });
}

export function buildReportXml(inp: ReportInput): { document: string; footer: string; imageCount: number } {
  const { data, content: c, vi, salonName, money } = inp;
  const t = (v: string, e: string) => (vi ? v : e);
  const L = (it?: ItemT | null) => ((vi ? it?.vi || it?.en : it?.en || it?.vi) || '');
  const f = (n: number | null | undefined) => fmtNum(n, vi);
  const S = data.socialInsights ?? [];
  const fb = S.find((x) => x.platform === 'facebook');
  const ig = S.find((x) => x.platform === 'instagram');
  const tt = S.find((x) => x.platform === 'tiktok');
  const parts: string[] = [];
  let imgN = 0;
  const image = (im?: ChartImage): string => {
    if (!im) return '';
    imgN += 1;
    return para(drawing(`rIdImg${imgN}`, imgN, im.wCm, im.hCm), { after: 60, align: 'center' });
  };

  // ---- letterhead ----
  const effMap: Record<string, [string, string]> = {
    good: [C.GREEN, t('Hiệu quả tốt', 'Performing well')],
    ok: ['2563EB', t('Đang có hiệu quả', 'On track')],
    low: [C.AMBER, t('Cần cải thiện', 'Needs work')],
    organic: [C.MUTED, t('Tăng trưởng tự nhiên', 'Organic growth')],
  };
  const [effColor, effLabel] = effMap[data.effectiveness || 'organic'];
  const mLabel = monthLabel(data.month, vi);
  const head =
    para(run(t('BÁO CÁO MARKETING THÁNG', 'MONTHLY MARKETING REPORT'), { b: true, size: 18, color: C.INDIGO }), { after: 20 }) +
    para(run(salonName || 'Lumio', { b: true, size: 44, color: C.NAVY }), { after: 20 }) +
    para(
      run(`Facebook · Instagram · TikTok · Google · ${mLabel} · `, { size: 19, color: C.MUTED }) +
      run(effLabel, { b: true, size: 19, color: effColor }),
      { after: 0 },
    );
  const chip = para(run('Lumio', { b: true, size: 26, color: C.INDIGO }), { align: 'center', after: 0 });
  parts.push(tbl([CM(13.9), CM(3.5)], tr(tc(CM(13.9), head) + tc(CM(3.5), chip, { fill: C.FILL_IND, vAlign: 'center' }))));
  parts.push(para('<w:r/>', { after: 30, ruleUnder: C.INDIGO }));

  // ---- 01 business outcome ----
  parts.push(sectionHead('01', t('KẾT QUẢ KINH DOANH THÁNG', 'BUSINESS RESULTS')));
  const o = data.outcome; const b = data.blended; const d = data.deltas;
  const roas = b?.revenuePerSpend;
  const w6 = FULL / 6;
  parts.push(tbl(
    Array(6).fill(CM(w6)),
    tr(
      kpiCell(w6, f(o.totals.bookings), t('Lượt đặt lịch', 'Bookings'), d?.bookings) +
      kpiCell(w6, f(o.totals.showed), t('Đã đến', 'Showed'), d?.showed) +
      kpiCell(w6, f(o.newCustomers), t('Khách mới', 'New customers'), d?.newCustomers) +
      kpiCell(w6, money(o.totals.revenueCents), t('Doanh thu', 'Revenue'), d?.revenueCents) +
      kpiCell(w6, money(b?.totalSpendCents ?? 0), t('Chi phí marketing', 'Marketing spend'), d?.spendCents) +
      kpiCell(w6, roas == null ? '—' : `${Math.round(roas * 100) / 100}×`, 'ROAS', null, roas == null ? undefined : roas >= 1 ? C.GREEN : C.AMBER),
    ),
    { borders: true },
  ));
  const spendRows = (data.spend ?? []).filter((x) => x.amountCents > 0).sort((a, z) => z.amountCents - a.amountCents);
  const CH: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', google_ads: 'Google Ads', gbp: 'Google Maps', seo: 'SEO', email: 'Email', sms: 'SMS', website: 'Website', other: t('Khác', 'Other') };
  if (spendRows.length) {
    parts.push(text(
      t('Chi tiết chi phí: ', 'Spend detail: ') + spendRows.map((x) => `${CH[x.channel] || x.channel} ${money(x.amountCents)}`).join(' · '),
      { size: 17, color: C.MUTED }, { before: 60, after: 40 },
    ));
  }

  // ---- 02 performance table ----
  parts.push(sectionHead('02', t('TỔNG QUAN HIỆU QUẢ', 'PERFORMANCE OVERVIEW')));
  const cols = tt ? [FULL - 3 * 3.6, 3.6, 3.6, 3.6] : [FULL - 2 * 3.9, 3.9, 3.9];
  const headCell = (w: number, label: string, color: string) =>
    tc(CM(w), para(run(label, { b: true, size: 19, color }), { align: 'center', after: 0 }), { fill: C.FILL_SOFT, vAlign: 'center' });
  const num = (w: number, v: string, dl?: SocialDelta | null, mutedNote?: boolean) =>
    tc(CM(w), para(run(v, { b: mutedNote ? false : true, size: mutedNote ? 15 : 20, color: mutedNote ? '94A3B8' : C.NAVY }) + deltaRun(dl), { align: 'center', after: 0 }), { vAlign: 'center' });
  const lbl = (s: string) => tc(CM(cols[0]), text(s, { size: 20, color: '475569' }, { after: 0 }), { vAlign: 'center' });
  const rows: string[] = [];
  rows.push(tr(tc(CM(cols[0]), para('<w:r/>', { after: 0 }), { fill: C.FILL_SOFT }) + headCell(cols[1], 'Facebook', C.FB) + headCell(cols[2], 'Instagram', C.IG) + (tt ? headCell(cols[3], 'TikTok', C.TT) : '')));
  const prow = (label: string, fv: string, fd?: SocialDelta | null, iv?: string, idv?: SocialDelta | null, tv?: string, tdv?: SocialDelta | null, fNote?: boolean, tNote?: boolean) =>
    rows.push(tr(lbl(label) + num(cols[1], fv, fd, fNote) + num(cols[2], iv ?? '—', idv) + (tt ? num(cols[3], tv ?? '—', tdv, tNote) : '')));
  prow(t('Tổng follower', 'Total followers'), f(fb?.followers), fb?.vsPrev?.followers, f(ig?.followers), ig?.vsPrev?.followers, f(tt?.followers), tt?.vsPrev?.followers);
  prow(t('Người tiếp cận (Reach)', 'Reach'), fb?.reach == null ? t('Meta ngừng cung cấp', 'retired by Meta') : f(fb?.reach), fb?.reach == null ? null : fb?.vsPrev?.reach, f(ig?.reach), ig?.vsPrev?.reach, t('Không áp dụng', 'n/a'), null, fb?.reach == null, true);
  prow(t('Lượt xem (Views)', 'Views'), f(fb?.views), fb?.vsPrev?.views, f(ig?.views), ig?.vsPrev?.views, f(tt?.views), tt?.vsPrev?.views);
  prow(t('Lượt tương tác', 'Engagements'), f(fb?.engagement), fb?.vsPrev?.engagement, f(ig?.engagement), ig?.vsPrev?.engagement, f(tt?.engagement), tt?.vsPrev?.engagement);
  prow(t('Tỉ lệ tương tác', 'Engagement rate'), engRate(fb), null, engRate(ig), null, engRate(tt), null);
  prow(t('Số follow mới', 'Net followers'), f(fb?.newFollowers), fb?.vsPrev?.newFollowers, f(ig?.newFollowers), ig?.vsPrev?.newFollowers, f(tt?.newFollowers), tt?.vsPrev?.newFollowers);
  parts.push(tbl(cols.map((w) => CM(w)), rows.join(''), { borders: true }));
  parts.push(image(inp.images?.views));

  // ---- 03 growth ----
  parts.push(sectionHead('03', t('TĂNG TRƯỞNG NGƯỜI THEO DÕI', 'FOLLOWER GROWTH')));
  if (inp.images?.growth) parts.push(image(inp.images.growth));
  else parts.push(text(t('Biểu đồ tăng trưởng theo tháng hiện khi có ≥2 tháng đồng bộ.', 'The growth chart appears once ≥2 months are synced.'), { size: 19, color: '94A3B8' }));

  // ---- 04 content ----
  parts.push(sectionHead('04', t('NỘI DUNG', 'CONTENT')));
  const igP = ig?.posts ?? []; const fbP = fb?.posts ?? [];
  const reels = igP.filter((x) => x.type === 'reel' || x.type === 'video').length;
  const fbReels = fbP.filter((x) => x.type === 'reel' || x.type === 'video').length;
  const fbTot = fb?.postsCount ?? (fbP.length || null);
  const cg = [FULL - 2 * 3.6, 3.6, 3.6];
  const crow = (label: string, a: string, bv: string) =>
    tr(lblc(label) + numc(a) + numc(bv));
  const lblc = (s: string) => tc(CM(cg[0]), text(s, { size: 20, color: '475569' }, { after: 0 }), { vAlign: 'center' });
  const numc = (v: string) => tc(CM(3.6), para(run(v, { b: true, size: 20, color: C.NAVY }), { align: 'center', after: 0 }), { vAlign: 'center' });
  parts.push(tbl(cg.map((w) => CM(w)),
    tr(tc(CM(cg[0]), para('<w:r/>', { after: 0 }), { fill: C.FILL_SOFT }) + headCell(3.6, 'FB', C.FB) + headCell(3.6, 'IG', C.IG)) +
    crow(t('Tổng bài', 'Total posts'), fbTot == null ? '—' : f(fbTot), f(ig?.postsCount ?? igP.length)) +
    crow('Reels/Video', fbP.length ? f(fbReels) : '—', f(reels)) +
    crow(t('Bài ảnh', 'Photos'), fbP.length ? f(fbP.length - fbReels) : '—', f(igP.length - reels)),
    { borders: true }));
  const top = topPosts(fbP, igP, 4);
  if (top.length) {
    parts.push(text(t('TOP BÀI (FB + IG) — theo lượt xem', 'TOP POSTS (FB + IG) — by views'), { b: true, size: 17, color: C.MUTED }, { before: 80, after: 30, keepNext: true }));
    for (const p of top) {
      const eng = (p.likes ?? 0) + (p.comments ?? 0);
      parts.push(para(
        run(` ${p.pf} `, { b: true, size: 15, color: C.WHITE, fill: p.pf === 'FB' ? C.FB : C.IG }) +
        run('  ' + (p.caption || (p.type === 'reel' ? 'Reel' : 'Post')).slice(0, 70) + '  —  ', { size: 19 }) +
        run(`${f(p.views)} ${t('xem', 'views')} · ${f(eng)} ${t('tương tác', 'eng')}`, { b: true, size: 17, color: C.MUTED }),
        { after: 30 },
      ));
    }
  }
  parts.push(image(inp.images?.audience));

  // ---- chapter B: GBP ----
  const g = data.gbp;
  if (g && (g.impressions != null || g.calls != null || g.directions != null || g.websiteClicks != null || g.bookings != null)) {
    parts.push(chapterBand('B', t('GOOGLE BUSINESS PROFILE — HIỆN DIỆN TRÊN GOOGLE & MAPS', 'GOOGLE BUSINESS PROFILE')));
    parts.push(sectionHead('01', t('TỔNG QUAN HIỆU QUẢ GBP', 'GBP PERFORMANCE')));
    const gv = g.vsPrev;
    const w3 = FULL / 3;
    const gcell = (label: string, sub: string, val: number | null | undefined, dl?: SocialDelta | null, tone?: string) =>
      tc(CM(w3),
        para(run(f(val), { b: true, size: 27, color: tone || C.NAVY }) + deltaRun(dl), { after: 6 }) +
        para(run(`${label} · ${sub}`, { size: 15, color: C.MUTED }), { after: 0 }),
      );
    parts.push(tbl([CM(w3), CM(w3), CM(w3)],
      tr(gcell(t('Lượt xem hồ sơ', 'Profile views'), 'Impressions', g.impressions, gv?.impressions, '1A73E8') +
        gcell(t('Lượt gọi điện', 'Calls'), 'Call clicks', g.calls, gv?.calls) +
        gcell(t('Lượt chỉ đường', 'Directions'), 'Directions', g.directions, gv?.directions)) +
      tr(gcell(t('Truy cập web', 'Website clicks'), 'Website', g.websiteClicks, gv?.websiteClicks) +
        gcell(t('Lượt đặt lịch', 'Bookings'), 'Reserve with Google', g.bookings, gv?.bookings) +
        gcell(t('Lượt nhắn tin', 'Messages'), 'Conversations', g.conversations, gv?.conversations)),
      { borders: true }));
    parts.push(sectionHead('02', t('NGUỒN HIỂN THỊ', 'WHERE SEEN')));
    const tot = g.impressions || 0;
    const srcLine = (label: string, val: number | null | undefined, color: string) => {
      const p2 = pctOf(val ?? null, tot);
      parts.push(para(run(`${label}: `, { size: 19, color: '475569' }) + run(`${f(val ?? null)}${p2 != null ? ` · ${p2}%` : ''}`, { b: true, size: 19, color: C.NAVY }), { after: 10, keepNext: true }));
      parts.push(barPara(p2, color));
    };
    srcLine(t('Trên Tìm kiếm', 'On Search'), g.searchImpr, '4285F4');
    srcLine(t('Trên Maps', 'On Maps'), g.mapsImpr, '34A853');
    srcLine('Mobile', g.mobileImpr, '5B8DEF');
    srcLine('Desktop', g.desktopImpr, '9BB8F0');
    const kw = (g.keywords || []).slice(0, 6);
    if (kw.length) parts.push(text(t('Từ khoá khách tìm: ', 'Top searches: ') + kw.map((k) => `${k.keyword} (${f(k.count)})`).join(' · '), { size: 17, color: C.MUTED }, { after: 60 }));
    else parts.push(text(t('Từ khoá khách tìm: chưa có dữ liệu tháng này.', 'Top searches: no data this month.'), { size: 17, color: '94A3B8' }, { after: 60 }));
    parts.push(sectionHead('03', t('XU HƯỚNG & TỶ LỆ HÀNH ĐỘNG', 'TREND & ACTION RATES')));
    if (inp.images?.gbp) parts.push(image(inp.images.gbp));
    else {
      const rate = (label: string, val: number | null | undefined, color: string) => {
        const r = tot > 0 && val != null ? Math.round((val / tot) * 1000) / 10 : null;
        parts.push(para(run(`${label}: `, { size: 19, color: '475569' }) + run(r != null ? `${r}%` : '—', { b: true, size: 19, color: C.NAVY }), { after: 10, keepNext: true }));
        parts.push(barPara(r, color));
      };
      rate(t('Gọi điện', 'Calls'), g.calls, '4285F4');
      rate(t('Chỉ đường', 'Directions'), g.directions, '34A853');
      rate(t('Truy cập web', 'Website'), g.websiteClicks, 'FBBC05');
    }
    const rv = g.reviews;
    if (rv && (rv.rating != null || rv.count != null)) {
      parts.push(sectionHead('04', t('ĐÁNH GIÁ & XẾP HẠNG', 'REVIEWS & RATING')));
      const stars = '★'.repeat(Math.max(0, Math.min(5, Math.round(rv.rating || 0))));
      const wR = FULL / 3;
      parts.push(tbl([CM(wR), CM(wR), CM(wR)],
        tr(
          tc(CM(wR), para(run(`${rv.rating ?? '—'} `, { b: true, size: 34, color: C.NAVY }) + run(stars, { size: 22, color: C.GOLD }), { after: 4 }) + para(run(`${f(rv.count)} ${t('đánh giá', 'reviews')}`, { size: 15, color: C.MUTED }), { after: 0 })) +
          tc(CM(wR), para(run(rv.newThisMonth != null ? `+${f(rv.newThisMonth)}` : '—', { b: true, size: 30, color: '16A34A' }), { after: 4 }) + para(run(t('review mới tháng này', 'new this month'), { size: 15, color: C.MUTED }), { after: 0 })) +
          tc(CM(wR), para(run(rv.badCount != null ? f(rv.badCount) : '—', { b: true, size: 30, color: (rv.badCount || 0) > 0 ? C.RED : C.NAVY }), { after: 4 }) + para(run(t('review xấu (≤2★)', 'bad (≤2★)'), { size: 15, color: C.MUTED }), { after: 0 })),
        ), { borders: true }));
      for (const r of (rv.recent || []).slice(0, 2)) {
        parts.push(para(
          run(`${r.author || ''} `, { b: true, size: 19 }) + run('★'.repeat(Math.max(0, Math.min(5, r.rating || 0))), { size: 17, color: C.GOLD }) +
          run(`  “${(r.comment || '').slice(0, 110)}”`, { i: true, size: 18, color: '475569' }),
          { after: 30 },
        ));
      }
    }
  }

  // ---- chapter C: summary & plan ----
  parts.push(chapterBand('C', t('TỔNG KẾT & KẾ HOẠCH THÁNG TỚI — TẤT CẢ KÊNH', 'SUMMARY & NEXT-MONTH PLAN')));
  const vColor: Record<string, string> = { good: C.GREEN, ok: '2563EB', weak: C.AMBER, nodata: C.MUTED };
  const vTxt = (v: string) => (({ good: t('Tốt', 'Good'), ok: t('Ổn', 'OK'), weak: t('Yếu', 'Weak'), nodata: t('Chưa đủ dữ liệu', 'No data') } as Record<string, string>)[v] || v);
  const chs = c.channels ?? [];
  if (chs.length) {
    parts.push(sectionHead('01', t('ĐÁNH GIÁ TỪNG KÊNH', 'CHANNEL VERDICTS')));
    const half = FULL / 2;
    const cell = (ch?: { name: string; verdict: string; vi: string; en: string }) => ch
      ? tc(CM(half),
        para(run(CH[ch.name] || ch.name, { b: true, size: 20, color: C.NAVY }) + run(' · ' + vTxt(ch.verdict), { b: true, size: 20, color: vColor[ch.verdict] || C.MUTED }), { after: 20, keepNext: true }) +
        para(run(L(ch), { size: 19, color: C.BODY }), { after: 0, line: 264 }),
        { fill: C.FILL_SOFT })
      : tc(CM(half), para('<w:r/>', { after: 0 }));
    for (let i = 0; i < chs.length; i += 2) parts.push(tbl([CM(half), CM(half)], tr(cell(chs[i]) + cell(chs[i + 1])), { borders: true }));
  }
  parts.push(sectionHead('02', t('ĐÁNH GIÁ CHUNG', 'OVERALL')));
  const hi = c.highlights ?? []; const iss = c.issues ?? [];
  if (hi.length) {
    parts.push(text(t('Điểm tích cực', 'What went well'), { b: true, size: 19, color: '166534' }, { after: 20, keepNext: true }));
    for (const x of hi) parts.push(bullet('✓', L(x), C.GREEN));
  }
  if (iss.length) {
    parts.push(text(t('Điểm cần cải thiện', 'Needs attention'), { b: true, size: 19, color: C.AMBER }, { before: 60, after: 20, keepNext: true }));
    for (const x of iss) parts.push(bullet('▲', L(x), C.AMBER));
  }
  if (!hi.length && !iss.length) parts.push(text('—', { size: 19, color: '94A3B8' }));
  const insights = (c.insights ?? []).map((x) => L(x)).filter(Boolean);
  const tl = L(c.tldr) || L(c.summary);
  if (insights.length || tl) {
    parts.push(sectionHead('03', t('INSIGHT NỔI BẬT', 'KEY INSIGHTS')));
    if (insights.length) for (const s of insights) parts.push(bullet('•', s));
    else parts.push(text(tl, { size: 20, color: C.BODY }, { line: 276 }));
  }
  const nm = c.nextMonth;
  parts.push(sectionHead('04', t('KẾ HOẠCH & ĐỊNH HƯỚNG THÁNG TIẾP THEO', 'NEXT-MONTH PLAN')));
  const groups: [string, string, ItemT[] | undefined][] = [
    [t('NỘI DUNG', 'CONTENT'), '2563EB', nm?.content],
    [t('QUẢNG CÁO', 'ADS'), C.INDIGO, nm?.ads],
    [t('TĂNG TRƯỞNG', 'GROWTH'), C.GREEN, nm?.growth],
    [t('KPI THÁNG SAU', 'NEXT KPIs'), C.AMBER, nm?.kpi],
  ];
  if (groups.some(([, , items]) => (items ?? []).length)) {
    const half = FULL / 2;
    const gcell2 = ([label, color, items]: [string, string, ItemT[] | undefined]) =>
      tc(CM(half),
        para(run(label, { b: true, size: 18, color }), { after: 30, keepNext: true }) +
        ((items ?? []).map((x) => para(run(L(x), { size: 18, color: C.BODY }), { after: 20, line: 264 })).join('') || text('—', { size: 18, color: '94A3B8' }, { after: 0 })),
      );
    parts.push(tbl([CM(half), CM(half)], tr(gcell2(groups[0]) + gcell2(groups[1])) + tr(gcell2(groups[2]) + gcell2(groups[3])), { borders: true }));
  } else if ((c.plan ?? []).length) {
    for (const x of c.plan ?? []) parts.push(bullet('→', L(x), C.INDIGO));
  } else {
    parts.push(text('—', { size: 19, color: '94A3B8' }));
  }

  // ---- sign-off ----
  parts.push(para('<w:r/>', { after: 120 }));
  parts.push(tbl([CM(FULL)], tr(tc(CM(FULL),
    para(run(t('Cảm ơn quý khách đã đồng hành cùng Lumio Agency.', 'Thank you for partnering with Lumio Agency.'), { b: true, size: 21, color: C.NAVY }), { after: 20 }) +
    para(run(t('Mọi thắc mắc về số liệu trong báo cáo, vui lòng liên hệ: ', 'Questions about any number in this report: '), { size: 18, color: C.MUTED }) + run('lumioagency.com@gmail.com', { b: true, size: 18, color: C.INDIGO }), { after: 0 }),
    { fill: C.FILL_SOFT }))));

  const footerLabel = `Lumio Agency · ${t('Báo cáo Marketing', 'Marketing report')} ${mLabel} · ${t('Trang', 'Page')}`;
  return { document: documentXml(parts.join('')), footer: footerXml(footerLabel), imageCount: imgN };
}

/** All zip entries of the finished .docx, ready for zipStore(). */
export function buildReportEntries(inp: ReportInput): ZipEntry[] {
  const { document, footer, imageCount } = buildReportXml(inp);
  const enc = new TextEncoder();
  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: enc.encode(contentTypesXml(imageCount)) },
    { name: '_rels/.rels', data: enc.encode(rootRelsXml()) },
    { name: 'word/document.xml', data: enc.encode(document) },
    { name: 'word/_rels/document.xml.rels', data: enc.encode(documentRelsXml(imageCount)) },
    { name: 'word/styles.xml', data: enc.encode(stylesXml()) },
    { name: 'word/footer1.xml', data: enc.encode(footer) },
  ];
  // Media entries in the exact order the drawings were numbered.
  const imgs = [inp.images?.views, inp.images?.growth, inp.images?.audience, inp.images?.gbp].filter((x): x is ChartImage => !!x);
  imgs.forEach((im, i) => entries.push({ name: `word/media/image${i + 1}.png`, data: im.png }));
  return entries;
}

export function buildReportDocx(inp: ReportInput): Uint8Array {
  return zipStore(buildReportEntries(inp));
}
