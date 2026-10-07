'use client';

// "Xin nghỉ" — the technician asks for time off from her phone.
//
// A short form (which days, or which part of a day, and why), then her own
// requests with where each one stands. She can withdraw one that is still
// pending, or leave that has not started. Once the owner approves, the days
// are hers: no bookings land on her, the booking page shows no times for her.

import { useCallback, useEffect, useState } from 'react';
import { StaffShell } from '../../../components/StaffShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { useLang } from '../../../lib/i18n';
import { L, Pill, SectionLabel, Sheet, st } from '../../../components/staff/kit';
import { whenLabel as when } from '../../../lib/time-off-ui';

interface Req {
  id: string; startDate: string; endDate: string; startTime: string | null; endTime: string | null;
  reason: string | null; status: 'PENDING' | 'APPROVED' | 'DENIED' | 'CANCELLED'; decisionNote: string | null; byOwner: boolean;
}
interface Mine { today: string; requests: Req[] }

export default function StaffTimeOffPage() {
  const { lang } = useLang();
  return <StaffShell title={L(lang === 'vi', 'Xin nghỉ', 'Time off')}><Inner /></StaffShell>;
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const [data, setData] = useState<Mine | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ startDate: '', endDate: '', partial: false, startTime: '13:00', endTime: '17:00', reason: '' });
  const [confirm, setConfirm] = useState<Req | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try { const d = await apiFetch<Mine>('/time-off/me', { token }); setData(d); setErr(null); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  const today = data?.today ?? '';
  function startForm() {
    setF({ startDate: today, endDate: today, partial: false, startTime: '13:00', endTime: '17:00', reason: '' });
    setOpen(true);
  }
  async function send() {
    setBusy(true); setErr(null);
    try {
      await apiFetch('/time-off/me', { method: 'POST', token, body: {
        startDate: f.startDate, endDate: f.partial ? f.startDate : f.endDate,
        startTime: f.partial ? f.startTime : undefined, endTime: f.partial ? f.endTime : undefined, reason: f.reason.trim() || undefined,
      } });
      setOpen(false); await load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }
  async function withdraw(r: Req) {
    setBusy(true); setErr(null);
    try { await apiFetch(`/time-off/me/${r.id}`, { method: 'DELETE', token }); setConfirm(null); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }

  const reqs = data?.requests ?? [];
  const upcoming = reqs.filter((r) => (r.status === 'PENDING' || r.status === 'APPROVED') && r.endDate >= today).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const past = reqs.filter((r) => !upcoming.includes(r));
  const tone = (s: Req['status']) => (s === 'APPROVED' ? 'good' : s === 'PENDING' ? 'warn' : s === 'DENIED' ? 'bad' : 'mute') as 'good' | 'warn' | 'bad' | 'mute';
  const label = (s: Req['status']) => s === 'APPROVED' ? L(vi, 'Đã duyệt', 'Approved') : s === 'PENDING' ? L(vi, 'Chờ duyệt', 'Pending') : s === 'DENIED' ? L(vi, 'Chưa duyệt', 'Declined') : L(vi, 'Đã rút', 'Withdrawn');
  const canWithdraw = (r: Req) => r.status === 'PENDING' || (r.status === 'APPROVED' && r.startDate > today);

  const card = (r: Req) => (
    <div key={r.id} style={{ ...st.card, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ce2e8f0)', textTransform: 'capitalize', flex: 1 }}>{when(r, vi)}</div>
        <Pill text={label(r.status)} tone={tone(r.status)} />
      </div>
      {(r.reason || r.byOwner) && <div style={{ fontSize: 14, color: 'var(--c94a3b8)' }}>{r.reason || L(vi, 'Chủ tiệm ghi', 'Entered by the owner')}</div>}
      {r.decisionNote && <div style={{ fontSize: 14, color: 'var(--ccbd5e1)' }}>{L(vi, 'Chủ tiệm', 'Owner')}: “{r.decisionNote}”</div>}
      {canWithdraw(r) && (
        <button type="button" disabled={busy} onClick={() => setConfirm(r)} style={{ ...st.ghost, height: 44, alignSelf: 'flex-start', marginTop: 4 }}>{L(vi, 'Rút lại', 'Withdraw')}</button>
      )}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {err && <div style={{ ...st.card, borderColor: 'var(--ink-bad)', color: 'var(--ink-bad)', fontSize: 14, padding: 12 }}>{err}</div>}
      <button type="button" onClick={startForm} disabled={!data} style={{ ...st.primary, width: '100%' }}>{L(vi, '+ Xin nghỉ', '+ Ask for time off')}</button>
      <div style={{ fontSize: 13, color: 'var(--c94a3b8)', lineHeight: 1.5, margin: '-4px 2px 0' }}>
        {L(vi, 'Chủ tiệm duyệt xong, những ngày đó sẽ không có khách nào được giao cho bạn.', 'Once the owner approves, no bookings land on you for those days.')}
      </div>

      <SectionLabel>{L(vi, 'Sắp tới', 'Coming up')}</SectionLabel>
      {!data && !err && <div style={{ color: 'var(--c94a3b8)' }}>…</div>}
      {data && upcoming.length === 0 && <div style={{ ...st.card, color: 'var(--c94a3b8)', fontSize: 14 }}>{L(vi, 'Chưa có ngày nghỉ nào sắp tới.', 'No time off coming up.')}</div>}
      {upcoming.map(card)}

      {past.length > 0 && (<>
        <SectionLabel>{L(vi, 'Trước đây', 'Earlier')}</SectionLabel>
        {past.map(card)}
      </>)}

      <Sheet open={open} onClose={() => setOpen(false)} label={L(vi, 'Xin nghỉ', 'Ask for time off')}>
        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ce2e8f0)' }}>{L(vi, 'Bạn muốn nghỉ khi nào?', 'When do you need off?')}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          {[false, true].map((p) => (
            <button key={String(p)} type="button" onClick={() => setF({ ...f, partial: p })} aria-pressed={f.partial === p}
              style={{ ...st.ghost, flex: 1, height: 44, borderColor: f.partial === p ? '#4f46e5' : 'var(--line-strong)', background: f.partial === p ? '#4f46e5' : 'transparent', color: f.partial === p ? '#fff' : 'var(--ce2e8f0)' }}>
              {p ? L(vi, 'Một phần ngày', 'Part of a day') : L(vi, 'Cả ngày', 'Whole days')}
            </button>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={st.label}>{f.partial ? L(vi, 'Ngày', 'Day') : L(vi, 'Từ ngày', 'From')}</span>
            <input type="date" lang="en-US" min={today} value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value, endDate: f.endDate < e.target.value ? e.target.value : f.endDate })} style={inp} />
          </label>
          {f.partial ? (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={st.label}>{L(vi, 'Từ giờ – đến giờ', 'From – to')}</span>
              <span style={{ display: 'flex', gap: 6 }}>
                <input type="time" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} style={{ ...inp, minWidth: 0 }} />
                <input type="time" value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} style={{ ...inp, minWidth: 0 }} />
              </span>
            </label>
          ) : (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={st.label}>{L(vi, 'Đến ngày', 'To')}</span>
              <input type="date" lang="en-US" min={f.startDate || today} value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} style={inp} />
            </label>
          )}
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
          <span style={st.label}>{L(vi, 'Lý do (không bắt buộc)', 'Reason (optional)')}</span>
          <input value={f.reason} maxLength={300} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder={L(vi, 'VD: về quê, đi khám', 'e.g. family trip, appointment')} style={inp} />
        </label>
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button type="button" onClick={() => setOpen(false)} style={{ ...st.ghost, flex: 1, height: 52 }}>{L(vi, 'Huỷ', 'Cancel')}</button>
          <button type="button" disabled={busy || !f.startDate || (!f.partial && !f.endDate)} onClick={send} style={{ ...st.primary, flex: 2 }}>{busy ? L(vi, 'Đang gửi…', 'Sending…') : L(vi, 'Gửi chủ tiệm', 'Send to the owner')}</button>
        </div>
      </Sheet>

      <Sheet open={!!confirm} onClose={() => setConfirm(null)} label={L(vi, 'Rút lại', 'Withdraw')}>
        {confirm && (<>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ce2e8f0)' }}>{L(vi, 'Rút lại yêu cầu này?', 'Withdraw this request?')}</div>
          <div style={{ fontSize: 14, color: 'var(--c94a3b8)', marginTop: 4, textTransform: 'capitalize' }}>{when(confirm, vi)}</div>
          {confirm.status === 'APPROVED' && <div style={{ fontSize: 14, color: 'var(--ccbd5e1)', marginTop: 8, lineHeight: 1.5 }}>{L(vi, 'Ngày nghỉ đã duyệt sẽ bị bỏ — bạn làm việc bình thường những ngày đó. Chủ tiệm sẽ được báo.', 'The approved time off is dropped — you work those days as usual. The owner is told.')}</div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button type="button" onClick={() => setConfirm(null)} style={{ ...st.ghost, flex: 1, height: 52 }}>{L(vi, 'Giữ', 'Keep')}</button>
            <button type="button" disabled={busy} onClick={() => withdraw(confirm)} style={{ ...st.primary, flex: 2, background: '#b91c1c' }}>{L(vi, 'Rút lại', 'Withdraw')}</button>
          </div>
        </>)}
      </Sheet>
    </div>
  );
}

const inp = { height: 46, borderRadius: 12, border: '1px solid var(--line-strong)', background: 'var(--c0f172a)', color: 'var(--ce2e8f0)', fontSize: 16, padding: '0 12px', width: '100%', boxSizing: 'border-box' as const };
