'use client';

import { useCallback, useEffect, useState, FormEvent } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang, tr, Lang } from '../../../lib/i18n';
import { usePaged, Pager } from '../../../components/ListFilter';

interface ReviewSettings { enabled: boolean; reviewMode: 'direct' | 'rate_first'; googlePlaceId: string; googleReviewUrl: string; staffPointsPerFeedback: number; staffBonusFor5Star: number; customerPoints: number; minRatingForGoogle: number; requireRealVisit: boolean; visitWindowHours: number; dailyCapPerStaff: number; dedupDays: number; staffPointsPerSend: number; sendDailyCap: number; sendDedupHours: number; anchorToVisits: boolean; visitBuffer: number; onlyBusinessHours: boolean }
interface LeaderRow { id: string; name: string; avatarUrl: string | null; balance: number; earnedMonth: number; sendsMonth: number; blockedMonth: number; feedbackMonth: number; avgMonth: number; flagged: boolean }
interface SendRow { id: string; createdAt: string; counted: boolean; reason: string | null; staff: string; device: string }
interface FeedbackRow { id: string; rating: number; comment: string | null; createdAt: string; invitedToGoogle: boolean; verified: boolean; staff: { firstName: string; lastName: string | null } | null; customer: { firstName: string; phone: string | null } | null }

export default function ReviewsPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [settings, setSettings] = useState<ReviewSettings | null>(null);
  const [board, setBoard] = useState<LeaderRow[]>([]);
  const [boardLabel, setBoardLabel] = useState('');
  const [ym, setYm] = useState<string>(currentYm());
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [sends, setSends] = useState<SendRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadBoard = useCallback(async (m: string) => {
    if (!token) return;
    try {
      const r = await apiFetch<{ ym: string; label: string; rows: LeaderRow[] }>(`/reviews/leaderboard?month=${m}`, { token });
      setBoard(r.rows); setBoardLabel(r.label);
    } catch { /* ignore */ }
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const [s, f, sn] = await Promise.all([
        apiFetch<{ review: ReviewSettings }>('/settings', { token }),
        apiFetch<FeedbackRow[]>('/reviews/feedback', { token }),
        apiFetch<SendRow[]>('/reviews/sends', { token }).catch(() => [] as SendRow[]),
      ]);
      setSettings(s.review);
      setFeedback(f);
      setSends(sn);
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadBoard(ym); }, [ym, loadBoard]);

  async function adjust(id: string, delta: number) {
    const reason = delta < 0 ? (prompt(t('rv.redeemReason')) ?? 'Redeemed') : 'Manual add';
    try { await apiFetch(`/reviews/staff/${id}/adjust`, { method: 'POST', token, body: { delta, reason } }); await loadBoard(ym); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
  }

  async function resetStaff(id: string, name: string) {
    if (!confirm(t('rv.confirmReset').replace('{name}', name))) return;
    try { await apiFetch(`/reviews/staff/${id}/reset`, { method: 'POST', token }); await loadBoard(ym); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
  }

  async function wipeAll() {
    if (!confirm(t('rv.confirmWipe1'))) return;
    if (!confirm(t('rv.confirmWipe2'))) return;
    try { await apiFetch('/reviews/reset-all', { method: 'POST', token }); await load(); await loadBoard(ym); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
  }

  async function cleanupRange(from: string, to: string) {
    if (!from || !to) { setError(t('rv.pickDates')); return; }
    if (!confirm(t('rv.confirmCleanup').replace('{from}', from).replace('{to}', to))) return;
    try { await apiFetch('/reviews/cleanup', { method: 'POST', token, body: { from, to } }); await load(); await loadBoard(ym); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
  }

  const fbPage = usePaged(feedback, 20);
  const sendsPage = usePaged(sends, 20);

  if (loading) return <SalonShellLoading />;

  return (
    <section>
      <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>{t('rv.title')}</h1>
      <p style={{ color: '#94a3b8', margin: '0 0 18px', fontSize: 14 }}>{t('rv.subtitle')}</p>

      {error && <div style={ui.banner}>{error}</div>}

      {settings && <SettingsCard token={token!} initial={settings} onSaved={load} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, margin: '24px 0 10px' }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>{t('rv.leaderboard')}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setYm(shiftYm(ym, -1))} style={monthNavBtn} aria-label={t('rv.prevMonth')}>‹</button>
          <span style={{ minWidth: 130, textAlign: 'center', fontWeight: 600, fontSize: 14 }}>{boardLabel || '—'}</span>
          <button onClick={() => setYm(shiftYm(ym, 1))} disabled={ym >= currentYm()} style={{ ...monthNavBtn, opacity: ym >= currentYm() ? 0.4 : 1 }} aria-label={t('rv.nextMonth')}>›</button>
          {ym !== currentYm() && <button onClick={() => setYm(currentYm())} style={{ ...miniBtn, marginLeft: 4 }}>{t('rv.thisMonth')}</button>}
        </div>
      </div>
      <div style={{ border: '1px solid #334155', borderRadius: 12, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead><tr style={{ background: '#1e293b' }}>
            <th style={{ ...ui.th, width: 44 }}>#</th>
            <th style={ui.th}>{t('rv.colTech')}</th>
            <th style={ui.th} title={t('rv.colEarnedT')}>{t('rv.colEarned')}</th>
            <th style={ui.th} title={t('rv.colBalanceT')}>{t('rv.colBalance')}</th>
            <th style={ui.th}>{t('rv.colSends')}</th>
            <th style={ui.th}>{t('rv.colFeedbacks')}</th>
            <th style={ui.th}>{t('rv.colAvg')}</th>
            <th style={ui.th}>{t('rv.colManage')}</th>
          </tr></thead>
          <tbody>
            {board.length === 0 && <tr><td style={ui.td} colSpan={8}>{t('rv.noStaff')}</td></tr>}
            {board.map((s, i) => (
              <tr key={s.id} style={{ borderTop: '1px solid #334155' }}>
                <td style={{ ...ui.td, textAlign: 'center' }}>{s.earnedMonth > 0 ? medal(i) : '—'}</td>
                <td style={ui.td}>{s.name}{s.flagged && <span title={t('rv.checkTitle')} style={{ marginLeft: 6, background: '#7f1d1d', color: '#fecaca', borderRadius: 6, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>{t('rv.checkBadge')}</span>}</td>
                <td style={ui.td}><strong style={{ color: '#eab308' }}>{s.earnedMonth}</strong> <span style={{ color: '#64748b', fontSize: 12 }}>{t('rv.pts')}</span></td>
                <td style={ui.td}>{s.balance}</td>
                <td style={ui.td}><strong style={{ color: '#22c55e' }}>{s.sendsMonth}</strong>{s.blockedMonth ? <span style={{ color: '#f97316', fontSize: 12 }}> · {t('rv.blocked').replace('{n}', String(s.blockedMonth))}</span> : null}</td>
                <td style={ui.td}>{s.feedbackMonth}</td>
                <td style={ui.td}>{s.avgMonth ? `${s.avgMonth}★` : '—'}</td>
                <td style={ui.td}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button onClick={() => adjust(s.id, 10)} style={miniBtn}>+10</button>
                    <button onClick={() => adjust(s.id, -50)} style={{ ...miniBtn, borderColor: '#ef4444', color: '#ef4444' }}>{t('rv.redeem50')}</button>
                    <button onClick={() => resetStaff(s.id, s.name)} style={{ ...miniBtn, borderColor: '#64748b', color: '#94a3b8' }}>{t('rv.reset')}</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ color: '#64748b', fontSize: 12, margin: '8px 0 0' }}>
        {lang === 'vi'
          ? <><strong>Đã kiếm</strong> = điểm nhận trong {boardLabel || 'tháng này'}; <strong>Số dư</strong> = điểm tích luỹ có thể đổi. Đổi tháng bằng mũi tên ở trên.</>
          : <><strong>Earned</strong> = points gained in {boardLabel || 'this month'}; <strong>Balance</strong> = lifetime points available to redeem. Switch months with the arrows above.</>}
      </p>

      <h2 style={{ fontSize: 16, margin: '24px 0 10px' }}>{t('rv.recentFeedback')}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {feedback.length === 0 && <p style={{ color: '#94a3b8', fontSize: 14 }}>{t('rv.noFeedback')}</p>}
        {fbPage.paged.map((f) => (
          <div key={f.id} style={{ ...ui.card, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: '#f59e0b' }}>{'★'.repeat(f.rating)}<span style={{ color: '#334155' }}>{'★'.repeat(5 - f.rating)}</span></span>
              <span style={{ color: '#64748b' }}>{new Date(f.createdAt).toLocaleString()}</span>
            </div>
            <div style={{ fontSize: 13, color: '#cbd5e1', marginTop: 4 }}>
              {f.staff ? `${f.staff.firstName} ${f.staff.lastName ?? ''}`.trim() : t('rv.salon')} · {f.customer?.phone ?? f.customer?.firstName ?? t('rv.anonymous')}
              {f.verified
                ? <span style={{ marginLeft: 8, color: '#22c55e', fontSize: 11 }}>{t('rv.verified')}</span>
                : <span style={{ marginLeft: 8, color: '#f59e0b', fontSize: 11 }}>{t('rv.noMatch')}</span>}
              {f.invitedToGoogle && <span style={{ marginLeft: 8, color: '#818cf8', fontSize: 11 }}>{t('rv.invited')}</span>}
            </div>
            {f.comment && <div style={{ fontSize: 14, marginTop: 6, color: '#e2e8f0' }}>“{f.comment}”</div>}
          </div>
        ))}
        <Pager paged={fbPage} />
      </div>

      <h2 style={{ fontSize: 16, margin: '24px 0 10px' }}>{t('rv.sendLog')} <span style={{ color: '#64748b', fontSize: 12, fontWeight: 400 }}>{t('rv.sendLogSub')}</span></h2>
      <div style={{ border: '1px solid #334155', borderRadius: 12, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead><tr style={{ background: '#1e293b' }}>
            <th style={ui.th}>{t('rv.sWhen')}</th><th style={ui.th}>{t('rv.sTech')}</th><th style={ui.th}>{t('rv.sDevice')}</th><th style={ui.th}>{t('rv.sCounted')}</th><th style={ui.th}>{t('rv.sReason')}</th>
          </tr></thead>
          <tbody>
            {sends.length === 0 && <tr><td style={ui.td} colSpan={5}>{t('rv.noSends')}</td></tr>}
            {sendsPage.paged.map((r) => (
              <tr key={r.id} style={{ borderTop: '1px solid #334155' }}>
                <td style={{ ...ui.td, color: '#94a3b8' }}>{new Date(r.createdAt).toLocaleString()}</td>
                <td style={ui.td}>{r.staff}</td>
                <td style={{ ...ui.td, color: '#64748b' }}>{r.device}</td>
                <td style={ui.td}>{r.counted ? <span style={{ color: '#22c55e', fontWeight: 600 }}>{t('rv.plusPts')}</span> : <span style={{ color: '#94a3b8' }}>—</span>}</td>
                <td style={ui.td}>{reasonLabel(r.reason, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: '0 14px 12px' }}><Pager paged={sendsPage} /></div>
      </div>

      <CleanupTools onWipe={wipeAll} onCleanup={cleanupRange} />
    </section>
  );
}

function CleanupTools({ onWipe, onCleanup }: { onWipe: () => void; onCleanup: (from: string, to: string) => void }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  return (
    <div style={{ marginTop: 24, border: '1px solid #7f1d1d', borderRadius: 12, padding: 16, background: '#1f1416' }}>
      <button onClick={() => setOpen((o) => !o)} style={{ background: 'none', border: 'none', color: '#fca5a5', fontSize: 15, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
        {open ? '▾' : '▸'} {t('rv.cleanupTitle')}
      </button>
      {open && (
        <div style={{ marginTop: 12 }}>
          <p style={{ color: '#94a3b8', fontSize: 13, margin: '0 0 12px' }}>
            {lang === 'vi'
              ? <>Dùng để xoá dữ liệu bạn tạo khi thử nghiệm. <strong style={{ color: '#fca5a5' }}>Các thao tác này xoá dữ liệu vĩnh viễn và không thể hoàn tác.</strong></>
              : <>Use these to clear data you created while testing. <strong style={{ color: '#fca5a5' }}>These permanently delete data and cannot be undone.</strong></>}
          </p>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            <label><span style={ui.label}>{t('rv.from')}</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ ...ui.input, colorScheme: 'dark' }} /></label>
            <label><span style={ui.label}>{t('rv.to')}</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ ...ui.input, colorScheme: 'dark' }} /></label>
            <button onClick={() => onCleanup(from, to)} style={{ ...miniBtn, borderColor: '#f97316', color: '#f97316', padding: '9px 14px' }}>{t('rv.deleteRange')}</button>
          </div>
          <button onClick={onWipe} style={{ padding: '9px 16px', borderRadius: 8, border: 'none', background: '#b91c1c', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
            {t('rv.wipeAll')}
          </button>
        </div>
      )}
    </div>
  );
}

function SettingsCard({ token, initial, onSaved }: { token: string; initial: ReviewSettings; onSaved: () => void }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [f, setF] = useState({
    enabled: initial.enabled,
    reviewMode: initial.reviewMode ?? 'direct',
    googlePlaceId: initial.googlePlaceId ?? '',
    googleReviewUrl: initial.googleReviewUrl,
    staffPointsPerFeedback: String(initial.staffPointsPerFeedback),
    staffBonusFor5Star: String(initial.staffBonusFor5Star),
    customerPoints: String(initial.customerPoints),
    minRatingForGoogle: String(initial.minRatingForGoogle),
    requireRealVisit: initial.requireRealVisit ?? true,
    dailyCapPerStaff: String(initial.dailyCapPerStaff ?? 10),
    dedupDays: String(initial.dedupDays ?? 7),
    visitWindowHours: String(initial.visitWindowHours ?? 48),
    staffPointsPerSend: String(initial.staffPointsPerSend ?? 5),
    sendDailyCap: String(initial.sendDailyCap ?? 20),
    sendDedupHours: String(initial.sendDedupHours ?? 12),
    anchorToVisits: initial.anchorToVisits ?? true,
    visitBuffer: String(initial.visitBuffer ?? 3),
    onlyBusinessHours: initial.onlyBusinessHours ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault(); setSaving(true); setErr(null); setSaved(false);
    try {
      await apiFetch('/settings/review', { method: 'PATCH', token, body: {
        enabled: f.enabled,
        reviewMode: f.reviewMode,
        googlePlaceId: f.googlePlaceId,
        googleReviewUrl: f.googleReviewUrl,
        staffPointsPerFeedback: parseInt(f.staffPointsPerFeedback, 10) || 0,
        staffBonusFor5Star: parseInt(f.staffBonusFor5Star, 10) || 0,
        customerPoints: parseInt(f.customerPoints, 10) || 0,
        minRatingForGoogle: Math.min(5, Math.max(1, parseInt(f.minRatingForGoogle, 10) || 4)),
        requireRealVisit: f.requireRealVisit,
        dailyCapPerStaff: parseInt(f.dailyCapPerStaff, 10) || 0,
        dedupDays: parseInt(f.dedupDays, 10) || 0,
        visitWindowHours: parseInt(f.visitWindowHours, 10) || 0,
        staffPointsPerSend: parseInt(f.staffPointsPerSend, 10) || 0,
        sendDailyCap: parseInt(f.sendDailyCap, 10) || 0,
        sendDedupHours: parseInt(f.sendDedupHours, 10) || 0,
        anchorToVisits: f.anchorToVisits,
        visitBuffer: parseInt(f.visitBuffer, 10) || 0,
        onlyBusinessHours: f.onlyBusinessHours,
      } });
      setSaved(true); onSaved();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={save} style={ui.card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <Toggle on={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} />
        <span style={{ fontWeight: 600 }}>{t('rv.enable')}</span>
      </div>
      {err && <div style={ui.banner}>{err}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 12 }}>
        <button type="button" onClick={() => setF({ ...f, reviewMode: 'direct' })}
          style={modeCard(f.reviewMode === 'direct')}>
          <div style={{ fontWeight: 700 }}>{t('rv.modeDirect')}</div>
          <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 4 }}>{t('rv.modeDirectDesc')}</div>
        </button>
        <button type="button" onClick={() => setF({ ...f, reviewMode: 'rate_first' })}
          style={modeCard(f.reviewMode === 'rate_first')}>
          <div style={{ fontWeight: 700 }}>{t('rv.modeRate')}</div>
          <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 4 }}>{t('rv.modeRateDesc')}</div>
        </button>
      </div>

      {f.reviewMode === 'direct' && (
        <div style={{ marginBottom: 12, padding: 12, background: '#0f172a', borderRadius: 10, border: '1px solid #334155' }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: '#cbd5e1', marginBottom: 8 }}>{t('rv.rewardPerSend')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <label><span style={ui.label}>{t('rv.pointsPerSend')}</span><input style={ui.input} type="number" min={0} value={f.staffPointsPerSend} onChange={(e) => setF({ ...f, staffPointsPerSend: e.target.value })} /></label>
            <label><span style={ui.label}>{t('rv.deviceCooldown')}</span><input style={ui.input} type="number" min={0} value={f.sendDedupHours} onChange={(e) => setF({ ...f, sendDedupHours: e.target.value })} /></label>
            <label><span style={ui.label}>{t('rv.hardCap')}</span><input style={ui.input} type="number" min={0} value={f.sendDailyCap} onChange={(e) => setF({ ...f, sendDailyCap: e.target.value })} /></label>
          </div>

          <div style={{ fontWeight: 600, fontSize: 14, color: '#cbd5e1', margin: '14px 0 8px' }}>{t('rv.antiFraud')}</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <Toggle on={f.anchorToVisits} onChange={(v) => setF({ ...f, anchorToVisits: v })} />
            <span style={{ fontSize: 14 }}>{t('rv.anchor')}</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <Toggle on={f.onlyBusinessHours} onChange={(v) => setF({ ...f, onlyBusinessHours: v })} />
            <span style={{ fontSize: 14 }}>{t('rv.bizHours')}</span>
          </label>
          <label style={{ display: 'block', maxWidth: 240 }}>
            <span style={ui.label}>{t('rv.buffer')}</span>
            <input style={ui.input} type="number" min={0} value={f.visitBuffer} onChange={(e) => setF({ ...f, visitBuffer: e.target.value })} disabled={!f.anchorToVisits} />
          </label>
          <p style={{ color: '#64748b', fontSize: 12, margin: '10px 0 0' }}>{t('rv.antiFraudNote1')}</p>
        </div>
      )}

      <label style={{ display: 'block', marginBottom: 6 }}>
        <span style={ui.label}>{t('rv.placeId')}</span>
        <input style={ui.input} value={f.googlePlaceId} onChange={(e) => setF({ ...f, googlePlaceId: e.target.value })} placeholder={t('rv.placeIdPh')} />
      </label>
      <p style={{ color: '#64748b', fontSize: 12, margin: '0 0 6px' }}>
        {lang === 'vi'
          ? <>Dùng Place ID giúp đánh giá mở trong <strong>ứng dụng Google Maps</strong> của khách (nơi họ đã đăng nhập) thay vì màn hình đăng nhập trình duyệt.{' '}<a href="https://developers.google.com/maps/documentation/places/web-service/place-id" target="_blank" rel="noopener noreferrer" style={{ color: '#818cf8' }}>{t('rv.findPlaceId')}</a>{' '}Tìm tên tiệm, sao chép ID bắt đầu bằng <code style={{ color: '#cbd5e1' }}>ChIJ…</code></>
          : <>Using a Place ID lets the review open in the customer&apos;s <strong>Google Maps app</strong> (where they&apos;re already signed in) instead of a browser login screen.{' '}<a href="https://developers.google.com/maps/documentation/places/web-service/place-id" target="_blank" rel="noopener noreferrer" style={{ color: '#818cf8' }}>{t('rv.findPlaceId')}</a>{' '}Search your salon name, copy the ID that starts with <code style={{ color: '#cbd5e1' }}>ChIJ…</code></>}
      </p>
      <details style={{ marginBottom: 12 }}>
        <summary style={{ cursor: 'pointer', color: '#94a3b8', fontSize: 12 }}>{t('rv.noPlaceId')}</summary>
        <input style={{ ...ui.input, marginTop: 6 }} value={f.googleReviewUrl} onChange={(e) => setF({ ...f, googleReviewUrl: e.target.value })} placeholder={t('rv.reviewUrlPh')} />
      </details>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <label><span style={ui.label}>{t('rv.staffPts')}</span><input style={ui.input} type="number" min={0} value={f.staffPointsPerFeedback} onChange={(e) => setF({ ...f, staffPointsPerFeedback: e.target.value })} /></label>
        <label><span style={ui.label}>{t('rv.bonus5')}</span><input style={ui.input} type="number" min={0} value={f.staffBonusFor5Star} onChange={(e) => setF({ ...f, staffBonusFor5Star: e.target.value })} /></label>
        <label><span style={ui.label}>{t('rv.custPts')}</span><input style={ui.input} type="number" min={0} value={f.customerPoints} onChange={(e) => setF({ ...f, customerPoints: e.target.value })} /></label>
        <label><span style={ui.label}>{t('rv.showGoogle')}</span>
          <select style={ui.input} value={f.minRatingForGoogle} onChange={(e) => setF({ ...f, minRatingForGoogle: e.target.value })}>
            <option value="1">{t('rv.always')}</option><option value="4">{t('rv.fourPlus')}</option><option value="5">{t('rv.only5')}</option>
          </select>
        </label>
      </div>
      <p style={{ color: '#64748b', fontSize: 12, margin: '10px 0 0' }}>{t('rv.policyNote')}</p>

      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #334155' }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: '#cbd5e1', marginBottom: 6 }}>{t('rv.antiFraud')}</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <Toggle on={f.requireRealVisit} onChange={(v) => setF({ ...f, requireRealVisit: v })} />
          <span style={{ fontSize: 14 }}>{t('rv.requireVisit')}</span>
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          <label><span style={ui.label}>{t('rv.visitWindow')}</span><input style={ui.input} type="number" min={1} value={f.visitWindowHours} onChange={(e) => setF({ ...f, visitWindowHours: e.target.value })} /></label>
          <label><span style={ui.label}>{t('rv.maxRewarded')}</span><input style={ui.input} type="number" min={1} value={f.dailyCapPerStaff} onChange={(e) => setF({ ...f, dailyCapPerStaff: e.target.value })} /></label>
          <label><span style={ui.label}>{t('rv.clientCooldown')}</span><input style={ui.input} type="number" min={1} value={f.dedupDays} onChange={(e) => setF({ ...f, dedupDays: e.target.value })} /></label>
        </div>
        <p style={{ color: '#64748b', fontSize: 12, margin: '8px 0 0' }}>{t('rv.antiFraudNote2')}</p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
        <button type="submit" disabled={saving} style={ui.primaryBtn}>{saving ? t('rv.saving') : t('rv.saveSettings')}</button>
        {saved && <span style={{ color: '#22c55e', fontSize: 13 }}>{t('rv.saved')}</span>}
      </div>
    </form>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!on)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
      <span style={{ width: 38, height: 22, borderRadius: 999, background: on ? '#6366f1' : '#475569', position: 'relative', display: 'inline-block' }}>
        <span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 18, height: 18, borderRadius: '50%', background: 'white' }} />
      </span>
    </button>
  );
}

function SalonShellLoading() { const { lang } = useLang(); return <p style={{ color: '#94a3b8' }}>{tr('rv.loading', lang)}</p>; }

const miniBtn: React.CSSProperties = { padding: '4px 10px', borderRadius: 6, border: '1px solid #475569', background: 'transparent', color: '#cbd5e1', fontSize: 12, cursor: 'pointer' };
function modeCard(active: boolean): React.CSSProperties {
  return { textAlign: 'left', padding: '12px 14px', borderRadius: 10, cursor: 'pointer', background: active ? '#312e81' : 'transparent', border: `1px solid ${active ? '#6366f1' : '#334155'}`, color: '#e2e8f0' };
}
const monthNavBtn: React.CSSProperties = { width: 30, height: 30, borderRadius: 8, border: '1px solid #475569', background: '#1e293b', color: '#e2e8f0', fontSize: 16, cursor: 'pointer', lineHeight: 1 };
function currentYm(): string { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function shiftYm(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, (m - 1) + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function medal(rank: number): string { return rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : String(rank + 1); }
function reasonLabel(r: string | null, lang: Lang): React.ReactNode {
  const map: Record<string, { k: string; c: string }> = {
    ok: { k: 'rv.rOk', c: '#22c55e' },
    dedup: { k: 'rv.rDedup', c: '#94a3b8' },
    'off-hours': { k: 'rv.rOffHours', c: '#f97316' },
    cap: { k: 'rv.rCap', c: '#f97316' },
    'over-visits': { k: 'rv.rOverVisits', c: '#f97316' },
    disabled: { k: 'rv.rDisabled', c: '#94a3b8' },
  };
  const m = r ? map[r] : null;
  return <span style={{ color: m?.c ?? '#94a3b8', fontSize: 13 }}>{m ? tr(m.k, lang) : (r || '—')}</span>;
}
