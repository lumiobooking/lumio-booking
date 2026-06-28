'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui, formatPrice } from '../../../lib/ui';
import { useLang, tr, DAY_LABEL } from '../../../lib/i18n';

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

// Six operational buckets the front desk actually tracks. The 8 raw enum values
// fold into these so the calendar reads at a glance (key → bilingual label via
// `cal.st<Key>`; color → dot/stripe).
const STATUS_BUCKETS: { key: string; color: string }[] = [
  { key: 'Pending', color: '#f59e0b' },
  { key: 'Confirmed', color: '#3b82f6' },
  { key: 'Arrived', color: '#10b981' },
  { key: 'Completed', color: '#8b5cf6' },
  { key: 'NoShow', color: '#ef4444' },
  { key: 'Cancelled', color: '#64748b' },
];
function statusBucket(status: string): { key: string; color: string } {
  switch (status) {
    case 'PENDING': case 'ASSIGNED': case 'REJECTED': return STATUS_BUCKETS[0];
    case 'ACCEPTED': case 'CONFIRMED': return STATUS_BUCKETS[1];
    case 'ARRIVED': return STATUS_BUCKETS[2];
    case 'COMPLETED': return STATUS_BUCKETS[3];
    case 'NO_SHOW': return STATUS_BUCKETS[4];
    case 'CANCELLED': return STATUS_BUCKETS[5];
    default: return STATUS_BUCKETS[0];
  }
}

export default function CalendarPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const locale = lang === 'vi' ? 'vi-VN' : 'en-US';
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

  const todayStats = useMemo(() => {
    const list = byDay.get(today.toDateString()) ?? [];
    const count = (k: string) => list.filter((b) => statusBucket(b.status).key === k).length;
    return { total: list.length, pending: count('Pending'), arrived: count('Arrived') };
  }, [byDay, today]);

  const monthLabel = view.toLocaleString(locale, { month: 'long', year: 'numeric' });
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
        <h1 style={{ fontSize: 24, margin: 0 }}>{t('cal.title')}</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <strong style={{ minWidth: 140, textAlign: 'center' }}>{monthLabel}</strong>
          <button style={navBtn} onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}>‹</button>
          <button style={navBtn} onClick={() => setView(new Date(today.getFullYear(), today.getMonth(), 1))}>{t('cal.today')}</button>
          <button style={navBtn} onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}>›</button>
        </div>
      </div>

      {error && <div style={ui.banner}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {STATUS_BUCKETS.map((s) => (
            <span key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#cbd5e1' }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
              {t('cal.st' + s.key)}
            </span>
          ))}
        </div>
        <div style={{ fontSize: 13, color: '#94a3b8' }}>
          {t('cal.todayLabel')}: <strong style={{ color: '#e2e8f0' }}>{todayStats.total}</strong> {t('cal.apptWord')}
          {todayStats.pending > 0 && <> · <span style={{ color: '#f59e0b' }}>{todayStats.pending} {t('cal.stPending')}</span></>}
          {todayStats.arrived > 0 && <> · <span style={{ color: '#10b981' }}>{todayStats.arrived} {t('cal.stArrived')}</span></>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 1, background: '#334155', border: '1px solid #334155', borderRadius: 10, overflow: 'hidden' }}>
        {[1, 2, 3, 4, 5, 6, 0].map((dow) => (
          <div key={dow} style={{ background: '#1e293b', textAlign: 'center', padding: '8px 0', fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>{DAY_LABEL[lang][dow]}</div>
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
                    {items.slice(0, 4).map((b) => {
                      const m = statusBucket(b.status);
                      const dim = m.key === 'Cancelled' || m.key === 'NoShow';
                      const strike = m.key === 'Cancelled' ? 'line-through' : 'none';
                      return (
                        <div key={b.id} title={`${t('cal.st' + m.key)} · ${b.service?.name ?? ''} · ${name(b.customer)}`}
                          onClick={() => setSelected(b)}
                          style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '3px 6px', borderRadius: 4, background: '#1e293b', borderLeft: `3px solid ${m.color}`, cursor: 'pointer', opacity: dim ? 0.5 : 1 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
                          <span style={{ fontWeight: 600, whiteSpace: 'nowrap', textDecoration: strike }}>{new Date(b.startTime).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })}</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: strike }}>{name(b.customer)}{b.service?.name ? ` · ${b.service.name}` : ''}</span>
                        </div>
                      );
                    })}
                    {items.length > 4 && <div style={{ fontSize: 11, color: '#94a3b8' }}>{t('cal.more').replace('{n}', String(items.length - 4))}</div>}
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
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const locale = lang === 'vi' ? 'vi-VN' : 'en-US';
  const start = new Date(b.startTime);
  const end = new Date(b.endTime);
  const duration = Math.round((end.getTime() - start.getTime()) / 60000);
  const fullName = b.customer ? `${b.customer.firstName} ${b.customer.lastName ?? ''}`.trim() : '—';
  const tech = b.assignedStaff ? `${b.assignedStaff.firstName} ${b.assignedStaff.lastName ?? ''}`.trim() : t('cal.unassigned');
  const canArrive = ['PENDING', 'ASSIGNED', 'ACCEPTED', 'CONFIRMED'].includes(b.status);
  const active = canArrive || b.status === 'ARRIVED';

  return (
    <>
      {/* backdrop */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 40 }} />
      {/* right drawer */}
      <div style={{ position: 'fixed', top: 0, right: 0, height: '100vh', width: 380, maxWidth: '90vw', background: '#111827', borderLeft: '1px solid #1f2937', zIndex: 41, padding: 24, overflowY: 'auto', boxShadow: '-8px 0 30px rgba(0,0,0,0.4)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, margin: 0 }}>{t('cal.detailsTitle')}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{b.service?.name ?? t('cal.service')}</div>
          <div style={{ marginTop: 8 }}>
            <StatusBadge status={b.status} />
          </div>
        </div>

        <DetailRow label={t('cal.dDate')} value={start.toLocaleDateString(locale, { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })} />
        <DetailRow label={t('cal.dTime')} value={`${fmtTime(start)} – ${fmtTime(end)}`} />
        <DetailRow label={t('cal.dDuration')} value={`${duration} ${t('cal.min')}`} />
        <DetailRow label={t('cal.dTechnician')} value={tech} />
        <DetailRow label={t('cal.dPrice')} value={formatPrice(b.priceCents, b.currency)} />
        {b.addons && b.addons.some((a) => a.kind === 'service') && (
          <DetailRow label={t('cal.dAlsoBooked')} value={b.addons.filter((a) => a.kind === 'service').map((a) => a.name).join(', ')} />
        )}
        {b.addons && b.addons.some((a) => a.kind !== 'service') && (
          <DetailRow label={t('cal.dAddons')} value={b.addons.filter((a) => a.kind !== 'service').map((a) => a.name).join(', ')} />
        )}

        <div style={{ borderTop: '1px solid #1f2937', margin: '16px 0 12px' }} />
        <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6, fontWeight: 600 }}>{t('cal.customer')}</div>
        <DetailRow label={t('cal.dName')} value={fullName} />
        {b.customer?.phone && <DetailRow label={t('cal.dPhone')} value={b.customer.phone} />}
        {b.customer?.email && <DetailRow label={t('cal.dEmail')} value={b.customer.email} />}
        {b.notes && <DetailRow label={t('cal.dNote')} value={b.notes} />}

        {active && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 20 }}>
            {canArrive && (
              <button onClick={() => onAction(b.id, 'arrive')} style={{ ...ui.primaryBtn, background: '#10b981', width: '100%', padding: '11px' }}>{t('cal.arrive')}</button>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => onAction(b.id, 'complete')} style={{ ...ui.primaryBtn, background: '#22c55e', flex: 1 }}>{t('cal.complete')}</button>
              <button onClick={() => onAction(b.id, 'cancel')} style={{ ...ui.dangerBtn, flex: 1 }}>{t('cal.cancel')}</button>
            </div>
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
  const { lang } = useLang();
  const m = statusBucket(status);
  return <span style={{ color: m.color, border: `1px solid ${m.color}`, borderRadius: 999, padding: '3px 12px', fontSize: 12, fontWeight: 600 }}>{tr('cal.st' + m.key, lang)}</span>;
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
