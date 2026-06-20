'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui, formatPrice } from '../../../lib/ui';

interface Addon { id: string; name: string; priceCents: number; kind?: string }
interface Booking {
  id: string;
  status: string;
  startTime: string;
  endTime: string;
  priceCents: number;
  currency: string;
  notes: string | null;
  addons?: Addon[];
  customer: { firstName: string; lastName: string | null; email: string | null; phone: string | null } | null;
  service: { name: string; durationMinutes: number } | null;
  assignedStaff: { firstName: string; lastName: string | null } | null;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: '#eab308', ASSIGNED: '#3b82f6', ACCEPTED: '#22c55e', CONFIRMED: '#22c55e',
  REJECTED: '#ef4444', CANCELLED: '#64748b', COMPLETED: '#a855f7', NO_SHOW: '#ef4444',
};

export default function CalendarPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Booking | null>(null);
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const [view, setView] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    // Fetch the visible month range (+/- to catch spillover days).
    const from = new Date(view.getFullYear(), view.getMonth() - 1, 1).toISOString();
    const to = new Date(view.getFullYear(), view.getMonth() + 2, 0).toISOString();
    try {
      const params = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
      setBookings(await apiFetch<Booking[]>(`/bookings${params}`, { token }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load calendar');
    }
  }, [token, view]);

  useEffect(() => { load(); }, [load]);

  const days = useMemo(() => buildMonth(view), [view]);
  const byDay = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const b of bookings) {
      const key = new Date(b.startTime).toDateString();
      const arr = map.get(key) ?? [];
      arr.push(b);
      map.set(key, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime));
    return map;
  }, [bookings]);

  const monthLabel = view.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const name = (c: { firstName: string; lastName?: string | null } | null) => (c ? c.firstName : '');

  async function action(id: string, path: string) {
    try {
      await apiFetch(`/bookings/${id}/${path}`, { method: 'POST', token });
      setSelected(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  }

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>Calendar</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <strong style={{ minWidth: 140, textAlign: 'center' }}>{monthLabel}</strong>
          <button style={navBtn} onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}>‹</button>
          <button style={navBtn} onClick={() => setView(new Date(today.getFullYear(), today.getMonth(), 1))}>Today</button>
          <button style={navBtn} onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}>›</button>
        </div>
      </div>

      {error && <div style={ui.banner}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 1, background: '#334155', border: '1px solid #334155', borderRadius: 10, overflow: 'hidden' }}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} style={{ background: '#1e293b', textAlign: 'center', padding: '8px 0', fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>{d}</div>
        ))}
        {days.map((d, i) => {
          const items = d ? byDay.get(d.toDateString()) ?? [] : [];
          const isToday = d && d.getTime() === today.getTime();
          return (
            <div key={i} style={{ background: '#0f172a', minHeight: 104, padding: 6, opacity: d ? 1 : 0.4 }}>
              {d && (
                <>
                  <div style={{ fontSize: 12, fontWeight: isToday ? 700 : 500, color: isToday ? '#818cf8' : '#cbd5e1', marginBottom: 4 }}>
                    {d.getDate()}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {items.slice(0, 4).map((b) => (
                      <div key={b.id} title={`${b.service?.name ?? ''} · ${name(b.customer)}`}
                        onClick={() => setSelected(b)}
                        style={{ fontSize: 11, padding: '2px 5px', borderRadius: 4, background: '#1e293b', borderLeft: `3px solid ${STATUS_COLORS[b.status] ?? '#64748b'}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' }}>
                        {new Date(b.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} {name(b.customer)}
                      </div>
                    ))}
                    {items.length > 4 && <div style={{ fontSize: 11, color: '#94a3b8' }}>+{items.length - 4} more</div>}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {selected && (
        <BookingDetail booking={selected} onClose={() => setSelected(null)} onAction={action} />
      )}
    </section>
  );
}

function BookingDetail({ booking: b, onClose, onAction }: {
  booking: Booking; onClose: () => void; onAction: (id: string, path: string) => void;
}) {
  const start = new Date(b.startTime);
  const end = new Date(b.endTime);
  const duration = Math.round((end.getTime() - start.getTime()) / 60000);
  const fullName = b.customer ? `${b.customer.firstName} ${b.customer.lastName ?? ''}`.trim() : '—';
  const tech = b.assignedStaff ? `${b.assignedStaff.firstName} ${b.assignedStaff.lastName ?? ''}`.trim() : 'Unassigned';
  const active = ['PENDING', 'ASSIGNED', 'ACCEPTED', 'CONFIRMED'].includes(b.status);

  return (
    <>
      {/* backdrop */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 40 }} />
      {/* right drawer */}
      <div style={{ position: 'fixed', top: 0, right: 0, height: '100vh', width: 380, maxWidth: '90vw', background: '#111827', borderLeft: '1px solid #1f2937', zIndex: 41, padding: 24, overflowY: 'auto', boxShadow: '-8px 0 30px rgba(0,0,0,0.4)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, margin: 0 }}>Appointment details</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{b.service?.name ?? 'Service'}</div>
          <div style={{ marginTop: 8 }}>
            <StatusBadge status={b.status} />
          </div>
        </div>

        <DetailRow label="Date" value={start.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })} />
        <DetailRow label="Time" value={`${fmtTime(start)} – ${fmtTime(end)}`} />
        <DetailRow label="Duration" value={`${duration} min`} />
        <DetailRow label="Technician" value={tech} />
        <DetailRow label="Price" value={formatPrice(b.priceCents, b.currency)} />
        {b.addons && b.addons.some((a) => a.kind === 'service') && (
          <DetailRow label="Also booked" value={b.addons.filter((a) => a.kind === 'service').map((a) => a.name).join(', ')} />
        )}
        {b.addons && b.addons.some((a) => a.kind !== 'service') && (
          <DetailRow label="Add-ons" value={b.addons.filter((a) => a.kind !== 'service').map((a) => a.name).join(', ')} />
        )}

        <div style={{ borderTop: '1px solid #1f2937', margin: '16px 0 12px' }} />
        <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6, fontWeight: 600 }}>Customer</div>
        <DetailRow label="Name" value={fullName} />
        {b.customer?.phone && <DetailRow label="Phone" value={b.customer.phone} />}
        {b.customer?.email && <DetailRow label="Email" value={b.customer.email} />}
        {b.notes && <DetailRow label="Note" value={b.notes} />}

        {active && (
          <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
            <button onClick={() => onAction(b.id, 'complete')} style={{ ...ui.primaryBtn, background: '#22c55e', flex: 1 }}>Complete</button>
            <button onClick={() => onAction(b.id, 'cancel')} style={{ ...ui.dangerBtn, flex: 1 }}>Cancel</button>
          </div>
        )}
      </div>
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', fontSize: 14 }}>
      <span style={{ color: '#94a3b8' }}>{label}</span>
      <span style={{ textAlign: 'right', wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] ?? '#64748b';
  return <span style={{ color: c, border: `1px solid ${c}`, borderRadius: 999, padding: '3px 12px', fontSize: 12, fontWeight: 600 }}>{status}</span>;
}

function fmtTime(d: Date) {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function buildMonth(view: Date): (Date | null)[] {
  const year = view.getFullYear(), month = view.getMonth();
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) { const dt = new Date(year, month, d); dt.setHours(0, 0, 0, 0); cells.push(dt); }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

const navBtn: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', fontSize: 13, cursor: 'pointer',
};
