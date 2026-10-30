'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { apiFetch } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { addMin, blockBody, blockLabel, onDay, type CalBlock } from '../../../lib/cal-blocks';
import { C, Icon, Seg, btn } from './CalParts';

/**
 * BLOCK TẠM THỜI — the Calendar's "Khoá giờ": a few hours, a day or several
 * days, for one technician or for the whole salon. Nothing can be booked in
 * it afterwards (online, bots, desk). Bookings already inside are kept and
 * counted, so the desk knows whom to move. The day's blocks are listed under
 * the form with "Gỡ" for the ones the salon made itself.
 */
export function BlockTimeSheet({ open, onClose, day, staff, blocks, onChanged, isMobile, vi, preset }: {
  open: boolean; onClose: () => void;
  /** The salon day being looked at, "YYYY-MM-DD". */
  day: string;
  staff: { id: string; name: string }[];
  blocks: CalBlock[];
  onChanged: () => void;
  isMobile: boolean; vi: boolean;
  /** Opened from a column: that technician (null = whole salon) and the hour clicked. */
  preset?: { staffId: string | null; from?: string } | null;
}) {
  const { token } = useAuth();
  const L = (a: string, b: string) => (vi ? a : b);
  const [who, setWho] = useState('ALL');
  const [kind, setKind] = useState<'hours' | 'day' | 'days'>('hours');
  const [date, setDate] = useState(day);
  const [endDate, setEndDate] = useState(day);
  const [from, setFrom] = useState('12:00');
  const [to, setTo] = useState('14:00');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDate(day); setEndDate(day); setError(null); setDone(null); setReason('');
    setWho(preset?.staffId ?? 'ALL');
    const start = preset?.from || '12:00';
    setFrom(start); setTo(addMin(start, 120)); setKind('hours');
  }, [open, day, preset]);

  const dayBlocks = useMemo(() => blocks.filter((b) => onDay(b, date)), [blocks, date]);

  if (!open) return null;

  async function save() {
    setError(null); setDone(null);
    const r = blockBody({ who, kind, date, endDate, from, to, reason });
    if (!r.ok) {
      setError(r.why === 'order' ? L('Giờ / ngày kết thúc phải sau lúc bắt đầu.', 'The end must be after the start.') : r.why === 'time' ? L('Chọn giờ bắt đầu và kết thúc.', 'Pick a start and an end time.') : L('Chọn ngày.', 'Pick a date.'));
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<{ bookingsInside?: number }>('/calendar-blocks', { method: 'POST', token, body: r.body });
      const n = res?.bookingsInside ?? 0;
      setDone(n > 0
        ? L(`Đã khoá. Có ${n} lịch hẹn đang nằm trong khoảng này — lịch vẫn giữ, hãy dời hoặc báo khách.`, `Blocked. ${n} booking(s) already sit inside it — they are kept; move them or tell the customers.`)
        : L('Đã khoá. Không ai đặt được vào khoảng này nữa.', 'Blocked. Nobody can book that time now.'));
      setReason('');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : L('Không khoá được.', 'Could not block.'));
    } finally { setBusy(false); }
  }

  async function remove(b: CalBlock) {
    if (!window.confirm(L(`Gỡ khoá: ${blockLabel(b, true)}?`, `Remove: ${blockLabel(b, false)}?`))) return;
    setError(null); setDone(null);
    try {
      await apiFetch(`/calendar-blocks/${encodeURIComponent(b.id)}`, { method: 'DELETE', token });
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : L('Không gỡ được.', 'Could not remove.')); }
  }

  const field: CSSProperties = { width: '100%', boxSizing: 'border-box', height: 42, padding: '0 10px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.soft, color: C.ink2, fontSize: isMobile ? 16 : 14, fontFamily: 'inherit' };
  const label: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12.5, fontWeight: 600, color: C.sub };
  const chip: CSSProperties = { height: 30, padding: '0 11px', borderRadius: 999, border: `1px solid ${C.border}`, background: C.panel, color: C.body, fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' };

  const body = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label style={label}>{L('Khoá cho', 'Block for')}
        <select value={who} onChange={(e) => setWho(e.target.value)} style={field} autoComplete="off">
          <option value="ALL">{L('Cả tiệm (mọi thợ)', 'Whole salon (everyone)')}</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <Seg full items={[{ key: 'hours' as const, label: L('Vài giờ', 'Hours') }, { key: 'day' as const, label: L('Cả ngày', 'All day') }, { key: 'days' as const, label: L('Nhiều ngày', 'Several days') }]} value={kind} onChange={setKind} />
      <div style={{ display: 'flex', gap: 10 }}>
        <label style={{ ...label, flex: 1 }}>{kind === 'days' ? L('Từ ngày', 'From') : L('Ngày', 'Date')}
          <input type="date" value={date} onChange={(e) => { setDate(e.target.value); if (endDate < e.target.value) setEndDate(e.target.value); }} style={field} autoComplete="off" />
        </label>
        {kind === 'days' && (
          <label style={{ ...label, flex: 1 }}>{L('Đến hết ngày', 'Until (incl.)')}
            <input type="date" value={endDate} min={date} onChange={(e) => setEndDate(e.target.value)} style={field} autoComplete="off" />
          </label>
        )}
      </div>
      {kind === 'hours' && (
        <>
          <div style={{ display: 'flex', gap: 10 }}>
            <label style={{ ...label, flex: 1 }}>{L('Từ', 'From')}
              <input type="time" step={900} value={from} onChange={(e) => setFrom(e.target.value)} style={field} autoComplete="off" />
            </label>
            <label style={{ ...label, flex: 1 }}>{L('Đến', 'To')}
              <input type="time" step={900} value={to} onChange={(e) => setTo(e.target.value)} style={field} autoComplete="off" />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[1, 2, 3, 4].map((h) => (
              <button key={h} type="button" onClick={() => setTo(addMin(from, h * 60))} style={chip}>{L(`${h} giờ`, `${h} h`)}</button>
            ))}
          </div>
        </>
      )}
      <label style={label}>{L('Lý do (không bắt buộc)', 'Reason (optional)')}
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder={L('VD: đào tạo, sự kiện riêng, mất điện', 'e.g. training, private event, power cut')} style={field} autoComplete="off" />
      </label>
      {error && <div role="alert" style={{ padding: '8px 10px', borderRadius: 10, background: 'var(--wash-red)', color: 'var(--ink-bad)', fontSize: 13, fontWeight: 600 }}>{error}</div>}
      {done && <div role="status" style={{ padding: '8px 10px', borderRadius: 10, background: 'var(--wash-amber)', color: 'var(--ink-warn)', fontSize: 13, fontWeight: 600 }}>{done}</div>}
      <button type="button" disabled={busy} onClick={save} style={{ ...btn(true, 44), width: '100%', opacity: busy ? 0.6 : 1 }}>
        <Icon name="lock" size={16} />{busy ? L('Đang khoá…', 'Blocking…') : L('Khoá thời gian này', 'Block this time')}
      </button>
      <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: C.sub }}>{L('Đang khoá ngày này', 'Blocked this day')}</span>
        {dayBlocks.length === 0 && <span style={{ fontSize: 13, color: C.muted }}>{L('Chưa có.', 'Nothing yet.')}</span>}
        {dayBlocks.map((b) => (
          <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 10, border: `1px solid ${C.line}`, background: C.soft }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: C.ink2 }}>🔒 {blockLabel(b, vi)}</span>
            {b.byOwner
              ? <button type="button" onClick={() => remove(b)} style={{ ...chip, color: 'var(--ink-bad)' }}>{L('Gỡ', 'Remove')}</button>
              : <span style={{ fontSize: 11.5, color: C.muted }}>{L('nghỉ phép · sửa ở Nhân viên', 'leave · edit in Staff')}</span>}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 80 }} />
      <div role="dialog" aria-label={L('Khoá giờ', 'Block time')}
        style={isMobile
          ? { position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 81, maxHeight: '90dvh', overflowY: 'auto', background: C.panel, borderRadius: '22px 22px 0 0', padding: '14px 16px calc(16px + env(safe-area-inset-bottom, 0px))', boxSizing: 'border-box' }
          : { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 81, width: 460, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100dvh - 48px)', overflowY: 'auto', background: C.panel, border: `1px solid ${C.line}`, borderRadius: 18, padding: 18, boxSizing: 'border-box', boxShadow: '0 24px 48px -16px rgba(0,0,0,.4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: C.ink }}>{L('Khoá giờ', 'Block time')}</span>
          <span style={{ fontSize: 12.5, color: C.muted }}>{L('không ai đặt được vào đây', 'nobody can book it')}</span>
          <button type="button" onClick={onClose} aria-label="Close" style={{ marginLeft: 'auto', width: 36, height: 36, border: 0, background: 'transparent', color: C.muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="x" size={20} /></button>
        </div>
        {body}
      </div>
    </>
  );
}
