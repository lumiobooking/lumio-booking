'use client';

import { useCallback, useEffect, useState } from 'react';
import { StaffShell } from '../../../components/StaffShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { DateRangeBar, useDateRange, sortNewest, usePaged, Pager } from '../../../components/ListFilter';

interface NamedRef {
  firstName?: string;
  lastName?: string | null;
}
interface Booking {
  id: string;
  status: string;
  startTime: string;
  notes: string | null;
  customer: NamedRef | null;
  service: { name: string } | null;
}

const STATUS_COLORS: Record<string, string> = {
  ASSIGNED: '#3b82f6',
  ACCEPTED: '#22c55e',
  CONFIRMED: '#22c55e',
  COMPLETED: '#a855f7',
  CANCELLED: '#94a3b8',
  NO_SHOW: '#ef4444',
};

export default function StaffBookingsPage() {
  return (
    <StaffShell>
      <Inner />
    </StaffShell>
  );
}

function Inner() {
  const { token } = useAuth();
  const range = useDateRange('all', true); // bookings are future-oriented
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setBookings(await apiFetch<Booking[]>('/bookings/my', { token }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bookings');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function respond(id: string, action: 'accept' | 'reject') {
    try {
      const body = action === 'reject' ? { reason: 'Not available' } : undefined;
      await apiFetch(`/bookings/${id}/${action}`, { method: 'POST', token, body });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  }

  const name = (c: NamedRef | null) => (c ? `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() : '—');

  // Filter by appointment date, then newest first.
  const visible = sortNewest(
    bookings.filter((b) => range.inRange(b.startTime)),
    (b) => b.startTime,
  );
  const pg = usePaged(visible, 20);

  return (
    <section>
      {error && <div style={ui.banner}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <span style={{ color: '#94a3b8', fontSize: 13 }}>{visible.length} booking{visible.length === 1 ? '' : 's'}</span>
        <DateRangeBar range={range} />
      </div>

      {loading ? (
        <p style={{ color: '#94a3b8' }}>Loading...</p>
      ) : visible.length === 0 ? (
        <div style={{ ...ui.card }}>
          <p style={{ margin: 0, color: '#94a3b8' }}>No bookings in this range.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {pg.paged.map((b) => (
            <div
              key={b.id}
              style={{
                ...ui.card,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{b.service?.name ?? 'Service'}</div>
                <div style={{ color: '#cbd5e1', fontSize: 14, marginTop: 2 }}>
                  {new Date(b.startTime).toLocaleString('en-US')} · {name(b.customer)}
                </div>
                <span
                  style={{
                    display: 'inline-block',
                    marginTop: 8,
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
              </div>
              {b.status === 'ASSIGNED' && (
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button onClick={() => respond(b.id, 'accept')} style={acceptBtn}>
                    Accept
                  </button>
                  <button onClick={() => respond(b.id, 'reject')} style={{ ...ui.dangerBtn, whiteSpace: 'nowrap' }}>
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}
          <Pager paged={pg} />
        </div>
      )}
    </section>
  );
}

const acceptBtn: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 8,
  border: 'none',
  background: '#22c55e',
  color: 'white',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
