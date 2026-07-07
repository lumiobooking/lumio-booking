'use client';

import { useCallback, useEffect, useState, CSSProperties } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '../../../lib/api';

interface LineItem { label: string; amountCents: number }
interface Invoice {
  number: string; type: 'OVERAGE' | 'RENEWAL'; status: 'OPEN' | 'PAID' | 'VOID';
  currency: string; subtotalCents: number; totalCents: number;
  lineItems: LineItem[]; periodStart: string | null; periodEnd: string | null;
  dueDate: string | null; createdAt: string; paidAt: string | null;
  salonName: string | null; canPay: boolean;
}

const money = (c: number, cur = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format((c || 0) / 100);
const fmt = (s: string | null) => { if (!s) return '—'; try { return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return '—'; } };

export default function InvoicePage() {
  const params = useParams();
  const token = String((params as Record<string, string | string[]>).token ?? '');
  const [inv, setInv] = useState<Invoice | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setInv(await apiFetch<Invoice>(`/public/invoices/${token}`)); }
    catch { setInv(null); }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    // Returning from Stripe → confirm payment, then load.
    const sid = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('session_id') : null;
    if (sid) {
      apiFetch(`/public/invoices/${token}/confirm`, { method: 'POST', body: { sessionId: sid } })
        .catch(() => {})
        .finally(() => { try { window.history.replaceState({}, '', `/invoice/${token}`); } catch { /* ignore */ } load(); });
    } else {
      load();
    }
  }, [token, load]);

  async function pay() {
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch<{ url: string }>(`/public/invoices/${token}/checkout`, { method: 'POST' });
      if (r?.url) window.location.href = r.url; else throw new Error('No checkout URL');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start payment');
      setBusy(false);
    }
  }

  if (inv === undefined) return <Shell><p style={{ color: '#64748b' }}>Loading…</p></Shell>;
  if (!inv) return <Shell><p style={{ color: '#64748b' }}>Invoice not found. Please check the link in your email.</p></Shell>;

  const paid = inv.status === 'PAID';
  const voided = inv.status === 'VOID';
  const title = inv.type === 'RENEWAL' ? 'Plan renewal' : 'Usage charges';

  return (
    <Shell>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 900, color: '#4f46e5' }}>Lumio Booking</div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>Invoice · {inv.number}</div>
        </div>
        <span style={{
          fontSize: 12.5, fontWeight: 700, padding: '5px 12px', borderRadius: 999,
          background: paid ? '#dcfce7' : voided ? '#f1f5f9' : '#fef3c7',
          color: paid ? '#15803d' : voided ? '#64748b' : '#b45309',
        }}>
          {paid ? '✓ Paid' : voided ? 'Void' : 'Payment due'}
        </span>
      </div>

      <div style={{ marginTop: 20, paddingTop: 18, borderTop: '1px solid #e2e8f0' }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#0f172a' }}>{title}</div>
        {inv.salonName && <div style={{ fontSize: 14, color: '#475569', marginTop: 2 }}>{inv.salonName}</div>}
        <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginTop: 12, fontSize: 13, color: '#64748b' }}>
          <div><div style={{ color: '#94a3b8', fontSize: 11.5 }}>Issued</div>{fmt(inv.createdAt)}</div>
          <div><div style={{ color: '#94a3b8', fontSize: 11.5 }}>Due</div>{fmt(inv.dueDate)}</div>
          {inv.periodStart && <div><div style={{ color: '#94a3b8', fontSize: 11.5 }}>Period</div>{fmt(inv.periodStart)} – {fmt(inv.periodEnd)}</div>}
          {paid && <div><div style={{ color: '#94a3b8', fontSize: 11.5 }}>Paid</div>{fmt(inv.paidAt)}</div>}
        </div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 18, fontSize: 14.5 }}>
        <tbody>
          {inv.lineItems.map((li, i) => (
            <tr key={i}>
              <td style={{ padding: '10px 0', color: '#334155', borderBottom: '1px solid #f1f5f9' }}>{li.label}</td>
              <td align="right" style={{ padding: '10px 0', color: '#0f172a', fontWeight: 600, borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' }}>{money(li.amountCents, inv.currency)}</td>
            </tr>
          ))}
          <tr>
            <td style={{ padding: '14px 0 0', fontWeight: 800, fontSize: 16 }}>Total due<div style={{ fontWeight: 400, fontSize: 12, color: '#94a3b8' }}>Số tiền cần thanh toán</div></td>
            <td align="right" style={{ padding: '14px 0 0', fontWeight: 900, fontSize: 22, color: '#4f46e5', whiteSpace: 'nowrap' }}>{money(inv.totalCents, inv.currency)}</td>
          </tr>
        </tbody>
      </table>

      {err && <div style={{ marginTop: 16, background: '#fef2f2', color: '#b91c1c', padding: '10px 14px', borderRadius: 8, fontSize: 13.5 }}>{err}</div>}

      {paid ? (
        <div style={{ marginTop: 22, background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', padding: '14px 16px', borderRadius: 10, fontSize: 14.5, fontWeight: 600 }}>
          ✓ This invoice has been paid. Thank you! · Cảm ơn bạn đã thanh toán.
        </div>
      ) : voided ? (
        <div style={{ marginTop: 22, color: '#64748b', fontSize: 14 }}>This invoice was cancelled.</div>
      ) : inv.canPay ? (
        <button onClick={pay} disabled={busy} style={payBtn}>
          {busy ? 'Opening secure checkout…' : `Pay ${money(inv.totalCents, inv.currency)} · Thanh toán ngay →`}
        </button>
      ) : (
        <div style={{ marginTop: 22, color: '#64748b', fontSize: 14 }}>
          To pay this invoice, please contact Lumio or reply to your invoice email.
        </div>
      )}

      <div style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid #e2e8f0', fontSize: 12, color: '#94a3b8' }}>
        Secure payment by Stripe. Questions about this bill? Reply to the invoice email we sent you.
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', display: 'flex', justifyContent: 'center', padding: '5vh 16px', boxSizing: 'border-box' }}>
      <div style={card}>{children}</div>
    </div>
  );
}

const card: CSSProperties = { width: '100%', maxWidth: 520, background: '#fff', borderRadius: 16, padding: 'clamp(20px, 4vw, 34px)', boxShadow: '0 20px 50px rgba(15,23,42,0.10)', height: 'fit-content', boxSizing: 'border-box' };
const payBtn: CSSProperties = { marginTop: 22, width: '100%', padding: '14px 20px', borderRadius: 10, border: 'none', cursor: 'pointer', background: '#4f46e5', color: '#fff', fontSize: 16, fontWeight: 800 };
