'use client';

/**
 * "CHƯA CÓ THỢ" — why a booking has nobody on it, and the button that fixes it.
 *
 * Friendly nails saw online bookings sit unassigned and could not tell why:
 * the salon's assignment mode, a technician who does not take appointments,
 * nobody able to do the service, nobody on shift, or everybody busy. The API
 * counts the engine's filters (GET /bookings/:id/assign-check); this says the
 * first one that empties the list, in the desk's words.
 */
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ind } from '../lib/ui-industry';
import { leaveReason } from '../lib/time-off-ui';

export interface AssignCheck { mode: 'none' | 'auto'; assigned: boolean; team: number; takesAppointments: number; serviceUnclaimed: boolean; skilled: number; onShift: number; onLeave?: number; free: string[] }

/** The one sentence that explains it. Pure — exported for the spec. */
export function assignReason(c: AssignCheck, vi: boolean): string {
  const L = (v: string, e: string) => ind(vi ? v : e);
  if (c.team === 0) return L('Tiệm chưa có thợ nào trong danh sách Thợ.', 'There are no technicians on the Staff page yet.');
  if (c.takesAppointments === 0) return L('Chưa thợ nào bật "Nhận lịch hẹn" trong hồ sơ thợ.', 'No technician has "Takes appointments" turned on.');
  if (c.skilled === 0) return L('Không thợ nào có dịch vụ này trong kỹ năng.', 'No technician has this service in their skills.');
  const leave = leaveReason(c.onShift, c.onLeave, vi);
  if (leave) return ind(leave);
  if (c.onShift === 0) return L('Không thợ nào có ca làm vào giờ này (xem Giờ làm của thợ).', 'No technician works at this time (check staff hours).');
  if (c.free.length === 0) return L('Tất cả thợ làm được đều đã có khách vào giờ này.', 'Every technician who can do it is booked at this time.');
  const names = c.free.slice(0, 4).join(', ');
  return c.mode === 'none'
    ? L(`Tiệm đang để giao thợ thủ công. Thợ rảnh: ${names}.`, `The salon assigns by hand. Free: ${names}.`)
    : L(`Thợ rảnh: ${names}. Bấm "Giao thợ tự động".`, `Free: ${names}. Press "Auto-assign".`);
}

/** In the booking drawer, for a booking with nobody on it. */
export function UnassignedHelp({ bookingId, vi, onAssign }: { bookingId: string; vi: boolean; onAssign: () => void }) {
  const { token } = useAuth();
  const [c, setC] = useState<AssignCheck | null>(null);
  useEffect(() => {
    if (!token) return;
    let alive = true;
    apiFetch<AssignCheck>(`/bookings/${bookingId}/assign-check`, { token }).then((r) => { if (alive) setC(r); }).catch(() => undefined);
    return () => { alive = false; };
  }, [token, bookingId]);
  if (!c || c.assigned) return null;
  const L = (v: string, e: string) => ind(vi ? v : e);
  return (
    <div style={{ border: '1px solid var(--ink-warn)', borderRadius: 10, padding: 10, marginTop: 12, fontSize: 13, lineHeight: 1.5 }}>
      <div style={{ fontWeight: 700, color: 'var(--ink-warn)' }}>⚠ {L('Chưa có thợ', 'No technician yet')}</div>
      <div style={{ color: 'var(--ccbd5e1)', marginTop: 3 }}>{assignReason(c, vi)}</div>
      {c.serviceUnclaimed && c.skilled > 0 && (
        <div style={{ color: 'var(--c94a3b8)', fontSize: 12, marginTop: 3 }}>
          {L('Chưa thợ nào đăng ký dịch vụ này trong kỹ năng — hệ thống tạm coi mọi thợ đều làm được.', 'Nobody lists this service in their skills — every technician counts for now.')}
        </div>
      )}
      {c.mode === 'none' && (
        <div style={{ color: 'var(--c94a3b8)', fontSize: 12, marginTop: 3 }}>{L('Bật "Tự động giao thợ" trong Cài đặt → Lịch hẹn để lịch online tự chia theo lượt.', 'Turn on auto-assign in Settings → Booking so online bookings are shared by turn.')}</div>
      )}
      {c.free.length > 0 && (
        <button type="button" onClick={onAssign} style={{ marginTop: 8, padding: '7px 12px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
          {L('Giao thợ tự động', 'Auto-assign')}
        </button>
      )}
    </div>
  );
}

/** Above the calendar: upcoming bookings nobody is on, and one button for all of them. */
export function UnassignedBanner({ bookings, vi, onDone }: { bookings: { status: string; startTime: string; assignedStaff?: unknown }[]; vi: boolean; onDone: () => void }) {
  const { token } = useAuth();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const now = Date.now();
  const n = bookings.filter((b) => b.status === 'PENDING' && !b.assignedStaff && new Date(b.startTime).getTime() >= now).length;
  if (!n && !msg) return null;
  const L = (v: string, e: string) => ind(vi ? v : e);
  async function run() {
    if (!token || busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await apiFetch<{ checked: number; assigned: number }>('/bookings/auto-assign-open', { method: 'POST', token });
      setMsg(L(`Đã giao ${r.assigned}/${r.checked} lịch. Lịch còn lại: mở lịch để xem lý do.`, `Assigned ${r.assigned} of ${r.checked}. For the rest, open the booking to see why.`));
      onDone();
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '9px 12px', borderRadius: 10, border: '1px solid var(--ink-warn)', marginBottom: 12, fontSize: 13 }}>
      {n > 0 && <span style={{ color: 'var(--ink-warn)', fontWeight: 600 }}>⚠ {L(`${n} lịch sắp tới chưa có thợ`, `${n} upcoming booking(s) with no technician`)}</span>}
      {msg && <span style={{ color: 'var(--c94a3b8)' }}>{msg}</span>}
      {n > 0 && <button type="button" onClick={run} disabled={busy} style={{ marginLeft: 'auto', padding: '6px 12px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>{busy ? '…' : L('Giao thợ tự động', 'Auto-assign all')}</button>}
    </div>
  );
}
