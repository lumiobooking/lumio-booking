'use client';

/**
 * The client, in a panel on the right — opened from the client list, the
 * bookings, the recall lists… without leaving the page. Who she is, what she
 * usually has, every visit, and "Đặt lại" on any of them: the same services
 * with the same technician, on a day and time picked in the booking sheet.
 * The full profile page is one tap away for everything else.
 */
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLang } from '../lib/i18n';
import { formatPrice } from '../lib/ui';
import { ind } from '../lib/ui-industry';
import { CLIENT_DRAWER_EVENT } from '../lib/client-drawer';
import { clientVisits, type Visit, type VisitAppt, type VisitOrder } from '../lib/client-visits';
import { RebookSheet, type RebookService, type RebookStaff } from './RebookSheet';

interface Detail {
  id: string; firstName: string; lastName: string | null; email: string | null; phone: string | null;
  notes: string | null; birthDate: string | null; createdAt: string; loyaltyPoints?: number;
  appointments: VisitAppt[];
  orders?: VisitOrder[];
  stats: { bookings: number; completed: number; noShows?: number; visits?: number; totalSpentCents: number; lastVisit: string | null };
  past?: { spentCents: number; visits: number; lastVisitAt: string | null; source: string | null };
  profile?: { favourites: { name: string; count: number }[]; preferredStaff: { name: string; count: number } | null };
}

/** Mounted once by the salon shell; listens for openClientDrawer(id). */
export function ClientDrawerHost() {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    window.__lumioClientDrawer = true;
    const on = (e: Event) => setId((e as CustomEvent<{ id: string }>).detail?.id ?? null);
    window.addEventListener(CLIENT_DRAWER_EVENT, on);
    return () => { window.__lumioClientDrawer = false; window.removeEventListener(CLIENT_DRAWER_EVENT, on); };
  }, []);
  return id ? <ClientDrawer key={id} id={id} onClose={() => setId(null)} /> : null;
}

export function ClientDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const L = (v: string, e: string) => ind(vi ? v : e);
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [services, setServices] = useState<RebookService[]>([]);
  const [staff, setStaff] = useState<RebookStaff[]>([]);
  const [currency, setCurrency] = useState('USD');
  const [tz, setTz] = useState<string | undefined>(undefined);
  const [rebook, setRebook] = useState<Visit['rebook'] | null>(null);
  const [booked, setBooked] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try { setD(await apiFetch<Detail>(`/customers/${encodeURIComponent(id)}`, { token })); } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }, [token, id]);
  useEffect(() => {
    void load();
    if (!token) return;
    apiFetch<RebookService[]>('/services', { token }).then(setServices).catch(() => undefined);
    apiFetch<RebookStaff[]>('/staff', { token }).then((s) => setStaff(s.filter((x) => x.isActive !== false))).catch(() => undefined);
    apiFetch<{ booking?: { currency?: string }; company?: { timezone?: string } }>('/settings', { token })
      .then((s) => { if (s.booking?.currency) setCurrency(s.booking.currency); if (s.company?.timezone) setTz(s.company.timezone); }).catch(() => undefined);
  }, [load, token]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !rebook) onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose, rebook]);

  const visits = d ? clientVisits(d.appointments, d.orders ?? [], services, new Date(), tz) : [];
  const lastDone = visits.find((v) => v.kind === 'done' && v.rebook.length);
  const name = d ? `${d.firstName} ${d.lastName ?? ''}`.trim() : '';
  const fmtDate = (s: string) => new Date(s).toLocaleDateString(vi ? 'vi-VN' : 'en-US', { day: '2-digit', month: '2-digit', year: 'numeric', ...(tz ? { timeZone: tz } : {}) });
  const fmtTime = (s: string) => new Date(s).toLocaleTimeString(vi ? 'vi-VN' : 'en-US', { hour: '2-digit', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) });
  const visitsCount = (d?.stats.visits ?? d?.stats.completed ?? 0) + (d?.past?.visits ?? 0);
  const spent = (d?.stats.totalSpentCents ?? 0) + (d?.past?.spentCents ?? 0);
  const pill = (v: Visit) => v.kind === 'upcoming'
    ? { t: L('Sắp tới', 'Upcoming'), bg: 'rgba(59,130,246,.15)', fg: '#3b82f6' }
    : v.kind === 'missed' ? { t: v.status === 'NO_SHOW' ? L('Vắng', 'No-show') : L('Đã huỷ', 'Cancelled'), bg: 'rgba(249,115,22,.15)', fg: '#f97316' }
      : { t: L('Đã làm', 'Done'), bg: 'rgba(34,197,94,.15)', fg: '#16a34a' };
  const btn = { minHeight: 40, padding: '0 14px', borderRadius: 10, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ce2e8f0)', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, textDecoration: 'none' } as const;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 320, background: 'rgba(2,6,23,.45)', display: 'flex', justifyContent: 'flex-end' }}>
      <aside onClick={(e) => e.stopPropagation()} role="dialog" aria-label={name || L('Khách hàng', 'Client')}
        style={{ width: 'min(500px, 100vw)', height: '100%', background: 'var(--c0f172a)', borderLeft: '1px solid var(--c334155)', boxShadow: '-12px 0 32px rgba(0,0,0,.25)', display: 'flex', flexDirection: 'column', color: 'var(--ce2e8f0)' }}>
        <div style={{ padding: '16px 18px 14px', borderBottom: '1px solid var(--c334155)', display: 'flex', gap: 12, alignItems: 'center' }}>
          <span aria-hidden style={{ width: 48, height: 48, borderRadius: 14, background: '#4f46e5', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 18, flexShrink: 0 }}>{(name[0] ?? '?').toUpperCase()}</span>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <b style={{ fontSize: 19, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name || '…'}</b>
            <span style={{ fontSize: 13, color: 'var(--c94a3b8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {d?.phone && <a href={`tel:${d.phone}`} style={{ color: 'inherit' }}>{d.phone}</a>}{d?.phone && d?.email ? ' · ' : ''}{d?.email}
            </span>
          </div>
          <button type="button" onClick={onClose} aria-label={L('Đóng', 'Close')} style={{ ...btn, width: 40, padding: 0, fontSize: 18 }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {err && <div style={{ color: 'var(--ink-bad)' }}>{err}</div>}
          {!d && !err && <div style={{ color: 'var(--c94a3b8)' }}>{L('Đang tải…', 'Loading…')}</div>}
          {booked && <div role="status" style={{ padding: 12, borderRadius: 12, background: 'rgba(34,197,94,.12)', color: 'var(--ink-good)', fontWeight: 700, fontSize: 14 }}>✓ {booked}</div>}
          {d && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
                {[
                  [L('Lượt ghé', 'Visits'), String(visitsCount)],
                  [L('Tổng chi', 'Spent'), formatPrice(spent, currency)],
                  [L('Lần cuối', 'Last visit'), d.stats.lastVisit ? fmtDate(d.stats.lastVisit) : d.past?.lastVisitAt ? fmtDate(d.past.lastVisitAt) : '—'],
                  [d.stats.noShows ? L('Vắng', 'No-shows') : L('Điểm', 'Points'), String(d.stats.noShows ? d.stats.noShows : d.loyaltyPoints ?? 0)],
                ].map(([k, v]) => (
                  <div key={k} style={{ padding: '10px 10px', borderRadius: 12, background: 'var(--c1e293b)', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: 11.5, color: 'var(--c94a3b8)', fontWeight: 700 }}>{k}</span>
                    <b style={{ fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</b>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {lastDone && (
                  <button type="button" onClick={() => { setBooked(null); setRebook(lastDone.rebook); }} style={{ ...btn, border: 'none', background: '#4f46e5', color: '#fff', flex: '1 1 200px', minHeight: 46 }}>
                    {L('Đặt lại lần gần nhất', 'Book the last visit again')}
                  </button>
                )}
                {d.phone && <a href={`tel:${d.phone}`} style={{ ...btn, minHeight: 46 }}>{L('Gọi', 'Call')}</a>}
                <a href={`/salon/customers/${d.id}`} style={{ ...btn, minHeight: 46 }}>{L('Hồ sơ đầy đủ', 'Full profile')} ↗</a>
              </div>

              {(d.profile?.favourites?.length || d.profile?.preferredStaff || d.notes) ? (
                <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <b style={{ fontSize: 14 }}>{L('Thói quen', 'Habits')}</b>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {d.profile?.favourites?.slice(0, 4).map((f) => <span key={f.name} style={{ fontSize: 12.5, fontWeight: 700, padding: '4px 10px', borderRadius: 999, background: 'var(--c1e293b)' }}>{f.name} · {f.count}×</span>)}
                    {d.profile?.preferredStaff && <span style={{ fontSize: 12.5, fontWeight: 700, padding: '4px 10px', borderRadius: 999, background: 'rgba(79,70,229,.15)', color: '#818cf8' }}>{L('Hay chọn', 'Usually')} {d.profile.preferredStaff.name}</span>}
                  </div>
                  {d.notes && <div style={{ fontSize: 13.5, padding: 10, borderRadius: 10, background: 'rgba(234,179,8,.10)', whiteSpace: 'pre-wrap' }}>{d.notes}</div>}
                </section>
              ) : null}

              <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <b style={{ fontSize: 14 }}>{L('Lịch sử', 'History')} <span style={{ color: 'var(--c94a3b8)', fontWeight: 600 }}>· {visits.length}</span></b>
                {visits.length === 0 && <span style={{ fontSize: 13.5, color: 'var(--c94a3b8)' }}>{L('Chưa có lần ghé nào trong hệ thống.', 'No visits recorded yet.')}{d.past?.visits ? L(` Hệ thống cũ: ${d.past.visits} lần.`, ` Old system: ${d.past.visits} visits.`) : ''}</span>}
                {visits.slice(0, 40).map((v) => {
                  const p = pill(v);
                  return (
                    <div key={v.key} style={{ padding: 12, borderRadius: 14, background: 'var(--c1e293b)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <b style={{ fontSize: 14 }}>{fmtDate(v.at)}</b>
                        <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{fmtTime(v.at)}</span>
                        <span style={{ fontSize: 11.5, fontWeight: 800, padding: '2px 8px', borderRadius: 999, background: p.bg, color: p.fg }}>{p.t}</span>
                        <span style={{ marginLeft: 'auto', fontSize: 13.5, fontWeight: 700 }}>{v.paidCents ? formatPrice(v.paidCents, currency) : ''}</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {v.lines.map((l, i) => (
                          <span key={i} style={{ fontSize: 13.5 }}>{l.name}{l.staff ? <span style={{ color: 'var(--c94a3b8)' }}> · {l.staff}</span> : null}</span>
                        ))}
                      </div>
                      {v.rebook.length > 0 && v.kind !== 'upcoming' && (
                        <button type="button" onClick={() => { setBooked(null); setRebook(v.rebook); }} style={{ ...btn, alignSelf: 'flex-start', minHeight: 36, borderColor: '#4f46e5', color: '#818cf8' }}>
                          ↻ {L('Đặt lại dịch vụ này', 'Book this again')}
                        </button>
                      )}
                    </div>
                  );
                })}
              </section>
            </>
          )}
        </div>
      </aside>
      {rebook && d && token && (
        <div onClick={(e) => e.stopPropagation()}>
          <RebookSheet token={token} lang={lang} customerId={d.id} customerLabel={[name, d.phone].filter(Boolean).join(' · ')}
            lines={rebook} services={services} staff={staff}
            subtitle={L('Dịch vụ và thợ lấy từ lần ghé trước — đổi được, chỉ còn chọn ngày và giờ.', 'Services and technician from the earlier visit — change them if needed, then pick a day and time.')}
            onClose={() => setRebook(null)}
            onBooked={(r) => {
              setRebook(null);
              setBooked(`${L('Đã đặt', 'Booked')} ${r.serviceNames.join(', ')} · ${fmtDate(r.startTime)} ${fmtTime(r.startTime)}${r.staffName ? ` · ${r.staffName}` : ''}`);
              void load();
            }} />
        </div>
      )}
    </div>
  );
}
