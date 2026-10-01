'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { useLang } from '../../../lib/i18n';
import { dayKeyInTz, presetRangeInTz } from '../../../lib/datetime';
import { C, FB_CSS, Lx, Seg, Btn, Empty, cardStyle } from '../../../components/feedback/admin/fb-ui';
import { FeedbackOverview, type Overview } from '../../../components/feedback/admin/FeedbackOverview';
import { FeedbackCases } from '../../../components/feedback/admin/FeedbackCases';
import { FeedbackStaffList, StaffScorecard } from '../../../components/feedback/admin/FeedbackStaff';
import { FeedbackSettings, type FbSettings, type SettingsView } from '../../../components/feedback/admin/FeedbackSettings';

type Tab = 'overview' | 'cases' | 'staff' | 'settings';
type Period = '7' | '30' | '90' | 'month';

export default function FeedbackPage() {
  return <SalonShell><Suspense fallback={null}><Inner /></Suspense></SalonShell>;
}

function rangeFor(p: Period): { from: string; to: string } {
  if (p === 'month') return presetRangeInTz('thisMonth');
  const days = Number(p);
  return { from: dayKeyInTz(new Date(Date.now() - (days - 1) * 86_400_000)), to: dayKeyInTz(new Date()) };
}

function Inner() {
  const { token, user } = useAuth();
  const { lang } = useLang();
  const L = Lx(lang);
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const caseParam = sp.get('case');
  const staffParam = sp.get('staff');
  const tab: Tab = caseParam ? 'cases' : staffParam ? 'staff' : ((['overview', 'cases', 'staff', 'settings'] as Tab[]).find((t) => t === sp.get('tab')) ?? 'overview');

  const [period, setPeriod] = useState<Period>('30');
  const [techId, setTechId] = useState('');
  const [search, setSearch] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [ov, setOv] = useState<Overview | null>(null);
  const [ovErr, setOvErr] = useState('');
  const [view, setView] = useState<SettingsView | null>(null);
  const [draft, setDraft] = useState<FbSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  const [openCount, setOpenCount] = useState(0);

  const range = useMemo(() => rangeFor(period), [period]);
  const periodLabel = period === 'month' ? L('Tháng này', 'This month') : L(`${period} ngày qua`, `Last ${period} days`);
  const isOwner = user?.role === 'SALON_ADMIN' || user?.role === 'SUPER_ADMIN';

  const go = useCallback((q: Record<string, string | null>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v) next.set(k, v);
    const s = next.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [pathname, router]);

  const loadOverview = useCallback(async () => {
    if (!token) return;
    const qs = new URLSearchParams({ from: range.from, to: range.to });
    if (techId) qs.set('staffId', techId);
    try { setOv(await apiFetch<Overview>(`/feedback/overview?${qs}`, { token })); setOvErr(''); }
    catch (e) { setOvErr((e as Error).message); }
  }, [token, range, techId]);

  const loadCount = useCallback(async () => {
    if (!token) return;
    try { const c = await apiFetch<{ open: number }>('/feedback/cases/open-count', { token }); setOpenCount(c.open); } catch { /* badge only */ }
  }, [token]);

  useEffect(() => { void loadOverview(); }, [loadOverview]);
  useEffect(() => { void loadCount(); }, [loadCount]);
  useEffect(() => {
    if (!token) return;
    apiFetch<SettingsView>('/feedback/settings', { token })
      .then((v) => { setView(v); setDraft(v.settings); })
      .catch(() => undefined);
  }, [token]);
  // Search waits for the typing to stop.
  useEffect(() => { const t = setTimeout(() => setSearchQ(search), 300); return () => clearTimeout(t); }, [search]);

  const dirty = !!(view && draft && JSON.stringify(view.settings) !== JSON.stringify(draft));
  async function saveSettings() {
    if (!token || !draft || saving) return;
    setSaving(true); setSaved('');
    try {
      const s = await apiFetch<FbSettings>('/feedback/settings', { method: 'PATCH', token, body: draft });
      setView((v) => (v ? { ...v, settings: s } : v)); setDraft(s); setSaved(L('Đã lưu', 'Saved'));
    } catch (e) { setSaved((e as Error).message); } finally { setSaving(false); }
  }

  const onCase = useCallback((id: string | null) => go({ case: id, tab: id ? null : 'cases' }), [go]);
  const onStaff = useCallback((id: string) => go({ staff: id }), [go]);
  const onCasesChanged = useCallback(() => { void loadCount(); void loadOverview(); }, [loadCount, loadOverview]);

  const techs = ov?.staff ?? [];
  const techPicker = (
    <select value={techId} onChange={(e) => setTechId(e.target.value)} aria-label={L('Lọc theo thợ', 'Filter by technician')}
      style={{ height: 36, padding: '0 12px', borderRadius: 10, border: `1px solid ${C.line}`, background: C.card, fontSize: 13, fontWeight: 600, color: C.ink2, fontFamily: 'inherit' }}>
      <option value="">👥 {L('Tất cả thợ', 'All technicians')}</option>
      {techs.map((t) => <option key={t.staffId} value={t.staffId}>{t.name}</option>)}
    </select>
  );

  const lead = tab === 'cases'
    ? L('Mỗi lần “chưa hài lòng” là một ca. Trả lời trong 24 giờ thì đa số khách sẽ quay lại.', 'Every “not quite” is a case. Reply within 24 hours and most customers come back.')
    : tab === 'settings'
      ? L('Chọn khi nào hỏi khách, khách được nói gì, và ai được báo.', 'Decide when customers are asked, what they can tell you, and who hears about it.')
      : L('Khách cảm thấy thế nào sau mỗi lần ghé — theo thợ, theo lý do, theo tuần.', 'How customers felt after every visit — by technician, by reason, week by week.');

  const tabs: { key: Tab; label: string; n?: number }[] = [
    { key: 'overview', label: L('Tổng quan', 'Overview') },
    { key: 'cases', label: L('Ca cần xử lý', 'Cases'), n: openCount },
    { key: 'staff', label: L('Thợ', 'Staff') },
    { key: 'settings', label: L('Cài đặt', 'Settings') },
  ];

  const scorecard = tab === 'staff' && staffParam;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '22px clamp(14px, 2.5vw, 30px) 30px', maxWidth: 1400, boxSizing: 'border-box', width: '100%', color: C.ink }}>
      <style>{FB_CSS}</style>
      {!scorecard && (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0, letterSpacing: '-.01em', color: C.ink }}>{L('Phản hồi của khách', 'Customer feedback')}</h1>
              <div style={{ color: C.muted, fontSize: 14.5, marginTop: 4 }}>{lead}</div>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              {(tab === 'overview' || tab === 'staff') && (
                <>
                  <Seg<Period> value={period} onChange={setPeriod} options={[{ key: '7', label: '7D' }, { key: '30', label: '30D' }, { key: '90', label: '90D' }, { key: 'month', label: L('Tháng', 'Month') }]} />
                  {tab === 'overview' && techPicker}
                </>
              )}
              {tab === 'cases' && (
                <>
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`🔎 ${L('Tìm tên hoặc SĐT', 'Search name or phone')}`}
                    style={{ height: 36, padding: '0 12px', borderRadius: 10, border: `1px solid ${C.line}`, background: C.card, fontSize: 13, color: C.ink, width: 210, fontFamily: 'inherit' }} />
                  {techPicker}
                </>
              )}
              {tab === 'settings' && (
                <>
                  {saved && <span style={{ fontSize: 13, color: saved === L('Đã lưu', 'Saved') ? C.good : C.bad, fontWeight: 600 }}>{saved}</span>}
                  <Btn primary disabled={!isOwner || !dirty || saving} onClick={() => void saveSettings()} title={!isOwner ? L('Chỉ chủ tiệm được đổi cài đặt', 'Only the owner can change settings') : undefined}>
                    {saving ? L('Đang lưu…', 'Saving…') : L('Lưu thay đổi', 'Save changes')}
                  </Btn>
                </>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.line}`, overflowX: 'auto' }} role="tablist">
            {tabs.map((t) => {
              const on = t.key === tab;
              return (
                <button key={t.key} type="button" role="tab" aria-selected={on} className="fb-tab" onClick={() => go({ tab: t.key === 'overview' ? null : t.key })}
                  style={{ padding: '10px 14px', fontSize: 14.5, fontWeight: 600, color: on ? C.accInk : C.muted, borderBottom: `2px solid ${on ? C.acc : 'transparent'}`, marginBottom: -1, display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap' }}>
                  {t.label}
                  {t.n ? <span style={{ fontSize: 11.5, fontWeight: 700, padding: '1px 7px', borderRadius: 999, background: C.badBg, color: C.bad }}>{L(`${t.n} mở`, `${t.n} open`)}</span> : null}
                </button>
              );
            })}
          </div>
          {view && !view.settings.enabled && tab !== 'settings' && (
            <div style={{ ...cardStyle, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', borderColor: C.accLine, background: C.accSoft }}>
              <span style={{ flex: 1, minWidth: 220, fontSize: 13.5, color: C.ink2 }}>
                <b style={{ color: C.accInk }}>✦ {L('Chưa bật', 'Not switched on yet')}</b> — {L('quầy thu ngân chưa hỏi khách sau khi thanh toán. Bật trong Cài đặt là chạy ngay.', 'the till isn’t asking customers after they pay. Turn it on in Settings and it starts with the next sale.')}
              </span>
              <Btn small onClick={() => go({ tab: 'settings' })}>{L('Mở cài đặt', 'Open settings')}</Btn>
            </div>
          )}
        </>
      )}

      {tab === 'overview' && (ov ? <FeedbackOverview data={ov} lang={lang} replyHours={view?.settings.replyHours ?? 24} periodLabel={periodLabel} onStaff={onStaff} onCase={(id) => onCase(id)} />
        : <div style={cardStyle}><Empty>{ovErr || L('Đang tải…', 'Loading…')}</Empty></div>)}

      {tab === 'cases' && token && (
        <FeedbackCases token={token} lang={lang} staffId={techId} search={searchQ} selectedId={caseParam}
          onSelect={(id) => { if (id !== caseParam) go({ case: id, tab: id ? null : 'cases' }); }} onChanged={onCasesChanged} />
      )}

      {tab === 'staff' && !staffParam && (ov ? <FeedbackStaffList data={ov} lang={lang} periodLabel={periodLabel} onStaff={onStaff} />
        : <div style={cardStyle}><Empty>{ovErr || L('Đang tải…', 'Loading…')}</Empty></div>)}

      {scorecard && token && (
        <StaffScorecard token={token} lang={lang} staffId={staffParam} range={range} canCoach
          onBack={() => go({ tab: 'staff' })} onCase={(id) => onCase(id)} />
      )}

      {tab === 'settings' && (view && draft
        ? <FeedbackSettings view={view} draft={draft} setDraft={setDraft} lang={lang} readOnly={!isOwner} />
        : <div style={cardStyle}><Empty>{L('Đang tải…', 'Loading…')}</Empty></div>)}
    </div>
  );
}
