'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { SalonShell } from '../../../../components/SalonShell';
import { useAuth } from '../../../../lib/auth';
import { apiFetch } from '../../../../lib/api';
import { ui, formatPrice } from '../../../../lib/ui';

interface Pay { id: string; amountCents: number; currency: string; status: string; type: string; createdAt: string }
interface Appt {
  id: string; status: string; startTime: string;
  service: { name: string } | null;
  assignedStaff: { firstName: string; lastName: string | null } | null;
  payments: Pay[];
}
interface CustomerDetail {
  id: string; firstName: string; lastName: string | null; email: string | null; phone: string | null;
  notes: string | null; createdAt: string;
  appointments: Appt[];
  stats: { bookings: number; completed: number; totalSpentCents: number; lastVisit: string | null };
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: '#eab308', ASSIGNED: '#3b82f6', ACCEPTED: '#22c55e', CONFIRMED: '#22c55e',
  REJECTED: '#ef4444', CANCELLED: '#94a3b8', COMPLETED: '#a855f7', NO_SHOW: '#f97316',
};
const PAY_COLORS: Record<string, string> = { PAID: '#22c55e', PENDING: '#eab308', FAILED: '#ef4444', REFUNDED: '#94a3b8' };

export default function CustomerDetailPage() {
  return (
    <SalonShell>
      <Inner />
    </SalonShell>
  );
}

function Inner() {
  const { token } = useAuth();
  const params = useParams();
  const id = String(params?.id ?? '');
  const [c, setC] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !id) return;
    setLoading(true); setError(null);
    try { setC(await apiFetch<CustomerDetail>(`/customers/${id}`, { token })); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load customer'); }
    finally { setLoading(false); }
  }, [token, id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p style={{ color: '#94a3b8' }}>Loading…</p>;
  if (error) return <div style={ui.banner}>{error}</div>;
  if (!c) return <p style={{ color: '#94a3b8' }}>Customer not found.</p>;

  const currency = c.appointments.flatMap((a) => a.payments)[0]?.currency ?? 'USD';

  return (
    <section>
      <a href="/salon/customers" style={{ color: '#818cf8', fontSize: 13, textDecoration: 'none' }}>← Back to customers</a>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '12px 0 18px' }}>
        <span style={{ width: 52, height: 52, borderRadius: '50%', background: '#334155', color: '#e2e8f0', display: 'grid', placeItems: 'center', fontSize: 22, fontWeight: 700 }}>
          {(c.firstName || '?').charAt(0).toUpperCase()}
        </span>
        <div>
          <h1 style={{ fontSize: 24, margin: 0 }}>{c.firstName} {c.lastName ?? ''}</h1>
          <div style={{ color: '#94a3b8', fontSize: 14 }}>
            {c.email ?? 'no email'} · {c.phone ?? 'no phone'} · since {new Date(c.createdAt).toLocaleDateString()}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginBottom: 18 }}>
        <Kpi label="Total spent" value={formatPrice(c.stats.totalSpentCents, currency)} accent="#22c55e" />
        <Kpi label="Bookings" value={String(c.stats.bookings)} accent="#3b82f6" />
        <Kpi label="Completed" value={String(c.stats.completed)} accent="#a855f7" />
        <Kpi label="Last visit" value={c.stats.lastVisit ? new Date(c.stats.lastVisit).toLocaleDateString() : '—'} accent="#06b6d4" />
      </div>

      {c.notes && (
        <div style={{ ...ui.card, marginBottom: 18 }}>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 4 }}>Notes</div>
          <div style={{ fontSize: 14 }}>{c.notes}</div>
        </div>
      )}

      <h2 style={{ fontSize: 16, margin: '0 0 10px' }}>Booking history</h2>
      <div style={{ border: '1px solid #334155', borderRadius: 12, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead><tr style={{ background: '#1e293b' }}>
            <th style={ui.th}>When</th><th style={ui.th}>Service</th><th style={ui.th}>Staff</th><th style={ui.th}>Status</th><th style={ui.th}>Payment</th>
          </tr></thead>
          <tbody>
            {c.appointments.length === 0 && <tr><td style={ui.td} colSpan={5}>No bookings yet.</td></tr>}
            {c.appointments.map((a) => {
              const pay = a.payments[0];
              return (
                <tr key={a.id} style={{ borderTop: '1px solid #334155' }}>
                  <td style={ui.td}>{new Date(a.startTime).toLocaleString()}</td>
                  <td style={ui.td}>{a.service?.name ?? '—'}</td>
                  <td style={ui.td}>{a.assignedStaff ? `${a.assignedStaff.firstName} ${a.assignedStaff.lastName ?? ''}`.trim() : '—'}</td>
                  <td style={ui.td}><span style={{ color: STATUS_COLORS[a.status] ?? '#94a3b8', fontWeight: 600 }}>{a.status}</span></td>
                  <td style={ui.td}>
                    {pay ? <span style={{ color: PAY_COLORS[pay.status] ?? '#94a3b8' }}>{formatPrice(pay.amountCents, pay.currency)} · {pay.status}</span> : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16, borderLeft: `3px solid ${accent}` }}>
      <div style={{ fontSize: 12, color: '#94a3b8' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );
}
