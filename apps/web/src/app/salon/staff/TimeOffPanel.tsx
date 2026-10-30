'use client';

// NGÀY NGHỈ — the owner's side of time off.
//
// At a glance: how many requests wait, who is off today, what is coming.
// Requests from the team wait at the top (duyệt / từ chối, each in a pop-up
// with a note); below, every approved day off and block as a card with its
// date, who, how long and why — "Sửa" and "Bỏ" open pop-ups too. Saving is
// applying: an approved day is a day the engine, the booking page, the bots
// and the desk treat as off (the server refuses bookings in it); whole days
// are days off on the payslip as well.

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { ind } from '../../../lib/ui-industry';
import { dateTile, daysOf, phaseOf, spanSentence } from '../../../lib/time-off-ui';
import { Avatar, ConfirmDialog, DecideDialog, TimeOffDialog, btnPrimary } from './TimeOffDialog';

export interface TimeOffRow {
  id: string; staffId: string | null; name: string; startDate: string; endDate: string; startTime: string | null; endTime: string | null;
  reason: string | null; status: 'PENDING' | 'APPROVED' | 'DENIED' | 'CANCELLED'; decidedAt: string | null; decisionNote: string | null; createdAt: string; byOwner: boolean;
}
interface Data { today: string; from: string; to: string; pending: number; requests: TimeOffRow[] }
interface StaffLite { id: string; firstName: string; lastName: string | null; isActive?: boolean }

type Pop =
  | { k: 'add' }
  | { k: 'edit'; row: TimeOffRow }
  | { k: 'decide'; row: TimeOffRow; decision: 'APPROVED' | 'DENIED' }
  | { k: 'remove'; row: TimeOffRow };

const smallBtn: CSSProperties = { height: 34, padding: '0 12px', borderRadius: 9, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--ce2e8f0)', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' };

export function TimeOffPanel({ vi, staff, onPending }: { vi: boolean; staff: StaffLite[]; onPending?: (n: number) => void }) {
  const { token } = useAuth();
  const L = (v: string, e: string) => ind(vi ? v : e);
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [pop, setPop] = useState<Pop | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const d = await apiFetch<Data>('/time-off', { token });
      setData(d); setErr(null); onPending?.(d.pending);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }, [token, onPending]);
  useEffect(() => { void load(); }, [load]);

  const today = data?.today ?? '';
  const rows = useMemo(() => data?.requests ?? [], [data]);
  const fullName = (s: StaffLite) => `${s.firstName}${s.lastName ? ' ' + s.lastName : ''}`;
  const nameOf = (r: TimeOffRow) => (r.staffId == null ? L('Cả tiệm', 'Whole salon') : (r.name || fullName(staff.find((x) => x.id === r.staffId) ?? { id: '', firstName: '', lastName: null })));
  const pending = rows.filter((r) => r.status === 'PENDING').sort((a, b) => a.startDate.localeCompare(b.startDate));
  const approvedAll = rows.filter((r) => r.status === 'APPROVED').sort((a, b) => a.startDate.localeCompare(b.startDate));
  const approved = approvedAll.filter((r) => showPast || phaseOf(r, today) !== 'past');
  const offNow = approvedAll.filter((r) => phaseOf(r, today) === 'now');
  const coming = approvedAll.filter((r) => phaseOf(r, today) === 'later');
  const closed = rows.filter((r) => r.status === 'DENIED' || r.status === 'CANCELLED').filter((r) => showPast || r.endDate >= today);
  const people = staff.filter((s) => s.isActive !== false).map((s) => ({ id: s.id, name: fullName(s) }));

  async function remove(row: TimeOffRow) {
    await apiFetch(`/time-off/${encodeURIComponent(row.id)}`, { method: 'DELETE', token });
    await load();
  }

  const tile = (r: TimeOffRow, tone: 'warn' | 'now' | 'plain') => {
    const t = dateTile(r.startDate, vi);
    const multi = r.endDate !== r.startDate;
    const c = tone === 'warn' ? { b: 'var(--wash-amber-2)', f: 'var(--ink-warn)' } : tone === 'now' ? { b: 'var(--wash-blue)', f: 'var(--ink-link)' } : { b: 'var(--c1e293b)', f: 'var(--ce2e8f0)' };
    return (
      <div aria-hidden="true" style={{ width: 54, flexShrink: 0, borderRadius: 12, overflow: 'hidden', textAlign: 'center', border: '1px solid var(--line)', background: c.b }}>
        <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', padding: '3px 0', color: c.f, borderBottom: '1px solid var(--line)' }}>{t.dow}</div>
        <div style={{ fontSize: 21, fontWeight: 800, lineHeight: 1.15, paddingTop: 3, color: 'var(--cf1f5f9)' }}>{t.day}</div>
        <div style={{ fontSize: 10.5, fontWeight: 600, paddingBottom: 4, color: 'var(--c94a3b8)' }}>{t.month}{multi ? ' +' : ''}</div>
      </div>
    );
  };

  const badge = (text: string, f: string, b: string) => <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, color: f, background: b, whiteSpace: 'nowrap' }}>{text}</span>;

  const card = (r: TimeOffRow, kind: 'pending' | 'approved' | 'closed') => {
    const phase = phaseOf(r, today);
    const tone = kind === 'pending' ? 'warn' : phase === 'now' ? 'now' : 'plain';
    const n = daysOf(r);
    return (
      <div key={r.id} style={{ display: 'flex', gap: 12, padding: 12, borderRadius: 14, border: `1px solid ${kind === 'pending' ? 'var(--ink-warn)' : 'var(--line)'}`, background: kind === 'pending' ? 'var(--wash-amber)' : 'var(--c0f172a)', opacity: kind === 'closed' || phase === 'past' ? 0.7 : 1 }}>
        {tile(r, tone)}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Avatar id={r.staffId} name={nameOf(r)} size={24} />
            <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--cf1f5f9)' }}>{nameOf(r)}</span>
            {kind === 'pending' && badge(L('Chờ duyệt', 'Waiting'), 'var(--ink-warn)', 'var(--wash-amber-2)')}
            {kind === 'approved' && phase === 'now' && badge(L('Đang nghỉ', 'Off now'), 'var(--ink-link)', 'var(--wash-blue)')}
            {kind === 'approved' && phase === 'past' && badge(L('Đã qua', 'Past'), 'var(--c94a3b8)', 'var(--c1e293b)')}
            {kind === 'closed' && badge(r.status === 'DENIED' ? L('Từ chối', 'Declined') : L('Đã rút', 'Withdrawn'), r.status === 'DENIED' ? 'var(--ink-bad)' : 'var(--c94a3b8)', r.status === 'DENIED' ? 'var(--wash-red)' : 'var(--c1e293b)')}
            {r.staffId == null && badge(L('Khoá cả tiệm', 'Salon block'), 'var(--ink-warn)', 'var(--wash-amber-2)')}
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--ce2e8f0)' }}>
            🕒 {spanSentence(r, vi)}
            {n === 0.5 && <span style={{ color: 'var(--c94a3b8)' }}> · {L('nửa ngày', 'part of a day')}</span>}
          </div>
          {(r.reason || r.decisionNote || r.byOwner) && (
            <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>
              {r.reason ? `💬 ${r.reason}` : r.byOwner ? L('Chủ tiệm ghi', 'Entered by the salon') : ''}
              {r.decisionNote && <span> · {L('Ghi chú', 'Note')}: {r.decisionNote}</span>}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center', flexShrink: 0 }}>
          {kind === 'pending' && <>
            <button type="button" onClick={() => setPop({ k: 'decide', row: r, decision: 'APPROVED' })} style={{ ...smallBtn, background: '#15803d', borderColor: '#15803d', color: '#fff' }}>✓ {L('Duyệt', 'Approve')}</button>
            <button type="button" onClick={() => setPop({ k: 'decide', row: r, decision: 'DENIED' })} style={{ ...smallBtn, color: 'var(--ink-bad)' }}>{L('Từ chối', 'Decline')}</button>
            <button type="button" onClick={() => setPop({ k: 'edit', row: r })} style={{ ...smallBtn, border: 0, background: 'transparent', color: 'var(--ink-link)', height: 26 }}>{L('Sửa', 'Edit')}</button>
          </>}
          {kind === 'approved' && <>
            <button type="button" onClick={() => setPop({ k: 'edit', row: r })} style={smallBtn}>✎ {L('Sửa', 'Edit')}</button>
            <button type="button" onClick={() => setPop({ k: 'remove', row: r })} style={{ ...smallBtn, color: 'var(--ink-bad)' }}>{L('Bỏ', 'Remove')}</button>
          </>}
          {kind === 'closed' && <button type="button" onClick={() => setPop({ k: 'remove', row: r })} style={{ ...smallBtn, color: 'var(--c94a3b8)' }}>{L('Xoá', 'Delete')}</button>}
        </div>
      </div>
    );
  };

  const stat = (n: number, label: string, f: string, b: string, icon: string) => (
    <div style={{ flex: '1 1 140px', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 14, border: '1px solid var(--line)', background: 'var(--c0f172a)' }}>
      <span aria-hidden="true" style={{ width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, background: b, color: f }}>{icon}</span>
      <div>
        <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.1, color: 'var(--cf1f5f9)' }}>{data ? n : '–'}</div>
        <div style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{label}</div>
      </div>
    </div>
  );
  const section = (title: string, color: string, extra?: React.ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '2px 0 8px' }}>
      <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: '0.05em', color }}>{title}</span>
      <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
      {extra}
    </div>
  );
  const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 380px), 1fr))', gap: 10 };

  return (
    <div style={{ ...ui.card, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 280px' }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--cf1f5f9)' }}>🏖 {L('Ngày nghỉ của thợ', 'Time off')}</div>
          <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 3, lineHeight: 1.45 }}>
            {L('Ngày đã duyệt áp dụng ngay: không giao khách, trang đặt lịch / bot / quầy đều không đặt được, bảng lương tính là ngày nghỉ.', 'Approved time off applies at once: no bookings are given, the booking page, bots and desk cannot book it, and payroll counts it as a day off.')}
          </div>
        </div>
        <button type="button" onClick={() => setPop({ k: 'add' })} disabled={people.length === 0} style={{ ...btnPrimary, marginLeft: 'auto' }}>＋ {L('Ghi ngày nghỉ', 'Record time off')}</button>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {stat(pending.length, L('Đơn chờ duyệt', 'Waiting for you'), 'var(--ink-warn)', 'var(--wash-amber-2)', '📨')}
        {stat(offNow.length, L('Đang nghỉ hôm nay', 'Off today'), 'var(--ink-link)', 'var(--wash-blue)', '🌴')}
        {stat(coming.length, L('Sắp tới', 'Coming up'), 'var(--ink-good)', 'var(--c052e16)', '📅')}
      </div>

      {err && <div style={ui.banner}>{err}</div>}

      {pending.length > 0 && (
        <div>
          {section(L(`CHỜ DUYỆT · ${pending.length}`, `WAITING · ${pending.length}`), 'var(--ink-warn)')}
          <div style={grid}>{pending.map((r) => card(r, 'pending'))}</div>
        </div>
      )}

      <div>
        {section(L('ĐÃ DUYỆT', 'APPROVED'), 'var(--c94a3b8)', (
          <label style={{ fontSize: 12.5, color: 'var(--ccbd5e1)', display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} /> {L('Hiện cả ngày đã qua', 'Include past')}
          </label>
        ))}
        {approved.length > 0 && <div style={grid}>{approved.map((r) => card(r, 'approved'))}</div>}
        {data && approved.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '22px 12px', borderRadius: 14, border: '1px dashed var(--c334155)', textAlign: 'center' }}>
            <span aria-hidden="true" style={{ fontSize: 30 }}>🌤</span>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{L('Chưa có ngày nghỉ nào sắp tới', 'No upcoming time off')}</div>
            <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{L('Thợ xin nghỉ trong app sẽ hiện ở đây để bạn duyệt.', 'Requests from the team’s app appear here for you to approve.')}</div>
            <button type="button" onClick={() => setPop({ k: 'add' })} disabled={people.length === 0} style={{ ...btnPrimary, height: 36, fontSize: 13, marginTop: 4 }}>＋ {L('Ghi ngày nghỉ', 'Record time off')}</button>
          </div>
        )}
        {!data && !err && <div style={{ padding: 12, fontSize: 13, color: 'var(--c94a3b8)' }}>{L('Đang tải…', 'Loading…')}</div>}
      </div>

      {closed.length > 0 && (
        <details>
          <summary style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--c94a3b8)', cursor: 'pointer' }}>{L(`Từ chối / đã rút · ${closed.length}`, `Declined / withdrawn · ${closed.length}`)}</summary>
          <div style={{ ...grid, marginTop: 8 }}>{closed.map((r) => card(r, 'closed'))}</div>
        </details>
      )}

      {pop?.k === 'add' && <TimeOffDialog vi={vi} staff={people} today={today} onClose={() => setPop(null)} onSaved={() => { void load(); }} />}
      {pop?.k === 'edit' && <TimeOffDialog vi={vi} staff={people} today={today} row={pop.row} onClose={() => setPop(null)} onSaved={() => { void load(); }} />}
      {pop?.k === 'decide' && <DecideDialog vi={vi} row={{ ...pop.row, name: nameOf(pop.row) }} today={today} decision={pop.decision} onClose={() => setPop(null)} onSaved={() => { void load(); }} />}
      {pop?.k === 'remove' && (
        <ConfirmDialog vi={vi}
          title={pop.row.status === 'APPROVED' ? L('Bỏ ngày nghỉ này?', 'Remove this time off?') : L('Xoá đơn này?', 'Delete this request?')}
          text={<>
            <strong style={{ color: 'var(--cf1f5f9)' }}>{nameOf(pop.row)}</strong> · {spanSentence(pop.row, vi)}
            {pop.row.status === 'APPROVED' && <div style={{ marginTop: 8 }}>{L('Sau khi bỏ, giờ này mở lại ngay cho khách đặt (trang đặt lịch, bot, quầy).', 'Once removed, this time opens again for bookings at once (booking page, bots, desk).')}</div>}
          </>}
          danger={pop.row.status === 'APPROVED' ? L('Bỏ ngày nghỉ', 'Remove') : L('Xoá', 'Delete')}
          onClose={() => setPop(null)} onConfirm={() => remove(pop.row)} />
      )}
    </div>
  );
}
