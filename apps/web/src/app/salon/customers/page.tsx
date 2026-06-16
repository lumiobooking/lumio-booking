'use client';

import { useCallback, useEffect, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { DateRangeBar, useDateRange, sortNewest } from '../../../components/ListFilter';

interface Customer {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  createdAt: string;
  loyaltyPoints?: number;
  _count: { appointments: number };
}

export default function CustomersPage() {
  return (
    <SalonShell>
      <Inner />
    </SalonShell>
  );
}

function Inner() {
  const { token } = useAuth();
  const range = useDateRange('all');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setCustomers(await apiFetch<Customer[]>('/customers', { token }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function remove(c: Customer) {
    const extra = c._count.appointments > 0 ? `\n\nThis will also delete their ${c._count.appointments} booking(s).` : '';
    if (!confirm(`Delete customer "${c.firstName} ${c.lastName ?? ''}"?${extra}\n\nThis cannot be undone.`)) return;
    try {
      await apiFetch(`/customers/${c.id}`, { method: 'DELETE', token });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  // Filter by join date + search text, then newest first.
  const filtered = sortNewest(
    customers.filter((c) => {
      if (!range.inRange(c.createdAt)) return false;
      const s = `${c.firstName} ${c.lastName ?? ''} ${c.email ?? ''} ${c.phone ?? ''}`.toLowerCase();
      return s.includes(q.toLowerCase());
    }),
    (c) => c.createdAt,
  );

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 24, margin: 0 }}>Customers</h1>
          <p style={{ color: '#94a3b8', margin: '4px 0 0', fontSize: 14 }}>{filtered.length} of {customers.length}</p>
        </div>
        <input
          placeholder="Search name / email / phone"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ ...ui.input, maxWidth: 280 }}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <DateRangeBar range={range} />
      </div>

      {error && <div style={ui.banner}>{error}</div>}

      {loading ? (
        <p style={{ color: '#94a3b8' }}>Loading…</p>
      ) : (
        <div style={{ border: '1px solid #334155', borderRadius: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#1e293b' }}>
                <th style={ui.th}>Name</th>
                <th style={ui.th}>Email</th>
                <th style={ui.th}>Phone</th>
                <th style={ui.th}>Bookings</th>
                <th style={ui.th}>Points</th>
                <th style={ui.th}>Since</th>
                <th style={ui.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td style={ui.td} colSpan={7}>No customers found.</td></tr>
              )}
              {filtered.map((c) => (
                <tr key={c.id} style={{ borderTop: '1px solid #334155' }}>
                  <td style={ui.td}><a href={`/salon/customers/${c.id}`} style={{ color: '#818cf8', textDecoration: 'none', fontWeight: 600 }}>{c.firstName} {c.lastName ?? ''}</a></td>
                  <td style={{ ...ui.td, color: '#94a3b8' }}>{c.email ?? '—'}</td>
                  <td style={{ ...ui.td, color: '#94a3b8' }}>{c.phone ?? '—'}</td>
                  <td style={ui.td}>{c._count.appointments}</td>
                  <td style={ui.td}>{c.loyaltyPoints ? <span style={{ color: '#eab308', fontWeight: 600 }}>{c.loyaltyPoints} pts</span> : '—'}</td>
                  <td style={{ ...ui.td, color: '#94a3b8' }}>{new Date(c.createdAt).toLocaleDateString()}</td>
                  <td style={ui.td}><button onClick={() => remove(c)} style={ui.dangerBtn}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
