'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '../lib/auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005/api';

type HealthState = 'checking' | 'up' | 'down';

export default function HomePage() {
  const { user, ready, logout } = useAuth();
  const [api, setApi] = useState<HealthState>('checking');
  const [database, setDatabase] = useState<HealthState>('checking');

  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then((res) => res.json())
      .then((data) => {
        setApi('up');
        setDatabase(data.database === 'up' ? 'up' : 'down');
      })
      .catch(() => {
        setApi('down');
        setDatabase('down');
      });
  }, []);

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '64px 24px' }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Lumio Booking</h1>
      <p style={{ color: '#94a3b8', marginTop: 0 }}>
        Multi-tenant SaaS booking platform for nail salons — Admin dashboard
      </p>

      <div style={{ marginTop: 24, display: 'flex', gap: 10, alignItems: 'center' }}>
        {ready && user ? (
          <>
            <span style={{ color: '#cbd5e1', fontSize: 14 }}>
              Signed in as <strong>{user.email}</strong> ({user.role})
            </span>
            {user.role === 'SUPER_ADMIN' && (
              <Link href="/super-admin/tenants" style={linkBtn}>
                Manage salons
              </Link>
            )}
            {user.role === 'SALON_ADMIN' && (
              <Link href="/salon" style={linkBtn}>
                Manage my salon
              </Link>
            )}
            {user.role === 'STAFF' && (
              <Link href="/staff/bookings" style={linkBtn}>
                My bookings
              </Link>
            )}
            <button onClick={logout} style={ghostBtn}>
              Log out
            </button>
          </>
        ) : (
          <Link href="/login" style={linkBtn}>
            Sign in
          </Link>
        )}
        <Link href="/book" style={ghostBtn}>
          Customer booking demo
        </Link>
      </div>

      <div
        style={{
          marginTop: 32,
          padding: 24,
          borderRadius: 12,
          background: '#1e293b',
          border: '1px solid #334155',
        }}
      >
        <h2 style={{ fontSize: 18, marginTop: 0 }}>System status</h2>
        <StatusRow label="Web dashboard (port 3005)" state="up" />
        <StatusRow label="Backend API (port 8005)" state={api} />
        <StatusRow label="Database (PostgreSQL)" state={database} />
      </div>

      <p style={{ color: '#64748b', marginTop: 32, fontSize: 14 }}>
        MVP ready: multi-tenant DB, auth + roles, Super Admin & Salon Admin
        portals, staff portal, booking engine, WordPress connector, and
        notification/payment adapters.
      </p>
    </main>
  );
}

function StatusRow({ label, state }: { label: string; state: HealthState }) {
  const color = state === 'up' ? '#22c55e' : state === 'down' ? '#ef4444' : '#eab308';
  const text = state === 'up' ? 'Online' : state === 'down' ? 'Offline' : 'Checking...';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 0',
        borderBottom: '1px solid #334155',
      }}
    >
      <span>{label}</span>
      <span style={{ color, fontWeight: 600 }}>● {text}</span>
    </div>
  );
}

const linkBtn: React.CSSProperties = {
  padding: '9px 14px',
  borderRadius: 8,
  background: '#6366f1',
  color: 'white',
  fontWeight: 600,
  fontSize: 13,
  textDecoration: 'none',
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
