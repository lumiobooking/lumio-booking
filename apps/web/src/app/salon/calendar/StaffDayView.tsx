'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui, formatPrice } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';

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
  payments?: { status: string; amountCents: number }[];
  customer: { id: string; firstName: string; lastName: string | null; email: string | null; phone: string | null } | null;
  service: { id: string; name: string; durationMinutes: number } | null;
  assignedStaff: { id: string; firstName: string; lastName: string | null } | null;
}
interface StaffLite {
  id: string;
  firstName: string;
  lastName: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  takesAppointments?: boolean;
}

// Same six-bucket status palette used by the month/day views, keyed by the raw
// booking enum so colors stay consistent across every calendar mode.
const STATUS_COLOR: Record<string, string> = {
  PENDING: '#f59e0b', ASSIGNED: '#f59e0b', REJECTED: '#f59e0b',
  ACCEPTED: '#3b82f6', CONFIRMED: '#3b82f6',
  ARRIVED: '#10b981', COMPLETED: '#8b5cf6', NO_SHOW: '#ef4444', CANCELLED: '#64748b',
};
const sc = (status: string) => STATUS_COLOR[status] ?? '#f59e0b';
const AVATAR_BG = ['#f472b6', '#60a5fa', '#34d399', '#fbbf24', '#a78bfa', '#f87171', '#22d3ee', '#c084fc'];

// Resource view: one column per technician + an "unassigned" lane for bookings
// with no tech yet (walk-ins, hotline bookings). Reads at a glance who is busy,
// who is free, and where a walk-in can slot in.
export function StaffDayView({ date, items, tz, isMobile, onOpen, today }: {
  date: Date; items: Booking[]; tz?: string; isMobile: boolean; onOpen: (b: Booking) => void; today: Date;
}) {
  const { token } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [staff, setStaff] = useState<StaffLite[]>([]);
  const [focus, setFocus] = useState<string | null>(null); // isolate one tech

  useEffect(() => {
    if (!token) return;
    apiFetch<StaffLite[]>('/staff', { token }).then(setStaff).catch(() => undefined);
  }, [token]);

  const fmtT = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) });
  const minInTz = (iso: string) => {
    const d = new Date(iso);
    if (!tz) return d.getHours() * 60 + d.getMinutes();
    const p = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).formatToParts(d);
    return (Number(p.find((x) => x.type === 'hour')?.value ?? 0) % 24) * 60 + Number(p.find((x) => x.type === 'minute')?.value ?? 0);
  };

  const isToday = date.getTime() === today.getTime();
  const currency = items[0]?.currency ?? 'USD';
  const revenue = items.reduce((s, b) => s + (b.status === 'CANCELLED' || b.status === 'NO_SHOW' ? 0 : b.priceCents), 0);
  const arrived = items.filter((b) => b.status === 'ARRIVED').length;

  const activeStaff = useMemo(
    () => staff.filter((s) => s.isActive && s.takesAppointments !== false).sort((a, b) => a.firstName.localeCompare(b.firstName)),
    [staff],
  );

  // Columns: unassigned lane (only if it has items) + one per staff. Any tech
  // that appears on a booking but isn't in the active list still gets a column,
  // so no appointment is ever hidden.
  const columns = useMemo(() => {
    const byStaff = new Map<string, Booking[]>();
    const unassigned: Booking[] = [];
    for (const b of items) {
      const id = b.assignedStaff?.id;
      if (!id) { unassigned.push(b); continue; }
      const arr = byStaff.get(id) ?? [];
      arr.push(b); byStaff.set(id, arr);
    }
    const seen = new Set<string>();
    const cols: { id: string; name: string; items: Booking[] }[] = [];
    for (const s of activeStaff) {
      seen.add(s.id);
      cols.push({ id: s.id, name: s.firstName, items: byStaff.get(s.id) ?? [] });
    }
    for (const [id, arr] of byStaff) {
      if (seen.has(id)) continue;
      cols.push({ id, name: arr[0].assignedStaff?.firstName ?? '—', items: arr });
    }
    const shown = focus ? cols.filter((c) => c.id === focus) : cols;
    return (!focus && unassigned.length)
      ? [{ id: '__un', name: t('cal.unassignedCol'), items: unassigned }, ...shown]
      : shown;
  }, [items, activeStaff, focus, t]);

  // Vertical window: fit the day's appointments, default 9a–6p, clamp 7a–9p.
  let startH = 9, endH = 18;
  for (const b of items) {
    const s = minInTz(b.startTime);
    let e = minInTz(b.endTime); if (e <= s) e = s + 30;
    startH = Math.min(startH, Math.floor(s / 60));
    endH = Math.max(endH, Math.ceil(e / 60));
  }
  startH = Math.max(7, startH); endH = Math.min(21, Math.max(endH, startH + 4));
  const gStart = startH * 60;
  const HP = isMobile ? 50 : 60;      // px per hour
  const railW = 50;
  const colW = isMobile ? 132 : 168;
  const headH = 46;
  const total = (endH - startH) * HP;
  const nowMin = isToday ? minInTz(new Date().toISOString()) : -1;
  const nowTop = nowMin >= gStart && nowMin <= endH * 60 ? (nowMin - gStart) / 60 * HP : -1;

  // Place a column's bookings; overlaps (double-booking) split into side lanes.
  const place = (list: Booking[]) => {
    const ev = list.map((b) => {
      const s = minInTz(b.startTime);
      let e = minInTz(b.endTime); if (e <= s) e = s + (b.service?.durationMinutes || 30);
      return { b, s, e };
    }).sort((a, z) => a.s - z.s || a.e - z.e);
    type P = { b: Booking; s: number; e: number; col: number; cols: number };
    const out: P[] = [];
    let cluster: { b: Booking; s: number; e: number; col: number }[] = [];
    let clusterEnd = -1;
    const laneEnds: number[] = [];
    const flush = () => {
      const cols = Math.max(1, ...cluster.map((c) => c.col + 1));
      for (const c of cluster) out.push({ ...c, cols });
      cluster = []; laneEnds.length = 0;
    };
    for (const x of ev) {
      if (cluster.length && x.s >= clusterEnd) flush();
      let col = laneEnds.findIndex((end) => end <= x.s);
      if (col === -1) { col = laneEnds.length; laneEnds.push(x.e); } else laneEnds[col] = x.e;
      cluster.push({ b: x.b, s: x.s, e: x.e, col });
      clusterEnd = cluster.length === 1 ? x.e : Math.max(clusterEnd, x.e);
    }
    if (cluster.length) flush();
    return out;
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10, padding: '10px 14px', background: '#111827', border: '1px solid #1f2937', borderRadius: 10 }}>
        <span style={{ fontSize: 14 }}><strong style={{ fontSize: 18 }}>{items.length}</strong> <span style={{ color: '#94a3b8' }}>{t('cal.apptWord')}</span></span>
        <span style={{ color: '#334155' }}>|</span>
        <span style={{ fontSize: 14 }}><span style={{ color: '#94a3b8' }}>{t('cal.expected')}: </span><strong style={{ color: '#22c55e' }}>{formatPrice(revenue, currency)}</strong></span>
        <span style={{ color: '#334155' }}>|</span>
        <span style={{ fontSize: 14 }}><span style={{ color: '#94a3b8' }}>{t('cal.stArrived')}: </span><strong style={{ color: '#10b981' }}>{arrived}</strong></span>
      </div>

      {activeStaff.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          <button onClick={() => setFocus(null)} style={chip(!focus)}>{t('cal.allStaff')}</button>
          {activeStaff.map((s) => (
            <button key={s.id} onClick={() => setFocus(focus === s.id ? null : s.id)} style={chip(focus === s.id)}>{s.firstName}</button>
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <div style={{ ...ui.card, textAlign: 'center', color: '#64748b', padding: '44px 0', fontSize: 14 }}>{t('cal.noAppts')}</div>
      ) : (
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', border: '1px solid #1f2937', borderRadius: 12, background: '#0f172a' }}>
          <div style={{ position: 'relative', display: 'flex', minWidth: railW + columns.length * colW }}>
            <div style={{ position: 'sticky', left: 0, zIndex: 4, width: railW, flexShrink: 0, background: '#0f172a', borderRight: '1px solid #1f2937' }}>
              <div style={{ height: headH }} />
              <div style={{ position: 'relative', height: total }}>
                {Array.from({ length: endH - startH + 1 }, (_, i) => startH + i).map((h) => (
                  <div key={h} style={{ position: 'absolute', top: (h - startH) * HP - 6, right: 7, fontSize: 11, color: '#64748b' }}>
                    {((h % 12) || 12)}{h < 12 ? 'a' : 'p'}
                  </div>
                ))}
              </div>
            </div>

            {columns.map((c, ci) => {
              const pos = place(c.items);
              const load = c.items.filter((b) => b.status !== 'CANCELLED' && b.status !== 'NO_SHOW').length;
              const un = c.id === '__un';
              return (
                <div key={c.id} style={{ width: colW, flexShrink: 0, borderRight: '1px solid #1f2937', background: un ? 'rgba(99,102,241,0.05)' : 'transparent' }}>
                  <div style={{ height: headH, display: 'flex', alignItems: 'center', gap: 7, padding: '0 8px', borderBottom: '1px solid #1f2937', boxSizing: 'border-box' }}>
                    <div style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0, background: un ? '#334155' : AVATAR_BG[ci % AVATAR_BG.length], color: un ? '#cbd5e1' : '#0b1220', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>
                      {un ? '?' : c.name.charAt(0).toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                      <div style={{ fontSize: 10.5, color: '#64748b' }}>{load} {t('cal.apptWord')}</div>
                    </div>
                  </div>
                  <div style={{ position: 'relative', height: total }}>
                    {Array.from({ length: endH - startH }, (_, i) => i + 1).map((i) => (
                      <div key={i} style={{ position: 'absolute', top: i * HP, left: 0, right: 0, borderTop: '1px solid #1e293b' }} />
                    ))}
                    {pos.map(({ b, s, e, col, cols }) => {
                      const cc = sc(b.status);
                      const top = (s - gStart) / 60 * HP;
                      const h = Math.max(34, (e - s) / 60 * HP - 3);
                      const dim = b.status === 'CANCELLED' || b.status === 'NO_SHOW';
                      const w = 100 / cols;
                      return (
                        <div key={b.id} onClick={() => onOpen(b)} title={`${fmtT(b.startTime)} · ${b.customer?.firstName ?? ''} · ${b.service?.name ?? ''}`}
                          style={{ position: 'absolute', top, height: h, left: `calc(${col * w}% + 3px)`, width: `calc(${w}% - 6px)`, boxSizing: 'border-box', background: dim ? '#18202f' : `${cc}22`, border: `1px solid ${cc}66`, borderRadius: 8, padding: '3px 7px', overflow: 'hidden', cursor: 'pointer', opacity: dim ? 0.7 : 1 }}>
                          <div style={{ fontSize: 10.5, fontWeight: 700, color: cc, whiteSpace: 'nowrap' }}>{fmtT(b.startTime)}{h > 40 ? `–${fmtT(b.endTime)}` : ''}</div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: b.status === 'CANCELLED' ? 'line-through' : 'none' }}>
                            {b.customer ? `${b.customer.firstName}${b.customer.lastName ? ' ' + b.customer.lastName : ''}` : '—'}
                          </div>
                          {h > 44 && <div style={{ fontSize: 11, color: '#cbd5e1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.service?.name ?? ''}</div>}
                          {h > 62 && <div style={{ fontSize: 10.5, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>{formatPrice(b.priceCents, b.currency)}</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {nowTop >= 0 && (
              <div style={{ position: 'absolute', top: headH + nowTop, left: railW, right: 0, height: 0, borderTop: '2px solid #ef4444', zIndex: 5, pointerEvents: 'none' }}>
                <span style={{ position: 'absolute', left: 0, top: -4, width: 7, height: 7, borderRadius: '50%', background: '#ef4444' }} />
              </div>
            )}
          </div>
        </div>
      )}
      <p style={{ color: '#64748b', fontSize: 12, marginTop: 10 }}>{t('cal.staffHint')}</p>
    </div>
  );
}

function chip(active: boolean): React.CSSProperties {
  return { padding: '4px 11px', borderRadius: 999, fontSize: 12, cursor: 'pointer', fontWeight: 600, border: `1px solid ${active ? '#6366f1' : '#334155'}`, background: active ? '#6366f1' : 'transparent', color: active ? '#fff' : '#94a3b8' };
}
