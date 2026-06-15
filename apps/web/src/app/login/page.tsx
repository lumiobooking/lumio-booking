'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('superadmin@lumio.test');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user = await login(email, password);
      // Route by role.
      if (user.role === 'SUPER_ADMIN') {
        router.push('/super-admin/tenants');
      } else if (user.role === 'SALON_ADMIN') {
        router.push('/salon');
      } else if (user.role === 'STAFF') {
        router.push('/staff/bookings');
      } else {
        router.push('/');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          width: '100%',
          maxWidth: 380,
          background: '#1e293b',
          border: '1px solid #334155',
          borderRadius: 12,
          padding: 28,
        }}
      >
        <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>Lumio Booking</h1>
        <p style={{ color: '#94a3b8', marginTop: 0, fontSize: 14 }}>Sign in to the admin console</p>

        <label style={labelStyle}>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={inputStyle}
        />

        <label style={labelStyle}>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={inputStyle}
        />

        {error && (
          <div
            style={{
              background: '#7f1d1d',
              color: '#fecaca',
              padding: '8px 12px',
              borderRadius: 8,
              fontSize: 13,
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}

        <button type="submit" disabled={loading} style={buttonStyle}>
          {loading ? 'Signing in...' : 'Sign in'}
        </button>

        <p style={{ color: '#64748b', fontSize: 12, marginTop: 16, lineHeight: 1.6 }}>
          Demo (local): superadmin@lumio.test / Password123!
        </p>
      </form>
    </main>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  color: '#cbd5e1',
  margin: '14px 0 6px',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid #475569',
  background: '#0f172a',
  color: '#e2e8f0',
  fontSize: 14,
};

const buttonStyle: React.CSSProperties = {
  width: '100%',
  marginTop: 20,
  padding: '11px 12px',
  borderRadius: 8,
  border: 'none',
  background: '#6366f1',
  color: 'white',
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
};
