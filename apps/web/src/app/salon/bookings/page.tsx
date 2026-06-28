'use client';

import { useCallback, useEffect, useState, FormEvent } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';
import { useLiveRefresh } from '../../../lib/useLiveRefresh';
import { DateRangeBar, SearchBox, matchesQuery, useDateRange, sortNewest, usePaged, Pager } from '../../../components/ListFilter';

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
  customer: NamedRef | null;
  service: { id: string; name: string } | null;
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
  const range = useDateRange('all', true); // bookings are future-oriented
  const [q, setQ] = useState('');
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [services, setServices] = useState<Service[]>([]);
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
      const [b, s, st, p] = await Promise.all([
        apiFetch<Booking[]>('/bookings', { token }),
        apiFetch<Service[]>('/services', { token }),
        apiFetch<Staff[]>('/staff', { token }),
        apiFetch<Payment[]>('/payments', { token }),
      ]);
      setBookings(b);
      setServices(s);
      setStaff(st);
      setPayments(p);
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
        matchesQuery(`${staffName(b.customer)} ${b.service?.name ?? ''} ${staffName(b.assignedStaff)} ${b.status}`, q),
    ),
    (b) => b.startTime,
  );
  const unconfirmedCount = bookings.filter(isUnconfirmed).length;
  const pg = usePaged(visible, 20);

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
        <SearchBox value={q} onChange={setQ} placeholder={t('bk.searchPh')} />
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
      ) : (
        <div style={{ border: '1px solid #334155', borderRadius: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#1e293b' }}>
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
                  <td style={ui.td} colSpan={7}>
                    {t('bk.noBookings')}
                  </td>
                </tr>
              )}
              {pg.paged.map((b) => (
                <tr key={b.id} style={{ borderTop: '1px solid #334155' }}>
                  <td style={ui.td}>{new Date(b.startTime).toLocaleString()}</td>
                  <td style={ui.td}>
                    {b.customer?.id
                      ? <a href={`/salon/customers/${b.customer.id}`} style={{ color: '#818cf8', textDecoration: 'none', fontWeight: 600 }}>{staffName(b.customer)}</a>
                      : staffName(b.customer)}
                  </td>
                  <td style={ui.td}>{b.service?.name ?? '—'}</td>
                  <td style={ui.td}>{staffName(b.assignedStaff)}</td>
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
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', maxWidth: 360 }}>
                      {b.status === 'PENDING' && (
                        <>
                          <button
                            onClick={() => action(b.id, 'auto-assign')}
                            style={smallOk}
                            title={t('bk.autoAssignHint')}
                          >
                            {t('bk.autoAssign')}
                          </button>
                          <AssignControl
                            staff={staff.filter((s) => s.isActive)}
                            onAssign={(staffId) => action(b.id, 'assign', { staffId })}
                          />
                        </>
                      )}
                      {ACTIVE_STATUSES.includes(b.status) && (
                        <>
                          <a
                            href={`/salon/pos?appointmentId=${b.id}&serviceId=${b.service?.id ?? ''}&staffId=${b.assignedStaff?.id ?? ''}&customerId=${b.customer?.id ?? ''}&customer=${encodeURIComponent(staffName(b.customer))}`}
                            style={{ ...actBtnFilled('#6366f1'), textDecoration: 'none' }}
                            title={t('bk.checkoutHint')}
                          >
                            {t('bk.checkout')}
                          </a>
                          <button onClick={() => action(b.id, 'complete')} style={smallOk}>
                            {t('bk.complete')}
                          </button>
                          <button
                            onClick={() => { if (confirm(t('bk.confirmNoShow'))) action(b.id, 'no-show'); }}
                            style={smallWarn}
                            title={t('bk.noShowHint')}
                          >
                            {t('bk.noShow')}
                          </button>
                          <button
                            onClick={() => { if (confirm(t('bk.confirmCancel'))) action(b.id, 'cancel'); }}
                            style={actBtnOutline('#ef4444')}
                          >
                            {t('bk.cancel')}
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => removeBooking(b.id)}
                        style={{ ...actBtnOutline('#94a3b8') }}
                        title={t('bk.deleteHint')}
                      >
                        {t('bk.delete')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: '0 14px 12px' }}><Pager paged={pg} /></div>
        </div>
      )}
    </section>
  );
}

function AssignControl({
  staff,
  onAssign,
}: {
  staff: Staff[];
  onAssign: (staffId: string) => void;
}) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [staffId, setStaffId] = useState('');
  return (
    <span style={{ display: 'flex', gap: 4 }}>
      <select value={staffId} onChange={(e) => setStaffId(e.target.value)} style={{ ...ui.input, padding: '4px 8px', width: 'auto' }}>
        <option value="">{t('bk.assignTo')}</option>
        {staff.map((s) => (
          <option key={s.id} value={s.id}>
            {s.firstName} {s.lastName ?? ''}
          </option>
        ))}
      </select>
      <button disabled={!staffId} onClick={() => staffId && onAssign(staffId)} style={smallOk}>
        {t('bk.assign')}
      </button>
    </span>
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
  const [form, setForm] = useState({
    serviceId: '',
    startLocal: '',
    staffId: '',
    customerFirstName: '',
    customerLastName: '',
    customerEmail: '',
    customerPhone: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function up(key: keyof typeof form, v: string) {
    setForm((f) => ({ ...f, [key]: v }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch('/bookings', {
        method: 'POST',
        token,
        body: {
          serviceId: form.serviceId,
          // datetime-local is local time; convert to a UTC ISO string.
          startTime: new Date(form.startLocal).toISOString(),
          staffId: form.staffId || undefined,
          customerFirstName: form.customerFirstName,
          customerLastName: form.customerLastName || undefined,
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
    <form onSubmit={submit} style={{ ...ui.card, marginBottom: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label>
          <span style={ui.label}>{t('bk.fService')}</span>
          <select style={ui.input} value={form.serviceId} onChange={(e) => up('serviceId', e.target.value)} required>
            <option value="">{t('bk.selectService')}</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.durationMinutes} min)
              </option>
            ))}
          </select>
        </label>
        <label>
          <span style={ui.label}>{t('bk.dateTime')}</span>
          <input
            style={ui.input}
            type="datetime-local"
            value={form.startLocal}
            onChange={(e) => up('startLocal', e.target.value)}
            required
          />
        </label>
        <label>
          <span style={ui.label}>{t('bk.assignStaff')}</span>
          <select style={ui.input} value={form.staffId} onChange={(e) => up('staffId', e.target.value)}>
            <option value="">{t('bk.leaveUnassigned')}</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.firstName} {s.lastName ?? ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span style={ui.label}>{t('bk.custFirstName')}</span>
          <input style={ui.input} value={form.customerFirstName} onChange={(e) => up('customerFirstName', e.target.value)} required />
        </label>
        <label>
          <span style={ui.label}>{t('bk.custEmail')}</span>
          <input style={ui.input} type="email" value={form.customerEmail} onChange={(e) => up('customerEmail', e.target.value)} />
        </label>
        <label>
          <span style={ui.label}>{t('bk.custPhone')}</span>
          <input style={ui.input} value={form.customerPhone} onChange={(e) => up('customerPhone', e.target.value)} />
        </label>
      </div>
      {error && <div style={ui.banner}>{error}</div>}
      <button type="submit" disabled={submitting} style={{ ...ui.primaryBtn, marginTop: 14 }}>
        {submitting ? t('bk.creating') : t('bk.createBooking')}
      </button>
    </form>
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
