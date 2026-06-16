'use client';

import { useCallback, useEffect, useState, FormEvent } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { DateRangeBar, useDateRange, sortNewest } from '../../../components/ListFilter';

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
  const range = useDateRange('all');
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

  async function takePayment(appointmentId: string, type: 'PAY_ONLINE' | 'PAY_LATER') {
    try {
      await apiFetch('/payments', { method: 'POST', token, body: { appointmentId, type } });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed');
    }
  }

  async function markPaid(paymentId: string) {
    try {
      await apiFetch(`/payments/${paymentId}/mark-paid`, { method: 'POST', token });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  }

  useEffect(() => {
    load();
  }, [load]);

  async function action(id: string, path: string, body?: unknown) {
    try {
      await apiFetch(`/bookings/${id}/${path}`, { method: 'POST', token, body });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
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

  // Filter by appointment date, then show newest first.
  const visible = sortNewest(
    bookings.filter((b) => range.inRange(b.startTime)),
    (b) => b.startTime,
  );

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>Bookings</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={processTimeouts} style={ghostBtn} title="Reassign bookings whose staff did not respond in time">
            Process timeouts
          </button>
          <button onClick={() => setShowForm((s) => !s)} style={ui.primaryBtn}>
            {showForm ? 'Close' : '+ New booking'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <span style={{ color: '#94a3b8', fontSize: 13 }}>{visible.length} booking{visible.length === 1 ? '' : 's'}</span>
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

      {loading ? (
        <p style={{ color: '#94a3b8' }}>Loading...</p>
      ) : (
        <div style={{ border: '1px solid #334155', borderRadius: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#1e293b' }}>
                <th style={ui.th}>When</th>
                <th style={ui.th}>Customer</th>
                <th style={ui.th}>Service</th>
                <th style={ui.th}>Staff</th>
                <th style={ui.th}>Status</th>
                <th style={ui.th}>Payment</th>
                <th style={ui.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td style={ui.td} colSpan={7}>
                    No bookings in this range.
                  </td>
                </tr>
              )}
              {visible.map((b) => (
                <tr key={b.id} style={{ borderTop: '1px solid #334155' }}>
                  <td style={ui.td}>{new Date(b.startTime).toLocaleString()}</td>
                  <td style={ui.td}>{staffName(b.customer)}</td>
                  <td style={ui.td}>{b.service?.name ?? '—'}</td>
                  <td style={ui.td}>{staffName(b.assignedStaff)}</td>
                  <td style={ui.td}>
                    <span
                      style={{
                        color: STATUS_COLORS[b.status] ?? '#94a3b8',
                        border: `1px solid ${STATUS_COLORS[b.status] ?? '#94a3b8'}`,
                        borderRadius: 999,
                        padding: '2px 10px',
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      {b.status}
                    </span>
                  </td>
                  <td style={ui.td}>
                    <PaymentCell
                      payment={paymentByBooking.get(b.id)}
                      onPay={(type) => takePayment(b.id, type)}
                      onMarkPaid={(pid) => markPaid(pid)}
                    />
                  </td>
                  <td style={ui.td}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {b.status === 'PENDING' && (
                        <>
                          <button
                            onClick={() => action(b.id, 'auto-assign')}
                            style={smallOk}
                            title="Let the assignment engine pick the best technician"
                          >
                            Auto-assign
                          </button>
                          <AssignControl
                            staff={staff.filter((s) => s.isActive)}
                            onAssign={(staffId) => action(b.id, 'assign', { staffId })}
                          />
                        </>
                      )}
                      {ACTIVE_STATUSES.includes(b.status) && (
                        <>
                          <button onClick={() => action(b.id, 'complete')} style={smallOk}>
                            Complete
                          </button>
                          <button
                            onClick={() => { if (confirm('Mark as NO-SHOW? Any deposit already paid is kept as revenue.')) action(b.id, 'no-show'); }}
                            style={smallWarn}
                            title="Customer did not show up (deposit kept)"
                          >
                            No-show
                          </button>
                          <button
                            onClick={() => { if (confirm('Cancel this booking? Any payment will be refunded and removed from revenue.')) action(b.id, 'cancel'); }}
                            style={ui.dangerBtn}
                          >
                            Cancel
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
  const [staffId, setStaffId] = useState('');
  return (
    <span style={{ display: 'flex', gap: 4 }}>
      <select value={staffId} onChange={(e) => setStaffId(e.target.value)} style={{ ...ui.input, padding: '4px 8px', width: 'auto' }}>
        <option value="">Assign to…</option>
        {staff.map((s) => (
          <option key={s.id} value={s.id}>
            {s.firstName} {s.lastName ?? ''}
          </option>
        ))}
      </select>
      <button disabled={!staffId} onClick={() => staffId && onAssign(staffId)} style={smallOk}>
        Assign
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
          <span style={ui.label}>Service</span>
          <select style={ui.input} value={form.serviceId} onChange={(e) => up('serviceId', e.target.value)} required>
            <option value="">Select a service…</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.durationMinutes} min)
              </option>
            ))}
          </select>
        </label>
        <label>
          <span style={ui.label}>Date &amp; time</span>
          <input
            style={ui.input}
            type="datetime-local"
            value={form.startLocal}
            onChange={(e) => up('startLocal', e.target.value)}
            required
          />
        </label>
        <label>
          <span style={ui.label}>Assign staff (optional)</span>
          <select style={ui.input} value={form.staffId} onChange={(e) => up('staffId', e.target.value)}>
            <option value="">— Leave unassigned (pending) —</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.firstName} {s.lastName ?? ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span style={ui.label}>Customer first name</span>
          <input style={ui.input} value={form.customerFirstName} onChange={(e) => up('customerFirstName', e.target.value)} required />
        </label>
        <label>
          <span style={ui.label}>Customer email (optional)</span>
          <input style={ui.input} type="email" value={form.customerEmail} onChange={(e) => up('customerEmail', e.target.value)} />
        </label>
        <label>
          <span style={ui.label}>Customer phone (optional)</span>
          <input style={ui.input} value={form.customerPhone} onChange={(e) => up('customerPhone', e.target.value)} />
        </label>
      </div>
      {error && <div style={ui.banner}>{error}</div>}
      <button type="submit" disabled={submitting} style={{ ...ui.primaryBtn, marginTop: 14 }}>
        {submitting ? 'Creating...' : 'Create booking'}
      </button>
    </form>
  );
}

function PaymentCell({
  payment,
  onPay,
  onMarkPaid,
}: {
  payment?: Payment;
  onPay: (type: 'PAY_ONLINE' | 'PAY_LATER') => void;
  onMarkPaid: (paymentId: string) => void;
}) {
  if (!payment) {
    return (
      <div style={{ display: 'flex', gap: 4 }}>
        <button onClick={() => onPay('PAY_ONLINE')} style={tinyBtn} title="Charge online (mock)">
          Online
        </button>
        <button onClick={() => onPay('PAY_LATER')} style={tinyBtn} title="Pay at the salon">
          Later
        </button>
      </div>
    );
  }
  const color = payment.status === 'PAID' ? '#22c55e' : payment.status === 'FAILED' ? '#ef4444' : '#eab308';
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <span style={{ color, fontSize: 12, fontWeight: 600 }}>{payment.status}</span>
      {payment.status === 'PENDING' && (
        <button onClick={() => onMarkPaid(payment.id)} style={tinyBtn}>
          Mark paid
        </button>
      )}
    </div>
  );
}

const tinyBtn: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: 6,
  border: '1px solid #475569',
  background: 'transparent',
  color: '#cbd5e1',
  fontSize: 12,
  cursor: 'pointer',
};

const smallOk: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid #22c55e',
  background: 'transparent',
  color: '#22c55e',
  fontSize: 13,
  cursor: 'pointer',
};

const smallWarn: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid #f97316',
  background: 'transparent',
  color: '#f97316',
  fontSize: 13,
  cursor: 'pointer',
};

const ghostBtn: React.CSSProperties = {
  padding: '9px 14px',
  borderRadius: 8,
  border: '1px solid #475569',
  background: 'transparent',
  color: '#e2e8f0',
  fontSize: 13,
  cursor: 'pointer',
};
