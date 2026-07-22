'use client';

import { useCallback, useEffect, useState, CSSProperties } from 'react';
import { SalonShell } from '../../../../components/SalonShell';
import { useAuth } from '../../../../lib/auth';
import { apiFetch } from '../../../../lib/api';
import { ui, formatPrice } from '../../../../lib/ui';
import { useLang } from '../../../../lib/i18n';

interface SpendRow { id?: string; channel: string; amountCents: number; reach?: number | null; clicks?: number | null; leads?: number | null; }
interface WorkRow { id: string; category: string; title: string; createdAt: string; }
interface Blended { totalSpendCents: number; costPerBookingCents: number | null; costPerShowedCents: number | null; costPerNewCustomerCents: number | null; revenuePerSpend: number | null; }
interface Delta { value: number; prev: number; pct: number | null }
interface Monthly {
  month: string;
  outcome: { totals: { bookings: number; showed: number; revenueCents: number }; newCustomers: number; owned: Record<string, number>; channels: { key: string; bookings: number; showed: number; revenueCents: number }[] };
  spend: SpendRow[]; workLog: WorkRow[]; blended: Blended;
  prevMonth?: string;
  deltas?: { bookings: Delta; showed: Delta; revenueCents: Delta; newCustomers: Delta; spendCents: Delta };
  effectiveness?: 'good' | 'ok' | 'low' | 'organic';
}
interface Item { vi: string; en: string }
interface Content { headline?: Item; summary?: Item; highlights?: Item[]; issues?: Item[]; plan?: Item[]; _aiUnavailable?: boolean; _aiError?: string }
interface Report { periodMonth: string; status: string; content: Content; aiModel?: string | null; approvedAt?: string | null; }

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
  const [data, setData] = useState<Monthly | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [currency, setCurrency] = useState('USD');
  const [spendDraft, setSpendDraft] = useState<Record<string, SpendRow>>({});
  const [showMetrics, setShowMetrics] = useState(false);
  const [wTitle, setWTitle] = useState(''); const [wCat, setWCat] = useState('post');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const money = (c: number) => formatPrice(c, currency);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [d, r, settings] = await Promise.all([
        apiFetch<Monthly>(`/marketing/monthly?month=${month}`, { token }),
        apiFetch<Report | null>(`/marketing/report?month=${month}`, { token }).catch(() => null),
        apiFetch<{ booking?: { currency?: string } }>('/settings', { token }).catch(() => ({} as { booking?: { currency?: string } })),
      ]);
      setData(d); setReport(r);
      if (settings?.booking?.currency) setCurrency(settings.booking.currency);
      const draft: Record<string, SpendRow> = {};
      for (const ch of CHANNELS) { const ex = d.spend.find((s) => s.channel === ch); draft[ch] = ex ? { ...ex } : { channel: ch, amountCents: 0 }; }
      setSpendDraft(draft);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, [token, month]);
  useEffect(() => { load(); }, [load]);

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

  if (loading && !data) return <section><h2 style={{ fontSize: 18 }}>{T('Báo cáo tháng', 'Monthly report')}</h2><p style={{ color: '#94a3b8' }}>Loading…</p></section>;

  return (
    <section>
      <MktTabs vi={vi} active="monthly" />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h2 style={{ fontSize: 18, margin: 0 }}>{T('Báo cáo marketing tháng', 'Monthly marketing report')}</h2>
          <p style={{ color: '#94a3b8', margin: '4px 0 0', fontSize: 13 }}>{T('Nhập chi phí + công việc → AI viết nháp → duyệt → gửi khách.', 'Enter spend + work → AI drafts it → review → send to the client.')}</p>
        </div>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={dateInput} />
      </div>

      {error && <div style={ui.banner}>{error}</div>}
      {msg && <div style={{ ...ui.banner, background: '#064e3b', borderColor: '#059669', color: '#d1fae5' }}>{msg}</div>}

      {/* Blended KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
        <Kpi label={T('Tổng chi marketing', 'Total spend')} value={money(b?.totalSpendCents ?? 0)} />
        <Kpi label={T('Doanh thu (từ lịch)', 'Revenue (booked)')} value={money(data?.outcome.totals.revenueCents ?? 0)} accent="#22c55e" />
        <Kpi label={T('Chi phí / khách mới', 'Cost / new customer')} value={showBlended && b?.costPerNewCustomerCents != null ? money(b.costPerNewCustomerCents) : '—'} hint={showBlended ? undefined : T('cần nhập chi phí', 'enter spend')} />
        <Kpi label={T('Mỗi $1 chi → doanh thu', 'Revenue per $1')} value={showBlended && b?.revenuePerSpend != null ? `$${b.revenuePerSpend}` : '—'} accent="#22c55e" hint={showBlended ? undefined : T('cần nhập chi phí', 'enter spend')} />
      </div>
      <p style={{ color: '#64748b', fontSize: 11.5, margin: '-6px 0 16px', lineHeight: 1.5 }}>
        {T('Chỉ số tổng hợp (blended): tổng chi ÷ kết quả thật. Chưa tách được "quảng cáo nào ra booking nào" — phần đó cần gắn UTM (Giai đoạn 2).',
           'Blended metrics: total spend ÷ real outcome. We cannot yet attribute a specific ad to a specific booking — that needs UTM (Phase 2).')}
      </p>

      {/* Connected channels (Phase 3) */}
      <ChannelsSection token={token} vi={vi} month={month} onSynced={load} />

      {/* Spend entry */}
      <div style={{ ...ui.card, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={cardTitle}>{T('Chi phí từng kênh', 'Spend per channel')}</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94a3b8', cursor: 'pointer' }}>
            <input type="checkbox" checked={showMetrics} onChange={(e) => setShowMetrics(e.target.checked)} />
            {T('Thêm reach / click / lead', 'Add reach / clicks / leads')}
          </label>
        </div>
        <p style={{ color: '#64748b', fontSize: 11.5, margin: '2px 0 10px' }}>{T('Chỉ cần nhập chi phí. Kênh nào không chạy thì để trống.', 'Just enter spend. Leave channels you did not run blank.')}</p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: showMetrics ? 520 : 260 }}>
            <thead><tr style={{ color: '#94a3b8', textAlign: 'left' }}>
              <th style={th}>{T('Kênh', 'Channel')}</th><th style={th}>{T('Chi phí', 'Spend')}</th>
              {showMetrics && <><th style={th}>Reach</th><th style={th}>Clicks</th><th style={th}>Leads</th></>}
            </tr></thead>
            <tbody>
              {CHANNELS.map((ch) => {
                const r = spendDraft[ch] ?? { channel: ch, amountCents: 0 };
                const set = (p: Partial<SpendRow>) => setSpendDraft((d) => ({ ...d, [ch]: { ...r, ...p } }));
                return (
                  <tr key={ch} style={{ borderTop: '1px solid #1e293b' }}>
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
        {(data?.workLog ?? []).length === 0 ? <p style={{ color: '#64748b', fontSize: 13, margin: 0 }}>{T('Chưa có công việc nào.', 'No work logged yet.')}</p> : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {data!.workLog.map((w) => (
              <li key={w.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderTop: '1px solid #1e293b', fontSize: 13 }}>
                <span><span style={{ color: '#818cf8', fontSize: 11, textTransform: 'uppercase', marginRight: 8 }}>{w.category}</span>{w.title}</span>
                <button onClick={() => delWork(w.id)} style={{ ...ui.dangerBtn, padding: '3px 9px', fontSize: 11 }}>×</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Report */}
      <ReportEditor
        report={report} vi={vi} T={T} busy={busy}
        onGenerate={generate} onSave={saveReport} onApprove={approve}
        printData={data} money={money}
      />
    </section>
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
    return { headline: c.headline ?? { vi: '', en: '' }, summary: c.summary ?? { vi: '', en: '' }, highlights: zip(hVi, hEn), issues: zip(iVi, iEn), plan: zip(pVi, pEn) };
  }

  if (!report) {
    return (
      <div style={{ ...ui.card }}>
        <div style={cardTitle}>{T('Báo cáo tháng', 'Monthly report')}</div>
        <p style={{ color: '#94a3b8', fontSize: 13 }}>{T('Nhập chi phí & công việc ở trên, rồi bấm nút để AI viết nháp báo cáo song ngữ.', 'Enter spend & work above, then let AI draft the bilingual report.')}</p>
        <button onClick={onGenerate} disabled={busy === 'gen'} style={ui.primaryBtn}>{busy === 'gen' ? T('Đang tạo…', 'Generating…') : T('Tạo báo cáo bằng AI', 'Generate with AI')}</button>
      </div>
    );
  }

  const status = report.status;
  const badge = { review: ['#f59e0b', T('Chờ duyệt', 'In review')], approved: ['#22c55e', T('Đã duyệt', 'Approved')], sent: ['#6366f1', T('Đã gửi', 'Sent')], draft: ['#94a3b8', 'Draft'] }[status] ?? ['#94a3b8', status];

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

      {report.content._aiUnavailable && <div style={{ ...ui.banner, background: '#422006', borderColor: '#b45309', color: '#fde68a', marginBottom: 12 }}>{T('AI không viết được nháp: ', 'AI could not draft: ')}<b>{report.content._aiError || 'unknown'}</b>{T(' — nhập nhận xét tay bên dưới.', ' — write the notes manually below.')}</div>}

      <p style={{ fontSize: 11.5, color: '#64748b', margin: '0 0 10px' }}>{T('AI đã điền sẵn — chỉ sửa nếu cần rồi bấm Duyệt. Đang sửa bản ', 'AI filled this in — edit only if needed, then Approve. Editing the ')}<b style={{ color: '#a5b4fc' }}>{vi ? 'Tiếng Việt' : 'English'}</b>{T('; bấm VI/EN ở góc trên để sửa bản kia.', ' version; use VI/EN at the top to edit the other.')}</p>

      <div style={{ background: '#0f172a', border: '1px solid #4f46e5', borderRadius: 8, padding: 10, marginBottom: 12 }}>
        <label style={{ ...lbl, color: '#a5b4fc', fontWeight: 700 }}>{T('★ Điều quan trọng nhất tháng này (khách đọc đầu tiên)', '★ The one most important message (client reads first)')}</label>
        {vi
          ? <input style={ta} value={c.headline?.vi ?? ''} onChange={(e) => setC({ ...c, headline: { vi: e.target.value, en: c.headline?.en ?? '' } })} placeholder="Ví dụ: Doanh thu tăng 31% nhờ Google Maps" />
          : <input style={ta} value={c.headline?.en ?? ''} onChange={(e) => setC({ ...c, headline: { vi: c.headline?.vi ?? '', en: e.target.value } })} placeholder="e.g. Revenue up 31%, driven by Google Maps" />}
      </div>
      {vi
        ? <Field label={T('Tóm tắt', 'Summary')} value={c.summary?.vi ?? ''} onChange={(v) => setC({ ...c, summary: { vi: v, en: c.summary?.en ?? '' } })} />
        : <Field label={T('Tóm tắt', 'Summary')} value={c.summary?.en ?? ''} onChange={(v) => setC({ ...c, summary: { vi: c.summary?.vi ?? '', en: v } })} />}
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
function openPrint(data: Monthly | null, c: Content, vi: boolean, money: (n: number) => string) {
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
    return `<span style="color:${up ? '#059669' : '#dc2626'};font-size:12px;font-weight:700">${up ? '▲' : '▼'} ${Math.abs(dl.pct)}%</span>`;
  };
  const bignum = (val: string, label: string, dl?: Delta, green?: boolean) =>
    `<div style="flex:1;min-width:78px;text-align:center"><div style="font-size:24px;font-weight:800;color:${green ? '#059669' : '#111827'}">${val}</div><div style="font-size:11px;color:#6b7280">${label}</div><div style="font-size:11px">${arrow(dl)}</div></div>`;

  const CH: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', google_ads: 'Google Ads', gbp: 'Google Maps', seo: 'SEO', email: 'Email', sms: 'SMS', website: 'Website', other: t('Khác', 'Other') };
  const spendRows = (data.spend ?? []).filter((x) => x.amountCents > 0).sort((a, z) => z.amountCents - a.amountCents);
  const spendLine = spendRows.map((x) => `${esc(CH[x.channel] || x.channel)} ${money(x.amountCents)}`).join(' · ');
  const work = (data.workLog ?? []).map((w) => `<div style="margin:4px 0">✓ ${esc(w.title)}</div>`).join('') || `<div style="color:#9ca3af">${t('Chưa ghi', 'None logged')}</div>`;
  const plan = (c.plan ?? []).map((x) => `<div style="margin:4px 0">→ ${esc(L(x))}</div>`).join('') || `<div style="color:#9ca3af">—</div>`;
  const total = b?.totalSpendCents ?? 0;

  const card = (inner: string, bg = '#f7f7fb') => `<div style="background:${bg};border-radius:12px;padding:14px 16px;margin-top:10px">${inner}</div>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${t('Báo cáo Marketing', 'Marketing report')} ${data.month}</title><style>
  *{box-sizing:border-box} body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111827;max-width:620px;margin:0 auto;padding:26px 22px;line-height:1.5}
  .lbl{font-size:12px;color:#6b7280;font-weight:600}
  @media print{body{padding:6px}}
  </style></head><body>
  <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;border-bottom:3px solid #4f46e5;padding-bottom:10px">
    <div><div style="font-size:19px;font-weight:800">${t('Báo cáo Marketing', 'Marketing report')} · ${data.month}</div><div style="font-size:11px;color:#6b7280">${t('bởi Lumio Agency', 'by Lumio Agency')}</div></div>
    <div style="background:${effColor};color:#fff;border-radius:20px;padding:6px 14px;font-size:13px;font-weight:600;white-space:nowrap">${effLabel}</div>
  </div>
  ${c.headline && L(c.headline) ? `<div style="font-size:18px;font-weight:800;margin:14px 0 2px">${esc(L(c.headline))}</div>` : ''}

  ${card(`<div class="lbl">① ${t('ĐÃ CHI', 'SPENT')}</div><div style="font-size:30px;font-weight:800;margin:2px 0 ${spendLine ? '8px' : '0'}">${money(total)}</div>${spendLine ? `<div style="font-size:12px;color:#6b7280">${spendLine}</div>` : ''}`)}

  ${card(`<div class="lbl" style="margin-bottom:10px">② ${t('MANG VỀ', 'RESULTS')}</div><div style="display:flex;gap:8px;flex-wrap:wrap">
    ${bignum(String(o.totals.bookings), t('lượt đặt', 'bookings'), d?.bookings)}
    ${bignum(String(o.totals.showed), t('đã đến', 'showed up'), d?.showed)}
    ${bignum(String(o.newCustomers), t('khách mới', 'new customers'), d?.newCustomers)}
    ${bignum(money(o.totals.revenueCents), t('doanh thu', 'revenue'), d?.revenueCents, true)}
  </div>`)}

  ${b && b.revenuePerSpend != null ? card(`<div class="lbl" style="color:#065f46;margin-bottom:4px">③ ${t('HIỆU QUẢ', 'EFFECTIVENESS')}</div><div style="font-size:16px;color:#065f46">${t('Mỗi', 'Every')} <b>$1</b> ${t('chi ra', 'spent')} → <b>$${b.revenuePerSpend}</b> ${t('doanh thu', 'revenue')}${b.costPerNewCustomerCents != null ? ` &nbsp;·&nbsp; ${t('chi phí mỗi khách mới', 'cost per new customer')}: <b>${money(b.costPerNewCustomerCents)}</b>` : ''}</div>`, '#ecfdf5') : ''}

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">
    <div style="background:#f7f7fb;border-radius:12px;padding:14px 16px"><div class="lbl" style="margin-bottom:6px">④ ${t('ĐÃ LÀM GÌ', 'WHAT WE DID')}</div><div style="font-size:12.5px">${work}</div></div>
    <div style="background:#eef2ff;border:2px solid #c7d2fe;border-radius:12px;padding:14px 16px"><div class="lbl" style="color:#4f46e5;margin-bottom:6px">${t('SẮP LÀM GÌ', 'WHAT\'S NEXT')}</div><div style="font-size:12.5px">${plan}</div></div>
  </div>

  ${c.summary && L(c.summary) ? `<div style="font-size:12.5px;color:#4b5563;margin-top:12px;background:#f7f7fb;border-radius:10px;padding:11px 13px">${esc(L(c.summary))}</div>` : ''}

  <div style="font-size:10.5px;color:#9ca3af;margin-top:16px;text-align:center;border-top:1px solid #eee;padding-top:10px">${t('Số liệu lấy tự động từ Lumio · AI tổng hợp, nhân viên Lumio duyệt trước khi gửi.', 'Data pulled automatically from Lumio · summarised by AI, reviewed by Lumio staff.')}</div>
  <script>window.onload=function(){window.print()}</script></body></html>`;
  const w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close(); }
}

function Kpi({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: string }) {
  return (
    <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent ?? '#fff' }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{hint}</div>}
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
      <p style={{ color: '#64748b', fontSize: 11.5, margin: '4px 0 12px', lineHeight: 1.5 }}>
        {T('Dán token + ID tài khoản để tự kéo chi phí/số liệu mỗi tháng, thay nhập tay. Xem hướng dẫn lấy tài khoản trong tài liệu GĐ3.', 'Paste a token + account ID to auto-pull monthly spend/metrics instead of typing. See the Phase-3 prep guide for how to obtain them.')}
      </p>
      {err && <div style={{ ...ui.banner, marginBottom: 10 }}>{err}</div>}
      {note && <div style={{ ...ui.banner, background: '#064e3b', borderColor: '#059669', color: '#d1fae5', marginBottom: 10 }}>{note}</div>}
      {chs.map((c) => (
        <div key={c.platform} style={{ borderTop: '1px solid #1e293b', padding: '10px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>
              {c.label}
              {!c.enabled && <span style={{ fontSize: 10.5, color: '#94a3b8', border: '1px solid #334155', borderRadius: 999, padding: '1px 8px' }}>{T('sắp có', 'coming soon')}</span>}
              {c.connected && <span style={{ fontSize: 10.5, color: '#22c55e', border: '1px solid #22c55e', borderRadius: 999, padding: '1px 8px' }}>{T('đã kết nối', 'connected')}</span>}
              {c.status === 'ERROR' && <span style={{ fontSize: 10.5, color: '#f87171', border: '1px solid #f87171', borderRadius: 999, padding: '1px 8px' }}>{T('lỗi', 'error')}</span>}
            </span>
            <span style={{ display: 'flex', gap: 6 }}>
              {c.enabled && !c.connected && <button onClick={() => { setOpenP(openP === c.platform ? null : c.platform); setErr(null); setNote(null); }} style={miniBtn}>{openP === c.platform ? T('Đóng', 'Close') : T('Kết nối', 'Connect')}</button>}
              {c.connected && <>
                <button onClick={() => test(c.platform)} disabled={busy === c.platform} style={miniBtn}>{T('Kiểm tra', 'Test')}</button>
                <button onClick={() => sync(c.platform)} disabled={busy === c.platform} style={{ ...miniBtn, borderColor: '#6366f1', color: '#c7d2fe' }}>{busy === c.platform ? '…' : T('Đồng bộ', 'Sync')}</button>
                <button onClick={() => disconnect(c.platform)} disabled={busy === c.platform} style={{ ...miniBtn, borderColor: '#7f1d1d', color: '#fca5a5' }}>{T('Ngắt', 'Remove')}</button>
              </>}
            </span>
          </div>
          {c.connected && <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{c.accountName || c.externalAccountId} {c.lastSyncedAt ? '· ' + T('đồng bộ', 'synced') + ' ' + new Date(c.lastSyncedAt).toLocaleString('en-US') : ''}{c.lastError ? ' · ' + c.lastError : ''}</div>}
          {openP === c.platform && (
            <div style={{ marginTop: 8, background: '#0f172a', borderRadius: 8, padding: 10, display: 'grid', gap: 6 }}>
              <input style={inp} placeholder={c.platform === 'meta' ? 'Ad Account ID (act_...)' : c.platform === 'gbp' ? 'Location ID (locations/...)' : 'Account ID'} value={f.externalAccountId} onChange={(e) => setF({ ...f, externalAccountId: e.target.value })} />
              <input style={inp} type="password" placeholder={T('Access token', 'Access token')} value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} autoComplete="off" />
              {c.platform === 'gbp' && <>
                <div style={{ fontSize: 10.5, color: '#64748b' }}>{T('Hoặc refresh token (Google) nếu không dùng access token:', 'Or a Google refresh token if not using an access token:')}</div>
                <input style={inp} type="password" placeholder="Refresh token" value={f.refreshToken} onChange={(e) => setF({ ...f, refreshToken: e.target.value })} autoComplete="off" />
                <input style={inp} placeholder="OAuth Client ID" value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })} />
                <input style={inp} type="password" placeholder="OAuth Client Secret" value={f.clientSecret} onChange={(e) => setF({ ...f, clientSecret: e.target.value })} autoComplete="off" />
              </>}
              <button onClick={() => connect(c.platform)} disabled={busy === c.platform || (!f.token && !f.refreshToken) || !f.externalAccountId} style={{ ...ui.primaryBtn, justifySelf: 'start' }}>{busy === c.platform ? '…' : T('Lưu & kiểm tra', 'Save & verify')}</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function MktTabs({ vi, active }: { vi: boolean; active: 'monthly' | 'live' }) {
  const tab = (on: boolean): CSSProperties => ({ padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: on ? 700 : 500, textDecoration: 'none', color: on ? '#fff' : '#94a3b8', background: on ? '#6366f1' : 'transparent', border: on ? 'none' : '1px solid #334155' });
  return (
    <div style={{ display: 'inline-flex', gap: 6, marginBottom: 14 }}>
      <a href="/salon/marketing/monthly" style={tab(active === 'monthly')}>{vi ? 'Báo cáo tháng' : 'Monthly report'}</a>
      <a href="/salon/marketing/report" style={tab(active === 'live')}>{vi ? 'Tổng quan trực tiếp' : 'Live overview'}</a>
    </div>
  );
}
const cardTitle: CSSProperties = { fontSize: 13, fontWeight: 700, color: '#cbd5e1' };
const dateInput: CSSProperties = { background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 8, padding: '7px 10px', fontSize: 13 };
const numInput: CSSProperties = { width: 90, background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 6, padding: '5px 8px', fontSize: 13 };
const th: CSSProperties = { padding: '6px 8px', fontWeight: 600, fontSize: 12 };
const td: CSSProperties = { padding: '5px 8px' };
const lbl: CSSProperties = { display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 };
const ta: CSSProperties = { width: '100%', boxSizing: 'border-box', background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 8, padding: '8px 10px', fontSize: 13, resize: 'vertical', fontFamily: 'inherit' };
const ghost: CSSProperties = { padding: '8px 12px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#e2e8f0', fontSize: 13, cursor: 'pointer' };
const miniBtn: CSSProperties = { padding: '5px 11px', borderRadius: 7, border: '1px solid #334155', background: 'transparent', color: '#e2e8f0', fontSize: 12, cursor: 'pointer' };
const inp: CSSProperties = { background: '#111827', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 7, padding: '7px 10px', fontSize: 13 };
