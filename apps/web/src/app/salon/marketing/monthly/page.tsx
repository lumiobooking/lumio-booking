'use client';

import { useCallback, useEffect, useRef, useState, CSSProperties } from 'react';
import { SalonShell } from '../../../../components/SalonShell';
import { useAuth } from '../../../../lib/auth';
import { apiFetch } from '../../../../lib/api';
import { ui, formatPrice } from '../../../../lib/ui';
import { useLang } from '../../../../lib/i18n';
import { uiLocale } from '../../../../lib/datetime';

interface SpendRow { id?: string; channel: string; amountCents: number; reach?: number | null; clicks?: number | null; leads?: number | null; }
interface WorkRow { id: string; category: string; title: string; createdAt: string; }
interface Blended { totalSpendCents: number; costPerBookingCents: number | null; costPerShowedCents: number | null; costPerNewCustomerCents: number | null; revenuePerSpend: number | null; }
interface Delta { value: number; prev: number; pct: number | null }
interface Monthly {
  month: string;
  range?: { from: string; to: string };
  outcome: { totals: { bookings: number; showed: number; revenueCents: number }; newCustomers: number; owned: Record<string, number>; gbp?: { bookings: number; showed: number; revenueCents: number }; channels: { key: string; bookings: number; showed: number; revenueCents: number }[] };
  spend: SpendRow[]; workLog: WorkRow[]; blended: Blended;
  prevMonth?: string;
  deltas?: { bookings: Delta; showed: Delta; revenueCents: Delta; newCustomers: Delta; spendCents: Delta };
  channelTrends?: { channel: string; spend: Delta | null; reach: Delta | null; clicks: Delta | null; leads: Delta | null }[];
  socialInsights?: SocialInsight[];
  gbp?: GbpData;
  effectiveness?: 'good' | 'ok' | 'low' | 'organic';
}
interface Item { vi: string; en: string }
interface ChEval { name: string; verdict: 'good' | 'ok' | 'weak' | 'nodata'; vi: string; en: string }
interface Content { headline?: Item; tldr?: Item; summary?: Item; channels?: ChEval[]; highlights?: Item[]; issues?: Item[]; plan?: Item[]; insights?: Item[]; nextMonth?: { content?: Item[]; ads?: Item[]; growth?: Item[]; kpi?: Item[] }; _aiUnavailable?: boolean; _aiError?: string }
interface Report { periodMonth: string; status: string; content: Content; aiModel?: string | null; approvedAt?: string | null; }
interface AutoStatus {
  enabled: boolean;
  months: { month: string; label: string; status: string | null; createdAt: string | null; approvedAt: string | null; sentAt: string | null }[];
  lastNotice: { month: string | null; recipient: string; status: string; at: string } | null;
}
interface SocialDelta { value: number | null; prev: number | null; pct: number | null }
interface GbpData {
  impressions?: number | null; mapsImpr?: number | null; searchImpr?: number | null; desktopImpr?: number | null; mobileImpr?: number | null;
  calls?: number | null; directions?: number | null; websiteClicks?: number | null; bookings?: number | null; conversations?: number | null;
  keywords?: { keyword: string; count: number | null }[];
  vsPrev?: { impressions: SocialDelta | null; calls: SocialDelta | null; directions: SocialDelta | null; websiteClicks: SocialDelta | null; bookings: SocialDelta | null; conversations: SocialDelta | null };
  series?: { month: string; impressions: number | null; calls: number | null; directions: number | null; websiteClicks: number | null; bookings: number | null }[];
  reviews?: { rating: number | null; count: number | null; newThisMonth?: number | null; badCount?: number | null; manual?: boolean; source?: string; syncedAt?: string; recent?: { author: string; rating: number; comment: string; time?: string }[] } | null;
}
interface PostRow { id: string; type: string; timestamp: string | null; permalink: string | null; thumbnail: string | null; caption: string | null; likes: number | null; comments: number | null; reach: number | null; views: number | null; saved: number | null; shares: number | null; interactions: number | null }
interface SocialInsight {
  platform: string;
  followers: number | null; newFollowers: number | null;
  reach: number | null; views: number | null; engagement: number | null;
  profileViews: number | null; postsCount: number | null;
  posts?: PostRow[];
  series?: { date: string; value: number }[];
  monthlySeries?: { month: string; followers: number }[];
  audience?: { gender?: Record<string, number>; age?: Record<string, number> } | null;
  fbDebug?: { count: number; status: number; error: string | null } | null;
  vsPrev?: { followers: SocialDelta | null; reach: SocialDelta | null; views: SocialDelta | null; engagement: SocialDelta | null; newFollowers: SocialDelta | null };
}

const CHANNELS = ['facebook', 'instagram', 'tiktok', 'google_ads', 'gbp', 'seo', 'email', 'sms', 'website', 'other'];
const CH_LABEL: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', google_ads: 'Google Ads', gbp: 'Google Maps', seo: 'SEO', email: 'Email', sms: 'SMS', website: 'Website', other: 'Khác / Other' };
const thisMonth = () => new Date().toISOString().slice(0, 7);

export default function MarketingMonthlyPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const T = (v: string, e: string) => (vi ? v : e);

  const [month, setMonth] = useState(thisMonth());
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [data, setData] = useState<Monthly | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [auto, setAuto] = useState<AutoStatus | null>(null);
  const [currency, setCurrency] = useState('USD');
  const [spendDraft, setSpendDraft] = useState<Record<string, SpendRow>>({});
  const [showMetrics, setShowMetrics] = useState(false);
  const [wTitle, setWTitle] = useState(''); const [wCat, setWCat] = useState('post');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [salonName, setSalonName] = useState('');
  const [tt, setTt] = useState<{ followers: string; newFollowers: string; views: string; engagement: string; postsCount: string }>({ followers: '', newFollowers: '', views: '', engagement: '', postsCount: '' });
  const [gr, setGr] = useState<{ rating: string; totalReviews: string; newReviews: string; badReviews: string }>({ rating: '', totalReviews: '', newReviews: '', badReviews: '' });
  const money = (c: number) => formatPrice(c, currency);

  // "Tải Word" — the same report as the print view, as a real .docx the owner
  // can rebalance freely. Charts are painted on canvas at click time; the docx
  // library itself is dynamically imported so report readers who never export
  // don't download it.
  const [wordBusy, setWordBusy] = useState(false);
  const exportWord = async () => {
    if (!data || wordBusy) return;
    setWordBusy(true);
    try {
      const { downloadReportDocx } = await import('../../../../lib/docx');
      await downloadReportDocx({ data, content: report?.content ?? {}, vi, salonName, month, money });
    } catch (e) { setError(e instanceof Error ? e.message : 'docx error'); }
    finally { setWordBusy(false); }
  };

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [d, r, settings, a] = await Promise.all([
        apiFetch<Monthly>(`/marketing/monthly?month=${month}`, { token }),
        apiFetch<Report | null>(`/marketing/report?month=${month}`, { token }).catch(() => null),
        apiFetch<{ booking?: { currency?: string }; company?: { name?: string } }>('/settings', { token }).catch(() => ({} as { booking?: { currency?: string }; company?: { name?: string } })),
        apiFetch<AutoStatus>('/marketing/auto-status', { token }).catch(() => null),
      ]);
      setData(d); setReport(r); setAuto(a);
      if (settings?.booking?.currency) setCurrency(settings.booking.currency);
      if (settings?.company?.name) setSalonName(settings.company.name);
      const draft: Record<string, SpendRow> = {};
      for (const ch of CHANNELS) { const ex = d.spend.find((s) => s.channel === ch); draft[ch] = ex ? { ...ex } : { channel: ch, amountCents: 0 }; }
      setSpendDraft(draft);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, [token, month]);
  useEffect(() => { load(); }, [load]);

  // Auto-generate the AI analysis the first time a month is opened with no report yet.
  const autoTried = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!token || loading || busy) return;
    if (report) return;                 // a report row already exists (even if AI failed) — don't loop
    if (!data) return;
    const hasData =
      (data.socialInsights?.length ?? 0) > 0 ||
      (data.spend?.length ?? 0) > 0 ||
      (data.outcome?.totals?.bookings ?? 0) > 0;
    if (!hasData) return;               // nothing to analyse yet
    if (autoTried.current.has(month)) return;
    autoTried.current.add(month);
    generate();                         // fills OVERALL ASSESSMENT / KEY INSIGHTS / NEXT-MONTH PLAN
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, loading, busy, report, data, month]);

  useEffect(() => {
    const t = (data?.socialInsights ?? []).find((x) => x.platform === 'tiktok');
    setTt(t ? { followers: t.followers?.toString() ?? '', newFollowers: t.newFollowers?.toString() ?? '', views: t.views?.toString() ?? '', engagement: t.engagement?.toString() ?? '', postsCount: t.postsCount?.toString() ?? '' } : { followers: '', newFollowers: '', views: '', engagement: '', postsCount: '' });
    const gp = data?.gbp?.reviews;
    setGr(gp ? { rating: gp.rating?.toString() ?? '', totalReviews: gp.count?.toString() ?? '', newReviews: gp.newThisMonth?.toString() ?? '', badReviews: gp.badCount?.toString() ?? '' } : { rating: '', totalReviews: '', newReviews: '', badReviews: '' });
  }, [data]);
  async function saveManualTt() {
    setBusy('ttmanual'); setMsg(null); setError(null);
    try {
      const numOr = (v: string) => (v.trim() === '' ? null : Number(v));
      await apiFetch('/marketing/social-manual', { method: 'POST', token, body: { platform: 'tiktok', month, followers: numOr(tt.followers), newFollowers: numOr(tt.newFollowers), views: numOr(tt.views), engagement: numOr(tt.engagement), postsCount: numOr(tt.postsCount) } });
      setMsg(T('Đã lưu số liệu TikTok tháng ' + month + ' — bấm "Tạo báo cáo bằng AI" để phân tích.', 'TikTok numbers saved for ' + month + ' — click Generate to analyse.')); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'error'); } finally { setBusy(null); }
  }
  async function saveGbpReviews() {
    setBusy('grev'); setMsg(null); setError(null);
    try {
      const numOr = (v: string) => (v.trim() === '' ? null : Number(v));
      await apiFetch('/marketing/gbp-reviews', { method: 'POST', token, body: { month, rating: numOr(gr.rating), totalReviews: numOr(gr.totalReviews), newReviews: numOr(gr.newReviews), badReviews: numOr(gr.badReviews) } });
      setMsg(T('Đã lưu đánh giá Google tháng ' + month + '.', 'Google reviews saved for ' + month + '.')); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'error'); } finally { setBusy(null); }
  }
  async function saveSpend() {
    setBusy('spend'); setMsg(null); setError(null);
    try {
      const changed = CHANNELS.map((ch) => spendDraft[ch]).filter((r) => r && (r.amountCents > 0 || r.reach || r.clicks || r.leads || r.id));
      for (const r of changed) {
        await apiFetch('/marketing/spend', { method: 'POST', token, body: { channel: r.channel, periodMonth: month, amountCents: r.amountCents, reach: r.reach ?? null, clicks: r.clicks ?? null, leads: r.leads ?? null } });
      }
      setMsg(T('Đã lưu chi phí.', 'Spend saved.')); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'error'); } finally { setBusy(null); }
  }
  async function addWork() {
    if (!wTitle.trim()) return;
    setBusy('work');
    try { await apiFetch('/marketing/worklog', { method: 'POST', token, body: { periodMonth: month, category: wCat, title: wTitle.trim() } }); setWTitle(''); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'error'); } finally { setBusy(null); }
  }
  async function delWork(id: string) {
    try { await apiFetch(`/marketing/worklog/${id}`, { method: 'DELETE', token }); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'error'); }
  }
  async function generate() {
    setBusy('gen'); setMsg(null); setError(null);
    try {
      const r = await apiFetch<Report & { aiUsed?: boolean; aiError?: string | null }>('/marketing/report/generate', { method: 'POST', token, body: { month } });
      setReport(r);
      setMsg(r.aiUsed ? T('AI đã viết nháp — kiểm tra & duyệt.', 'AI drafted it — review & approve.') : (T('AI không chạy được: ', 'AI could not run: ') + (r.aiError || 'unknown')));
    } catch (e) { setError(e instanceof Error ? e.message : 'error'); } finally { setBusy(null); }
  }
  async function saveReport(content: Content) {
    setBusy('save'); setMsg(null);
    try { const r = await apiFetch<Report>('/marketing/report', { method: 'PATCH', token, body: { month, content } }); setReport(r); setMsg(T('Đã lưu.', 'Saved.')); }
    catch (e) { setError(e instanceof Error ? e.message : 'error'); } finally { setBusy(null); }
  }
  async function approve() {
    setBusy('approve');
    try { const r = await apiFetch<Report>('/marketing/report/approve', { method: 'POST', token, body: { month } }); setReport(r); setMsg(T('Đã duyệt.', 'Approved.')); }
    catch (e) { setError(e instanceof Error ? e.message : 'error'); } finally { setBusy(null); }
  }

  const b = data?.blended;
  const showBlended = (b?.totalSpendCents ?? 0) > 0;

  if (loading && !data) return <section><h2 style={{ fontSize: 18 }}>{T('Báo cáo tháng', 'Monthly report')}</h2><p style={{ color: 'var(--c94a3b8)' }}>Loading…</p></section>;

  return (
    <section style={{ maxWidth: 1040, margin: '0 auto' }}>
      <MktTabs vi={vi} active="monthly" />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h2 style={{ fontSize: 18, margin: 0 }}>{T('Báo cáo marketing tháng', 'Monthly marketing report')}</h2>
          <p style={{ color: 'var(--c94a3b8)', margin: '4px 0 0', fontSize: 13 }}>{T('Nhập chi phí + công việc → AI viết nháp → duyệt → gửi khách.', 'Enter spend + work → AI drafts it → review → send to the client.')}</p>
        </div>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={dateInput} />
      </div>

      {error && <div style={ui.banner}>{error}</div>}
      {msg && <div style={{ ...ui.banner, background: 'var(--c064e3b)', borderColor: '#059669', color: 'var(--cd1fae5)' }}>{msg}</div>}

      <div style={{ display: 'inline-flex', background: 'var(--c1e293b)', border: '1px solid var(--c334155)', borderRadius: 8, padding: 3, marginBottom: 16 }}>
        <button onClick={() => setMode('view')} style={segBtn(mode === 'view')}>{T('Xem báo cáo', 'View report')}</button>
        <button onClick={() => setMode('edit')} style={segBtn(mode === 'edit')}>{T('Chỉnh sửa', 'Edit')}</button>
      </div>

      {mode === 'view' && <ReportView data={data} content={report?.content ?? null} vi={vi} money={money} onEdit={() => setMode('edit')} onPrint={() => openPrint(data, report?.content ?? {}, vi, money, salonName)} onWord={exportWord} wordBusy={wordBusy} T={T} />}

      {mode === 'edit' && (<>

      {/* Blended KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
        <Kpi label={T('Tổng chi marketing', 'Total spend')} value={money(b?.totalSpendCents ?? 0)} />
        <Kpi label={T('Doanh thu (từ lịch)', 'Revenue (booked)')} value={money(data?.outcome.totals.revenueCents ?? 0)} accent="#22c55e" />
        <Kpi label={T('Chi phí / khách mới', 'Cost / new customer')} value={showBlended && b?.costPerNewCustomerCents != null ? money(b.costPerNewCustomerCents) : '—'} hint={showBlended ? undefined : T('cần nhập chi phí', 'enter spend')} />
        <Kpi label={T('Mỗi $1 chi → doanh thu', 'Revenue per $1')} value={showBlended && b?.revenuePerSpend != null ? `$${b.revenuePerSpend}` : '—'} accent="#22c55e" hint={showBlended ? undefined : T('cần nhập chi phí', 'enter spend')} />
      </div>
      <p style={{ color: 'var(--c64748b)', fontSize: 11.5, margin: '-6px 0 16px', lineHeight: 1.5 }}>
        {T('Chỉ số tổng hợp (blended): tổng chi ÷ kết quả thật. Chưa tách được "quảng cáo nào ra booking nào" — phần đó cần gắn UTM (Giai đoạn 2).',
           'Blended metrics: total spend ÷ real outcome. We cannot yet attribute a specific ad to a specific booking — that needs UTM (Phase 2).')}
      </p>

      {/* Connected channels (Phase 3) */}
      <ChannelsSection token={token} vi={vi} month={month} onSynced={load} />

      {/* TikTok manual entry — until the TikTok API is connected */}
      <div style={{ ...ui.card, marginBottom: 16 }}>
        <div style={cardTitle}>{T('TikTok — nhập số liệu tay', 'TikTok — manual numbers')}</div>
        <p style={{ color: 'var(--c64748b)', fontSize: 11.5, margin: '2px 0 10px', lineHeight: 1.5 }}>{T('Nhập số của CẢ THÁNG (đầu tháng → cuối tháng). Hệ thống tự so với tháng trước và AI phân tích. Dùng tạm khi chưa duyệt API TikTok — nối API xong sẽ tự thay số.', 'Enter WHOLE-MONTH totals (1st to last day). The system compares vs last month and AI analyses. Use until the TikTok API is approved — connecting the API later replaces these.')}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
          {(([['followers', T('Follower (tổng)', 'Followers (total)')], ['newFollowers', T('Follower mới', 'New followers')], ['views', T('Tổng lượt xem', 'Total views')], ['engagement', T('Tổng tương tác', 'Total engagement')], ['postsCount', T('Số video đăng', 'Videos posted')]]) as [keyof typeof tt, string][]).map(([k, label]) => (
            <label key={k} style={{ fontSize: 11.5, color: 'var(--c94a3b8)' }}>{label}
              <input type="number" inputMode="numeric" value={tt[k]} onChange={(e) => setTt({ ...tt, [k]: e.target.value })} style={{ ...inp, marginTop: 4 }} />
            </label>
          ))}
        </div>
        <button onClick={saveManualTt} disabled={busy === 'ttmanual'} style={{ ...ui.primaryBtn, marginTop: 10 }}>{busy === 'ttmanual' ? '…' : T('Lưu số liệu TikTok', 'Save TikTok numbers')}</button>
      </div>

      {/* Google reviews — automatic from mirrored reviews, with a manual override */}
      <div style={{ ...ui.card, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={cardTitle}>{T('Google — Đánh giá', 'Google — Reviews')}</div>
          {(() => {
            const rv = data?.gbp?.reviews;
            if (!rv) return <span style={{ fontSize: 11, color: 'var(--c64748b)', border: '1px solid var(--c334155)', borderRadius: 999, padding: '1px 9px' }}>{T('chưa có số', 'no data')}</span>;
            const auto = rv.manual !== true;
            return (
              <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '1px 9px', color: auto ? '#22c55e' : '#f59e0b', border: `1px solid ${auto ? '#22c55e' : '#f59e0b'}` }}>
                {auto ? T('TỰ ĐỘNG', 'AUTOMATIC') : T('ĐANG NHẬP TAY', 'MANUAL OVERRIDE')}
              </span>
            );
          })()}
        </div>
        <p style={{ color: 'var(--c64748b)', fontSize: 11.5, margin: '2px 0 10px', lineHeight: 1.5 }}>
          {data?.gbp?.reviews && data.gbp.reviews.manual !== true
            ? T('Số này tự tính từ các đánh giá Google đã đồng bộ trong mục "Google reviews" (điểm trung bình, tổng số, review mới trong tháng, review ≤2★). Chỉ nhập tay nếu muốn ghi đè.',
                'These figures are computed from the Google reviews already synced in "Google reviews" (average rating, total, new this month, ≤2★). Type below only to override.')
            : T('Đang ghi đè bằng số nhập tay. Muốn quay lại số tự động: xoá trống cả 4 ô rồi bấm Lưu. Chưa kết nối đồng bộ đánh giá? Vào Reviews & rewards → Google reviews để kết nối.',
                'Manual numbers are overriding the automatic ones. To go back to automatic: clear all four boxes and Save. Not syncing reviews yet? Connect it in Reviews & rewards → Google reviews.')}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
          {(([['rating', T('Điểm trung bình (vd 4.8)', 'Avg rating (e.g. 4.8)')], ['totalReviews', T('Tổng số review', 'Total reviews')], ['newReviews', T('Review mới trong tháng', 'New reviews this month')], ['badReviews', T('Review xấu (≤2★)', 'Bad reviews (≤2★)')]]) as [keyof typeof gr, string][]).map(([k, label]) => (
            <label key={k} style={{ fontSize: 11.5, color: 'var(--c94a3b8)' }}>{label}
              <input type="number" inputMode="decimal" value={gr[k]} onChange={(e) => setGr({ ...gr, [k]: e.target.value })} style={{ ...inp, marginTop: 4 }} />
            </label>
          ))}
        </div>
        <button onClick={saveGbpReviews} disabled={busy === 'grev'} style={{ ...ui.primaryBtn, marginTop: 10 }}>{busy === 'grev' ? '…' : T('Lưu đánh giá Google', 'Save Google reviews')}</button>
        {data?.gbp?.reviews?.syncedAt && data.gbp.reviews.manual !== true && (
          <span style={{ fontSize: 11, color: 'var(--c64748b)', marginLeft: 10 }}>
            {T('cập nhật ', 'updated ')}{new Date(data.gbp.reviews.syncedAt).toLocaleString(vi ? 'vi-VN' : uiLocale())}
          </span>
        )}
      </div>

      {/* Spend entry */}
      <div style={{ ...ui.card, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={cardTitle}>{T('Chi phí từng kênh', 'Spend per channel')}</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--c94a3b8)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showMetrics} onChange={(e) => setShowMetrics(e.target.checked)} />
            {T('Thêm reach / click / lead', 'Add reach / clicks / leads')}
          </label>
        </div>
        <p style={{ color: 'var(--c64748b)', fontSize: 11.5, margin: '2px 0 10px' }}>{T('Chỉ cần nhập chi phí. Kênh nào không chạy thì để trống.', 'Just enter spend. Leave channels you did not run blank.')}</p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: showMetrics ? 520 : 260 }}>
            <thead><tr style={{ color: 'var(--c94a3b8)', textAlign: 'left' }}>
              <th style={th}>{T('Kênh', 'Channel')}</th><th style={th}>{T('Chi phí', 'Spend')}</th>
              {showMetrics && <><th style={th}>Reach</th><th style={th}>Clicks</th><th style={th}>Leads</th></>}
            </tr></thead>
            <tbody>
              {CHANNELS.map((ch) => {
                const r = spendDraft[ch] ?? { channel: ch, amountCents: 0 };
                const set = (p: Partial<SpendRow>) => setSpendDraft((d) => ({ ...d, [ch]: { ...r, ...p } }));
                return (
                  <tr key={ch} style={{ borderTop: '1px solid var(--c1e293b)' }}>
                    <td style={td}>{CH_LABEL[ch]}</td>
                    <td style={td}><input type="number" min={0} step="0.01" value={r.amountCents ? r.amountCents / 100 : ''} placeholder="0" onChange={(e) => set({ amountCents: Math.round(parseFloat(e.target.value || '0') * 100) })} style={numInput} /></td>
                    {showMetrics && <>
                    <td style={td}><input type="number" min={0} value={r.reach ?? ''} placeholder="—" onChange={(e) => set({ reach: e.target.value ? parseInt(e.target.value, 10) : null })} style={numInput} /></td>
                    <td style={td}><input type="number" min={0} value={r.clicks ?? ''} placeholder="—" onChange={(e) => set({ clicks: e.target.value ? parseInt(e.target.value, 10) : null })} style={numInput} /></td>
                    <td style={td}><input type="number" min={0} value={r.leads ?? ''} placeholder="—" onChange={(e) => set({ leads: e.target.value ? parseInt(e.target.value, 10) : null })} style={numInput} /></td>
                    </>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button onClick={saveSpend} disabled={busy === 'spend'} style={{ ...ui.primaryBtn, marginTop: 12 }}>{busy === 'spend' ? '…' : T('Lưu chi phí', 'Save spend')}</button>
      </div>

      {/* Work log */}
      <div style={{ ...ui.card, marginBottom: 16 }}>
        <div style={cardTitle}>{T('Công việc đã làm tháng này', 'Work done this month')}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <select value={wCat} onChange={(e) => setWCat(e.target.value)} style={{ ...dateInput }}>
            {['post', 'ads', 'seo', 'review', 'content', 'email', 'sms', 'other'].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input value={wTitle} onChange={(e) => setWTitle(e.target.value)} placeholder={T('Ví dụ: Đăng 12 bài FB/IG', 'e.g. Posted 12 FB/IG posts')} style={{ ...dateInput, flex: 1, minWidth: 200 }} />
          <button onClick={addWork} disabled={busy === 'work' || !wTitle.trim()} style={ui.primaryBtn}>{T('Thêm', 'Add')}</button>
        </div>
        {(data?.workLog ?? []).length === 0 ? <p style={{ color: 'var(--c64748b)', fontSize: 13, margin: 0 }}>{T('Chưa có công việc nào.', 'No work logged yet.')}</p> : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {data!.workLog.map((w) => (
              <li key={w.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderTop: '1px solid var(--c1e293b)', fontSize: 13 }}>
                <span><span style={{ color: 'var(--c818cf8)', fontSize: 11, textTransform: 'uppercase', marginRight: 8 }}>{w.category}</span>{w.title}</span>
                <button onClick={() => delWork(w.id)} style={{ ...ui.dangerBtn, padding: '3px 9px', fontSize: 11 }}>×</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {auto && <AutoReportCard auto={auto} vi={vi} T={T} onOpen={(m) => setMonth(m)} />}

      {/* Report */}
      <ReportEditor
        report={report} vi={vi} T={T} busy={busy}
        onGenerate={generate} onSave={saveReport} onApprove={approve}
        printData={data} money={money}
      />
      </>)}
    </section>
  );
}

/**
 * Month-end automation status. The scheduler drafts LAST month in the first days
 * of a new month and emails the salon admins; this card is where a salon can see
 * that it actually happened (and what still needs approving) instead of trusting it.
 */
function AutoReportCard({ auto, vi, T, onOpen }: { auto: AutoStatus; vi: boolean; T: (v: string, e: string) => string; onOpen: (month: string) => void }) {
  const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(vi ? 'vi-VN' : uiLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
  const statusChip = (st: string | null) => {
    const map: Record<string, [string, string]> = {
      review: ['#f59e0b', T('Chờ duyệt', 'In review')],
      approved: ['#22c55e', T('Đã duyệt', 'Approved')],
      sent: ['#6366f1', T('Đã gửi', 'Sent')],
      draft: ['var(--c94a3b8)', 'Draft'],
    };
    const [color, label] = st ? (map[st] ?? ['var(--c94a3b8)', st]) : ['var(--c475569)', T('Chưa có nháp', 'No draft')];
    return <span style={{ color, border: `1px solid ${color}`, borderRadius: 999, padding: '1px 9px', fontSize: 11, fontWeight: 700 }}>{label}</span>;
  };
  return (
    <div style={{ ...ui.card, marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ccbd5e1)' }}>{T('Báo cáo tự động cuối tháng', 'Month-end auto-report')}</span>
        <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '1px 9px', color: auto.enabled ? '#22c55e' : 'var(--c94a3b8)', border: `1px solid ${auto.enabled ? '#22c55e' : 'var(--c475569)'}` }}>
          {auto.enabled ? T('ĐANG BẬT', 'ON') : T('ĐANG TẮT', 'OFF')}
        </span>
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--c64748b)', margin: '0 0 10px', lineHeight: 1.5 }}>
        {auto.enabled
          ? T('Đầu tháng hệ thống tự kéo số từ các kênh đã kết nối, viết nháp báo cáo của tháng vừa kết thúc và gửi email báo cho quản lý. Nháp luôn ở trạng thái Chờ duyệt — không có gì đến tay khách trước khi bạn bấm Duyệt.',
              'At the start of each month the system pulls numbers from connected channels, drafts the report for the month that just ended and emails the salon admins. Drafts always stay In review — nothing reaches a client until you approve.')
          : T('Hiện tắt — báo cáo phải bấm tạo thủ công.', 'Currently off — reports must be generated manually.')}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {auto.months.map((m) => (
          <div key={m.month} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--ccbd5e1)', borderTop: '1px solid var(--c1e293b)', paddingTop: 6 }}>
            <span style={{ minWidth: 120, fontWeight: 600 }}>{m.label}</span>
            {statusChip(m.status)}
            <span style={{ color: 'var(--c64748b)', fontSize: 11.5 }}>
              {m.status ? T('nháp ngày ', 'drafted ') + fmtDate(m.createdAt) : T('không có dữ liệu để viết báo cáo', 'no activity to report on')}
              {m.approvedAt ? T(' · duyệt ', ' · approved ') + fmtDate(m.approvedAt) : ''}
            </span>
            {m.status && <button onClick={() => onOpen(m.month)} style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--c334155)', color: 'var(--ca5b4fc)', borderRadius: 999, padding: '3px 11px', fontSize: 11.5, cursor: 'pointer', fontWeight: 600 }}>{T('Mở', 'Open')}</button>}
          </div>
        ))}
      </div>
      {auto.lastNotice && (
        <p style={{ fontSize: 11, color: 'var(--c64748b)', margin: '10px 0 0' }}>
          {T('Email báo nháp gần nhất: ', 'Last draft notice: ')}<b style={{ color: 'var(--c94a3b8)' }}>{auto.lastNotice.recipient}</b>
          {' · '}{fmtDate(auto.lastNotice.at)}{' · '}{auto.lastNotice.status}
        </p>
      )}
    </div>
  );
}

function ReportEditor({ report, vi, T, busy, onGenerate, onSave, onApprove, printData, money }: {
  report: Report | null; vi: boolean; T: (v: string, e: string) => string; busy: string | null;
  onGenerate: () => void; onSave: (c: Content) => void; onApprove: () => void; printData: Monthly | null; money: (c: number) => string;
}) {
  const [c, setC] = useState<Content>({});
  useEffect(() => { setC(report?.content ?? {}); }, [report]);

  const lines = (arr?: Item[], k: 'vi' | 'en' = 'vi') => (arr ?? []).map((x) => x[k]).join('\n');
  const zip = (viText: string, enText: string): Item[] => {
    const a = viText.split('\n').map((x) => x.trim()).filter(Boolean);
    const b = enText.split('\n').map((x) => x.trim()).filter(Boolean);
    const n = Math.max(a.length, b.length);
    return Array.from({ length: n }, (_, i) => ({ vi: a[i] ?? '', en: b[i] ?? '' }));
  };
  const [hVi, setHVi] = useState(''); const [hEn, setHEn] = useState('');
  const [iVi, setIVi] = useState(''); const [iEn, setIEn] = useState('');
  const [pVi, setPVi] = useState(''); const [pEn, setPEn] = useState('');
  useEffect(() => {
    setHVi(lines(report?.content.highlights, 'vi')); setHEn(lines(report?.content.highlights, 'en'));
    setIVi(lines(report?.content.issues, 'vi')); setIEn(lines(report?.content.issues, 'en'));
    setPVi(lines(report?.content.plan, 'vi')); setPEn(lines(report?.content.plan, 'en'));
  }, [report]);

  function collect(): Content {
    return { headline: c.headline ?? { vi: '', en: '' }, tldr: c.tldr ?? { vi: '', en: '' }, summary: c.summary ?? { vi: '', en: '' }, highlights: zip(hVi, hEn), issues: zip(iVi, iEn), plan: zip(pVi, pEn) };
  }

  if (!report) {
    return (
      <div style={{ ...ui.card }}>
        <div style={cardTitle}>{T('Báo cáo tháng', 'Monthly report')}</div>
        <p style={{ color: 'var(--c94a3b8)', fontSize: 13 }}>{T('Nhập chi phí & công việc ở trên, rồi bấm nút để AI viết nháp báo cáo song ngữ.', 'Enter spend & work above, then let AI draft the bilingual report.')}</p>
        <button onClick={onGenerate} disabled={busy === 'gen'} style={ui.primaryBtn}>{busy === 'gen' ? T('Đang tạo…', 'Generating…') : T('Tạo báo cáo bằng AI', 'Generate with AI')}</button>
      </div>
    );
  }

  const status = report.status;
  const badge = { review: ['#f59e0b', T('Chờ duyệt', 'In review')], approved: ['#22c55e', T('Đã duyệt', 'Approved')], sent: ['#6366f1', T('Đã gửi', 'Sent')], draft: ['var(--c94a3b8)', 'Draft'] }[status] ?? ['var(--c94a3b8)', status];

  return (
    <div style={{ ...ui.card }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={cardTitle}>{T('Báo cáo tháng — nháp AI', 'Monthly report — AI draft')} <span style={{ color: badge[0], border: `1px solid ${badge[0]}`, borderRadius: 999, padding: '1px 9px', fontSize: 11, marginLeft: 8 }}>{badge[1]}</span></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onGenerate} disabled={busy === 'gen'} style={ghost}>{busy === 'gen' ? '…' : T('Tạo lại', 'Regenerate')}</button>
          <button onClick={() => onSave(collect())} disabled={busy === 'save'} style={ghost}>{T('Lưu', 'Save')}</button>
          <button onClick={onApprove} disabled={busy === 'approve'} style={ui.primaryBtn}>{T('Duyệt', 'Approve')}</button>
          <button onClick={() => openPrint(printData, collect(), vi, money)} style={ghost}>{T('Xem bản khách / In', 'Client view / Print')}</button>
        </div>
      </div>

      {report.content._aiUnavailable && <div style={{ ...ui.banner, background: '#422006', borderColor: '#b45309', color: 'var(--cfde68a)', marginBottom: 12 }}>{T('AI không viết được nháp: ', 'AI could not draft: ')}<b>{report.content._aiError || 'unknown'}</b>{T(' — nhập nhận xét tay bên dưới.', ' — write the notes manually below.')}</div>}

      <p style={{ fontSize: 11.5, color: 'var(--c64748b)', margin: '0 0 10px' }}>{T('AI đã điền sẵn — chỉ sửa nếu cần rồi bấm Duyệt. Đang sửa bản ', 'AI filled this in — edit only if needed, then Approve. Editing the ')}<b style={{ color: 'var(--ca5b4fc)' }}>{vi ? 'Tiếng Việt' : 'English'}</b>{T('; bấm VI/EN ở góc trên để sửa bản kia.', ' version; use VI/EN at the top to edit the other.')}</p>

      <div style={{ background: 'var(--c0f172a)', border: '1px solid #4f46e5', borderRadius: 8, padding: 10, marginBottom: 12 }}>
        <label style={{ ...lbl, color: 'var(--ca5b4fc)', fontWeight: 700 }}>{T('★ Điều quan trọng nhất tháng này (khách đọc đầu tiên)', '★ The one most important message (client reads first)')}</label>
        {vi
          ? <input style={ta} value={c.headline?.vi ?? ''} onChange={(e) => setC({ ...c, headline: { vi: e.target.value, en: c.headline?.en ?? '' } })} placeholder="Ví dụ: Doanh thu tăng 31% nhờ Google Maps" />
          : <input style={ta} value={c.headline?.en ?? ''} onChange={(e) => setC({ ...c, headline: { vi: c.headline?.vi ?? '', en: e.target.value } })} placeholder="e.g. Revenue up 31%, driven by Google Maps" />}
      </div>
      {vi
        ? <Field label={T('Tóm tắt cho chủ tiệm (đọc đầu tiên)', 'Executive summary (read first)')} value={c.tldr?.vi ?? ''} onChange={(v) => setC({ ...c, tldr: { vi: v, en: c.tldr?.en ?? '' } })} />
        : <Field label={T('Tóm tắt cho chủ tiệm (đọc đầu tiên)', 'Executive summary (read first)')} value={c.tldr?.en ?? ''} onChange={(v) => setC({ ...c, tldr: { vi: c.tldr?.vi ?? '', en: v } })} />}
      {vi
        ? <Field label={T('Bối cảnh / số liệu', 'Context / detail')} value={c.summary?.vi ?? ''} onChange={(v) => setC({ ...c, summary: { vi: v, en: c.summary?.en ?? '' } })} />
        : <Field label={T('Bối cảnh / số liệu', 'Context / detail')} value={c.summary?.en ?? ''} onChange={(v) => setC({ ...c, summary: { vi: c.summary?.vi ?? '', en: v } })} />}
      <OneCol label={T('Điểm tốt (mỗi dòng 1 ý)', 'Highlights (one per line)')} value={vi ? hVi : hEn} onChange={vi ? setHVi : setHEn} />
      <OneCol label={T('Vấn đề còn tồn tại', 'Issues')} value={vi ? iVi : iEn} onChange={vi ? setIVi : setIEn} />
      <OneCol label={T('Kế hoạch tháng sau', 'Next-month plan')} value={vi ? pVi : pEn} onChange={vi ? setPVi : setPEn} />
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={lbl}>{label}</label>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} style={ta} />
    </div>
  );
}
function OneCol({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={lbl}>{label}</label>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} style={ta} />
    </div>
  );
}

function esc(s: string) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function openPrint(data: Monthly | null, c: Content, vi: boolean, money: (n: number) => string, salonName = '') {
  if (!data) return;
  const o = data.outcome; const b = data.blended; const d = data.deltas;
  const t = (v: string, e: string) => (vi ? v : e);
  const L = (it?: Item) => (vi ? (it?.vi || it?.en) : (it?.en || it?.vi)) || '';
  const eff = data.effectiveness || 'organic';
  const effMap: Record<string, [string, string]> = {
    good: ['#059669', t('Hiệu quả tốt', 'Performing well')],
    ok: ['#2563eb', t('Đang có hiệu quả', 'On track')],
    low: ['#d97706', t('Cần cải thiện', 'Needs work')],
    organic: ['#6b7280', t('Tăng trưởng tự nhiên', 'Organic growth')],
  };
  const [effColor, effLabel] = effMap[eff];

  const arrow = (dl?: Delta) => {
    if (!dl || dl.pct == null) return '';
    const up = dl.pct >= 0;
    return `<span class="t-cap" style="color:${up ? '#059669' : '#dc2626'};font-weight:700">${up ? '▲' : '▼'} ${Math.abs(dl.pct)}%</span>`;
  };
  // The value prints in ink for everyone. It used to paint revenue green
  // unconditionally, so a month that earned 35$ against 200$ of spend still
  // glowed "good" — the delta arrow is where the judgement lives. `tone` exists
  // for the one number that IS a verdict by definition (ROAS).
  const bignum = (val: string, label: string, dl?: Delta, tone?: string) =>
    `<div style="flex:1;min-width:86px;text-align:center"><div class="t-num" style="color:${tone || '#0b1f3a'}">${val}</div><div class="t-cap" style="color:#64748b;margin-top:3px">${label}</div><div class="t-cap" style="min-height:14px">${arrow(dl)}</div></div>`;

  const CH: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', google_ads: 'Google Ads', gbp: 'Google Maps', seo: 'SEO', email: 'Email', sms: 'SMS', website: 'Website', other: t('Khác', 'Other') };
  const spendRows = (data.spend ?? []).filter((x) => x.amountCents > 0).sort((a, z) => z.amountCents - a.amountCents);
  const spendLine = spendRows.map((x) => `${esc(CH[x.channel] || x.channel)} ${money(x.amountCents)}`).join(' · ');
  const work = (data.workLog ?? []).map((w) => `<div style="margin:4px 0">✓ ${esc(w.title)}</div>`).join('') || `<div style="color:#9ca3af">${t('Chưa ghi', 'None logged')}</div>`;
  const plan = (c.plan ?? []).map((x) => `<div style="margin:4px 0">→ ${esc(L(x))}</div>`).join('') || `<div style="color:#9ca3af">—</div>`;
  const total = b?.totalSpendCents ?? 0;

  const card = (inner: string, bg = '#f7f7fb') => `<div style="background:${bg};border-radius:12px;padding:14px 16px;margin-top:10px">${inner}</div>`;
  const vColor: Record<string, string> = { good: '#059669', ok: '#2563eb', weak: '#d97706', nodata: '#6b7280' };
  const vTxt = (v: string) => (({ good: t('Tốt', 'Good'), ok: t('Ổn', 'OK'), weak: t('Yếu', 'Weak'), nodata: t('Chưa đủ dữ liệu', 'No data') } as Record<string, string>)[v] || v);
  const spendMap: Record<string, SpendRow> = {}; (data.spend ?? []).forEach((x) => { spendMap[x.channel] = x; });
  const chMet = (name: string) => {
    const sp = spendMap[name]; if (!sp) return '';
    const parts = [money(sp.amountCents)];
    if (sp.leads) { parts.push(`${sp.leads} ${t('liên hệ', 'leads')}`); parts.push(`${money(Math.round(sp.amountCents / sp.leads))}/${t('liên hệ', 'lead')}`); }
    else if (sp.clicks) { parts.push(`${sp.clicks} clicks`); parts.push(`${money(Math.round(sp.amountCents / sp.clicks))}/click`); }
    else if (sp.reach) { parts.push(`${t('tiếp cận', 'reach')} ${sp.reach}`); }
    return parts.join(' · ');
  };
  const chTrendTxt = (name: string) => {
    const tr = (data.channelTrends ?? []).find((x) => x.channel === name);
    if (!tr) return '';
    const one = (label: string, dl: Delta | null, perf: boolean) => {
      if (!dl || dl.pct == null || dl.value === dl.prev) return '';
      const up = dl.pct >= 0;
      const col = !perf ? '#6b7280' : up ? '#059669' : '#dc2626';
      return `<span style="color:${col};font-weight:700;margin-right:8px">${esc(label)} ${up ? '▲' : '▼'}${Math.abs(dl.pct)}%</span>`;
    };
    const parts = [one(t('Chi', 'Spend'), tr.spend, false), one('Reach', tr.reach, true), one('Click', tr.clicks, true), one(t('Liên hệ', 'Leads'), tr.leads, true)].filter(Boolean).join('');
    return parts ? `<div class="t-body" style="margin-top:3px">${parts}<span style="color:#9ca3af">${t('so tháng trước', 'vs last month')}</span></div>` : '';
  };
  const channelsHtml = (c.channels ?? []).map((ch) => {
    const col = vColor[ch.verdict] || '#6b7280'; const met = chMet(ch.name);
    return `<div style="border-left:4px solid ${col};background:#fafafa;border-radius:8px;padding:9px 13px;margin:0;break-inside:avoid"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span class="t-body" style="font-weight:700">${esc(CH[ch.name] || ch.name)} <span style="color:${col}">· ${esc(vTxt(ch.verdict))}</span></span>${met ? `<span class="t-cap" style="color:#6b7280">${esc(met)}</span>` : ''}</div><div class="t-body" style="color:#374151;font-weight:400;margin-top:3px">${esc(L(ch))}</div>${chTrendTxt(ch.name)}</div>`;
  }).join('');
  const hiHtml = (c.highlights ?? []).map((x) => `<div style="margin:3px 0">✓ ${esc(L(x))}</div>`).join('');
  const issHtml = (c.issues ?? []).map((x) => `<div style="margin:3px 0">▲ ${esc(L(x))}</div>`).join('');
  const socHtml = (data.socialInsights ?? []).map((si) => {
    const isIg = si.platform === 'instagram';
    const nm = isIg ? 'Instagram' : 'Facebook'; const col = isIg ? '#e1306c' : '#1877f2';
    const f = (n: number | null) => (n == null ? '—' : Number(n).toLocaleString(uiLocale()));
    const ar = (dl?: SocialDelta | null) => (dl && dl.pct != null ? `<span class="t-cap" style="color:${dl.pct >= 0 ? '#059669' : '#dc2626'};font-weight:700"> ${dl.pct >= 0 ? '▲' : '▼'}${Math.abs(dl.pct)}%</span>` : '');
    const st = (label: string, val: number | null, dl?: SocialDelta | null) => (val == null ? '' : `<div style="text-align:center;flex:1;min-width:58px"><div class="t-h2" style="font-weight:800">${f(val)}${ar(dl)}</div><div class="t-cap" style="color:#6b7280">${label}</div></div>`);
    const cells = [st(t('Follower', 'Followers'), si.followers, si.vsPrev?.followers), st(t('Follower mới', 'New'), si.newFollowers, si.vsPrev?.newFollowers), st('Reach', si.reach, si.vsPrev?.reach), st(t('Xem', 'Views'), si.views, si.vsPrev?.views), st(t('Tương tác', 'Engagement'), si.engagement, si.vsPrev?.engagement)].filter(Boolean).join('');
    if (!cells) return '';
    return `<div style="border:1px solid #eee;border-radius:10px;padding:9px 12px;margin:6px 0"><div style="font-weight:700;color:${col};margin-bottom:4px">${nm}</div><div style="display:flex;gap:6px;flex-wrap:wrap">${cells}</div></div>`;
  }).join('');
  const igPosts = ((data.socialInsights ?? []).find((x) => x.platform === 'instagram')?.posts ?? []).slice(0, 12);
  const postsHtml = igPosts.map((p) => {
    const f = (n: number | null) => (n == null ? '—' : Number(n).toLocaleString(uiLocale()));
    const dt = p.timestamp ? new Date(p.timestamp).toLocaleDateString(uiLocale(), { month: 'short', day: 'numeric' }) : '';
    const tl = p.type === 'reel' ? 'Reel' : p.type === 'video' ? 'Video' : p.type === 'carousel_album' ? 'Album' : t('Ảnh', 'Photo');
    const thumb = p.thumbnail && p.thumbnail.startsWith('http') ? `<img src="${esc(p.thumbnail)}" style="width:40px;height:40px;border-radius:6px;object-fit:cover;flex-shrink:0" />` : `<div style="width:40px;height:40px;border-radius:6px;background:#f1f4f9;flex-shrink:0"></div>`;
    const cell = (label: string, v: number | null) => (v == null ? '' : `<span style="margin-right:10px"><b>${f(v)}</b> <span style="color:#6b7280">${label}</span></span>`);
    const stats = [cell(t('thích', 'likes'), p.likes), cell(t('bl', 'cmts'), p.comments), cell('reach', p.reach), cell(t('xem', 'views'), p.views), cell(t('lưu', 'saved'), p.saved)].join('');
    return `<div style="display:flex;gap:9px;align-items:center;padding:6px 0;border-top:1px solid #f0ece7">${thumb}<div style="flex:1;min-width:0"><div class="t-body" style="color:#6b7280">${esc(tl)} · ${dt}${p.caption ? ' · ' + esc(p.caption) : ''}</div><div class="t-body" style="margin-top:2px">${stats}</div></div></div>`;
  }).join('');

  const igAud = (data.socialInsights ?? []).find((x) => x.platform === 'instagram')?.audience;
  let audienceHtml = '';
  if (igAud && (igAud.gender || igAud.age)) {
    const g = igAud.gender || {}; const gt = Object.values(g).reduce((a, b) => a + b, 0) || 1;
    const gl: Record<string, string> = { F: t('Nữ', 'Female'), M: t('Nam', 'Male'), U: t('Khác', 'Other') };
    const gRows = ['F', 'M', 'U'].filter((k) => g[k] != null).map((k) => `<span style="margin-right:14px">${esc(gl[k] || k)}: <b>${Math.round((g[k] / gt) * 1000) / 10}%</b></span>`).join('');
    const age = igAud.age || {}; const at = Object.values(age).reduce((a, b) => a + b, 0) || 1;
    const ageRows = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'].filter((k) => age[k] != null).map((k) => { const pct = Math.round((age[k] / at) * 1000) / 10; return `<div style="display:flex;align-items:center;gap:8px;margin:3px 0"><span class="t-body" style="width:44px;color:#6b7280">${k}</span><span style="flex:1;height:8px;background:#eee;border-radius:4px;overflow:hidden"><span style="display:block;height:100%;width:${pct}%;background:#6366f1"></span></span><span class="t-body" style="width:38px;text-align:right">${pct}%</span></div>`; }).join('');
    audienceHtml = `${gRows ? `<div class="t-body" style="color:#374151;margin-bottom:6px"><b>${t('Giới tính', 'Gender')}</b> — ${gRows}</div>` : ''}${ageRows ? `<div class="lbl" style="margin-bottom:2px">${t('Độ tuổi', 'Age')}</div>${ageRows}` : ''}`;
  }
  // ---- Client deck (landscape, matches the agency template) ----
  const S = data.socialInsights ?? [];
  const fb = S.find((x) => x.platform === 'facebook');
  const ig = S.find((x) => x.platform === 'instagram');
  const tt = S.find((x) => x.platform === 'tiktok');
  const fnum = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString(uiLocale()));
  const arS = (dl?: SocialDelta | null) => (dl && dl.pct != null ? `<span class="t-cap" style="color:${dl.pct >= 0 ? '#16a34a' : '#dc2626'};font-weight:700">${dl.pct >= 0 ? '▲' : '▼'}${Math.abs(dl.pct)}%</span>` : '');
  // Engagement ÷ reach, else ÷ views, else ÷ followers. TikTok has no reach,
  // and dividing by its 21 followers printed "1209.5%" in a client report — one
  // impossible number and every other number on the page stops being believed.
  // A rate that still comes out above 100% prints as an em-dash for the same
  // reason.
  const engR = (x?: SocialInsight) => {
    if (!x || x.engagement == null) return '—';
    const denom = x.reach || x.views || x.followers;
    if (!denom) return '—';
    const r = Math.round((x.engagement / denom) * 1000) / 10;
    return r > 100 ? '—' : `${r}%`;
  };
  // ONE numbering system. The old template mixed three glyph families on a
  // single page (◆ for some sections, ①② for others, ◎ for a third kind) —
  // which reads as three different documents stitched together. Every section
  // is now a numbered chip + tracked small caps, numbered per page.
  const panel = (n: string, title: string, inner: string) =>
    `<div class="panel"><div class="sec">${n ? `<span class="sec-n">${n}</span>` : ''}<span class="sec-t">${title}</span></div>${inner}</div>`;
  const prow = (label: string, fv: string, fd: SocialDelta | null | undefined, iv: string, idv: SocialDelta | null | undefined, tv?: string, tdv?: SocialDelta | null) =>
    `<tr><td class="t-body" style="padding:7px 2px;color:#475569;border-top:1px solid #eef1f6">${label}</td><td style="padding:7px 2px;text-align:right;font-weight:700;color:#0f2a52;border-top:1px solid #eef1f6">${fv} ${arS(fd)}</td><td style="padding:7px 2px;text-align:right;font-weight:700;color:#0f2a52;border-top:1px solid #eef1f6">${iv} ${arS(idv)}</td>${tt ? `<td style="padding:7px 2px;text-align:right;font-weight:700;color:#0f2a52;border-top:1px solid #eef1f6">${tv ?? '—'} ${arS(tdv)}</td>` : ''}</tr>`;
  const perfTable = `<table style="width:100%;border-collapse:collapse">
    <tr class="t-body" style=""><td></td><td style="text-align:right;padding-bottom:4px"><span style="color:#1877f2;font-weight:800">Facebook</span></td><td style="text-align:right;padding-bottom:4px"><span style="color:#e1306c;font-weight:800">Instagram</span></td>${tt ? '<td style="text-align:right;padding-bottom:4px"><span style="color:#010101;font-weight:800">TikTok</span></td>' : ''}</tr>
    ${prow(t('Tổng follower', 'Total followers'), fnum(fb?.followers), fb?.vsPrev?.followers, fnum(ig?.followers), ig?.vsPrev?.followers, fnum(tt?.followers), tt?.vsPrev?.followers)}
    ${prow(t('Người tiếp cận (Reach)', 'Reach'), fb?.reach == null ? ('<span class="t-cap" style="color:#94a3b8;font-weight:600">' + t('Meta ngừng cung cấp', 'retired by Meta') + '</span>') : fnum(fb?.reach), fb?.vsPrev?.reach, fnum(ig?.reach), ig?.vsPrev?.reach, '<span class="t-cap" style="color:#94a3b8;font-weight:600">' + t('Không áp dụng', 'n/a') + '</span>', null)}
    ${prow(t('Lượt xem (Views)', 'Views'), fnum(fb?.views), fb?.vsPrev?.views, fnum(ig?.views), ig?.vsPrev?.views, fnum(tt?.views), tt?.vsPrev?.views)}
    ${prow(t('Lượt tương tác', 'Engagements'), fnum(fb?.engagement), fb?.vsPrev?.engagement, fnum(ig?.engagement), ig?.vsPrev?.engagement, fnum(tt?.engagement), tt?.vsPrev?.engagement)}
    ${prow(t('Tỉ lệ tương tác', 'Engagement rate'), engR(fb), null, engR(ig), null, engR(tt), null)}
    ${prow(t('Số follow mới', 'Net followers'), fnum(fb?.newFollowers), fb?.vsPrev?.newFollowers, fnum(ig?.newFollowers), ig?.vsPrev?.newFollowers, fnum(tt?.newFollowers), tt?.vsPrev?.newFollowers)}
  </table>`;
  const igSeries = ig?.series ?? [];
  const cumA: number[] = [];
  if (igSeries.length > 1) { const vals = igSeries.map((x) => x.value || 0); let base = (ig?.followers ?? 0) - vals.reduce((a, b2) => a + b2, 0); for (const v of vals) { base += v; cumA.push(base); } }
  // Facebook has no live daily-follower metric — chart month-by-month snapshots instead.
  const fbMs = fb?.monthlySeries ?? [];
  const cumF: number[] = fbMs.length > 1 ? fbMs.map((m) => m.followers) : [];
  const igMs = ig?.monthlySeries ?? [];
  let igMonthly = false;
  if (cumA.length < 2 && igMs.length > 1) { igMonthly = true; cumA.length = 0; for (const m of igMs) cumA.push(m.followers); }
  // A line with no numbers on it is decoration, not a chart. This one carries
  // the first and last values, a dot on today, a soft area fill, and month
  // captions when the series is monthly — the four things that let a reader
  // answer "from what, to what, over when" without leaving the panel.
  const sparkD = (arr: number[], color: string, months?: string[]) => {
    if (arr.length < 2) return '';
    const w = 260, h = 72, pd = 10, top = 13, bot = months?.length ? 15 : 6;
    const mn = Math.min(...arr), mx = Math.max(...arr), sp = mx - mn || 1;
    const X = (i: number) => pd + (i / (arr.length - 1)) * (w - 2 * pd);
    const Y = (v: number) => top + (1 - (v - mn) / sp) * (h - top - bot - 6);
    const pts = arr.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
    const base = (h - bot).toFixed(1);
    const mLb = (m: string) => (m && m.length >= 7 ? `${m.slice(5, 7)}/${m.slice(2, 4)}` : m);
    const labels = months?.length
      ? `<text x="${pd}" y="${h - 3}" font-size="8.5" fill="#8a97ad">${mLb(months[0])}</text><text x="${w - pd}" y="${h - 3}" font-size="8.5" fill="#8a97ad" text-anchor="end">${mLb(months[months.length - 1])}</text>`
      : '';
    return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:64px;margin-top:6px">
      <line x1="${pd}" y1="${base}" x2="${w - pd}" y2="${base}" stroke="#e3e8f2" stroke-width="1"/>
      <polygon points="${pd},${base} ${pts} ${(w - pd).toFixed(1)},${base}" fill="${color}" opacity="0.09"/>
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${X(arr.length - 1).toFixed(1)}" cy="${Y(arr[arr.length - 1]).toFixed(1)}" r="2.6" fill="${color}"/>
      <text x="${X(0).toFixed(1)}" y="${(Y(arr[0]) - 5).toFixed(1)}" font-size="9" font-weight="700" fill="#64748b">${fnum(arr[0])}</text>
      <text x="${X(arr.length - 1).toFixed(1)}" y="${(Y(arr[arr.length - 1]) - 5).toFixed(1)}" font-size="9" font-weight="700" fill="${color}" text-anchor="end">${fnum(arr[arr.length - 1])}</text>
      ${labels}
    </svg>`;
  };
  const growth = `<div style="display:flex;gap:16px">
    <div style="flex:1"><div class="t-h3" style="color:#1877f2;font-weight:800;">Facebook</div><div class="t-num2" style="font-weight:800;color:#0f2a52">${fnum(fb?.followers)} ${arS(fb?.vsPrev?.followers)}</div><div class="t-cap" style="color:#94a3b8">${t('Tổng theo dõi', 'Total followers')}</div>${cumF.length > 1 ? sparkD(cumF, '#1877f2', fbMs.map((m) => m.month)) : `<div class="empty" style="margin-top:10px">${t('Biểu đồ tăng trưởng theo tháng hiện khi có ≥2 tháng đồng bộ','Monthly growth chart appears once ≥2 months are synced')}</div>`}</div>
    <div style="flex:1"><div class="t-h3" style="color:#e1306c;font-weight:800;">Instagram</div><div class="t-num2" style="font-weight:800;color:#0f2a52">${fnum(ig?.followers)} ${arS(ig?.vsPrev?.followers)}</div><div class="t-cap" style="color:#94a3b8">${t('Tổng theo dõi', 'Total followers')}</div>${cumA.length > 1 ? sparkD(cumA, '#e1306c', igMonthly ? igMs.map((m) => m.month) : undefined) : `<div class="empty" style="margin-top:10px">${t('Biểu đồ tăng trưởng theo tháng hiện khi có ≥2 tháng đồng bộ','Monthly growth chart appears once ≥2 months are synced')}</div>`}</div>
  </div>`;
  const igP = ig?.posts ?? [];
  const reels = igP.filter((x) => x.type === 'reel' || x.type === 'video').length;
  const fbP = fb?.posts ?? [];
  const fbReels = fbP.filter((x) => x.type === 'reel' || x.type === 'video').length;
  const fbTot = fb?.postsCount ?? (fbP.length || null);
  const contentTable = `<table class="t-body" style="width:100%;border-collapse:collapse">
    <tr class="t-cap" style="color:#94a3b8"><td></td><td style="text-align:right"><b style="color:#1877f2">FB</b></td><td style="text-align:right"><b style="color:#e1306c">IG</b></td></tr>
    <tr><td style="padding:3px 0;color:#475569">${t('Tổng bài', 'Total posts')}</td><td style="text-align:right;font-weight:700">${fbTot ?? '—'}</td><td style="text-align:right;font-weight:700">${ig?.postsCount ?? igP.length}</td></tr>
    <tr><td style="padding:3px 0;color:#475569">Reels/Video</td><td style="text-align:right;font-weight:700">${fbP.length ? fbReels : '—'}</td><td style="text-align:right;font-weight:700">${reels}</td></tr>
    <tr><td style="padding:3px 0;color:#475569">${t('Bài ảnh', 'Photos')}</td><td style="text-align:right;font-weight:700">${fbP.length ? (fbP.length - fbReels) : '—'}</td><td style="text-align:right;font-weight:700">${igP.length - reels}</td></tr>
  </table>`;
  // Top posts across BOTH Facebook and Instagram, ranked by views (highest first).
  const topAll = [
    ...fbP.map((p) => ({ ...p, _pf: 'FB', _col: '#1877f2' })),
    ...igP.map((p) => ({ ...p, _pf: 'IG', _col: '#e1306c' })),
  ].sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 4);
  const top3 = topAll.map((p) => { const th = p.thumbnail && p.thumbnail.startsWith('http') ? `<img src="${esc(p.thumbnail)}" style="width:34px;height:34px;border-radius:6px;object-fit:cover;flex-shrink:0"/>` : `<div class="t-cap" style="width:34px;height:34px;border-radius:6px;background:${p._col}22;color:${p._col};flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:800">${p._pf}</div>`; const badge = `<span class="t-cap" style="font-weight:800;color:#fff;background:${p._col};border-radius:4px;padding:1px 5px;margin-right:5px">${p._pf}</span>`; return `<div style="display:flex;gap:8px;align-items:center;margin:5px 0">${th}<div style="flex:1;min-width:0"><div class="t-cap" style="color:#475569;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${badge}${esc(p.caption || (p.type === 'reel' ? 'Reel' : 'Post'))}</div><div class="t-cap" style="color:#0f2a52"><b>${fnum(p.views)}</b> ${t('xem', 'views')}${p.reach != null ? ` · <b>${fnum(p.reach)}</b> reach` : ''} · <b>${fnum((p.likes ?? 0) + (p.comments ?? 0))}</b> ${t('tương tác', 'eng')}</div></div></div>`; }).join('') || `<div class="t-body" style="color:#94a3b8;">—</div>`;
  const contentPanel = `<div style="display:flex;gap:14px"><div style="flex:0 0 40%">${contentTable}</div><div style="flex:1;min-width:0;border-left:1px solid #eef1f6;padding-left:12px"><div class="t-cap" style="color:#94a3b8;margin-bottom:2px">${t('TOP BÀI (FB + IG) — theo lượt xem', 'TOP POSTS (FB + IG) — by views')}</div>${top3}</div></div>`;
  const adsPanel = spendLine
    ? `<div class="t-body" style="color:#0f2a52">${t('Tổng chi', 'Spend')}: <b>${money(total)}</b><div class="t-body" style="color:#6b7280;margin-top:4px">${spendLine}</div></div>`
    : `<div class="t-body" style="color:#94a3b8;line-height:1.6">${t('Chưa chạy quảng cáo tháng này. Khi bật quảng cáo, mục này hiển thị Chi phí · Reach · Click · CPC · CTR · ROAS.', 'No paid ads this month. Once ads run, this shows Spend · Reach · Clicks · CPC · CTR · ROAS.')}</div>`;
  let donutHtml = '';
  if (igAud?.gender) { const g = igAud.gender; const gt = Object.values(g).reduce((a, b2) => a + b2, 0) || 1; let acc = 0; const seg = ([['F', '#e1306c'], ['M', '#3b82f6'], ['U', '#cbd5e1']] as [string, string][]).map(([k, cc]) => { const pctv = Math.round(((g[k] || 0) / gt) * 1000) / 10; const from = acc; acc += pctv; return `${cc} ${from}% ${acc}%`; }).join(','); const leg = ([['F', t('Nữ', 'Female'), '#e1306c'], ['M', t('Nam', 'Male'), '#3b82f6'], ['U', t('Khác', 'Other'), '#cbd5e1']] as [string, string, string][]).filter(([k]) => g[k] != null).map(([k, lb, cc]) => `<div class="t-body" style="display:flex;align-items:center;gap:6px;margin:2px 0"><span style="width:9px;height:9px;border-radius:2px;background:${cc}"></span><span style="color:#475569">${esc(lb)}</span><b style="margin-left:auto;color:#0f2a52">${Math.round(((g[k] || 0) / gt) * 1000) / 10}%</b></div>`).join(''); donutHtml = `<div style="display:flex;gap:12px;align-items:center"><div style="width:76px;height:76px;border-radius:50%;flex-shrink:0;background:conic-gradient(${seg});-webkit-mask:radial-gradient(circle 23px at center,transparent 98%,#000 100%);mask:radial-gradient(circle 23px at center,transparent 98%,#000 100%)"></div><div style="flex:1">${leg}</div></div>`; }
  const audiencePanel = (donutHtml || audienceHtml)
    ? `${donutHtml}${igAud?.age ? `<div style="margin-top:8px">${(() => { const age = igAud.age || {}; const at = Object.values(age).reduce((a, b2) => a + b2, 0) || 1; return ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'].filter((k) => age[k] != null).map((k) => { const pv = Math.round(((age[k] || 0) / at) * 1000) / 10; return `<div style="display:flex;align-items:center;gap:8px;margin:2px 0"><span class="t-cap" style="width:42px;color:#94a3b8">${k}</span><span style="flex:1;height:7px;background:#eef1f6;border-radius:4px;overflow:hidden"><span style="display:block;height:100%;width:${pv}%;background:#6366f1"></span></span><span class="t-cap" style="width:36px;text-align:right;color:#0f2a52">${pv}%</span></div>`; }).join(''); })()}</div>` : ''}`
    : `<div class="t-body" style="color:#94a3b8">${t('Meta không cung cấp nhân khẩu cho Facebook. Instagram cần ≥100 follower.', 'Meta does not provide Facebook demographics. Instagram needs ≥100 followers.')}</div>`;
  const posBox = hiHtml ? `<div class="t-body" style="line-height:1.55;color:#166534">${hiHtml}</div>` : `<div class="muted">—</div>`;
  const negBox = issHtml ? `<div class="t-body" style="line-height:1.55;color:#b45309">${issHtml}</div>` : `<div class="muted">—</div>`;
  const insightBox = (c.tldr && L(c.tldr)) || (c.summary && L(c.summary)) ? `<div class="t-body" style="color:#334155;line-height:1.6">${esc(L(c.tldr) || L(c.summary))}</div>` : `<div class="muted">—</div>`;
  const insightsBox = (c.insights ?? []).length ? (c.insights ?? []).map((x) => `<div class="t-body" style="margin:3px 0;color:#334155">• ${esc(L(x))}</div>`).join('') : insightBox;
  const planGroup = (label: string, items?: Item[]) => `<div style="flex:1;min-width:130px"><div class="t-body" style="font-weight:800;color:#4338ca;margin-bottom:3px">${esc(label)}</div>${(items ?? []).length ? (items ?? []).map((x) => `<div class="t-body" style="margin:2px 0;color:#334155">• ${esc(L(x))}</div>`).join('') : '<div class="muted">—</div>'}</div>`;
  const nm = c.nextMonth;
  const kehoachHtml = nm && (nm.content || nm.ads || nm.growth || nm.kpi)
    ? `<div style="display:flex;gap:14px;flex-wrap:wrap">${planGroup(t('NỘI DUNG', 'CONTENT'), nm.content)}${planGroup(t('QUẢNG CÁO', 'ADS'), nm.ads)}${planGroup(t('TĂNG TRƯỞNG', 'GROWTH'), nm.growth)}${planGroup(t('KPI THÁNG SAU', 'NEXT-MONTH KPIs'), nm.kpi)}</div>`
    : `<div class="t-body" style="color:#4338ca;line-height:1.55">${plan}</div>`;
  // ---- Google Business Profile deck page (real GBP metrics only) ----
  const g = data.gbp;
  let gbpHtml = '';
  if (g && (g.impressions != null || g.calls != null || g.directions != null || g.websiteClicks != null || g.bookings != null)) {
    const gv = g.vsPrev || ({} as NonNullable<GbpData['vsPrev']>);
    const card = (label: string, sub: string, val: number | null | undefined, d: SocialDelta | null | undefined, color: string) =>
      `<div style="flex:1;min-width:150px;background:#fff;border:1px solid #e6ebf3;border-radius:12px;padding:11px 13px"><div class="t-body" style="color:#475569;font-weight:600">${esc(label)}</div><div class="t-cap" style="color:#94a3b8">${esc(sub)}</div><div style="display:flex;align-items:baseline;gap:8px;margin-top:5px"><div class="t-num2" style="font-weight:800;color:${color}">${fnum(val)}</div>${arS(d)}</div></div>`;
    const overview = `<div style="display:flex;gap:9px;flex-wrap:wrap">
      ${card(t('Lượt xem hồ sơ', 'Profile views'), 'Impressions', g.impressions, gv.impressions, '#1a73e8')}
      ${card(t('Lượt gọi điện', 'Calls'), 'Call clicks', g.calls, gv.calls, '#0f2a52')}
      ${card(t('Lượt chỉ đường', 'Directions'), 'Direction requests', g.directions, gv.directions, '#0f2a52')}
      ${card(t('Lượt truy cập web', 'Website'), 'Website clicks', g.websiteClicks, gv.websiteClicks, '#0f2a52')}
      ${card(t('Lượt đặt lịch', 'Bookings'), 'Reserve with Google', g.bookings, gv.bookings, '#0f2a52')}
      ${card(t('Lượt nhắn tin', 'Messages'), 'Conversations', g.conversations, gv.conversations, '#0f2a52')}
    </div>`;
    const totImp = g.impressions || 0;
    const bar = (label: string, val: number, color: string) => { const pct = totImp > 0 ? Math.round((val / totImp) * 100) : 0; return `<div style="margin:4px 0"><div class="t-body" style="display:flex;justify-content:space-between;color:#475569"><span>${esc(label)}</span><b style="color:#0f2a52">${fnum(val)} · ${pct}%</b></div><div style="height:8px;background:#eef1f6;border-radius:4px;overflow:hidden"><span style="display:block;height:100%;width:${pct}%;background:${color}"></span></div></div>`; };
    const sourcePanel = `${bar(t('Trên Tìm kiếm', 'On Search'), g.searchImpr || 0, '#4285F4')}${bar(t('Trên Maps', 'On Maps'), g.mapsImpr || 0, '#34A853')}<div style="height:6px"></div>${bar('Mobile', g.mobileImpr || 0, '#5b8def')}${bar('Desktop', g.desktopImpr || 0, '#9bb8f0')}`;
    const kw = (g.keywords || []).slice(0, 6);
    const kwPanel = kw.length ? `<div class="t-body" style="">${kw.map((k) => `<div style="display:flex;justify-content:space-between;margin:2px 0;color:#475569"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(k.keyword)}</span><b style="color:#0f2a52;flex-shrink:0;margin-left:8px">${fnum(k.count)}</b></div>`).join('')}</div>` : `<div class="empty">${t('Chưa có dữ liệu từ khoá tháng này.', 'No keyword data this month.')}</div>`;
    const impSeries = (g.series || []).map((x) => x.impressions || 0);
    const trendPanel = impSeries.length > 1 ? sparkD(impSeries, '#1a73e8', (g.series || []).map((x) => x.month)) : `<div class="empty">${t('Cần ≥2 tháng đồng bộ để vẽ xu hướng.', 'Need ≥2 synced months for a trend.')}</div>`;
    const actRate = (val: number | null | undefined) => (totImp > 0 && val != null ? Math.round((val / totImp) * 1000) / 10 : null);
    const actBar = (label: string, val: number | null | undefined, color: string) => { const r = actRate(val); return `<div style="margin:4px 0"><div class="t-body" style="display:flex;justify-content:space-between;color:#475569"><span>${esc(label)}</span><b style="color:#0f2a52">${r != null ? r + '%' : '—'}</b></div><div style="height:8px;background:#eef1f6;border-radius:4px;overflow:hidden"><span style="display:block;height:100%;width:${r || 0}%;background:${color}"></span></div></div>`; };
    const actionPanel = `${actBar(t('Gọi điện', 'Calls'), g.calls, '#4285F4')}${actBar(t('Chỉ đường', 'Directions'), g.directions, '#34A853')}${actBar(t('Truy cập web', 'Website'), g.websiteClicks, '#FBBC05')}${actBar(t('Đặt lịch', 'Bookings'), g.bookings, '#EA4335')}`;
    const up = (x: number | null | undefined) => (x == null ? null : Math.ceil((x * 1.1) / 50) * 50);
    const kpiRow = (label: string, cur: number | null | undefined) => (cur != null ? `<div class="t-body" style="display:flex;justify-content:space-between;margin:3px 0"><span style="color:#475569">${esc(label)}</span><b style="color:#0f2a52">≥ ${fnum(up(cur))}</b></div>` : '');
    const kpiPanel = `${kpiRow(t('Lượt xem hồ sơ', 'Profile views'), g.impressions)}${kpiRow(t('Lượt gọi', 'Calls'), g.calls)}${kpiRow(t('Lượt chỉ đường', 'Directions'), g.directions)}${kpiRow(t('Lượt truy cập web', 'Website'), g.websiteClicks)}${kpiRow(t('Lượt đặt lịch', 'Bookings'), g.bookings)}` || '<div class="muted">—</div>';
    const rv = g.reviews;
    const stars = (n: number) => '★'.repeat(Math.max(0, Math.min(5, Math.round(n)))) + '☆'.repeat(Math.max(0, 5 - Math.round(n)));
    const reviewPanel = rv && (rv.rating != null || rv.count != null)
      ? `<div style="display:flex;align-items:center;gap:8px"><div class="t-num" style="font-weight:800;color:#0f2a52">${rv.rating ?? '—'}</div><div><div class="t-h2" style="color:#f59e0b;line-height:1">${stars(rv.rating || 0)}</div><div class="t-cap" style="color:#64748b">${fnum(rv.count)} ${t('đánh giá', 'reviews')}</div></div></div>
        <div style="display:flex;gap:18px;margin-top:10px;border-top:1px solid #eef1f6;padding-top:8px">
          <div><div class="t-num2" style="font-weight:800;color:#16A34A">${rv.newThisMonth != null ? '+' + fnum(rv.newThisMonth) : '—'}</div><div class="t-cap" style="color:#64748b">${t('review mới tháng này', 'new this month')}</div></div>
          <div><div class="t-num2" style="font-weight:800;color:${(rv.badCount || 0) > 0 ? '#DC2626' : '#0f2a52'}">${rv.badCount != null ? fnum(rv.badCount) : '—'}</div><div class="t-cap" style="color:#64748b">${t('review xấu (≤2★)', 'bad (≤2★)')}</div></div>
        </div>${(rv.recent || []).slice(0, 2).map((r) => `<div class="t-cap" style="border-top:1px solid #eef1f6;padding:5px 0;margin-top:4px"><b>${esc(r.author || '')}</b> · <span style="color:#f59e0b">${'★'.repeat(r.rating || 0)}</span><div style="color:#475569">${esc((r.comment || '').slice(0, 90))}</div></div>`).join('')}`
      : `<div class="t-body" style="color:#94a3b8;line-height:1.6">${t('Chưa có dữ liệu đánh giá — vào Chỉnh sửa → “Google — Đánh giá (nhập tay)” để nhập rating, tổng review, review mới, review xấu.', 'No review data — go to Edit → “Google — Reviews (manual)” to enter rating, totals, new & bad reviews.')}</div>`;
    const recs: string[] = [];
    if ((g.bookings || 0) === 0) recs.push(t('Bật Đặt lịch qua Google (Reserve with Google) để khách đặt ngay trên Maps.', 'Turn on Reserve with Google so customers book from Maps.'));
    recs.push(t('Đăng 2–3 bài/tuần (ưu đãi, ảnh trước/sau) để giữ hồ sơ hoạt động.', 'Post 2–3/week (offers, before/after) to keep the profile active.'));
    recs.push(t('Trả lời mọi đánh giá trong 24h để tăng độ tin cậy.', 'Reply to every review within 24h to build trust.'));
    recs.push((g.searchImpr || 0) > (g.mapsImpr || 0)
      ? t('Khách tìm chủ yếu qua Tìm kiếm — tối ưu từ khoá dịch vụ trong mô tả hồ sơ.', 'Most discovery is via Search — optimise service keywords in the profile description.')
      : t('Khách chủ yếu thấy trên Maps — thêm ảnh mới & cập nhật giờ mở cửa để nổi bật.', 'Most views are on Maps — add fresh photos & keep hours updated to stand out.'));
    const recPanel = `<div class="t-body" style="line-height:1.5">${recs.map((r) => `<div style="margin:3px 0;color:#334155">• ${esc(r)}</div>`).join('')}</div>`;
    gbpHtml = `
    ${panel('01', t('TỔNG QUAN HIỆU QUẢ GBP', 'GBP PERFORMANCE'), overview)}
    <div class="grid" style="grid-template-columns:1fr 1fr 1fr">
      ${panel('02', t('NGUỒN HIỂN THỊ', 'WHERE SEEN'), sourcePanel)}
      ${panel('03', t('TỪ KHOÁ KHÁCH TÌM', 'TOP SEARCHES'), kwPanel)}
      ${panel('04', t('XU HƯỚNG LƯỢT XEM', 'VIEWS TREND'), trendPanel)}
    </div>
    <div class="grid" style="grid-template-columns:1fr 1fr">
      ${panel('05', t('TỶ LỆ HÀNH ĐỘNG', 'ACTION RATE'), actionPanel)}
      ${panel('06', t('ĐÁNH GIÁ & XẾP HẠNG', 'REVIEWS'), reviewPanel)}
    </div>`;
  }
  const bizNums = `<div style="display:flex;gap:12px;flex-wrap:wrap">${bignum(String(o.totals.bookings), t('Lượt đặt lịch', 'Bookings'), d?.bookings)}${bignum(String(o.totals.showed), t('Đã đến', 'Showed'), d?.showed)}${bignum(String(o.newCustomers), t('Khách mới', 'New customers'), d?.newCustomers)}${bignum(money(o.totals.revenueCents), t('Doanh thu', 'Revenue'), d?.revenueCents)}${total > 0 ? bignum(money(total), t('Chi phí marketing', 'Marketing spend'), d?.spendCents) : ''}${(total > 0 && b?.revenuePerSpend != null) ? bignum(String(b.revenuePerSpend) + '×', 'ROAS', undefined, b.revenuePerSpend >= 1 ? '#059669' : '#d97706') : ''}</div>${(o.gbp?.bookings ?? 0) > 0 ? `<div class="t-body" style="color:#475569;margin-top:8px;border-top:1px solid #eef1f6;padding-top:6px">${t('Trong đó từ Google Maps (đo đích danh)', 'From Google Maps (verified)')}: <b>${o.gbp!.bookings}</b> ${t('đặt lịch', 'bookings')} · <b style="color:#059669">${money(o.gbp!.revenueCents)}</b></div>` : ''}${spendLine ? `<div class="t-body" style="color:#6b7280;margin-top:6px">${t('Chi tiết chi phí', 'Spend detail')}: ${esc(spendLine)}</div>` : ''}`;
  // "Tháng 08/2026", not the raw "2026-08" — a client report speaks the
  // client's calendar, not the database's.
  const [yy, mm] = String(data.month || '').split('-');
  const monthLabel = vi ? `Tháng ${mm}/${yy}` : `${mm}/${yy}`;

  /**
   * Every sheet gets the SAME header and the SAME footer.
   *
   * The header is ink on a light band, never white-on-navy. The previous
   * template put white text on a gradient, and because browsers do not print
   * backgrounds unless asked, the gradient vanished and every title in the
   * exported PDF came out pale grey on white — the single biggest reason the
   * old report read as unfinished. print-color-adjust is now set too, but the
   * design no longer DEPENDS on a background surviving: worst case it loses a
   * tint, never the words.
   */
  const sheetHead = (kicker: string, chip: string) => `
    <div class="head">
      <div style="min-width:0">
        <div class="kick">${kicker}</div>
        <div class="t-title">${esc(salonName || t('Báo cáo Marketing', 'Marketing Report'))}</div>
        <div class="t-cap" style="color:#64748b;margin-top:3px">Facebook · Instagram · TikTok · Google · ${monthLabel} · <b style="color:${effColor}">${effLabel}</b></div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        ${chip}
        <div class="t-cap" style="color:#8a97ad;margin-top:4px">Lumio Agency</div>
      </div>
    </div>
    <div class="rule"></div>`;
  const lumioChip = `<span class="chip" style="background:#eef2ff;color:#4338ca">Lumio</span>`;
  const gChip = `<span class="chip" style="background:#e8f0fe;color:#1a73e8">G</span>`;

  // The footer says where the numbers came from — and which page you hold.
  // Page numbers are the cheapest professionalism there is, and the old export
  // had none.
  const sheetFoot = (note: string) => `<div class="foot"><span style="min-width:0">${note}</span><span class="pg" style="flex-shrink:0"></span></div>`;

  const orgNote = t('Số liệu organic lấy trực tiếp từ Facebook/Instagram · Meta đã ngừng một số chỉ số Facebook · AI tổng hợp, Lumio duyệt trước khi gửi.', 'Organic data pulled directly from Facebook/Instagram · Meta discontinued some Facebook metrics · AI-summarised, reviewed by Lumio.');
  const gbpNote = t('Số liệu Google Business Profile lấy trực tiếp từ Google · Một số chỉ số Google không mở qua API · Lumio duyệt trước khi gửi.', 'Google Business Profile data pulled directly from Google · Some metrics are not exposed via the API · Reviewed by Lumio.');

  // Sheet 1 — the numbers. "Đánh giá từng kênh" used to sit at the bottom of
  // this page and is precisely what overflowed: the export grew a ghost page
  // holding one floating footer line. It belongs with the assessment anyway —
  // page 1 states facts, the closing page passes judgement.
  const sheet1 = `<div class="sheet">
    ${sheetHead(t('BÁO CÁO MARKETING THÁNG', 'MONTHLY MARKETING REPORT'), lumioChip)}
    ${panel('01', t('KẾT QUẢ KINH DOANH THÁNG', 'BUSINESS RESULTS'), bizNums)}
    <div class="grid" style="grid-template-columns:1fr 1fr">
      ${panel('02', t('TỔNG QUAN HIỆU QUẢ', 'PERFORMANCE OVERVIEW'), perfTable)}
      ${panel('03', t('TĂNG TRƯỞNG NGƯỜI THEO DÕI', 'FOLLOWER GROWTH'), growth)}
    </div>
    <div class="grid" style="grid-template-columns:1.3fr 1fr 1fr">
      ${panel('04', t('NỘI DUNG', 'CONTENT'), contentPanel)}
      ${panel('05', t('QUẢNG CÁO', 'ADS'), adsPanel)}
      ${panel('06', t('ĐỐI TƯỢNG (IG)', 'AUDIENCE (IG)'), audiencePanel)}
    </div>
    ${sheetFoot(orgNote)}
  </div>`;

  const gbpSheet = gbpHtml ? `<div class="sheet">
    ${sheetHead(t('GOOGLE BUSINESS PROFILE — HIỆN DIỆN TRÊN GOOGLE & MAPS', 'GOOGLE BUSINESS PROFILE'), gChip)}
    ${gbpHtml}
    ${sheetFoot(gbpNote)}
  </div>` : '';

  const summarySheet = `<div class="sheet">
    ${sheetHead(t('TỔNG KẾT & KẾ HOẠCH THÁNG TỚI — TẤT CẢ KÊNH', 'SUMMARY & NEXT-MONTH PLAN'), lumioChip)}
    ${channelsHtml ? panel('01', t('ĐÁNH GIÁ TỪNG KÊNH', 'CHANNEL EVALUATION'), `<div class="grid" style="grid-template-columns:1fr 1fr">${channelsHtml}</div>`) : ''}
    <div class="grid" style="grid-template-columns:1fr 1fr">
      ${panel('02', t('ĐÁNH GIÁ CHUNG', 'OVERALL ASSESSMENT'), `<div class="t-body" style="font-weight:700;color:#166534;margin-bottom:2px">${t('Điểm tích cực', 'Wins')}</div>${posBox}<div class="t-body" style="font-weight:700;color:#b45309;margin:8px 0 2px">${t('Điểm cần cải thiện', 'To improve')}</div>${negBox}`)}
      ${panel('03', t('INSIGHT NỔI BẬT', 'KEY INSIGHTS'), insightsBox)}
    </div>
    ${panel('04', t('KẾ HOẠCH & ĐỊNH HƯỚNG THÁNG TIẾP THEO', 'NEXT-MONTH PLAN'), kehoachHtml)}
    ${sheetFoot(t('AI tổng hợp từ số liệu thật của tháng · Lumio Agency duyệt trước khi gửi khách.', 'AI-drafted from the month’s real numbers · reviewed by Lumio Agency before sending.'))}
  </div>`;

  const html = `<!doctype html><html lang="${vi ? 'vi' : 'en'}"><head><meta charset="utf-8"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;600;700;800&display=swap" rel="stylesheet"><title>${t('Báo cáo Marketing', 'Marketing report')} — ${esc(salonName || '')} — ${data.month}</title><style>
  @page{size:A4 landscape;margin:8mm}
  /* Without this line the browser strips every background at print time —
     which is exactly how the last export shipped with grey ghost titles. */
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-family:'Be Vietnam Pro',-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1f2a3d;margin:0 auto;padding:0;background:#eef2f8;width:281mm;line-height:1.45;
       /* Lining, equal-width digits: numbers in columns land in columns. */
       font-variant-numeric:tabular-nums}
  @media print{body{background:#fff;width:auto}}
  .sheet{width:281mm;min-height:186mm;background:#fff;padding:9mm 11mm 6mm;display:flex;flex-direction:column;page-break-after:always;margin:0 auto;overflow:hidden}
  /* The footer may never be orphaned onto its own page — the exact defect the
     old export shipped with: one caption line floating alone on page 2. */
  .foot{break-inside:avoid;page-break-inside:avoid}
  @media screen{.sheet{margin:10px auto;border:1px solid #dbe2ee;border-radius:10px}}
  .sheet:last-of-type{page-break-after:auto}
  .head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px}
  .kick{font-size:10.5px;font-weight:800;letter-spacing:2.2px;color:#4f46e5;text-transform:uppercase}
  .rule{height:3px;border-radius:2px;background:linear-gradient(90deg,#4f46e5,#e1306c 55%,#f59e0b);margin:8px 0 1px;flex-shrink:0}
  .chip{display:inline-grid;place-items:center;min-width:44px;height:34px;border-radius:9px;font-weight:800;font-size:15px;padding:0 10px}
  .grid{display:grid;gap:10px;margin-top:10px;break-inside:avoid}
  /* THE line that keeps the columns honest. A grid item's default min-width is
     its content's min width, so one unwrappable line (a post caption, a long
     number) inflates its column past the fraction it was given — the content
     panel then swallowed the ads panel's space and pushed the audience panel
     clean off the edge of the sheet. min-width:0 lets fr do its arithmetic. */
  .grid>*{min-width:0}
  .panel{background:#fff;border:1px solid #e3e8f2;border-radius:12px;padding:12px 14px;break-inside:avoid;margin-top:10px;overflow:hidden}
  .grid .panel{margin-top:0} /* the grid's gap already spaces these */
  .sec{display:flex;align-items:center;gap:8px;margin-bottom:9px}
  .sec-n{width:21px;height:21px;border-radius:6px;background:#eef2ff;color:#4338ca;font-size:11px;font-weight:800;display:grid;place-items:center;flex-shrink:0}
  .sec-t{font-size:12px;font-weight:800;letter-spacing:1.1px;color:#0b1f3a;text-transform:uppercase}
  table{width:100%;border-collapse:collapse} td{vertical-align:middle}
  /* Type scale — print sizes, not screen sizes. Every size comes from here. */
  .t-title{font-size:27px;font-weight:800;color:#0b1f3a;letter-spacing:.2px;line-height:1.3;padding:1px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .t-num  {font-size:24px;font-weight:800;line-height:1.12}
  .t-num2 {font-size:19px;font-weight:800;line-height:1.15}
  .t-h2   {font-size:16px;font-weight:800}
  .t-h3   {font-size:13px;font-weight:800;letter-spacing:.3px}
  .t-body {font-size:12.5px;font-weight:400}
  .t-cap  {font-size:11px;font-weight:400}
  .muted{color:#7a8ba6;line-height:1.5}
  .empty{color:#8496b0;background:#f7f9fc;border:1px dashed #dde4ef;border-radius:10px;padding:14px 12px;text-align:center;font-size:12px}
  .foot{margin-top:auto;padding-top:7px;border-top:1px solid #e8edf5;display:flex;justify-content:space-between;align-items:baseline;gap:16px;color:#8a97ad;font-size:10px}
  .toolbar{position:fixed;top:12px;right:14px;z-index:50;display:flex;align-items:center;gap:10px}
  .print-btn{background:#4f46e5;color:#fff;border:none;border-radius:10px;padding:10px 18px;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit;box-shadow:0 6px 18px rgba(79,70,229,.35)}
  .toolbar .t-cap{color:#64748b;background:#fff;border:1px solid #e3e8f2;border-radius:8px;padding:4px 9px}
  .tool-btn{background:#fff;border:1px solid #cdd6e6;color:#334155;border-radius:10px;padding:9px 14px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit}
  .tool-btn.on{background:#eef2ff;border-color:#6366f1;color:#4338ca}
  /* Edit mode: hover shows what a click will edit; × removes a whole block. */
  body.editing .sheet{cursor:text}
  .panel{position:relative}
  body.editing .panel:hover{outline:2px dashed #a5b4fc;outline-offset:2px}
  [contenteditable]:focus{outline:none}
  .del-x{display:none;position:absolute;top:6px;right:6px;width:21px;height:21px;border-radius:6px;border:1px solid #fecaca;background:#fef2f2;color:#dc2626;font-size:12px;font-weight:800;cursor:pointer;line-height:1;z-index:5;font-family:inherit}
  body.editing .del-x{display:block}
  @media print{.toolbar{display:none}.del-x{display:none!important}body.editing .panel:hover{outline:none}}
  </style></head><body>
  <div class="toolbar">
    <span class="t-cap" id="hint">${t('Ctrl+P cũng in được', 'Ctrl+P works too')}</span>
    <button class="tool-btn" id="undoBtn" onclick="undoDel()" style="display:none">↩ ${t('Hoàn tác xoá', 'Undo remove')}</button>
    <button class="tool-btn" id="editBtn" onclick="toggleEdit()">✏️ ${t('Chỉnh sửa', 'Edit')}</button>
    <button class="print-btn" onclick="doPrint()">🖨 ${t('In / Lưu PDF', 'Print / Save PDF')}</button>
  </div>
  ${sheet1}
  ${gbpSheet}
  ${summarySheet}
  <script>
  // Page numbers — filled here because only the assembled document knows how
  // many sheets it has (the Google page appears only when the salon has GBP).
  (function(){
    var ps=document.querySelectorAll('.pg'), n=ps.length;
    for(var i=0;i<n;i++){ ps[i].textContent='Lumio Agency · ${t('Trang', 'Page')} '+(i+1)+'/'+n; }
  })();
  // Safety net, not the layout: if a sheet still overflows the printable
  // 194mm, shrink IT (not the whole document) until it fits. The old version
  // relied on this alone, measured against the full height, and a single
  // footer line spilling over produced a nearly blank ghost page in the PDF.
  function fitPages(){
    var MM=96/25.4, MAX=190*MM;
    var ps=document.querySelectorAll('.sheet');
    for(var i=0;i<ps.length;i++){
      var el=ps[i]; el.style.zoom=''; var h=el.getBoundingClientRect().height;
      if(h>MAX){ el.style.zoom=Math.max(0.6,(MAX-6)/h); }
    }
  }
  // The zoom exists to squeeze a sheet onto PAPER. It used to stay applied
  // after the print dialog closed, so on screen one sheet rendered at 88% and
  // the next at 100% — pages of visibly different sizes, which reads as the
  // layout jumping around. Paper gets the fit; the screen goes back to 1:1.
  function clearFit(){
    var ps=document.querySelectorAll('.sheet');
    for(var i=0;i<ps.length;i++){ ps[i].style.zoom=''; }
  }
  // Ctrl+P and the browser menu land here too, so the fit always applies.
  window.onbeforeprint=fitPages;
  window.onafterprint=clearFit;
  // Printing happens when the PERSON asks, never on load. The old template
  // fired window.print() the moment it opened — right for the one button in
  // the app whose whole job is printing, and wrong everywhere else: opening
  // the file just to read it slammed a print dialog in your face, and inside
  // embedded viewers that cannot print at all it opened a dead dialog over
  // the report. A visible button costs one click and surprises nobody.
  // ---- Edit-before-publish -------------------------------------------------
  // The rule this exists for: NOTHING reaches a client that a person could not
  // change first. The app's editor covers the AI text and the manual numbers;
  // this covers the last mile — standing in front of the finished page, a
  // sentence to soften, a number to hide, a whole block the client should not
  // see. Click any text to retype it; × removes a block; undo brings it back.
  //
  // Deliberately NOT saved anywhere: this is proofing one export, like pen on
  // a printout. The durable numbers and the AI text keep living in the app,
  // where the next month's report is generated from them.
  var editing=false; var undoStack=[];
  function toggleEdit(){
    editing=!editing;
    document.body.classList.toggle('editing',editing);
    var sh=document.querySelectorAll('.sheet');
    for(var i=0;i<sh.length;i++){ sh[i].contentEditable=editing?'true':'false'; }
    var b=document.getElementById('editBtn');
    b.classList.toggle('on',editing);
    b.textContent=editing?'✓ ${t('Xong', 'Done')}':'✏️ ${t('Chỉnh sửa', 'Edit')}';
    document.getElementById('hint').textContent=editing
      ? '${t('Bấm vào chữ/số bất kỳ để sửa · dấu × xoá cả khối', 'Click any text to edit · × removes a block')}'
      : '${t('Ctrl+P cũng in được', 'Ctrl+P works too')}';
    document.getElementById('undoBtn').style.display=(editing&&undoStack.length)?'':'none';
    if(editing) ensureDelButtons();
  }
  function ensureDelButtons(){
    var ps=document.querySelectorAll('.panel');
    for(var i=0;i<ps.length;i++){
      if(ps[i].querySelector('.del-x')) continue;
      var x=document.createElement('button');
      x.className='del-x'; x.textContent='×'; x.contentEditable='false';
      x.title='${t('Xoá khối này khỏi bản in', 'Remove this block from the print')}';
      x.onclick=function(ev){ ev.preventDefault(); ev.stopPropagation(); removePanel(this); };
      ps[i].appendChild(x);
    }
  }
  function removePanel(btn){
    var el=btn.closest('.panel'); if(!el) return;
    undoStack.push({el:el,parent:el.parentNode,next:el.nextSibling});
    el.remove();
    document.getElementById('undoBtn').style.display='';
  }
  function undoDel(){
    var it=undoStack.pop();
    if(it&&it.parent){ it.parent.insertBefore(it.el,it.next); }
    if(!undoStack.length){ document.getElementById('undoBtn').style.display='none'; }
  }
  function doPrint(){
    // Paper never sees the editing chrome — carets, dashed outlines, × buttons.
    if(editing) toggleEdit();
    var ready=(document.fonts&&document.fonts.ready)?document.fonts.ready:Promise.resolve();
    var done=false;
    ready.then(function(){ if(done) return; done=true; fitPages(); window.print(); clearFit(); });
    // A blocked font CDN must delay the button by at most a second, not hang it.
    setTimeout(function(){ if(done) return; done=true; fitPages(); window.print(); clearFit(); },1000);
  }
  </script></body></html>`;

  const w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close(); }
}

function Kpi({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: string }) {
  return (
    <div style={{ background: 'var(--c111827)', border: '1px solid var(--c1e293b)', borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent ?? 'var(--cf8fafc)' }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: 'var(--c64748b)', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function ChannelsSection({ token, vi, month, onSynced }: { token: string | null; vi: boolean; month: string; onSynced: () => void }) {
  const T = (v: string, e: string) => (vi ? v : e);
  interface Ch { platform: string; label: string; enabled: boolean; hasSpend: boolean; connected: boolean; status: string | null; accountName: string | null; externalAccountId: string | null; keyHint: string | null; lastSyncedAt: string | null; lastError: string | null; }
  const [chs, setChs] = useState<Ch[]>([]);
  const [openP, setOpenP] = useState<string | null>(null);
  const [f, setF] = useState<{ externalAccountId: string; token: string; refreshToken: string; clientId: string; clientSecret: string }>({ externalAccountId: '', token: '', refreshToken: '', clientId: '', clientSecret: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try { setChs(await apiFetch<Ch[]>('/marketing/channels', { token })); } catch (e) { setErr(e instanceof Error ? e.message : 'error'); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function connect(platform: string) {
    setBusy(platform); setErr(null); setNote(null);
    try {
      await apiFetch('/marketing/channels/connect', { method: 'POST', token, body: { platform, externalAccountId: f.externalAccountId || undefined, token: f.token || undefined, refreshToken: f.refreshToken || undefined, clientId: f.clientId || undefined, clientSecret: f.clientSecret || undefined } });
      setNote(T('Đã kết nối.', 'Connected.')); setOpenP(null); setF({ externalAccountId: '', token: '', refreshToken: '', clientId: '', clientSecret: '' }); await load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'error'); } finally { setBusy(null); }
  }
  async function test(platform: string) { setBusy(platform); setErr(null); setNote(null); try { const r = await apiFetch<{ ok: boolean; error?: string }>(`/marketing/channels/test/${platform}`, { method: 'POST', token }); setNote(r.ok ? T('Kết nối OK ✓', 'Connection OK ✓') : `✗ ${r.error ?? ''}`); await load(); } catch (e) { setErr(e instanceof Error ? e.message : 'error'); } finally { setBusy(null); } }
  async function sync(platform: string) { setBusy(platform); setErr(null); setNote(null); try { await apiFetch('/marketing/channels/sync', { method: 'POST', token, body: { platform, month } }); setNote(T('Đã đồng bộ chi phí về tháng ' + month, 'Synced spend for ' + month)); await load(); onSynced(); } catch (e) { setErr(e instanceof Error ? e.message : 'error'); } finally { setBusy(null); } }
  async function disconnect(platform: string) { if (!confirm(T('Ngắt kết nối kênh này?', 'Disconnect this channel?'))) return; setBusy(platform); try { await apiFetch(`/marketing/channels/${platform}`, { method: 'DELETE', token }); await load(); } catch (e) { setErr(e instanceof Error ? e.message : 'error'); } finally { setBusy(null); } }

  return (
    <div style={{ ...ui.card, marginBottom: 16 }}>
      <div style={cardTitle}>{T('Kênh kết nối (tự đồng bộ chi phí)', 'Connected channels (auto-sync spend)')}</div>
      <p style={{ color: 'var(--c64748b)', fontSize: 11.5, margin: '4px 0 12px', lineHeight: 1.5 }}>
        {T('Chỉ cần ID tài khoản (act_… / locations/…) — token để trống nếu Lumio đã cấu hình token chung của agency trên server. Dán token riêng chỉ khi tiệm tự quản lý quảng cáo.', 'Just the account ID (act_… / locations/…) — leave the token blank if the agency-wide token is configured on the server. Paste a token only when the salon runs its own ads.')}
      </p>
      {err && <div style={{ ...ui.banner, marginBottom: 10 }}>{err}</div>}
      {note && <div style={{ ...ui.banner, background: 'var(--c064e3b)', borderColor: '#059669', color: 'var(--cd1fae5)', marginBottom: 10 }}>{note}</div>}
      {chs.map((c) => (
        <div key={c.platform} style={{ borderTop: '1px solid var(--c1e293b)', padding: '10px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, color: 'var(--ce2e8f0)', display: 'flex', alignItems: 'center', gap: 8 }}>
              {c.label}
              {!c.enabled && <span style={{ fontSize: 10.5, color: 'var(--c94a3b8)', border: '1px solid var(--c334155)', borderRadius: 999, padding: '1px 8px' }}>{T('sắp có', 'coming soon')}</span>}
              {c.connected && !c.keyHint?.startsWith('LINKED:') && <span style={{ fontSize: 10.5, color: '#22c55e', border: '1px solid #22c55e', borderRadius: 999, padding: '1px 8px' }}>{T('đã kết nối', 'connected')}</span>}
              {/* A linked channel explains itself. A bare green tick reads as
                  "somebody set this up here"; this one says which existing
                  connection it is riding on, so nobody hunts for settings that
                  do not exist on this page. */}
              {c.keyHint === 'LINKED:messenger' && <span style={{ fontSize: 10.5, color: '#22c55e', border: '1px solid var(--c166534)', background: 'var(--c052e16)', borderRadius: 999, padding: '1px 8px' }}>{T('✓ tự dùng kết nối Messenger AI', '✓ using the Messenger AI connection')}</span>}
              {c.keyHint === 'LINKED:google-reviews' && <span style={{ fontSize: 10.5, color: '#22c55e', border: '1px solid var(--c166534)', background: 'var(--c052e16)', borderRadius: 999, padding: '1px 8px' }}>{T('✓ tự dùng kết nối Google Reviews', '✓ using the Google Reviews connection')}</span>}
              {c.status === 'ERROR' && <span style={{ fontSize: 10.5, color: 'var(--cf87171)', border: '1px solid var(--cf87171)', borderRadius: 999, padding: '1px 8px' }}>{T('lỗi', 'error')}</span>}
            </span>
            <span style={{ display: 'flex', gap: 6 }}>
              {c.enabled && !c.connected && <button onClick={() => { setOpenP(openP === c.platform ? null : c.platform); setErr(null); setNote(null); }} style={miniBtn}>{openP === c.platform ? T('Đóng', 'Close') : T('Kết nối', 'Connect')}</button>}
              {c.connected && <>
                <button onClick={() => test(c.platform)} disabled={busy === c.platform} style={miniBtn}>{T('Kiểm tra', 'Test')}</button>
                <button onClick={() => sync(c.platform)} disabled={busy === c.platform} style={{ ...miniBtn, borderColor: '#6366f1', color: 'var(--cc7d2fe)' }}>{busy === c.platform ? '…' : T('Đồng bộ', 'Sync')}</button>
                {c.keyHint?.startsWith('LINKED:')
                  /* Nothing to disconnect HERE — the credentials live on the
                     Messenger AI / Google Reviews screen. Removing them there
                     removes them here. What CAN be done here is overriding
                     with this page's own credentials, which then win. */
                  ? <button onClick={() => { setOpenP(openP === c.platform ? null : c.platform); setErr(null); setNote(null); }} style={miniBtn}>{openP === c.platform ? T('Đóng', 'Close') : T('Dùng token riêng', 'Use own token')}</button>
                  : <button onClick={() => disconnect(c.platform)} disabled={busy === c.platform} style={{ ...miniBtn, borderColor: 'var(--c7f1d1d)', color: 'var(--cfca5a5)' }}>{T('Ngắt', 'Remove')}</button>}
              </>}
            </span>
          </div>
          {c.connected && <div style={{ fontSize: 11, color: 'var(--c64748b)', marginTop: 4 }}>
            {c.accountName || c.externalAccountId} {c.lastSyncedAt ? '· ' + T('đồng bộ', 'synced') + ' ' + new Date(c.lastSyncedAt).toLocaleString(uiLocale()) : ''}{c.lastError ? ' · ' + c.lastError : ''}
            {c.keyHint === 'LINKED:messenger' && <> · {T('Quản lý ở mục', 'Managed in')} <a href="/salon/messenger" style={{ color: 'var(--c818cf8)' }}>Messenger AI</a></>}
            {c.keyHint === 'LINKED:google-reviews' && <> · {T('Quản lý ở mục', 'Managed in')} <a href="/salon/reviews-replies" style={{ color: 'var(--c818cf8)' }}>Google Reviews</a></>}
          </div>}
          {openP === c.platform && (
            <div style={{ marginTop: 8, background: 'var(--c0f172a)', borderRadius: 8, padding: 10, display: 'grid', gap: 6 }}>
              <input style={inp} name="lumio-account-id" autoComplete="off" placeholder={c.platform === 'meta_social' ? 'Facebook Page ID hoặc username (vd: VinaNailsSpa)' : c.platform === 'meta' ? 'Ad Account ID (act_...)' : c.platform === 'gbp' ? 'Location ID — vd: 17202153832315858041' : c.platform === 'tiktok' ? T('Bỏ trống — TikTok nhận diện qua token', 'Leave blank — TikTok is identified by the token') : 'Account ID'} value={f.externalAccountId} onChange={(e) => setF({ ...f, externalAccountId: e.target.value })} />
              {c.platform === 'meta_social'
                ? <div style={{ fontSize: 10.5, color: 'var(--c64748b)', lineHeight: 1.5 }}>{T('Token do Lumio cấu hình sẵn trên server — chỉ cần Page ID/username. Instagram tự nhận từ Trang đã liên kết.', 'The token is pre-configured on the Lumio server — just the Page ID/username. Instagram is auto-detected from the linked Page.')}</div>
                : c.platform === 'tiktok' ? null
                : <input style={inp} type="password" placeholder={T('Access token', 'Access token')} value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} autoComplete="off" />}
              {c.platform === 'gbp' && <>
                <div style={{ fontSize: 10.5, color: 'var(--c64748b)', lineHeight: 1.5 }}>{T('CHỈ cần Location ID — token Google đã cấu hình sẵn trên server (dùng chung cho mọi salon). Để trống 3 ô dưới. Chỉ điền nếu salon tự dùng tài khoản Google riêng.', 'Just the Location ID — the Google token is pre-configured on the server (shared for all salons). Leave the 3 fields below blank. Only fill them if the salon uses its own Google account.')}</div>
                <input style={inp} type="password" placeholder="Refresh token" value={f.refreshToken} onChange={(e) => setF({ ...f, refreshToken: e.target.value })} autoComplete="off" />
                <input style={inp} placeholder="OAuth Client ID" value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })} />
                <input style={inp} type="password" placeholder="OAuth Client Secret" value={f.clientSecret} onChange={(e) => setF({ ...f, clientSecret: e.target.value })} autoComplete="off" />
              </>}
              {c.platform === 'tiktok' && <>
                <div style={{ fontSize: 10.5, color: 'var(--c64748b)', lineHeight: 1.5 }}>{T('Dán Refresh token TikTok của salon — client key/secret đã cấu hình trên server. Ô Account ID để trống.', 'Paste the salon TikTok Refresh token — client key/secret are on the server. Leave Account ID blank.')}</div>
                <input style={inp} type="password" placeholder="TikTok Refresh token" value={f.refreshToken} onChange={(e) => setF({ ...f, refreshToken: e.target.value })} autoComplete="off" />
              </>}
              <button onClick={() => connect(c.platform)} disabled={busy === c.platform || (!f.externalAccountId && !f.refreshToken && !f.token)} style={{ ...ui.primaryBtn, justifySelf: 'start' }}>{busy === c.platform ? '…' : T('Lưu & kiểm tra', 'Save & verify')}</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function PostRowView({ p, T }: { p: PostRow; T: (v: string, e: string) => string }) {
  const img = !!p.thumbnail && p.thumbnail.startsWith('http');
  const dt = p.timestamp ? new Date(p.timestamp).toLocaleDateString(uiLocale(), { month: 'short', day: 'numeric' }) : '';
  const typeLabel = p.type === 'reel' ? 'Reel' : p.type === 'video' ? 'Video' : p.type === 'carousel_album' ? 'Album' : T('Ảnh', 'Photo');
  const num = (n: number | null) => (n == null ? null : Number(n).toLocaleString(uiLocale()));
  const stat = (label: string, v: number | null) => (v == null ? null : <span key={label} style={{ whiteSpace: 'nowrap' }}><b style={{ color: 'var(--cf8fafc)' }}>{num(v)}</b> <span style={{ color: 'var(--c64748b)' }}>{label}</span></span>);
  const stats = [stat(T('thích', 'likes'), p.likes), stat(T('bl', 'cmts'), p.comments), stat('reach', p.reach), stat(T('xem', 'views'), p.views), stat(T('lưu', 'saved'), p.saved), stat('share', p.shares)].filter(Boolean);
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', background: 'var(--c0f172a)', border: '1px solid var(--c1e293b)', borderRadius: 10, padding: '8px 10px' }}>
      {img
        ? <span style={{ width: 46, height: 46, borderRadius: 8, flexShrink: 0, background: `var(--c1e293b) center/cover no-repeat url(${p.thumbnail})` }} />
        : <span style={{ width: 46, height: 46, borderRadius: 8, flexShrink: 0, background: 'var(--c1e293b)', display: 'grid', placeItems: 'center', fontSize: 18 }}>📷</span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--ca5b4fc)', background: 'var(--c1e293b)', borderRadius: 4, padding: '1px 6px' }}>{typeLabel}</span>
          <span style={{ fontSize: 11, color: 'var(--c64748b)', flexShrink: 0 }}>{dt}</span>
          {p.caption && <span style={{ fontSize: 11.5, color: 'var(--c94a3b8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.caption}</span>}
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 4, fontSize: 11.5, color: 'var(--ce2e8f0)' }}>{stats.length ? stats : <span style={{ color: 'var(--c64748b)', fontSize: 11 }}>{T('chưa có số liệu', 'no metrics')}</span>}</div>
      </div>
      {p.permalink && <a href={p.permalink} target="_blank" rel="noreferrer" style={{ color: 'var(--c818cf8)', fontSize: 11, textDecoration: 'none', flexShrink: 0 }}>{T('Xem', 'Open')} ↗</a>}
    </div>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const w = 240, h = 38, pad = 3;
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - 2 * pad);
    const y = h - pad - ((v - min) / span) * (h - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: 36, marginTop: 8, display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function AudienceSection({ a, T }: { a: { gender?: Record<string, number>; age?: Record<string, number> }; T: (v: string, e: string) => string }) {
  const order: [string, string, string][] = [['F', T('Nữ', 'Female'), '#e1306c'], ['M', T('Nam', 'Male'), '#3b82f6'], ['U', T('Khác', 'Other'), 'var(--c94a3b8)']];
  const g = a.gender || {};
  const gTotal = Object.values(g).reduce((x, y) => x + y, 0) || 1;
  const gPct = order.map(([k, label, col]) => ({ label, col, pct: Math.round(((g[k] || 0) / gTotal) * 1000) / 10 })).filter((x) => x.pct > 0);
  let acc = 0;
  const stops = gPct.map((x) => { const from = acc; acc += x.pct; return `${x.col} ${from}% ${acc}%`; }).join(', ');
  const ageMap = a.age || {};
  const ageKeys = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'].filter((k) => ageMap[k] != null);
  const ageTotal = Object.values(ageMap).reduce((x, y) => x + y, 0) || 1;
  if (!gPct.length && !ageKeys.length) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={pvL}>{T('ĐỐI TƯỢNG INSTAGRAM', 'INSTAGRAM AUDIENCE')}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 8 }}>
        {gPct.length > 0 && (
          <div style={{ background: 'var(--c0f172a)', border: '1px solid var(--c1e293b)', borderRadius: 10, padding: 12, display: 'flex', gap: 14, alignItems: 'center' }}>
            <div style={{ width: 74, height: 74, borderRadius: '50%', flexShrink: 0, background: `conic-gradient(${stops})`, WebkitMask: 'radial-gradient(circle 22px at center, transparent 98%, #000 100%)', mask: 'radial-gradient(circle 22px at center, transparent 98%, #000 100%)' }} />
            <div style={{ fontSize: 12, flex: 1 }}>
              <div style={{ fontSize: 11.5, color: 'var(--c94a3b8)', marginBottom: 4 }}>{T('Giới tính', 'Gender')}</div>
              {gPct.map((x) => <div key={x.label} style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '3px 0' }}><span style={{ width: 9, height: 9, borderRadius: 2, background: x.col }} /><span style={{ color: 'var(--ccbd5e1)' }}>{x.label}</span><b style={{ color: 'var(--cf8fafc)', marginLeft: 'auto' }}>{x.pct}%</b></div>)}
            </div>
          </div>
        )}
        {ageKeys.length > 0 && (
          <div style={{ background: 'var(--c0f172a)', border: '1px solid var(--c1e293b)', borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 11.5, color: 'var(--c94a3b8)', marginBottom: 6 }}>{T('Độ tuổi', 'Age')}</div>
            {ageKeys.map((k) => { const pct = Math.round(((ageMap[k] || 0) / ageTotal) * 1000) / 10; return (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '3px 0' }}>
                <span style={{ width: 42, fontSize: 11, color: 'var(--c94a3b8)' }}>{k}</span>
                <span style={{ flex: 1, height: 8, background: 'var(--c1e293b)', borderRadius: 4, overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${pct}%`, background: 'var(--c818cf8)' }} /></span>
                <span style={{ width: 38, fontSize: 11, color: 'var(--ce2e8f0)', textAlign: 'right' }}>{pct}%</span>
              </div>
            ); })}
          </div>
        )}
      </div>
    </div>
  );
}

function SocialCard({ s, vi, T }: { s: SocialInsight; vi: boolean; T: (v: string, e: string) => string }) {
  const isIg = s.platform === 'instagram';
  const isTt = s.platform === 'tiktok';
  const name = isTt ? 'TikTok' : isIg ? 'Instagram' : 'Facebook';
  const color = isTt ? '#25f4ee' : isIg ? '#e1306c' : '#1877f2';
  const fmt = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString(uiLocale()));
  const arrow = (dl?: SocialDelta | null) =>
    dl && dl.pct != null ? <span style={{ color: dl.pct >= 0 ? '#22c55e' : 'var(--cf87171)', fontSize: 10.5, fontWeight: 700 }}>{dl.pct >= 0 ? '▲' : '▼'}{Math.abs(dl.pct)}%</span> : null;
  const Stat = (label: string, val: number | null, dl?: SocialDelta | null) => (
    <div key={label} style={{ textAlign: 'center', flex: 1, minWidth: 62 }}>
      <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--cf8fafc)' }}>{fmt(val)}</div>
      <div style={{ fontSize: 10.5, color: 'var(--c94a3b8)' }}>{label}</div>
      <div style={{ minHeight: 14 }}>{arrow(dl)}</div>
    </div>
  );
  const stats = [
    Stat(T('Follower', 'Followers'), s.followers, s.vsPrev?.followers),
    s.newFollowers != null ? Stat(T('Follower mới', 'New follows'), s.newFollowers, s.vsPrev?.newFollowers) : null,
    s.reach != null ? Stat('Reach', s.reach, s.vsPrev?.reach) : null,
    s.views != null ? Stat(T('Lượt xem', 'Views'), s.views, s.vsPrev?.views) : null,
    s.engagement != null ? Stat(T('Tương tác', 'Engagement'), s.engagement, s.vsPrev?.engagement) : null,
  ].filter(Boolean);
  const empty = s.followers == null && s.reach == null && s.views == null && s.engagement == null && s.newFollowers == null;
  const engRate = (s.engagement != null && s.reach && s.reach > 0) ? Math.round((s.engagement / s.reach) * 1000) / 10 : null;
  const series = s.series ?? [];
  const ms = s.monthlySeries ?? [];
  const cum: number[] = [];
  if (isIg && series.length > 1) {
    // Instagram: smooth daily follower line within the month.
    const vals = series.map((x) => x.value || 0);
    let base = (s.followers ?? 0) - vals.reduce((a, b) => a + b, 0);
    for (const v of vals) { base += v; cum.push(base); }
  } else if (ms.length > 1) {
    // Facebook (no live daily metric): month-by-month follower snapshots.
    for (const m of ms) cum.push(m.followers);
  }
  return (
    <div style={{ background: 'var(--c0f172a)', border: '1px solid var(--c1e293b)', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ width: 9, height: 9, borderRadius: 3, background: color, display: 'inline-block' }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{name}</span>
        {s.postsCount != null && <span style={{ fontSize: 10.5, color: 'var(--c64748b)', marginLeft: 'auto' }}>{s.postsCount} {T('bài', 'posts')}</span>}
      </div>
      {empty
        ? <div style={{ fontSize: 11.5, color: 'var(--c64748b)' }}>{T('Chưa có số liệu tháng này.', 'No data for this month yet.')}</div>
        : <>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{stats}</div>
            {engRate != null && <div style={{ fontSize: 11, color: 'var(--c94a3b8)', marginTop: 8 }}>{T('Tỉ lệ tương tác', 'Engagement rate')}: <b style={{ color: 'var(--ce2e8f0)' }}>{engRate}%</b></div>}
            {cum.length > 1 && <Sparkline data={cum} color={color} />}
          </>}
    </div>
  );
}

function MktTabs({ vi, active }: { vi: boolean; active: 'monthly' | 'live' }) {
  const tab = (on: boolean): CSSProperties => ({ padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: on ? 700 : 500, textDecoration: 'none', color: on ? '#fff' : 'var(--c94a3b8)', background: on ? '#6366f1' : 'transparent', border: on ? 'none' : '1px solid var(--c334155)' });
  return (
    <div style={{ display: 'inline-flex', gap: 6, marginBottom: 14 }}>
      <a href="/salon/marketing/monthly" style={tab(active === 'monthly')}>{vi ? 'Báo cáo tháng' : 'Monthly report'}</a>
      <a href="/salon/marketing/report" style={tab(active === 'live')}>{vi ? 'Tổng quan trực tiếp' : 'Live overview'}</a>
    </div>
  );
}
// Every background here is a THEMED token. Two of them used to be hand-picked
// dark hexes (#3a2606, #0b1e3a) outside the palette — at night they looked
// intentional, and in light mode they were the unreadable dark-brown box the
// owner photographed: the card kept its midnight background while the text
// inside dutifully flipped to ink.
const VERDICT: Record<string, [string, string, string]> = {
  good: ['#22c55e', 'var(--c052e16)', 'Tốt'],
  ok: ['#3b82f6', 'var(--c172554)', 'Ổn'],
  weak: ['#f59e0b', 'var(--c451a03)', 'Yếu'],
  nodata: ['var(--c64748b)', 'var(--c1e293b)', 'Chưa đủ dữ liệu'],
};
const CH_NAME: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', google_ads: 'Google Ads', gbp: 'Google Maps', seo: 'SEO', email: 'Email', sms: 'SMS', website: 'Website', other: 'Khác' };

function GbpCard({ g, T }: { g: GbpData; T: (v: string, e: string) => string }) {
  const fmt = (n: number | null | undefined) => (n == null ? '\u2014' : Number(n).toLocaleString(uiLocale()));
  const arrow = (d?: SocialDelta | null) => (d && d.pct != null ? <span style={{ color: d.pct >= 0 ? '#22c55e' : 'var(--cf87171)', fontSize: 10.5, fontWeight: 700 }}>{d.pct >= 0 ? '\u25B2' : '\u25BC'}{Math.abs(d.pct)}%</span> : null);
  const Stat = (label: string, val: number | null | undefined, d?: SocialDelta | null) => (
    <div key={label} style={{ textAlign: 'center', flex: 1, minWidth: 80 }}>
      <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--cf8fafc)' }}>{fmt(val)}</div>
      <div style={{ fontSize: 10.5, color: 'var(--c94a3b8)' }}>{label}</div>
      <div style={{ minHeight: 14 }}>{arrow(d)}</div>
    </div>
  );
  const v = g.vsPrev || ({} as NonNullable<GbpData['vsPrev']>);
  const totImp = g.impressions || 0;
  const bar = (label: string, val: number | null | undefined, color: string) => {
    const pct = totImp > 0 ? Math.round(((val || 0) / totImp) * 100) : 0;
    return (
      <div style={{ margin: '4px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--c94a3b8)' }}><span>{label}</span><b style={{ color: 'var(--ce2e8f0)' }}>{fmt(val)} · {pct}%</b></div>
        <div style={{ height: 7, background: 'var(--c1e293b)', borderRadius: 4, overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${pct}%`, background: color }} /></div>
      </div>
    );
  };
  const kw = (g.keywords || []).slice(0, 6);
  return (
    <div style={{ background: 'var(--c0f172a)', border: '1px solid var(--c1e293b)', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: '#1a73e8' }} /><span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ce2e8f0)' }}>Google Business Profile (Maps)</span></div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {Stat(T('L\u01b0\u1ee3t xem', 'Views'), g.impressions, v.impressions)}
        {Stat(T('G\u1ecdi', 'Calls'), g.calls, v.calls)}
        {Stat(T('Ch\u1ec9 \u0111\u01b0\u1eddng', 'Directions'), g.directions, v.directions)}
        {Stat(T('Web', 'Website'), g.websiteClicks, v.websiteClicks)}
        {Stat(T('\u0110\u1eb7t l\u1ecbch', 'Bookings'), g.bookings, v.bookings)}
        {Stat(T('Nh\u1eafn tin', 'Messages'), g.conversations, v.conversations)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 10 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--c64748b)', marginBottom: 2 }}>{T('Ngu\u1ed3n hi\u1ec3n th\u1ecb', 'Where seen')}</div>
          {bar(T('T\u00ecm ki\u1ebfm', 'Search'), g.searchImpr, '#4285F4')}
          {bar('Maps', g.mapsImpr, '#34A853')}
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--c64748b)', marginBottom: 2 }}>{T('T\u1eeb kho\u00e1 kh\u00e1ch t\u00ecm', 'Top searches')}</div>
          {kw.length ? kw.map((k, i) => (<div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ccbd5e1)', margin: '2px 0' }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.keyword}</span><b style={{ color: 'var(--ce2e8f0)', marginLeft: 8 }}>{fmt(k.count)}</b></div>)) : <div style={{ fontSize: 11, color: 'var(--c64748b)' }}>{T('Ch\u01b0a c\u00f3', 'None')}</div>}
        </div>
      </div>
    </div>
  );
}

function ReportView({ data, content, vi, money, onEdit, onPrint, onWord, wordBusy, T }: { data: Monthly | null; content: Content | null; vi: boolean; money: (n: number) => string; onEdit: () => void; onPrint: () => void; onWord: () => void; wordBusy: boolean; T: (v: string, e: string) => string }) {
  if (!data) return <p style={{ color: 'var(--c94a3b8)' }}>Loading…</p>;
  const L = (it?: Item) => (vi ? (it?.vi || it?.en) : (it?.en || it?.vi)) || '';
  const o = data.outcome; const b = data.blended; const d = data.deltas;
  const eff = data.effectiveness || 'organic';
  const effMap: Record<string, [string, string]> = { good: ['#059669', T('Hiệu quả tốt', 'Performing well')], ok: ['#2563eb', T('Đang có hiệu quả', 'On track')], weak: ['#d97706', T('Cần cải thiện', 'Needs work')], low: ['#d97706', T('Cần cải thiện', 'Needs work')], organic: ['var(--c64748b)', T('Tăng trưởng tự nhiên', 'Organic growth')] };
  const [effColor, effLabel] = effMap[eff] ?? effMap.organic;
  const hasReport = !!content && !content._aiUnavailable && (!!L(content.headline) || !!L(content.tldr) || (content.plan ?? []).length > 0 || (content.channels ?? []).length > 0);

  const arrow = (dl?: Delta) => dl && dl.pct != null ? <span style={{ color: dl.pct >= 0 ? '#22c55e' : 'var(--cf87171)', fontSize: 11, fontWeight: 700 }}>{dl.pct >= 0 ? '▲' : '▼'} {Math.abs(dl.pct)}%</span> : null;
  const spendRows = (data.spend ?? []).filter((x) => x.amountCents > 0).sort((a, z) => z.amountCents - a.amountCents);
  const spendByCh: Record<string, SpendRow> = {}; (data.spend ?? []).forEach((x) => { spendByCh[x.channel] = x; });
  const vLabel = (v: string) => T(({ good: 'Tốt', ok: 'Ổn', weak: 'Yếu', nodata: 'Chưa đủ dữ liệu' } as Record<string, string>)[v] || v, ({ good: 'Good', ok: 'OK', weak: 'Weak', nodata: 'No data' } as Record<string, string>)[v] || v);
  const chMetrics = (name: string) => {
    const sp = spendByCh[name]; if (!sp) return '';
    const parts = [money(sp.amountCents)];
    if (sp.leads) { parts.push(`${sp.leads} ${T('liên hệ', 'leads')}`); parts.push(`${money(Math.round(sp.amountCents / sp.leads))}/${T('liên hệ', 'lead')}`); }
    else if (sp.clicks) { parts.push(`${sp.clicks} clicks`); parts.push(`${money(Math.round(sp.amountCents / sp.clicks))}/click`); }
    else if (sp.reach) { parts.push(`${T('tiếp cận', 'reach')} ${sp.reach}`); }
    return parts.join(' · ');
  };
  // Month-over-month chips per channel: spend neutral, performance green/red.
  const chTrendChips = (name: string) => {
    const tr = (data.channelTrends ?? []).find((x) => x.channel === name);
    if (!tr) return null;
    const chip = (label: string, dl: Delta | null, perf: boolean) => {
      if (!dl || dl.pct == null || (dl.value === dl.prev)) return null;
      const up = dl.pct >= 0;
      const col = !perf ? 'var(--c94a3b8)' : up ? '#22c55e' : 'var(--cf87171)';
      return <span key={label} style={{ color: col, fontSize: 11, fontWeight: 700, marginRight: 8 }}>{label} {up ? '▲' : '▼'}{Math.abs(dl.pct)}%</span>;
    };
    const chips = [chip(T('Chi', 'Spend'), tr.spend, false), chip('Reach', tr.reach, true), chip('Click', tr.clicks, true), chip(T('Liên hệ', 'Leads'), tr.leads, true)].filter(Boolean);
    if (chips.length === 0) return null;
    return <div style={{ marginTop: 4 }}>{chips}<span style={{ color: 'var(--c475569)', fontSize: 10.5 }}>{T('so tháng trước', 'vs last month')}</span></div>;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 1120, width: '100%', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ background: effColor, color: '#fff', borderRadius: 20, padding: '5px 14px', fontSize: 13, fontWeight: 700 }}>{effLabel}</span>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onWord} disabled={wordBusy} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ce2e8f0)', fontSize: 13, cursor: wordBusy ? 'wait' : 'pointer', opacity: wordBusy ? 0.6 : 1 }}>{wordBusy ? T('Đang tạo…', 'Building…') : T('Tải Word (.docx)', 'Download Word')}</button>
            <button onClick={onPrint} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ce2e8f0)', fontSize: 13, cursor: 'pointer' }}>{T('Xuất PDF / In', 'Export PDF / Print')}</button>
          </div>
          <span style={{ fontSize: 10.5, color: 'var(--c64748b)' }}>{T('Word: chỉnh chữ, bảng, bố cục tự do · Trong bản in: nút ✏️ sửa từng chữ trước khi gửi khách', 'Word: freely edit text & tables · Print view: ✏️ edits every word before it goes out')}</span>
        </div>
      </div>

      {L(content?.headline) && <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--cf8fafc)', lineHeight: 1.35 }}>{L(content?.headline)}</div>}

      {L(content?.tldr) && (
        <div style={{ background: 'var(--c0f172a)', border: '1px solid #4f46e5', borderLeft: '4px solid #6366f1', borderRadius: 10, padding: '12px 15px' }}>
          <div style={{ fontSize: 11, color: 'var(--ca5b4fc)', fontWeight: 700, letterSpacing: 0.3, marginBottom: 4 }}>{T('TÓM TẮT CHO CHỦ TIỆM', 'EXECUTIVE SUMMARY')}</div>
          <div style={{ fontSize: 14, color: 'var(--ce2e8f0)', lineHeight: 1.6 }}>{L(content?.tldr)}</div>
        </div>
      )}

      {/* Pillar 1 + 2 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        <div style={pv}><div style={pvL}>① {T('ĐÃ CHI', 'SPENT')}</div><div style={pvBig}>{money(b?.totalSpendCents ?? 0)} <span style={{ fontSize: 12, verticalAlign: 'middle' }}>{arrow(d?.spendCents)}</span></div>{spendRows.length > 0 && <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginTop: 6 }}>{spendRows.map((x) => `${CH_NAME[x.channel] || x.channel} ${money(x.amountCents)}`).join(' · ')}</div>}{(() => {
          const tot = (k: 'reach' | 'clicks') => (data.channelTrends ?? []).reduce((a, t) => { const dl = t[k]; return { v: a.v + (dl?.value ?? 0), p: a.p + (dl?.prev ?? 0) }; }, { v: 0, p: 0 });
          const mk = (label: string, o: { v: number; p: number }) => {
            if (o.v === 0 && o.p === 0) return null;
            const pct = o.p > 0 ? Math.round(((o.v - o.p) / o.p) * 100) : null;
            return <span key={label} style={{ marginRight: 10 }}>{label} <b style={{ color: 'var(--ce2e8f0)' }}>{o.v.toLocaleString()}</b>{pct != null && <span style={{ color: pct >= 0 ? '#22c55e' : 'var(--cf87171)', fontSize: 11, fontWeight: 700 }}> {pct >= 0 ? '▲' : '▼'}{Math.abs(pct)}%</span>}</span>;
          };
          const r2 = mk(T('Hiển thị', 'Reach'), tot('reach')); const c2 = mk('Click', tot('clicks'));
          return (r2 || c2) ? <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginTop: 6 }}>{r2}{c2}</div> : null;
        })()}</div>
        <div style={pv}><div style={pvL}>② {T('MANG VỀ', 'RESULTS')}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {[[String(o.totals.bookings), T('lượt đặt', 'bookings'), d?.bookings, false], [String(o.totals.showed), T('đã đến', 'showed'), d?.showed, false], [String(o.newCustomers), T('khách mới', 'new'), d?.newCustomers, false], [money(o.totals.revenueCents), T('doanh thu', 'revenue'), d?.revenueCents, true]].map((x, i) => (
              <div key={i} style={{ flex: 1, minWidth: 70, textAlign: 'center' }}>
                <div style={{ fontSize: 21, fontWeight: 800, color: x[3] ? '#22c55e' : 'var(--cf8fafc)' }}>{x[0] as string}</div>
                <div style={{ fontSize: 11, color: 'var(--c94a3b8)' }}>{x[1] as string}</div>
                <div>{arrow(x[2] as Delta)}</div>
              </div>
            ))}
          </div>
          {(o.gbp?.bookings ?? 0) > 0 && (
            <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginTop: 8, borderTop: '1px solid var(--c1e293b)', paddingTop: 6 }}>
              {T('Từ Google Maps (đo đích danh)', 'From Google Maps (verified)')}: <b style={{ color: 'var(--ce2e8f0)' }}>{o.gbp!.bookings}</b> {T('lượt đặt', 'bookings')} · {o.gbp!.showed} {T('đã đến', 'showed')} · <b style={{ color: '#22c55e' }}>{money(o.gbp!.revenueCents)}</b>
            </div>
          )}
        </div>
      </div>

      {/* Pillar 3 */}
      {b && b.revenuePerSpend != null && (
        <div style={{ background: 'var(--c052e16)', border: '1px solid #059669', borderRadius: 12, padding: '12px 16px' }}>
          <div style={{ fontSize: 12, color: 'var(--c6ee7b7)', fontWeight: 600, marginBottom: 3 }}>③ {T('HIỆU QUẢ', 'EFFECTIVENESS')}</div>
          <div style={{ fontSize: 15, color: 'var(--cd1fae5)' }}>{T('Mỗi', 'Every')} <b>$1</b> {T('chi ra', 'spent')} → <b>${b.revenuePerSpend}</b> {T('doanh thu', 'revenue')}{b.costPerNewCustomerCents != null && <> · {T('chi phí mỗi khách mới', 'cost / new customer')}: <b>{money(b.costPerNewCustomerCents)}</b></>}</div>
        </div>
      )}

      {/* Organic Facebook / Instagram (owned channels) */}
      {(data.socialInsights ?? []).length > 0 && (
        <div style={pv}>
          <div style={pvL}>{T('KÊNH TỰ NHIÊN — FACEBOOK / INSTAGRAM', 'ORGANIC — FACEBOOK / INSTAGRAM')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10, marginTop: 8 }}>
            {data.socialInsights!.map((sIns) => <SocialCard key={sIns.platform} s={sIns} vi={vi} T={T} />)}
          </div>
          {(data.socialInsights ?? []).filter((x) => (x.posts ?? []).length > 0).map((x) => {
            const posts = x.posts ?? [];
            const label = x.platform === 'facebook' ? T('CHI TIẾT BÀI FACEBOOK', 'FACEBOOK POSTS') : x.platform === 'tiktok' ? T('VIDEO TIKTOK', 'TIKTOK VIDEOS') : T('CHI TIẾT BÀI INSTAGRAM', 'INSTAGRAM POSTS');
            return (
              <div key={x.platform} style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--c94a3b8)', fontWeight: 700, marginBottom: 6 }}>{label} <span style={{ color: 'var(--c475569)' }}>· {posts.length}</span></div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {posts.slice(0, 12).map((p, i) => <PostRowView key={p.id || i} p={p} T={T} />)}
                </div>
                {posts.length > 12 && <div style={{ fontSize: 11, color: 'var(--c64748b)', marginTop: 6 }}>{T(`+ ${posts.length - 12} bài khác`, `+ ${posts.length - 12} more posts`)}</div>}
              </div>
            );
          })}
          {(() => {
            const ig = (data.socialInsights ?? []).find((x) => x.platform === 'instagram');
            const a = ig?.audience;
            if (!a || (!a.gender && !a.age)) return null;
            return <AudienceSection a={a} T={T} />;
          })()}
          {(() => {
            const fbI = (data.socialInsights ?? []).find((x) => x.platform === 'facebook');
            const dbg = fbI?.fbDebug;
            if (!dbg) return null;
            return <div style={{ fontSize: 10.5, color: dbg.error ? '#f59e0b' : 'var(--c64748b)', marginTop: 6 }}>{T('Facebook: đọc được', 'Facebook: read')} <b>{dbg.count}</b> {T('bài', 'posts')}{dbg.error ? ` · ${dbg.error}` : (dbg.count === 0 ? T(' (Page chưa có bài trong tháng)', ' (no page posts this month)') : '')}</div>;
          })()}
          <div style={{ fontSize: 10.5, color: 'var(--c475569)', marginTop: 8, lineHeight: 1.5 }}>
            {T('Số liệu tự nhiên (không tính quảng cáo), lấy trực tiếp từ Facebook/Instagram. Ô trống nghĩa là Meta đã ngừng cung cấp chỉ số đó.',
               'Organic (non-paid) numbers pulled directly from Facebook/Instagram. A blank means Meta no longer provides that metric.')}
          </div>
        </div>
      )}

      {/* Google Business Profile (Maps) */}
      {data.gbp && (data.gbp.impressions != null || data.gbp.calls != null || data.gbp.directions != null || data.gbp.websiteClicks != null || data.gbp.bookings != null) && (
        <div style={pv}>
          <div style={pvL}>{T('K\u00caNH GOOGLE MAPS (BUSINESS PROFILE)', 'GOOGLE MAPS (BUSINESS PROFILE)')}</div>
          <div style={{ marginTop: 8 }}><GbpCard g={data.gbp} T={T} /></div>
          <div style={{ fontSize: 10.5, color: 'var(--c475569)', marginTop: 8, lineHeight: 1.5 }}>
            {T('S\u1ed1 li\u1ec7u l\u1ea5y tr\u1ef1c ti\u1ebfp t\u1eeb Google Business Profile. Xu\u1ea5t PDF \u0111\u1ec3 xem deck GBP \u0111\u1ea7y \u0111\u1ee7 (xu h\u01b0\u1edbng, t\u1ef7 l\u1ec7 h\u00e0nh \u0111\u1ed9ng, \u0111\u1ec1 xu\u1ea5t, m\u1ee5c ti\u00eau).',
               'Pulled directly from Google Business Profile. Export PDF for the full GBP deck (trend, action rate, recommendations, goals).')}
          </div>
        </div>
      )}

      {/* Per-channel evaluation */}
      {hasReport && (content?.channels ?? []).length > 0 && (
        <div style={pv}>
          <div style={pvL}>{T('ĐÁNH GIÁ TỪNG KÊNH', 'CHANNEL EVALUATION')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            {content!.channels!.map((c, i) => {
              const [col, bg] = VERDICT[c.verdict] ?? VERDICT.nodata;
              const metrics = chMetrics(c.name);
              return (
                <div key={i} style={{ background: bg, borderRadius: 8, padding: '9px 12px' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ background: col, color: '#04121f', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{CH_NAME[c.name] || c.name}</span>
                    <span style={{ fontSize: 11, color: col, fontWeight: 700 }}>{vLabel(c.verdict)}</span>
                    {metrics && <span style={{ fontSize: 11.5, color: 'var(--c94a3b8)', marginLeft: 'auto' }}>{metrics}</span>}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--ce2e8f0)', marginTop: 5 }}>{vi ? c.vi : (c.en || c.vi)}</div>
                  {chTrendChips(c.name)}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Highlights (wins) */}
      {hasReport && (content?.highlights ?? []).length > 0 && (
        <div style={pv}>
          <div style={pvL}>{T('ĐIỂM NỔI BẬT', 'HIGHLIGHTS')}</div>
          <div style={{ marginTop: 8, fontSize: 13, color: 'var(--ce2e8f0)', display: 'flex', flexDirection: 'column', gap: 5 }}>
            {content!.highlights!.map((x, i) => <div key={i} style={{ display: 'flex', gap: 8 }}><span style={{ color: '#22c55e', fontWeight: 700 }}>✓</span><span>{L(x)}</span></div>)}
          </div>
        </div>
      )}

      {/* Challenges & solutions */}
      {hasReport && (content?.issues ?? []).length > 0 && (
        <div style={{ ...pv, border: '1px solid #b45309' }}>
          <div style={{ ...pvL, color: '#fbbf24' }}>{T('THÁCH THỨC & HƯỚNG XỬ LÝ', 'CHALLENGES & SOLUTIONS')}</div>
          <div style={{ marginTop: 8, fontSize: 13, color: 'var(--ce2e8f0)', display: 'flex', flexDirection: 'column', gap: 5 }}>
            {content!.issues!.map((x, i) => <div key={i} style={{ display: 'flex', gap: 8 }}><span style={{ color: '#f59e0b', fontWeight: 700 }}>▲</span><span>{L(x)}</span></div>)}
          </div>
        </div>
      )}

      {/* Pillar 4: work done + roadmap */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        <div style={pv}><div style={pvL}>④ {T('ĐÃ LÀM GÌ', 'WHAT WE DID')}</div>
          <div style={{ marginTop: 8, fontSize: 13, color: 'var(--ce2e8f0)' }}>{(data.workLog ?? []).length === 0 ? <span style={{ color: 'var(--c64748b)' }}>{T('Chưa ghi', 'None logged')}</span> : data.workLog.map((w) => <div key={w.id} style={{ margin: '4px 0' }}>✓ {w.title}</div>)}</div>
        </div>
        <div style={{ ...pv, border: '1px solid #6366f1' }}><div style={{ ...pvL, color: 'var(--ca5b4fc)' }}>{T('LỘ TRÌNH THÁNG SAU', 'NEXT-MONTH ROADMAP')}</div>
          <div style={{ marginTop: 8, fontSize: 13, color: 'var(--ce2e8f0)' }}>{(content?.plan ?? []).length === 0 ? <span style={{ color: 'var(--c64748b)' }}>—</span> : content!.plan!.map((x, i) => <div key={i} style={{ margin: '5px 0', display: 'flex', gap: 8 }}><span style={{ color: 'var(--c818cf8)', fontWeight: 700 }}>{i + 1}</span><span>{L(x)}</span></div>)}</div>
        </div>
      </div>

      {L(content?.summary) && <div style={{ fontSize: 13, color: 'var(--ccbd5e1)', background: 'var(--c0f172a)', borderRadius: 10, padding: '11px 13px', lineHeight: 1.6 }}>{L(content?.summary)}</div>}

      {!hasReport && (
        <div style={{ ...pv, textAlign: 'center', padding: 20 }}>
          <p style={{ color: 'var(--c94a3b8)', fontSize: 13, margin: '0 0 10px' }}>{T('Chưa có báo cáo phân tích cho tháng này. Sang "Chỉnh sửa" để nhập chi phí/công việc rồi bấm Tạo báo cáo (AI phân tích từng kênh + lộ trình).', 'No analysis report for this month yet. Go to "Edit" to enter spend/work, then Generate (AI evaluates each channel + roadmap).')}</p>
          <button onClick={onEdit} style={ui.primaryBtn}>{T('Sang Chỉnh sửa', 'Go to Edit')}</button>
        </div>
      )}
    </div>
  );
}

const pv: CSSProperties = { background: 'var(--c111a2c)', border: '1px solid #22304d', borderRadius: 14, padding: '15px 18px', boxShadow: '0 1px 3px rgba(0,0,0,0.22)' };
const pvL: CSSProperties = { fontSize: 11, color: '#93a4c4', fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', borderLeft: '3px solid #6366f1', paddingLeft: 9, lineHeight: 1.2 };
const pvBig: CSSProperties = { fontSize: 28, fontWeight: 800, color: 'var(--cf8fafc)', marginTop: 6, letterSpacing: -0.5 };
const segBtn = (on: boolean): CSSProperties => ({ padding: '7px 18px', borderRadius: 6, border: 'none', background: on ? '#6366f1' : 'transparent', color: on ? '#fff' : 'var(--c94a3b8)', fontSize: 13, fontWeight: on ? 700 : 500, cursor: 'pointer' });
const cardTitle: CSSProperties = { fontSize: 13, fontWeight: 700, color: 'var(--ccbd5e1)' };
const dateInput: CSSProperties = { background: 'var(--c0f172a)', border: '1px solid var(--c334155)', color: 'var(--ce2e8f0)', borderRadius: 8, padding: '7px 10px', fontSize: 13 };
const numInput: CSSProperties = { width: 90, background: 'var(--c0f172a)', border: '1px solid var(--c334155)', color: 'var(--ce2e8f0)', borderRadius: 6, padding: '5px 8px', fontSize: 13 };
const th: CSSProperties = { padding: '6px 8px', fontWeight: 600, fontSize: 12 };
const td: CSSProperties = { padding: '5px 8px' };
const lbl: CSSProperties = { display: 'block', fontSize: 12, color: 'var(--c94a3b8)', marginBottom: 4 };
const ta: CSSProperties = { width: '100%', boxSizing: 'border-box', background: 'var(--c0f172a)', border: '1px solid var(--c334155)', color: 'var(--ce2e8f0)', borderRadius: 8, padding: '8px 10px', fontSize: 13, resize: 'vertical', fontFamily: 'inherit' };
const ghost: CSSProperties = { padding: '8px 12px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ce2e8f0)', fontSize: 13, cursor: 'pointer' };
const miniBtn: CSSProperties = { padding: '5px 11px', borderRadius: 7, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ce2e8f0)', fontSize: 12, cursor: 'pointer' };
const inp: CSSProperties = { background: 'var(--c111827)', border: '1px solid var(--c334155)', color: 'var(--ce2e8f0)', borderRadius: 7, padding: '7px 10px', fontSize: 13 };
