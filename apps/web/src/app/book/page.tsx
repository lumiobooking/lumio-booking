'use client';

// ===========================================================================
// Customer-facing booking DEMO.
//
// This mirrors what the WordPress plugin shows to a salon's end customers, but
// runs inside the dashboard app so you can preview it without WordPress. It
// calls the PUBLIC API (/public/*) using a salon API key and prints the exact
// system response so you can see what the backend returns.
//
// NOTE: here the API key is typed into the browser for demo convenience. In
// production the WordPress plugin keeps the key server-side and the visitor
// never sees it.
// ===========================================================================

import { useState, FormEvent } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005/api';

interface Service {
  id: string;
  name: string;
  durationMinutes: number;
  priceCents: number;
  currency: string;
}
interface Staff {
  id: string;
  firstName: string;
  lastName: string | null;
}
interface ApiCall {
  method: string;
  path: string;
  status: number;
  body: unknown;
}

export default function BookPage() {
  const [apiKey, setApiKey] = useState('');
  const [connected, setConnected] = useState(false);
  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastCall, setLastCall] = useState<ApiCall | null>(null);

  // Booking form fields
  const [form, setForm] = useState({
    serviceId: '',
    preferredStaffId: '',
    startLocal: '',
    customerFirstName: '',
    customerEmail: '',
    customerPhone: '',
  });
  const [submitting, setSubmitting] = useState(false);

  function up(key: keyof typeof form, v: string) {
    setForm((f) => ({ ...f, [key]: v }));
  }

  async function publicFetch(path: string, init?: RequestInit) {
    const res = await fetch(`${API_URL}/public${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-Lumio-Api-Key': apiKey,
        ...(init?.headers ?? {}),
      },
    });
    const body = await res.json().catch(() => null);
    return { res, body };
  }

  async function connect(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const [svc, stf] = await Promise.all([publicFetch('/services'), publicFetch('/staff')]);
      if (!svc.res.ok) {
        setError(
          (svc.body && (svc.body as any).message) || `API key rejected (${svc.res.status})`,
        );
        setLastCall({ method: 'GET', path: '/public/services', status: svc.res.status, body: svc.body });
        return;
      }
      setServices(svc.body as Service[]);
      setStaff((stf.body as Staff[]) ?? []);
      setConnected(true);
      setLastCall({ method: 'GET', path: '/public/services', status: svc.res.status, body: svc.body });
    } catch {
      setError('Could not reach the API. Is the backend running on port 8005?');
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const payload = {
      serviceId: form.serviceId,
      preferredStaffId: form.preferredStaffId || undefined,
      startTime: form.startLocal ? new Date(form.startLocal).toISOString() : '',
      customerFirstName: form.customerFirstName,
      customerEmail: form.customerEmail || undefined,
      customerPhone: form.customerPhone || undefined,
    };
    try {
      const { res, body } = await publicFetch('/bookings', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setLastCall({ method: 'POST', path: '/public/bookings', status: res.status, body });
      if (!res.ok) {
        setError((body && (body as any).message) || `Booking failed (${res.status})`);
      }
    } catch {
      setError('Network error.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '40px 24px' }}>
      <h1 style={{ fontSize: 26, marginBottom: 4 }}>Book an appointment</h1>
      <p style={{ color: '#94a3b8', marginTop: 0, fontSize: 14 }}>
        Customer booking demo — this is what your salon's visitors see (via the WordPress plugin in
        production). The raw system response is shown on the right.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 20, alignItems: 'start' }}>
        {/* LEFT: the customer form */}
        <div style={card}>
          {!connected ? (
            <form onSubmit={connect}>
              <h2 style={{ fontSize: 16, marginTop: 0 }}>Connect with your salon API key</h2>
              <p style={{ color: '#94a3b8', fontSize: 13 }}>
                Get this from Salon Admin → Integrations → Generate API key.
              </p>
              <input
                style={input}
                placeholder="lumio_sk_..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                required
              />
              <button type="submit" style={{ ...primaryBtn, marginTop: 12 }}>
                Load services
              </button>
            </form>
          ) : (
            <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
              <h2 style={{ fontSize: 16, margin: 0 }}>Your appointment</h2>
              <label>
                <span style={label}>Service</span>
                <select style={input} value={form.serviceId} onChange={(e) => up('serviceId', e.target.value)} required>
                  <option value="">Select a service…</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {s.durationMinutes} min · {(s.priceCents / 100).toFixed(0)} {s.currency}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span style={label}>Preferred technician (optional)</span>
                <select style={input} value={form.preferredStaffId} onChange={(e) => up('preferredStaffId', e.target.value)}>
                  <option value="">No preference</option>
                  {staff.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.firstName} {m.lastName ?? ''}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span style={label}>Date &amp; time</span>
                <input style={input} type="datetime-local" value={form.startLocal} onChange={(e) => up('startLocal', e.target.value)} required />
              </label>
              <label>
                <span style={label}>Your name</span>
                <input style={input} value={form.customerFirstName} onChange={(e) => up('customerFirstName', e.target.value)} required />
              </label>
              <label>
                <span style={label}>Email (optional)</span>
                <input style={input} type="email" value={form.customerEmail} onChange={(e) => up('customerEmail', e.target.value)} />
              </label>
              <label>
                <span style={label}>Phone (optional)</span>
                <input style={input} value={form.customerPhone} onChange={(e) => up('customerPhone', e.target.value)} />
              </label>
              <button type="submit" disabled={submitting} style={primaryBtn}>
                {submitting ? 'Booking…' : 'Book appointment'}
              </button>
              <button type="button" onClick={() => setConnected(false)} style={ghostBtn}>
                Use a different key
              </button>
            </form>
          )}
          {error && (
            <div style={{ background: '#7f1d1d', color: '#fecaca', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginTop: 12 }}>
              {error}
            </div>
          )}
        </div>

        {/* RIGHT: the raw system response */}
        <div style={card}>
          <h2 style={{ fontSize: 16, marginTop: 0 }}>System response</h2>
          {!lastCall ? (
            <p style={{ color: '#64748b', fontSize: 13 }}>
              Submit the form to see exactly what the backend API returns.
            </p>
          ) : (
            <div style={{ fontSize: 13 }}>
              <div style={{ color: '#cbd5e1', marginBottom: 6 }}>
                <code>{lastCall.method} {lastCall.path}</code>
              </div>
              <div style={{ marginBottom: 8 }}>
                HTTP status:{' '}
                <span style={{ fontWeight: 700, color: lastCall.status < 400 ? '#22c55e' : '#ef4444' }}>
                  {lastCall.status}
                </span>
                {lastCall.method === 'POST' && lastCall.status < 400 && (
                  <span style={{ color: '#22c55e' }}> — booking created (status PENDING)</span>
                )}
              </div>
              <pre
                style={{
                  background: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: 8,
                  padding: 12,
                  overflowX: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: 420,
                }}
              >
                {JSON.stringify(lastCall.body, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

const card: React.CSSProperties = {
  background: '#1e293b',
  border: '1px solid #334155',
  borderRadius: 12,
  padding: 20,
};
const input: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '9px 11px',
  borderRadius: 8,
  border: '1px solid #475569',
  background: '#0f172a',
  color: '#e2e8f0',
  fontSize: 14,
};
const label: React.CSSProperties = { display: 'block', fontSize: 12, color: '#cbd5e1', marginBottom: 6 };
const primaryBtn: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 8,
  border: 'none',
  background: '#6366f1',
  color: 'white',
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
};
const ghostBtn: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 8,
  border: '1px solid #475569',
  background: 'transparent',
  color: '#94a3b8',
  fontSize: 13,
  cursor: 'pointer',
};
