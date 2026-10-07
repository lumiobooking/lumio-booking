'use client';

// NGÀY NGHỈ — the owner's side of time off.
//
// Requests from the team wait at the top (duyệt / từ chối); below, everything
// approved or recorded for the next months. The owner can also write leave in
// directly (sick days, a holiday agreed in person): that is approved as it is
// saved. An approved day is a day the engine, the booking page and the desk's
// open times treat as off; whole days are days off on the payslip as well.

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { ind } from '../../../lib/ui-industry';
import { daysOf, whenLabel } from '../../../lib/time-off-ui';

export interface TimeOffRow {
  id: string; staffId: string; name: string; startDate: string; endDate: string; startTime: string | null; endTime: string | null;
  reason: string | null; status: 'PENDING' | 'APPROVED' | 'DENIED' | 'CANCELLED'; decidedAt: string | null; decisionNote: string | null; createdAt: string; byOwner: boolean;
}
interface Data { today: string; from: string; to: string; pending: number; requests: TimeOffRow[] }
interface StaffLite { id: string; firstName: string; lastName: string | null; isActive?: boolean }

export function TimeOffPanel({ vi, staff, onPending }: { vi: boolean; staff: StaffLite[]; onPending?: (n: number) => void }) {
  const { token } = useAuth();
  const L = (v: string, e: string) => ind(vi ? v : e);
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [showPast, setShowPast] = useState(false);
  const [add, setAdd] = useState<{ staffId: string; startDate: string; endDate: string; partial: boolean; startTime: string; endTime: string; reason: string } | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const d = await apiFetch<Data>('/time-off', { token });
      setData(d); setErr(null); onPending?.(d.pending);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }, [token, onPending]);
  useEffect(() => { void load(); }, [load]);

  async function decide(id: string, decision: 'APPROVED' | 'DENIED') {
    setBusy(id); setErr(null);
    try { await apiFetch(`/time-off/${id}`, { method: 'PATCH', token, body: { decision, note: note[id] || undefined } }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(null); }
  }
  async function remove(id: string) {
    setBusy(id); setErr(null);
    try { await apiFetch(`/time-off/${id}`, { method: 'DELETE', token }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(null); }
  }
  async function save() {
    if (!add) return;
    setBusy('add'); setErr(null);
    try {
      await apiFetch('/time-off', { method: 'POST', token, body: {
        staffId: add.staffId, startDate: add.startDate, endDate: add.partial ? add.startDate : add.endDate,
        startTime: add.partial ? add.startTime : undefined, endTime: add.partial ? add.endTime : undefined, reason: add.reason.trim() || undefined,
      } });
      setAdd(null); await load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(null); }
  }

  const today = data?.today ?? '';
  const rows = data?.requests ?? [];
  const pending = rows.filter((r) => r.status === 'PENDING');
  const approved = rows.filter((r) => r.status === 'APPROVED' && (showPast || r.endDate >= today)).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const closed = rows.filter((r) => r.status === 'DENIED' || r.status === 'CANCELLED').filter((r) => showPast || r.endDate >= today);
  const active = staff.filter((s) => s.isActive !== false);
  const nameOf = (id: string) => { const s = staff.find((x) => x.id === id); return s ? `${s.firstName}${s.lastName ? ' ' + s.lastName : ''}` : ''; };

  const statusPill = (r: TimeOffRow) => {
    const m = {
      PENDING: { t: L('Chờ duyệt', 'Pending'), c: 'var(--ink-warn)', b: 'var(--wash-amber-2)' },
      APPROVED: { t: L('Đã duyệt', 'Approved'), c: 'var(--ink-good)', b: 'var(--c052e16)' },
      DENIED: { t: L('Từ chối', 'Declined'), c: 'var(--ink-bad)', b: 'var(--wash-red)' },
      CANCELLED: { t: L('Đã rút', 'Withdrawn'), c: 'var(--c94a3b8)', b: 'var(--c1e293b)' },
    }[r.status];
    return <span style={{ fontSize: 11.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, color: m.c, background: m.b, whiteSpace: 'nowrap' }}>{m.t}</span>;
  };
  const line = (r: TimeOffRow, actions: React.ReactNode) => (
    <div key={r.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
      <div style={{ minWidth: 130, fontWeight: 700, color: 'var(--cf1f5f9)' }}>{r.name || nameOf(r.staffId)}</div>
      <div style={{ minWidth: 180, color: 'var(--ccbd5e1)', textTransform: 'capitalize' }}>{whenLabel(r, vi)} <span style={{ color: 'var(--c94a3b8)', textTransform: 'none' }}>· {daysOf(r)} {L('ngày', daysOf(r) === 1 ? 'day' : 'days')}</span></div>
      <div style={{ flex: 1, minWidth: 120, fontSize: 13, color: 'var(--c94a3b8)' }}>
        {r.reason || (r.byOwner ? L('Chủ tiệm ghi', 'Entered by owner') : '')}
        {r.decisionNote && <span> · {L('Ghi chú', 'Note')}: {r.decisionNote}</span>}
      </div>
      {statusPill(r)}
      {actions}
    </div>
  );

  return (
    <div style={{ ...ui.card, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--cf1f5f9)' }}>{L('Ngày nghỉ của thợ', 'Time off')}</div>
          <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 2 }}>
            {L('Ngày đã duyệt: hệ thống không giao khách, trang đặt lịch không mở giờ, và bảng lương tính là ngày nghỉ.', 'An approved day: no bookings are assigned, the booking page shows no times, and payroll counts it as a day off.')}
          </div>
        </div>
        <button type="button" onClick={() => setAdd({ staffId: active[0]?.id ?? '', startDate: today, endDate: today, partial: false, startTime: '13:00', endTime: '17:00', reason: '' })}
          disabled={active.length === 0} style={{ ...ui.primaryBtn, marginLeft: 'auto' }}>{L('+ Ghi ngày nghỉ', '+ Record time off')}</button>
      </div>
      {err && <div style={ui.banner}>{err}</div>}

      {add && (
        <div style={{ padding: 12, borderRadius: 12, border: '1px solid var(--line)', background: 'var(--c0f172a)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, alignItems: 'end' }}>
          <label><span style={ui.label}>{L('Thợ', 'Tech')}</span>
            <select value={add.staffId} onChange={(e) => setAdd({ ...add, staffId: e.target.value })} style={ui.input}>
              {active.map((s) => <option key={s.id} value={s.id}>{s.firstName}{s.lastName ? ` ${s.lastName}` : ''}</option>)}
            </select>
          </label>
          <label><span style={ui.label}>{add.partial ? L('Ngày', 'Day') : L('Từ ngày', 'From')}</span>
            <input type="date" lang="en-US" value={add.startDate} onChange={(e) => setAdd({ ...add, startDate: e.target.value, endDate: add.endDate < e.target.value ? e.target.value : add.endDate })} style={ui.input} />
          </label>
          {!add.partial && (
            <label><span style={ui.label}>{L('Đến ngày', 'To')}</span>
              <input type="date" lang="en-US" min={add.startDate} value={add.endDate} onChange={(e) => setAdd({ ...add, endDate: e.target.value })} style={ui.input} />
            </label>
          )}
          {add.partial && (<>
            <label><span style={ui.label}>{L('Từ giờ', 'From')}</span><input type="time" value={add.startTime} onChange={(e) => setAdd({ ...add, startTime: e.target.value })} style={ui.input} /></label>
            <label><span style={ui.label}>{L('Đến giờ', 'To')}</span><input type="time" value={add.endTime} onChange={(e) => setAdd({ ...add, endTime: e.target.value })} style={ui.input} /></label>
          </>)}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ccbd5e1)', paddingBottom: 8 }}>
            <input type="checkbox" checked={add.partial} onChange={(e) => setAdd({ ...add, partial: e.target.checked })} /> {L('Chỉ một phần ngày', 'Part of a day')}
          </label>
          <label style={{ gridColumn: '1 / -1' }}><span style={ui.label}>{L('Lý do (không bắt buộc)', 'Reason (optional)')}</span>
            <input value={add.reason} maxLength={300} onChange={(e) => setAdd({ ...add, reason: e.target.value })} style={ui.input} placeholder={L('VD: ốm, về quê', 'e.g. sick, family trip')} />
          </label>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
            <button type="button" onClick={save} disabled={busy === 'add' || !add.staffId || !add.startDate} style={ui.primaryBtn}>{busy === 'add' ? L('Đang lưu…', 'Saving…') : L('Lưu (đã duyệt)', 'Save as approved')}</button>
            <button type="button" onClick={() => setAdd(null)} style={{ ...ui.input, width: 'auto', cursor: 'pointer' }}>{L('Huỷ', 'Cancel')}</button>
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-warn)', letterSpacing: '0.04em', marginBottom: 6 }}>{L(`CHỜ DUYỆT · ${pending.length}`, `WAITING · ${pending.length}`)}</div>
          <div style={{ borderRadius: 12, border: '1px solid var(--ink-warn)', background: 'var(--wash-amber)', overflow: 'hidden' }}>
            {pending.map((r) => line(r, (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <input value={note[r.id] ?? ''} onChange={(e) => setNote({ ...note, [r.id]: e.target.value })} placeholder={L('Ghi chú cho thợ…', 'Note to the tech…')} maxLength={300} style={{ ...ui.input, width: 160, padding: '6px 10px' }} />
                <button type="button" disabled={busy === r.id} onClick={() => decide(r.id, 'APPROVED')} style={{ ...ui.primaryBtn, padding: '6px 12px', background: '#15803d' }}>{L('Duyệt', 'Approve')}</button>
                <button type="button" disabled={busy === r.id} onClick={() => decide(r.id, 'DENIED')} style={{ ...ui.input, width: 'auto', cursor: 'pointer', padding: '6px 12px', color: 'var(--ink-bad)' }}>{L('Từ chối', 'Decline')}</button>
              </div>
            )))}
          </div>
        </div>
      )}

      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--c94a3b8)', letterSpacing: '0.04em' }}>{L('ĐÃ DUYỆT', 'APPROVED')}</span>
          <label style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--ccbd5e1)', display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} /> {L('Cả ngày đã qua', 'Include past')}
          </label>
        </div>
        <div style={{ borderRadius: 12, border: '1px solid var(--line)', overflow: 'hidden' }}>
          {approved.map((r) => line(r, (
            <button type="button" disabled={busy === r.id} onClick={() => remove(r.id)} style={{ ...ui.input, width: 'auto', cursor: 'pointer', padding: '6px 12px', color: 'var(--ink-bad)' }}>{L('Bỏ', 'Remove')}</button>
          )))}
          {data && approved.length === 0 && <div style={{ padding: 12, fontSize: 13, color: 'var(--c94a3b8)' }}>{L('Chưa có ngày nghỉ nào sắp tới.', 'No upcoming time off.')}</div>}
          {!data && !err && <div style={{ padding: 12, fontSize: 13, color: 'var(--c94a3b8)' }}>{L('Đang tải…', 'Loading…')}</div>}
        </div>
      </div>

      {closed.length > 0 && (
        <details>
          <summary style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--c94a3b8)', cursor: 'pointer' }}>{L(`Từ chối / đã rút · ${closed.length}`, `Declined / withdrawn · ${closed.length}`)}</summary>
          <div style={{ borderRadius: 12, border: '1px solid var(--line)', overflow: 'hidden', marginTop: 6 }}>
            {closed.map((r) => line(r, (
              <button type="button" disabled={busy === r.id} onClick={() => remove(r.id)} style={{ ...ui.input, width: 'auto', cursor: 'pointer', padding: '6px 12px', color: 'var(--c94a3b8)' }}>{L('Xoá', 'Delete')}</button>
            )))}
          </div>
        </details>
      )}
    </div>
  );
}
