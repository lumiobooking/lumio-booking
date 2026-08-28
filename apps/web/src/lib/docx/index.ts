/**
 * "Xuất Word" — one call from the monthly report page.
 *
 * Assembles chart inputs the same way the print view does (Facebook growth
 * from monthly snapshots, Instagram from the daily series accumulated onto the
 * current total, GBP trend from synced months), paints them on canvas, builds
 * the .docx and hands it to the browser as a download. Charts that don't have
 * enough data simply don't appear — the document text explains why.
 */

import { chartAudience, chartGbp, chartGrowth, chartViews, GrowthSeries } from './charts';
import { buildReportDocx, ChartImage, ContentT, MonthlyT, monthLabel, pctOf, SocialT } from './report-docx';

export function growthSeriesOf(data: MonthlyT): GrowthSeries[] {
  const S = data.socialInsights ?? [];
  const fb = S.find((x) => x.platform === 'facebook');
  const ig = S.find((x) => x.platform === 'instagram');
  const out: GrowthSeries[] = [];
  const fbMs = fb?.monthlySeries ?? [];
  if (fbMs.length > 1) out.push({ name: 'Facebook', color: '#1877f2', values: fbMs.map((m) => m.followers), months: fbMs.map((m) => m.month) });
  const igDaily = ig?.series ?? [];
  if (igDaily.length > 1) {
    // Daily NEW followers → cumulative totals, anchored so the last point IS
    // today's follower count (the page's chart does exactly this).
    const vals = igDaily.map((x) => x.value || 0);
    let base = (ig?.followers ?? 0) - vals.reduce((a, b) => a + b, 0);
    const cum = vals.map((v) => (base += v));
    out.push({ name: 'Instagram', color: '#e1306c', values: cum, months: [igDaily[0]?.date ?? '', igDaily[igDaily.length - 1]?.date ?? ''] });
  } else {
    const igMs = ig?.monthlySeries ?? [];
    if (igMs.length > 1) out.push({ name: 'Instagram', color: '#e1306c', values: igMs.map((m) => m.followers), months: igMs.map((m) => m.month) });
  }
  return out;
}

export function viewItemsOf(data: MonthlyT): { label: string; value: number; color: string }[] {
  const S = data.socialInsights ?? [];
  const pick = (p: string): SocialT | undefined => S.find((x) => x.platform === p);
  return ([
    ['Facebook', pick('facebook'), '#1877f2'],
    ['Instagram', pick('instagram'), '#e1306c'],
    ['TikTok', pick('tiktok'), '#010101'],
  ] as [string, SocialT | undefined, string][])
    .filter(([, si]) => si?.views != null)
    .map(([label, si, color]) => ({ label, value: si?.views ?? 0, color }));
}

export async function renderCharts(data: MonthlyT, vi: boolean): Promise<{ views?: ChartImage; growth?: ChartImage; audience?: ChartImage; gbp?: ChartImage }> {
  const t = (v: string, e: string) => (vi ? v : e);
  const out: { views?: ChartImage; growth?: ChartImage; audience?: ChartImage; gbp?: ChartImage } = {};
  const ig = (data.socialInsights ?? []).find((x) => x.platform === 'instagram');

  const views = await chartViews(viewItemsOf(data), `${t('Lượt xem (Views) theo nền tảng', 'Views by platform')} — ${monthLabel(data.month, vi)}`, vi);
  if (views) out.views = views;

  const growth = await chartGrowth(growthSeriesOf(data), vi);
  if (growth) out.growth = growth;

  const aud = await chartAudience(ig?.audience?.gender, ig?.audience?.age, vi);
  if (aud) out.audience = aud;

  const g = data.gbp;
  if (g) {
    const series = (g.series ?? []).map((x) => ({ month: x.month, value: x.impressions || 0 }));
    const tot = g.impressions || 0;
    const rate = (v: number | null | undefined) => (tot > 0 && v != null ? Math.round((v / tot) * 1000) / 10 : null);
    const gbp = await chartGbp(series.length >= 2 ? series : [], [
      { label: t('Gọi điện', 'Calls'), value: rate(g.calls), color: '#4285F4' },
      { label: t('Chỉ đường', 'Directions'), value: rate(g.directions), color: '#34A853' },
      { label: t('Truy cập web', 'Website'), value: rate(g.websiteClicks), color: '#FBBC05' },
    ], vi);
    if (gbp) out.gbp = gbp;
  }
  return out;
}

export function docxFileName(salonName: string, month: string): string {
  const clean = (salonName || 'Lumio').replace(/[\\/:*?"<>|]/g, '').trim() || 'Lumio';
  const [y, m] = String(month || '').split('-');
  return `Bao cao Marketing - ${clean} - ${m}.${y}.docx`;
}

/** The button's handler. Returns the byte length (handy for a toast). */
export async function downloadReportDocx(args: { data: MonthlyT; content: ContentT; vi: boolean; salonName: string; month: string; money: (cents: number) => string }): Promise<number> {
  const images = await renderCharts(args.data, args.vi);
  const bytes = buildReportDocx({ data: args.data, content: args.content, vi: args.vi, salonName: args.salonName, money: args.money, images });
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = docxFileName(args.salonName, args.month);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return bytes.length;
}

export { pctOf };
