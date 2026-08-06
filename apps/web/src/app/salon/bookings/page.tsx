'use client';

import { useCallback, useEffect, useState, FormEvent } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';
import { useLiveRefresh } from '../../../lib/useLiveRefresh';
import { useIsMobile } from '../../../lib/responsive';
import { MList, MCard, MHead, MRow, MActions } from '../../../components/MobileCard';
import { DateRangeBar, SearchBox, matchesQuery, useDateRange, sortNewest, usePaged, Pager } from '../../../components/ListFilter';
import { useBulkSelect, BulkBar, BulkAllBox, BulkRowBox, runBulkDelete } from '../../../components/BulkDelete';

interface NamedRef {
  id: string;
  firstName?: string;
  lastName?: string | null;
  name?: string;
}
interface Service {
  id: string;
  name: string;
  durationMinutes: number;
}
interface Staff {
  id: string;
  firstName: string;
  lastName: string | null;
  isActive: boolean;
}
interface Booking {
  id: string;
  status: string;
  startTime: string;
  endTime: string;
  notes: string | null;
  customer: (NamedRef & { phone?: string | null }) | null;
  service: { id: string; name: string } | null;
  // Extra services booked in the same visit are stored as line items on the
  // appointment (kind: 'service'); add-ons live in the same array without a kind.
  addons?: { id?: string; name?: string; kind?: string; staffMemberId?: string }[] | null;
  assignedStaff: NamedRef | null;
}
interface Payment {
  id: string;
  appointmentId: string | null;
  status: string;
  type: string;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: '#eab308',
  ASSIGNED: '#3b82f6',
  ACCEPTED: '#22c55e',
  CONFIRMED: '#22c55e',
  REJECTED: '#ef4444',
  CANCELLED: '#94a3b8',
  COMPLETED: '#a855f7',
  NO_SHOW: '#ef4444',
};

const ACTIVE_STATUSES = ['PENDING', 'ASSIGNED', 'ACCEPTED', 'CONFIRMED'];

export default function BookingsPage() {
  return (
    <SalonShell>
      <BookingsInner />
    </SalonShell>
  );
}

function BookingsInner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const isMobile = useIsMobile();
  const range = useDateRange('all', true); // bookings are future-oriented
  const [q, setQ] = useState('');
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  // Dates must read in the SALON's timezone, not the viewer's. Without this a
  // 4:00 PM appointment showed as 3:00 AM the NEXT DAY to anyone whose computer
  // sits in another timezone — the calendar and this table disagreed.
  const [salonTz, setSalonTz] = useState<string>('');
  const [staff, setStaff] = useState<Staff[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [b, s, st, p, settings] = await Promise.all([
        apiFetch<Booking[]>('/bookings', { token }),
        apiFetch<Service[]>('/services', { token }),
        apiFetch<Staff[]>('/staff', { token }),
        apiFetch<Payment[]>('/payments', { token }),
        apiFetch<{ company?: { timezone?: string } }>('/settings', { token }).catch(() => ({} as { company?: { timezone?: string } })),
      ]);
      setBookings(b);
      setServices(s);
      setStaff(st);
      setPayments(p);
      if (settings?.company?.timezone) setSalonTz(settings.company.timezone);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bookings');
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Latest payment per booking (payments are returned newest-first).
  const paymentByBooking = new Map<string, Payment>();
  for (const p of payments) {
    if (p.appointmentId && !paymentByBooking.has(p.appointmentId)) {
      paymentByBooking.set(p.appointmentId, p);
    }
  }

  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(load);

  async function action(id: string, path: string, body?: unknown) {
    try {
      await apiFetch(`/bookings/${id}/${path}`, { method: 'POST', token, body });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  }

  async function removeBooking(id: string) {
    if (!confirm('Delete this booking permanently? This cannot be undone. (To keep history, use Cancel instead.)')) return;
    try {
      await apiFetch(`/bookings/${id}`, { method: 'DELETE', token });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function processTimeouts() {
    try {
      const res = await apiFetch<{ processed: number; reassigned: number }>(
        '/bookings/process-timeouts',
        { method: 'POST', token },
      );
      await load();
      setError(
        res.processed === 0
          ? 'No timed-out bookings to process.'
          : `Processed ${res.processed} timed-out booking(s); reassigned ${res.reassigned}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  }

  const staffName = (s: NamedRef | null) =>
    s ? `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim() : '—';

  // "Needs confirmation" = upcoming booking the customer hasn't confirmed yet
  // (still PENDING/ASSIGNED/ACCEPTED, not CONFIRMED) → salon can call to remind.
  const now = Date.now();
  const isUnconfirmed = (b: Booking) =>
    new Date(b.startTime).getTime() > now && ['PENDING', 'ASSIGNED', 'ACCEPTED'].includes(b.status);

  // Filter by appointment date + search text, then show newest first.
  const visible = sortNewest(
    bookings.filter(
      (b) =>
        range.inRange(b.startTime) &&
        (!needsConfirm || isUnconfirmed(b)) &&
        matchesQuery(`${staffName(b.customer)} ${b.customer?.phone ?? ''} ${(b.customer?.phone ?? '').replace(/\D/g, '')} ${serviceNames(b).join(' ')} ${staffName(b.assignedStaff)} ${b.status}`, q),
    ),
    (b) => b.startTime,
  );
  const unconfirmedCount = bookings.filter(isUnconfirmed).length;
  const pg = usePaged(visible, 20);
  const bulk = useBulkSelect(pg.paged.map((r) => r.id));

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>{t('bk.title')}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={processTimeouts} style={ghostBtn} title={t('bk.processTimeoutsHint')}>
            {t('bk.processTimeouts')}
          </button>
          <button onClick={() => setShowForm((s) => !s)} style={ui.primaryBtn}>
            {showForm ? t('bk.close') : t('bk.newBooking')}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <SearchBox value={q} onChange={setQ} placeholder={lang === 'vi' ? 'Tìm theo tên, số điện thoại, dịch vụ…' : 'Search by name, phone, service…'} />
        <button
          onClick={() => setNeedsConfirm((v) => !v)}
          title={t('bk.needsConfirmHint')}
          style={{ padding: '7px 12px', borderRadius: 8, border: `1px solid ${needsConfirm ? '#f59e0b' : '#475569'}`, background: needsConfirm ? '#78350f' : 'transparent', color: needsConfirm ? '#fde68a' : '#cbd5e1', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}
        >
          {t('bk.needsConfirm')}{unconfirmedCount > 0 ? ` (${unconfirmedCount})` : ''}
        </button>
        <span style={{ color: '#94a3b8', fontSize: 13 }}>{visible.length} {t('bk.bookingWord')}</span>
        <DateRangeBar range={range} />
      </div>

      {error && <div style={ui.banner}>{error}</div>}

      {showForm && (
        <CreateBookingForm
          token={token!}
          services={services}
          staff={staff.filter((s) => s.isActive)}
          onCreated={async () => {
            setShowForm(false);
            await load();
          }}
        />
      )}

      {loading && bookings.length === 0 ? (
        <p style={{ color: '#94a3b8' }}>{t('bk.loading')}</p>
      ) : isMobile ? (
        <>
          <MList>
            {visible.length === 0 && <p style={{ color: '#64748b', fontSize: 13 }}>{t('bk.noBookings')}</p>}
            {pg.paged.map((b) => (
              <MCard key={b.id}>
                <MHead right={<span style={{ color: STATUS_COLORS[b.status] ?? '#94a3b8', border: `1px solid ${STATUS_COLORS[b.status] ?? '#94a3b8'}`, borderRadius: 999, padding: '2px 10px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{b.status}</span>}>
                  {b.customer?.id
                    ? <a href={`/salon/customers/${b.customer.id}`} style={{ color: '#818cf8', textDecoration: 'none' }}>{staffName(b.customer)}</a>
                    : staffName(b.customer)}
                </MHead>
                <MRow label={t('bk.colWhen')}>{fmtWhen(b.startTime, salonTz)}</MRow>
                <MRow label={t('bk.colService')}><ServiceCell b={b} /></MRow>
                <MRow label={t('bk.colStaff')}><StaffCell b={b} staff={staff} /></MRow>
                <MRow label={t('bk.colPayment')}><PaymentCell payment={paymentByBooking.get(b.id)} /></MRow>
                <MActions>
                  <BookingActions
                    b={b} staff={staff} t={t}
                    checkoutHref={`/salon/pos?appointmentId=${b.id}&serviceId=${b.service?.id ?? ''}&staffId=${b.assignedStaff?.id ?? ''}&customerId=${b.customer?.id ?? ''}&customer=${encodeURIComponent(staffName(b.customer))}`}
                    onAction={(path, body) => action(b.id, path, body)}
                    onDelete={() => removeBooking(b.id)}
                  />
                </MActions>
              </MCard>
            ))}
          </MList>
          <Pager paged={pg} />
        </>
      ) : (
        <div>
          <BulkBar count={bulk.count} ids={bulk.sel} onClear={bulk.clear} onDelete={(ids) => runBulkDelete(ids, (id) => apiFetch(`/bookings/${id}`, { method: 'DELETE', token }), load)} />
          <div style={{ border: '1px solid #334155', borderRadius: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#1e293b' }}>
                <th style={{ ...ui.th, width: 34 }}><BulkAllBox on={bulk.allOn} onChange={bulk.toggleAll} /></th>
                <th style={{ ...ui.th, whiteSpace: 'nowrap' }}>{t('bk.colWhen')}</th>
                <th style={{ ...ui.th, whiteSpace: 'nowrap' }}>{t('bk.colCustomer')}</th>
                <th style={{ ...ui.th, whiteSpace: 'nowrap' }}>{t('bk.colService')}</th>
                <th style={{ ...ui.th, whiteSpace: 'nowrap' }}>{t('bk.colStaff')}</th>
                <th style={{ ...ui.th, whiteSpace: 'nowrap' }}>{t('bk.colStatus')}</th>
                <th style={{ ...ui.th, whiteSpace: 'nowrap' }}>{t('bk.colPayment')}</th>
                <th style={{ ...ui.th, whiteSpace: 'nowrap' }}>{t('bk.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td style={ui.td} colSpan={8}>
                    {t('bk.noBookings')}
                  </td>
                </tr>
              )}
              {pg.paged.map((b) => (
                <tr key={b.id} style={{ borderTop: '1px solid #334155', background: bulk.has(b.id) ? '#1e1b4b' : undefined }}>
                  <td style={{ ...ui.td, width: 34 }}><BulkRowBox on={bulk.has(b.id)} onChange={() => bulk.toggle(b.id)} /></td>
                  <td style={ui.td}>{fmtWhen(b.startTime, salonTz)}</td>
                  <td style={ui.td}>
                    {b.customer?.id
                      ? <a href={`/salon/customers/${b.customer.id}`} style={{ color: '#818cf8', textDecoration: 'none', fontWeight: 600 }}>{staffName(b.customer)}</a>
                      : staffName(b.customer)}
                  </td>
                  <td style={ui.td}><ServiceCell b={b} /></td>
                  <td style={ui.td}><StaffCell b={b} staff={staff} /></td>
                  <td style={{ ...ui.td, whiteSpace: 'nowrap' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        whiteSpace: 'nowrap',
                        color: STATUS_COLORS[b.status] ?? '#94a3b8',
                        border: `1px solid ${STATUS_COLORS[b.status] ?? '#94a3b8'}`,
                        borderRadius: 999,
                        padding: '3px 10px',
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      {b.status}
                    </span>
                  </td>
                  <td style={ui.td}>
                    <PaymentCell payment={paymentByBooking.get(b.id)} />
                  </td>
                  <td style={ui.td}>
                    <BookingActions
                      b={b} staff={staff} t={t}
                      checkoutHref={`/salon/pos?appointmentId=${b.id}&serviceId=${b.service?.id ?? ''}&staffId=${b.assignedStaff?.id ?? ''}&customerId=${b.customer?.id ?? ''}&customer=${encodeURIComponent(staffName(b.customer))}`}
                      onAction={(path, body) => action(b.id, path, body)}
                      onDelete={() => removeBooking(b.id)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: '0 14px 12px' }}><Pager paged={pg} /></div>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * One booking's actions, arranged by how often they are used instead of all at
 * once: the next step in the visit is a filled button, the two "change the plan"
 * controls sit next to it as quiet icons, and everything destructive hides in a
 * ⋯ menu so nobody cancels a booking by mis-tapping.
 */
function BookingActions({ b, staff, t, checkoutHref, onAction, onDelete }: {
  b: Booking;
  staff: Staff[];
  t: (k: string) => string;
  checkoutHref: string;
  onAction: (path: string, body?: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [panel, setPanel] = useState<'none' | 'move' | 'staff'>('none');
  const active = ACTIVE_STATUSES.includes(b.status);
  const pending = b.status === 'PENDING';
  const live = staff.filter((s) => s.isActive);

  const iconBtn: React.CSSProperties = {
    width: 30, height: 30, display: 'grid', placeItems: 'center', borderRadius: 8,
    border: '1px solid #334155', background: 'transparent', color: '#cbd5e1', cursor: 'pointer', fontSize: 14,
  };

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Next step in the visit */}
        {pending ? (
          <button onClick={() => onAction('auto-assign')} title={t('bk.autoAssignHint')} style={{ ...actBtnFilled('#22c55e') }}>
            {t('bk.autoAssign')}
          </button>
        ) : active ? (
          <a href={checkoutHref} title={t('bk.checkoutHint')} style={{ ...actBtnFilled('#6366f1'), textDecoration: 'none' }}>
            {t('bk.checkout')}
          </a>
        ) : null}

        {/* Change the plan — icons, because they are used far less than the step above */}
        {active && (
          <>
            <button onClick={() => setPanel(panel === 'move' ? 'none' : 'move')} title={t('bk.reschedule')} style={{ ...iconBtn, ...(panel === 'move' ? { borderColor: '#6366f1', color: '#a5b4fc' } : {}) }}>🗓</button>
            <button onClick={() => setPanel(panel === 'staff' ? 'none' : 'staff')} title={pending ? t('bk.assign') : t('bk.changeStaff')} style={{ ...iconBtn, ...(panel === 'staff' ? { borderColor: '#6366f1', color: '#a5b4fc' } : {}) }}>👤</button>
          </>
        )}

        {/* Everything that ends or undoes the booking */}
        <button onClick={() => setMenu((v) => !v)} title={t('bk.colActions')} style={{ ...iconBtn, ...(menu ? { borderColor: '#6366f1', color: '#a5b4fc' } : {}) }}>⋯</button>
      </div>

      {panel === 'move' && (
        <InlineMove current={b.startTime} t={t} onMove={(iso) => { onAction('reschedule', { startTime: iso }); setPanel('none'); }} onClose={() => setPanel('none')} />
      )}
      {panel === 'staff' && (
        <select
          autoFocus
          defaultValue=""
          onChange={(e) => { if (e.target.value) { onAction('assign', { staffId: e.target.value }); setPanel('none'); } }}
          style={{ ...ui.input, padding: '6px 8px', fontSize: 13, minWidth: 170 }}
        >
          <option value="">{pending ? t('bk.assign') : t('bk.changeStaff')}</option>
          {live.map((s) => <option key={s.id} value={s.id}>{s.firstName} {s.lastName ?? ''}</option>)}
        </select>
      )}

      {menu && (
        <>
          <div onClick={() => setMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div style={{ position: 'absolute', top: 36, left: 0, zIndex: 41, minWidth: 190, background: '#0f172a', border: '1px solid #223047', borderRadius: 10, boxShadow: '0 14px 40px rgba(0,0,0,.5)', padding: 5 }}>
            {active && (
              <>
                <MenuItem label={`✅ ${t('bk.complete')}`} color="#22c55e" onClick={() => { setMenu(false); onAction('complete'); }} />
                <MenuItem label={`⚠ ${t('bk.noShow')}`} color="#f97316" onClick={() => { setMenu(false); if (confirm(t('bk.confirmNoShow'))) onAction('no-show'); }} />
                <MenuItem label={`✖ ${t('bk.cancel')}`} color="#ef4444" onClick={() => { setMenu(false); if (confirm(t('bk.confirmCancel'))) onAction('cancel'); }} />
                <div style={{ height: 1, background: '#1e293b', margin: '4px 6px' }} />
              </>
            )}
            <MenuItem label={`🗑 ${t('bk.delete')}`} color="#f87171" onClick={() => { setMenu(false); onDelete(); }} />
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 7, border: 'none', background: hov ? '#1a2436' : 'transparent', color, fontSize: 13, cursor: 'pointer' }}
    >
      {label}
    </button>
  );
}

/** Date+time picker that opens under the 🗓 icon. */
function InlineMove({ current, t, onMove, onClose }: { current: string; t: (k: string) => string; onMove: (iso: string) => void; onClose: () => void }) {
  const [val, setVal] = useState(() => {
    const d = new Date(current);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <input type="datetime-local" value={val} onChange={(e) => setVal(e.target.value)} style={{ ...ui.input, padding: '5px 8px', fontSize: 13 }} />
      <button disabled={!val} onClick={() => val && onMove(new Date(val).toISOString())} style={smallOk}>{t('bk.move')}</button>
      <button onClick={onClose} style={actBtnOutline('#94a3b8')}>✕</button>
    </div>
  );
}


function CreateBookingForm({
  token,
  services,
  staff,
  onCreated,
}: {
  token: string;
  services: Service[];
  staff: Staff[];
  onCreated: () => void;
}) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [svcQ, setSvcQ] = useState(''); // type-to-filter: many salons have 50+ services
  const [form, setForm] = useState({
    startLocal: '',
    staffId: '',
    customerFirstName: '',
    customerLastName: '',
    customerBirthDate: '',
    customerEmail: '',
    customerPhone: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function up(key: keyof typeof form, v: string) {
    setForm((f) => ({ ...f, [key]: v }));
  }
  const toggleSvc = (id: string) =>
    setServiceIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const totalMinutes = serviceIds.reduce((sum, id) => sum + (services.find((s) => s.id === id)?.durationMinutes ?? 0), 0);
  // Expected finish time, so staff can see the slot the booking will occupy.
  const endsAt = (() => {
    if (!form.startLocal || totalMinutes <= 0) return '';
    const d = new Date(form.startLocal);
    if (Number.isNaN(d.getTime())) return '';
    d.setMinutes(d.getMinutes() + totalMinutes);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  })();
  const svcShown = svcQ.trim()
    ? services.filter((s) => s.name.toLowerCase().includes(svcQ.trim().toLowerCase()))
    : services;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (serviceIds.length === 0) { setError(t('bk.pickAtLeastOne')); return; }
    setSubmitting(true);
    try {
      await apiFetch('/bookings', {
        method: 'POST',
        token,
        body: {
          // First pick = primary service; the rest ride along as service lines
          // (same visit, durations added up server-side).
          serviceId: serviceIds[0],
          serviceIds,
          // datetime-local is local time; convert to a UTC ISO string.
          startTime: new Date(form.startLocal).toISOString(),
          staffId: form.staffId || undefined,
          customerFirstName: form.customerFirstName,
          customerLastName: form.customerLastName || undefined,
          // Birthday is opt-in and only used for birthday campaigns.
          customerBirthDate: form.customerBirthDate || undefined,
          customerEmail: form.customerEmail || undefined,
          customerPhone: form.customerPhone || undefined,
        },
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="bkf" style={{ ...ui.card, marginBottom: 16, padding: 0, overflow: 'hidden' }}>
      <style>{`
        .bkf input, .bkf select { transition: border-color .12s ease, box-shadow .12s ease; }
        .bkf input:focus, .bkf select:focus { outline: none; border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.18); }
        .bkf input::placeholder { color: #475569; }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '14px 20px', borderBottom: '1px solid #334155' }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, background: '#1e3a8a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>📅</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>{t('bk.createBooking')}</div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            {serviceIds.length === 0
              ? t('bk.pickSvcFirst')
              : `${serviceIds.length} ${t('bk.servicesPicked')} · ${t('bk.totalDuration')} ${totalMinutes} min${endsAt ? ` · ${t('bk.endsAt')} ${endsAt}` : ''}`}
          </div>
        </div>
      </div>

      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <span style={ui.label}>
            {t('bk.fService')}
            {serviceIds.length > 0 && (
              <span style={{ color: '#94a3b8', fontWeight: 400 }}> · {serviceIds.length} {t('bk.servicesPicked')} · {t('bk.totalDuration')} {totalMinutes} min</span>
            )}
          </span>
          {/* Picked services stay visible as chips while staff searches for the next one. */}
          {serviceIds.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {serviceIds.map((id) => {
                const s = services.find((x) => x.id === id);
                if (!s) return null;
                return (
                  <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#1e3a8a', color: '#dbeafe', borderRadius: 999, padding: '4px 10px', fontSize: 12.5, fontWeight: 600 }}>
                    {s.name}
                    <button type="button" onClick={() => toggleSvc(id)} style={{ background: 'none', border: 'none', color: '#93c5fd', cursor: 'pointer', fontSize: 13, padding: 0, lineHeight: 1 }}>✕</button>
                  </span>
                );
              })}
            </div>
          )}
          <input
            value={svcQ}
            onChange={(e) => setSvcQ(e.target.value)}
            placeholder={t('bk.searchService')}
            style={{ ...ui.input, marginBottom: 8 }}
          />
          <div style={{ border: '1px solid #334155', borderRadius: 8, background: '#0f172a', maxHeight: 168, overflowY: 'auto', padding: 6, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 2 }}>
            {svcShown.length === 0 && <span style={{ color: '#94a3b8', fontSize: 13, padding: '6px 8px' }}>{t('bk.noSvcMatch')}</span>}
            {svcShown.map((s) => (
              <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 6, cursor: 'pointer', background: serviceIds.includes(s.id) ? '#1e293b' : 'transparent', fontSize: 13, color: serviceIds.includes(s.id) ? '#e2e8f0' : '#cbd5e1' }}>
                <input type="checkbox" checked={serviceIds.includes(s.id)} onChange={() => toggleSvc(s.id)} style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name} ({s.durationMinutes} min)</span>
              </label>
            ))}
          </div>
        </div>
        <FormSection title={t('bk.secWhen')}>
          <div style={fieldGrid}>
            <label>
              <FieldLabel raw={t('bk.dateTime')} required optionalWord={t('bk.optional')} />
              <input
                style={ui.input}
                type="datetime-local"
                value={form.startLocal}
                onChange={(e) => up('startLocal', e.target.value)}
                required
              />
            </label>
            <label>
              <FieldLabel raw={t('bk.assignStaff')} optionalWord={t('bk.optional')} />
              <select style={ui.input} value={form.staffId} onChange={(e) => up('staffId', e.target.value)}>
                <option value="">{t('bk.leaveUnassigned')}</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.firstName} {s.lastName ?? ''}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </FormSection>

        <FormSection title={t('bk.secWho')}>
          {/* Short labels: the section heading already says these are the
              customer's, so "Customer first name" only repeats itself. Five
              fields fit one line on a laptop; birthday feeds the birthday
              campaign and is never required. */}
          <div style={custGrid}>
            <label>
              <FieldLabel raw={t('bk.fFirst')} required optionalWord={t('bk.optional')} />
              <input style={ui.input} value={form.customerFirstName} onChange={(e) => up('customerFirstName', e.target.value)} placeholder="Anna" required />
            </label>
            <label>
              <FieldLabel raw={t('bk.fLast')} optionalWord={t('bk.optional')} />
              <input style={ui.input} value={form.customerLastName} onChange={(e) => up('customerLastName', e.target.value)} placeholder="Nguyen" />
            </label>
            <label>
              <FieldLabel raw={t('bk.fPhone')} optionalWord={t('bk.optional')} />
              <input style={ui.input} value={form.customerPhone} onChange={(e) => up('customerPhone', e.target.value)} placeholder="+1 512 886 8189" />
            </label>
            <label>
              <FieldLabel raw={t('bk.fEmail')} optionalWord={t('bk.optional')} />
              <input style={ui.input} type="email" value={form.customerEmail} onChange={(e) => up('customerEmail', e.target.value)} placeholder="anna@email.com" />
            </label>
            <label>
              <FieldLabel raw={t('bk.fBirth')} optionalWord={t('bk.optional')} hint={`🎂 ${t('bk.birthWhy')}`} />
              <input
                style={ui.input} type="date" max={new Date().toISOString().slice(0, 10)}
                value={form.customerBirthDate} onChange={(e) => up('customerBirthDate', e.target.value)}
              />
            </label>
          </div>
        </FormSection>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '13px 20px', borderTop: '1px solid #334155', background: '#0f172a' }}>
        {error
          ? <span style={{ color: '#f87171', fontSize: 13, flex: 1, minWidth: 160 }}>{error}</span>
          : <span style={{ color: '#64748b', fontSize: 12.5, flex: 1, minWidth: 160 }}>{t('bk.custFirstName')} + {t('bk.dateTime').toLowerCase()} {lang === 'vi' ? 'là bắt buộc' : 'are required'}</span>}
        <button
          type="submit"
          disabled={submitting || serviceIds.length === 0}
          style={{ ...ui.primaryBtn, padding: '10px 22px', fontSize: 14, opacity: (submitting || serviceIds.length === 0) ? 0.5 : 1, cursor: (submitting || serviceIds.length === 0) ? 'not-allowed' : 'pointer' }}
        >
          {submitting ? t('bk.creating') : `+ ${t('bk.createBooking')}`}
        </button>
      </div>
    </form>
  );
}

// Section heading: a small caps label with a hairline running to the edge, so
// a long form reads as two short ones instead of a wall of inputs.
function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 11 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#94a3b8', textTransform: 'uppercase' }}>{title}</span>
        <span style={{ flex: 1, height: 1, background: '#334155' }} />
      </div>
      {children}
    </div>
  );
}

// Labels come from i18n with "(optional)" baked in. Pull it out and show it as
// a quiet tag instead, so every label is the same short shape.
function FieldLabel({ raw, required, optionalWord, hint }: { raw: string; required?: boolean; optionalWord: string; hint?: string }) {
  const isOpt = /\((tuỳ chọn|tùy chọn|optional)\)/i.test(raw);
  const text = raw.replace(/\s*\((tuỳ chọn|tùy chọn|optional)\)\s*/i, '').trim();
  return (
    <span style={{ ...ui.label, display: 'flex', alignItems: 'center', gap: 6 }} title={hint}>
      {text}
      {required && <span style={{ color: '#f87171', fontWeight: 700 }}>*</span>}
      {isOpt && !required && (
        <span style={{ fontSize: 10.5, color: '#64748b', border: '1px solid #334155', borderRadius: 5, padding: '1px 5px', fontWeight: 600 }}>{optionalWord}</span>
      )}
    </span>
  );
}

const fieldGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 };
// Five customer fields; birthday is the narrowest so it gets a smaller floor.
const custGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 };

/** A booking time as the salon reads it on its own wall clock. */
function fmtWhen(iso: string, tz: string): string {
  const d = new Date(iso);
  try {
    return d.toLocaleString('en-US', tz ? { timeZone: tz } : undefined);
  } catch {
    return d.toLocaleString('en-US'); // unknown zone → viewer's clock
  }
}

/** Every service on the visit: the primary plus any extra service lines. */
function serviceNames(b: Booking): string[] {
  const extra = (b.addons ?? []).filter((a) => a?.kind === 'service').map((a) => a?.name ?? '').filter(Boolean);
  return [b.service?.name ?? '', ...extra].filter(Boolean);
}

/**
 * A visit can hold several services. Showing only the first one made staff
 * think the extras had been lost, so the rest are listed underneath.
 */
/**
 * Staff column: the visit's main tech plus every different tech assigned to a
 * service line. One name used to hide the fact that three techs work this
 * visit — the desk plans turns from this column.
 */
function StaffCell({ b, staff }: { b: Booking; staff: Staff[] }) {
  const primary = b.assignedStaff ? `${b.assignedStaff.firstName} ${b.assignedStaff.lastName ?? ''}`.trim() : '—';
  const others = [...new Set(
    (b.addons ?? [])
      .filter((a) => a?.kind === 'service' && a.staffMemberId && a.staffMemberId !== b.assignedStaff?.id)
      .map((a) => {
        const st = staff.find((x) => x.id === a.staffMemberId);
        return st ? `${st.firstName} ${st.lastName ?? ''}`.trim() : '';
      })
      .filter(Boolean),
  )];
  if (others.length === 0) return <>{primary}</>;
  return (
    <span title={[primary, ...others].join(', ')}>
      {primary}
      <span style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginTop: 2 }}>+ {others.join(' · ')}</span>
    </span>
  );
}

function ServiceCell({ b }: { b: Booking }) {
  const names = serviceNames(b);
  if (names.length === 0) return <>—</>;
  return (
    <span>
      {names[0]}
      {names.length > 1 && (
        <span style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
          + {names.slice(1).join(' · ')}
        </span>
      )}
    </span>
  );
}

// Read-only payment status. Money is collected only through POS / Checkout
// (single source of truth) so a booking can never be paid twice — once here
// and once in the register. If unpaid, we point staff to the Checkout button.
function PaymentCell({ payment }: { payment?: Payment }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  if (!payment) {
    return <span style={{ color: '#64748b', fontSize: 12 }}>{t('bk.collectAtCheckout')}</span>;
  }
  const color = payment.status === 'PAID' ? '#22c55e' : payment.status === 'FAILED' ? '#ef4444' : '#eab308';
  return <span style={{ color, fontSize: 12, fontWeight: 600 }}>{payment.status}</span>;
}

// Uniform compact action-button styles so the Actions cell stays tidy.
function actBtnOutline(color: string): React.CSSProperties {
  return { padding: '6px 11px', borderRadius: 8, border: `1px solid ${color}`, background: 'transparent', color, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', lineHeight: 1.2 };
}
function actBtnFilled(bg: string): React.CSSProperties {
  return { padding: '6px 11px', borderRadius: 8, border: 'none', background: bg, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', lineHeight: 1.2, display: 'inline-block' };
}

const smallOk: React.CSSProperties = actBtnOutline('#22c55e');
const smallWarn: React.CSSProperties = actBtnOutline('#f97316');

const ghostBtn: React.CSSProperties = {
  padding: '9px 14px',
  borderRadius: 8,
  border: '1px solid #475569',
  background: 'transparent',
  color: '#e2e8f0',
  fontSize: 13,
  cursor: 'pointer',
};
