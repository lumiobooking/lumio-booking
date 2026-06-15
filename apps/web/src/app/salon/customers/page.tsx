'use client';

import { useCallback, useEffect, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';

interface Customer {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  createdAt: string;
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

  const filtered = customers.filter((c) => {
    const s = `${c.firstName} ${c.lastName ?? ''} ${c.email ?? ''} ${c.phone ?? ''}`.toLowerCase();
    return s.includes(q.toLowerCase());
  });

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 24, margin: 0 }}>Customers</h1>
          <p style={{ color: '#94a3b8', margin: '4px 0 0', fontSize: 14 }}>{customers.length} total</p>
        </div>
        <input
          placeholder="Search name / email / phone"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ ...ui.input, maxWidth: 280 }}
        />
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
                <th style={ui.th}>Since</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td style={ui.td} colSpan={5}>No customers found.</td></tr>
              )}
              {filtered.map((c) => (
                <tr key={c.id} style={{ borderTop: '1px solid #334155' }}>
                  <td style={ui.td}>{c.firstName} {c.lastName ?? ''}</td>
                  <td style={{ ...ui.td, color: '#94a3b8' }}>{c.email ?? '—'}</td>
                  <td style={{ ...ui.td, color: '#94a3b8' }}>{c.phone ?? '—'}</td>
                  <td style={ui.td}>{c._count.appointments}</td>
                  <td style={{ ...ui.td, color: '#94a3b8' }}>{new Date(c.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
