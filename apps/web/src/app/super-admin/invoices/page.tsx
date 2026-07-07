'use client';

import { useCallback, useEffect, useState, CSSProperties, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';

interface Row {
  id: string; number: string; type: 'OVERAGE' | 'RENEWAL'; status: 'OPEN' | 'PAID' | 'VOID';
  totalCents: number; currency: string; sentAt: string | null; paidAt: string | null;
  token: string; createdAt: string; salonName: string | null;
}

const money = (c: number, cur = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format((c || 0) / 100);
const fmt = (s: string | null) => { if (!s) return '—'; try { return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { return '—'; } };

export default function AdminInvoicesPage() {
  const { token, user, ready } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (!token) router.replace('/login');
    else if (user && user.role !== 'SUPER_ADMIN') router.replace('/');
  }, [ready, token, user, router]);

  const load = useCallback(async () => {
    if (!token) return;
    try { setRows(await apiFetch<Row[]>('/admin/invoices', { token })); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed to load'); }
  }, [token]);
  useEffect(() => { if (ready && token && user?.role === 'SUPER_ADMIN') load(); }, [ready, token, user, load]);

  async function act(path: string, okMsg: string) {
    setBusy(true); setErr(null); setMsg(null);
    try { await apiFetch(path, { method: 'POST', token }); setMsg(okMsg); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Action failed'); }
    finally { setBusy(false); }
  }

  if (!ready || !token || user?.role !== 'SUPER_ADMIN') {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#94a3b8' }}>Loading…</div>;
  }

  const badge = (s: Row['status']) => (
    <span style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
      background: s === 'PAID' ? '#064e3b' : s === 'VOID' ? '#334155' : '#78350f',
      color: s === 'PAID' ? '#a7f3d0' : s === 'VOID' ? '#cbd5e1' : '#fde68a' }}>
      {s === 'PAID' ? 'Paid' : s === 'VOID' ? 'Void' : 'Open'}
    </span>
  );

  return (
    <main style={{ maxWidth: 980, margin: '0 auto', padding: '32px 24px', color: '#e2e8f0' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, margin: 0 }}>Invoices</h1>
          <p style={{ color: '#94a3b8', margin: '4px 0 0', fontSize: 14 }}>Month-end overage + plan-renewal invoices. Sent automatically; you can resend or run the sweep manually.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => act('/admin/invoices/run-now', '✓ Sweep ran. New invoices (if any) were emailed.')} disabled={busy} style={primary}>Run sweep now</button>
          <a href="/super-admin/tenants" style={ghost}>← Salons</a>
        </div>
      </header>

      {err && <Banner color="#fecaca" bg="#7f1d1d">{err}</Banner>}
      {msg && <Banner color="#bbf7d0" bg="#14532d">{msg}</Banner>}

      <section style={card}>
        {rows === null ? (
          <p style={{ color: '#94a3b8', margin: 0 }}>Loading…</p>
        ) : rows.length === 0 ? (
          <p style={{ color: '#94a3b8', margin: 0 }}>No invoices yet. They are generated at month end (overage) and when a plan is due (renewal).</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5, minWidth: 720 }}>
              <thead>
                <tr style={{ color: '#94a3b8', textAlign: 'left' }}>
                  <th style={th}>Invoice</th><th style={th}>Salon</th><th style={th}>Type</th>
                  <th style={{ ...th, textAlign: 'right' }}>Amount</th><th style={th}>Status</th>
                  <th style={th}>Sent</th><th style={th}>Paid</th><th style={{ ...th, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ borderTop: '1px solid #1f2937' }}>
                    <td style={td}><span style={{ fontFamily: 'monospace' }}>{r.number}</span></td>
                    <td style={td}>{r.salonName ?? '—'}</td>
                    <td style={td}>{r.type === 'RENEWAL' ? 'Renewal' : 'Overage'}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{money(r.totalCents, r.currency)}</td>
                    <td style={td}>{badge(r.status)}</td>
                    <td style={td}>{fmt(r.sentAt)}</td>
                    <td style={td}>{fmt(r.paidAt)}</td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <a href={`/invoice/${r.token}`} target="_blank" rel="noopener noreferrer" style={miniLink}>View</a>
                      {r.status !== 'VOID' && <button onClick={() => act(`/admin/invoices/${r.id}/resend`, '✓ Invoice re-emailed.')} disabled={busy} style={mini}>Resend</button>}
                      {r.status === 'OPEN' && <button onClick={() => act(`/admin/invoices/${r.id}/void`, '✓ Invoice voided.')} disabled={busy} style={{ ...mini, color: '#fca5a5' }}>Void</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function Banner({ children, color, bg }: { children: ReactNode; color: string; bg: string }) {
  return <div style={{ background: bg, color, padding: '10px 14px', borderRadius: 8, fontSize: 14, marginBottom: 14 }}>{children}</div>;
}

const card: CSSProperties = { background: '#111827', border: '1px solid #1f2937', borderRadius: 12, padding: 18 };
const th: CSSProperties = { padding: '6px 10px', fontWeight: 600 };
const td: CSSProperties = { padding: '10px 10px', color: '#e2e8f0', verticalAlign: 'middle' };
const ghost: CSSProperties = { padding: '9px 14px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#e2e8f0', fontSize: 14, cursor: 'pointer', textDecoration: 'none' };
const primary: CSSProperties = { padding: '9px 14px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' };
const mini: CSSProperties = { marginLeft: 8, padding: '5px 10px', borderRadius: 6, border: '1px solid #334155', background: 'transparent', color: '#e2e8f0', fontSize: 12.5, cursor: 'pointer' };
const miniLink: CSSProperties = { marginLeft: 8, padding: '5px 10px', borderRadius: 6, border: '1px solid #334155', color: '#a5b4fc', fontSize: 12.5, textDecoration: 'none' };
