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
interface Monthly {
  month: string;
  outcome: { totals: { bookings: number; showed: number; revenueCents: number }; newCustomers: number; owned: Record<string, number>; channels: { key: string; bookings: number; showed: number; revenueCents: number }[] };
  spend: SpendRow[]; workLog: WorkRow[]; blended: Blended;
}
interface Item { vi: string; en: string }
interface Content { summary?: Item; highlights?: Item[]; issues?: Item[]; plan?: Item[]; _aiUnavailable?: boolean }
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
      const r = await apiFetch<Report & { aiUsed?: boolean }>('/marketing/report/generate', { method: 'POST', token, body: { month } });
      setReport(r);
      setMsg(r.aiUsed ? T('AI đã viết nháp — kiểm tra & duyệt.', 'AI drafted it — review & approve.') : T('Đã tạo khung báo cáo (AI chưa bật) — nhập nhận xét tay.', 'Report shell created (AI off) — fill notes manually.'));
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

      {/* Spend entry */}
      <div style={{ ...ui.card, marginBottom: 16 }}>
        <div style={cardTitle}>{T('Chi phí từng kênh', 'Spend per channel')}</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 520 }}>
            <thead><tr style={{ color: '#94a3b8', textAlign: 'left' }}>
              <th style={th}>{T('Kênh', 'Channel')}</th><th style={th}>{T('Chi phí', 'Spend')}</th><th style={th}>Reach</th><th style={th}>Clicks</th><th style={th}>Leads</th>
            </tr></thead>
            <tbody>
              {CHANNELS.map((ch) => {
                const r = spendDraft[ch] ?? { channel: ch, amountCents: 0 };
                const set = (p: Partial<SpendRow>) => setSpendDraft((d) => ({ ...d, [ch]: { ...r, ...p } }));
                return (
                  <tr key={ch} style={{ borderTop: '1px solid #1e293b' }}>
                    <td style={td}>{CH_LABEL[ch]}</td>
                    <td style={td}><input type="number" min={0} step="0.01" value={r.amountCents ? r.amountCents / 100 : ''} placeholder="0" onChange={(e) => set({ amountCents: Math.round(parseFloat(e.target.value || '0') * 100) })} style={numInput} /></td>
                    <td style={td}><input type="number" min={0} value={r.reach ?? ''} placeholder="—" onChange={(e) => set({ reach: e.target.value ? parseInt(e.target.value, 10) : null })} style={numInput} /></td>
                    <td style={td}><input type="number" min={0} value={r.clicks ?? ''} placeholder="—" onChange={(e) => set({ clicks: e.target.value ? parseInt(e.target.value, 10) : null })} style={numInput} /></td>
                    <td style={td}><input type="number" min={0} value={r.leads ?? ''} placeholder="—" onChange={(e) => set({ leads: e.target.value ? parseInt(e.target.value, 10) : null })} style={numInput} /></td>
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
    return { summary: c.summary ?? { vi: '', en: '' }, highlights: zip(hVi, hEn), issues: zip(iVi, iEn), plan: zip(pVi, pEn) };
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

      {report.content._aiUnavailable && <div style={{ ...ui.banner, background: '#422006', borderColor: '#b45309', color: '#fde68a', marginBottom: 12 }}>{T('AI chưa bật (thiếu ANTHROPIC_API_KEY) — nhập nhận xét tay bên dưới.', 'AI is off (no ANTHROPIC_API_KEY) — write the notes manually below.')}</div>}

      <Field label={T('Tóm tắt (Việt)', 'Summary (VI)')} value={c.summary?.vi ?? ''} onChange={(v) => setC({ ...c, summary: { vi: v, en: c.summary?.en ?? '' } })} />
      <Field label={T('Tóm tắt (Anh)', 'Summary (EN)')} value={c.summary?.en ?? ''} onChange={(v) => setC({ ...c, summary: { vi: c.summary?.vi ?? '', en: v } })} />
      <TwoCol label={T('Điểm tốt (mỗi dòng 1 ý)', 'Highlights (one per line)')} vi={hVi} en={hEn} setVi={setHVi} setEn={setHEn} />
      <TwoCol label={T('Vấn đề còn tồn tại', 'Issues')} vi={iVi} en={iEn} setVi={setIVi} setEn={setIEn} />
      <TwoCol label={T('Kế hoạch tháng sau', 'Next-month plan')} vi={pVi} en={pEn} setVi={setPVi} setEn={setPEn} />
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
function TwoCol({ label, vi, en, setVi, setEn }: { label: string; vi: string; en: string; setVi: (v: string) => void; setEn: (v: string) => void }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={lbl}>{label}</label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <textarea value={vi} onChange={(e) => setVi(e.target.value)} rows={3} placeholder="Tiếng Việt" style={ta} />
        <textarea value={en} onChange={(e) => setEn(e.target.value)} rows={3} placeholder="English" style={ta} />
      </div>
    </div>
  );
}

function esc(s: string) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function openPrint(data: Monthly | null, c: Content, vi: boolean, money: (n: number) => string) {
  const o = data?.outcome; const b = data?.blended;
  const li = (arr?: Item[]) => (arr ?? []).map((x) => `<li><b>${esc(x.vi)}</b><br><span style="color:#555">${esc(x.en)}</span></li>`).join('');
  const spendRows = (data?.spend ?? []).filter((s) => s.amountCents > 0).map((s) => `<tr><td>${esc(CH_LABEL[s.channel] || s.channel)}</td><td style="text-align:right">${money(s.amountCents)}</td></tr>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Marketing report ${data?.month ?? ''}</title>
  <style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111;max-width:720px;margin:24px auto;padding:0 20px;line-height:1.6}
  h1{font-size:22px;margin:0 0 2px} h2{font-size:15px;color:#4f46e5;margin:22px 0 8px;border-bottom:1px solid #eee;padding-bottom:4px}
  .kpis{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0} .kpi{flex:1;min-width:120px;background:#f5f5fb;border-radius:10px;padding:10px 12px}
  .kpi .l{font-size:12px;color:#666} .kpi .v{font-size:20px;font-weight:700}
  table{width:100%;border-collapse:collapse;font-size:14px} td{padding:5px 0;border-bottom:1px solid #f0f0f0}
  ul{padding-left:18px} li{margin:6px 0} .muted{color:#888;font-size:12px}</style></head><body>
  <h1>${vi ? 'Báo cáo marketing' : 'Marketing report'} · ${data?.month ?? ''}</h1>
  <div class="muted">${vi ? 'Thực hiện bởi Lumio Agency' : 'By Lumio Agency'}</div>
  <div class="kpis">
    <div class="kpi"><div class="l">${vi ? 'Đã chi' : 'Spent'}</div><div class="v">${money(b?.totalSpendCents ?? 0)}</div></div>
    <div class="kpi"><div class="l">${vi ? 'Đặt lịch' : 'Bookings'}</div><div class="v">${o?.totals.bookings ?? 0}</div></div>
    <div class="kpi"><div class="l">${vi ? 'Đã đến' : 'Showed up'}</div><div class="v">${o?.totals.showed ?? 0}</div></div>
    <div class="kpi"><div class="l">${vi ? 'Doanh thu' : 'Revenue'}</div><div class="v">${money(o?.totals.revenueCents ?? 0)}</div></div>
  </div>
  ${b && b.revenuePerSpend != null ? `<p><b>${vi ? 'Mỗi $1 chi ra' : 'Per $1 spent'}:</b> $${b.revenuePerSpend} ${vi ? 'doanh thu' : 'revenue'}${b.costPerNewCustomerCents != null ? ` · <b>${vi ? 'Chi phí mỗi khách mới' : 'Cost per new customer'}:</b> ${money(b.costPerNewCustomerCents)}` : ''}</p>` : ''}
  ${c.summary && (c.summary.vi || c.summary.en) ? `<h2>${vi ? 'Tổng quan' : 'Overview'}</h2><p><b>${esc(c.summary.vi)}</b></p><p style="color:#555">${esc(c.summary.en)}</p>` : ''}
  ${spendRows ? `<h2>${vi ? 'Chi phí theo kênh' : 'Spend by channel'}</h2><table>${spendRows}</table>` : ''}
  ${(c.highlights ?? []).length ? `<h2>${vi ? 'Điểm nổi bật' : 'Highlights'}</h2><ul>${li(c.highlights)}</ul>` : ''}
  ${(c.issues ?? []).length ? `<h2>${vi ? 'Vấn đề' : 'Issues'}</h2><ul>${li(c.issues)}</ul>` : ''}
  ${(c.plan ?? []).length ? `<h2>${vi ? 'Kế hoạch tháng sau' : 'Next month'}</h2><ul>${li(c.plan)}</ul>` : ''}
  <p class="muted" style="margin-top:24px">${vi ? 'Số booking, khách đến, doanh thu lấy tự động từ hệ thống Lumio. Nháp do AI tổng hợp, nhân viên Lumio duyệt.' : 'Bookings, showed-up and revenue are pulled automatically from Lumio. Draft summarised by AI, reviewed by Lumio staff.'}</p>
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

const cardTitle: CSSProperties = { fontSize: 13, fontWeight: 700, color: '#cbd5e1' };
const dateInput: CSSProperties = { background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 8, padding: '7px 10px', fontSize: 13 };
const numInput: CSSProperties = { width: 90, background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 6, padding: '5px 8px', fontSize: 13 };
const th: CSSProperties = { padding: '6px 8px', fontWeight: 600, fontSize: 12 };
const td: CSSProperties = { padding: '5px 8px' };
const lbl: CSSProperties = { display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 };
const ta: CSSProperties = { width: '100%', boxSizing: 'border-box', background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 8, padding: '8px 10px', fontSize: 13, resize: 'vertical', fontFamily: 'inherit' };
const ghost: CSSProperties = { padding: '8px 12px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#e2e8f0', fontSize: 13, cursor: 'pointer' };
