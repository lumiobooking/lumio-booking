'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { formatPrice } from '../lib/ui';
import { fmtInTz } from '../lib/datetime';
import { ind } from '../lib/ui-industry';

/**
 * WHAT TODAY STILL OWES THE BOOKS — the end-of-day checklist.
 *
 * Reads GET /pos/day-check (pos.service.dayCheck). Four lists, each with its
 * one-tap fix: a walk-in served and never rung up ("Tính tiền"), a paid line
 * nobody is credited with (a picker, PATCH /pos/orders/:id/staff), a booking
 * whose time passed with nothing recorded, and a booking completed by hand —
 * counted at list price only. Shown on the till's close-shift sheet and on
 * the front desk. It never blocks anything: a checklist, not a gate.
 */

interface DayCheck {
  day: string; tz: string;
  unpaid: { id: string; customerName: string | null; status: string; at: string; services: string[] }[];
  unassigned: { orderId: string; orderNumber: number; items: { id: string; name: string; lineTotalCents: number }[] }[];
  openBookings: { id: string; customerName: string | null; startTime: string; status: string }[];
  estimated: { id: string; customerName: string | null; startTime: string; priceCents: number }[];
  counts: { unpaid: number; unassigned: number; openBookings: number; estimated: number };
}

export function DayCheckCard({ token, vi, currency, compact = false, onChanged }: {
  token: string | null;
  vi: boolean;
  currency?: string;
  /** One line with the counts and a toggle; the lists open on demand. */
  compact?: boolean;
  onChanged?: () => void;
}) {
  const L = (v: string, e: string) => ind(vi ? v : e);
  const fmt = (c: number) => formatPrice(c, currency);
  const [data, setData] = useState<DayCheck | null>(null);
  const [open, setOpen] = useState(!compact);
  const [staff, setStaff] = useState<{ id: string; firstName: string; lastName: string | null }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const r = await apiFetch<DayCheck>('/pos/day-check', { token });
      setData(r);
      setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : 'error'); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!token || !open) return;
    apiFetch<{ id: string; firstName: string; lastName: string | null; isActive?: boolean }[]>('/staff', { token })
      .then((s) => setStaff((Array.isArray(s) ? s : []).filter((x) => x.isActive !== false)))
      .catch(() => { /* the picker is simply empty */ });
  }, [token, open]);

  const credit = async (orderId: string, itemId: string, staffMemberId: string) => {
    if (!token || !staffMemberId) return;
    setBusy(itemId); setErr(null);
    try {
      await apiFetch(`/pos/orders/${orderId}/staff`, { method: 'PATCH', token, body: { items: [{ itemId, staffMemberId }] } });
      await load();
      onChanged?.();
    } catch (e) { setErr(e instanceof Error ? e.message : 'error'); }
    finally { setBusy(null); }
  };

  if (!data) return null;
  const total = data.counts.unpaid + data.counts.unassigned + data.counts.openBookings + data.counts.estimated;
  const time = (iso: string) => fmtInTz(iso, { hour: 'numeric', minute: '2-digit' });

  const head = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 16 }}>{total === 0 ? '✅' : '🧾'}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ce2e8f0)' }}>
          {total === 0
            ? L('Sổ sách hôm nay đã đủ — không còn gì cần ghi.', 'Today’s books are complete — nothing left to record.')
            : L(`Hôm nay còn ${total} việc cần ghi cho sổ sách`, `${total} thing${total > 1 ? 's' : ''} still to record today`)}
        </div>
        {total > 0 && (
          <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginTop: 2, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {data.counts.unpaid > 0 && <span>💺 {data.counts.unpaid} {L('khách chưa tính tiền', 'served, not paid')}</span>}
            {data.counts.unassigned > 0 && <span>👤 {data.counts.unassigned} {L('dòng chưa gán thợ', 'lines with no tech')}</span>}
            {data.counts.openBookings > 0 && <span>📅 {data.counts.openBookings} {L('lịch hẹn chưa kết thúc', 'bookings left open')}</span>}
            {data.counts.estimated > 0 && <span>≈ {data.counts.estimated} {L('hoàn tất không hoá đơn', 'completed without a bill')}</span>}
          </div>
        )}
      </div>
      {compact && total > 0 && (
        <button type="button" onClick={() => setOpen((v) => !v)} style={ghost}>{open ? L('Thu gọn', 'Hide') : L('Xử lý', 'Fix')}</button>
      )}
    </div>
  );

  const section = (title: string, hint: string, rows: React.ReactNode[]) => rows.length > 0 && (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.6, color: 'var(--c94a3b8)' }}>{title} <span style={{ fontWeight: 500, letterSpacing: 0, textTransform: 'none' }}>· {hint}</span></div>
      {rows}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 14px', borderRadius: 12, border: `1px solid ${total === 0 ? 'var(--line)' : 'rgba(245,158,11,.45)'}`, background: total === 0 ? 'var(--c0f172a)' : 'rgba(245,158,11,.08)' }}>
      {head}
      {err && <div style={{ fontSize: 12.5, color: 'var(--ink-bad)' }}>{err}</div>}
      {open && total > 0 && (
        <>
          {section(L('KHÁCH ĐÃ LÀM, CHƯA TÍNH TIỀN', 'SERVED, NOT PAID'), L('qua ngày sẽ tự đóng với doanh thu = 0', 'closes at midnight with no sale'),
            data.unpaid.map((w) => (
              <div key={w.id} style={row}>
                <span style={{ color: 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>{time(w.at)}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <b>{w.customerName || L('Khách vãng lai', 'Walk-in')}</b>{w.services.length ? <span style={{ color: 'var(--c94a3b8)' }}> · {w.services.join(', ')}</span> : null}
                </span>
                <a href={`/salon/pos?walkInId=${encodeURIComponent(w.id)}`} style={linkBtn}>{L('Tính tiền', 'Charge')} →</a>
              </div>
            )))}
          {section(L('ĐÃ THU, CHƯA GÁN THỢ', 'PAID, NO TECHNICIAN'), L('thợ không được tính hoa hồng cho dòng này', 'nobody is paid commission on these'),
            data.unassigned.flatMap((o) => o.items.map((it) => (
              <div key={it.id} style={row}>
                <span style={{ color: 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>#{o.orderNumber}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name} <span style={{ color: 'var(--c94a3b8)' }}>· {fmt(it.lineTotalCents)}</span></span>
                <select value="" disabled={busy === it.id} onChange={(e) => void credit(o.orderId, it.id, e.target.value)} style={sel}>
                  <option value="">{busy === it.id ? L('Đang lưu…', 'Saving…') : L('Gán cho…', 'Credit to…')}</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.firstName} {s.lastName ?? ''}</option>)}
                </select>
              </div>
            ))))}
          {section(L('LỊCH HẸN ĐÃ TỚI GIỜ, CHƯA KẾT THÚC', 'BOOKINGS PAST THEIR TIME, STILL OPEN'), L('tính tiền, hoặc đánh dấu hoàn tất / không đến trên lịch', 'charge it, or mark completed / no-show on the calendar'),
            data.openBookings.map((a) => (
              <div key={a.id} style={row}>
                <span style={{ color: 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>{time(a.startTime)}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><b>{a.customerName || L('Khách', 'Client')}</b> <span style={{ color: 'var(--c94a3b8)' }}>· {a.status === 'ARRIVED' ? L('đã đến', 'arrived') : L('chưa check-in', 'not checked in')}</span></span>
                <a href={`/salon/pos?appointmentId=${encodeURIComponent(a.id)}`} style={linkBtn}>{L('Tính tiền', 'Charge')} →</a>
              </div>
            )))}
          {section(L('HOÀN TẤT KHÔNG CÓ HOÁ ĐƠN', 'COMPLETED WITHOUT A BILL'), L('đang tính theo giá niêm yết — không tip, thuế, giảm giá', 'counted at list price — no tip, tax or discount'),
            data.estimated.map((a) => (
              <div key={a.id} style={row}>
                <span style={{ color: 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>{time(a.startTime)}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><b>{a.customerName || L('Khách', 'Client')}</b> <span style={{ color: 'var(--c94a3b8)' }}>· ≈ {fmt(a.priceCents)}</span></span>
                <a href={`/salon/pos?appointmentId=${encodeURIComponent(a.id)}`} style={linkBtn}>{L('Lập hoá đơn', 'Ring it up')} →</a>
              </div>
            )))}
        </>
      )}
    </div>
  );
}

const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 8, background: 'var(--c111827)', border: '1px solid var(--line)', fontSize: 13, color: 'var(--ce2e8f0)' };
const linkBtn: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: 'var(--ink-link)', textDecoration: 'none', whiteSpace: 'nowrap' };
const ghost: React.CSSProperties = { height: 32, padding: '0 11px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ccbd5e1)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' };
const sel: React.CSSProperties = { height: 32, minWidth: 140, padding: '0 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--c0f172a)', color: 'var(--ce2e8f0)', fontSize: 13, fontFamily: 'inherit' };
