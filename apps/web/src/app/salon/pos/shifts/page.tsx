'use client';

import { useCallback, useEffect, useState } from 'react';
import { SalonShell } from '../../../../components/SalonShell';
import { useAuth } from '../../../../lib/auth';
import { apiFetch } from '../../../../lib/api';
import { ui, formatPrice } from '../../../../lib/ui';
import { fmtInTz } from '../../../../lib/datetime';
import { DateRangeBar, useDateRange } from '../../../../components/ListFilter';
import { useLang } from '../../../../lib/i18n';
import { useIsMobile } from '../../../../lib/responsive';
import { ShiftSheet, printSheet, type ShiftSummary, type ShiftView } from '../../../../components/CashShiftPanel';

/**
 * Every cashier shift the till has run: who opened it, who closed it, what
 * the drawer should have held and what was counted. The owner's morning
 * read: which shift came up short, and by how much.
 */
interface ShiftRow extends ShiftView { orders: number | null; revenueCents: number | null; cashCents: number | null }

export default function ShiftHistoryPage() {
  return (
    <SalonShell>
      <Inner />
    </SalonShell>
  );
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const L = (v: string, e: string) => (vi ? v : e);
  const isMobile = useIsMobile();
  const range = useDateRange('30d');
  const [rows, setRows] = useState<ShiftRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ shift: ShiftView; summary: ShiftSummary } | null>(null);
  const [salonName, setSalonName] = useState('');
  const [currency, setCurrency] = useState('USD');
  const fmt = (c: number) => formatPrice(c, currency);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const q = new URLSearchParams();
      if (range.from) q.set('from', range.from);
      if (range.to) q.set('to', range.to);
      const [list, s] = await Promise.all([
        apiFetch<ShiftRow[]>(`/pos/shifts?${q.toString()}`, { token }),
        apiFetch<{ company?: { name?: string }; booking?: { currency?: string } }>('/settings', { token }).catch(() => null),
      ]);
      setRows(list);
      if (s?.company?.name) setSalonName(s.company.name);
      if (s?.booking?.currency) setCurrency(s.booking.currency);
    } catch (err) { setError(err instanceof Error ? err.message : 'error'); }
  }, [token, range.from, range.to]);
  useEffect(() => { void load(); }, [load]);

  async function show(id: string) {
    if (!token) return;
    try { setOpen(await apiFetch<{ shift: ShiftView; summary: ShiftSummary }>(`/pos/shifts/${id}`, { token })); }
    catch (err) { setError(err instanceof Error ? err.message : 'error'); }
  }

  const varianceText = (v: number | null) => v === null ? '—' : v === 0 ? L('Khớp', 'Balanced') : `${v < 0 ? '−' : '+'}${fmt(Math.abs(v))}`;
  const varianceColor = (v: number | null) => v === null ? 'var(--c94a3b8)' : v === 0 ? 'var(--ink-good)' : v < 0 ? 'var(--ink-bad)' : 'var(--ink-warn)';

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, margin: 0 }}>{L('Ca thu ngân', 'Cashier shifts')}</h1>
          <p style={{ color: 'var(--c94a3b8)', margin: '4px 0 0', fontSize: 14 }}>{L('Ai mở ca, ai chốt, két phải có bao nhiêu và đếm được bao nhiêu.', 'Who opened, who closed, what the drawer should have held and what was counted.')}</p>
        </div>
        <DateRangeBar range={range} />
      </div>

      {error && <div style={ui.banner}>{error}</div>}

      {!rows ? <p style={{ color: 'var(--c94a3b8)' }}>{L('Đang tải…', 'Loading…')}</p>
        : rows.length === 0 ? (
          <div style={{ ...ui.card, color: 'var(--c94a3b8)', fontSize: 14, lineHeight: 1.5 }}>
            {L('Chưa có ca nào trong khoảng này. Vào ca từ màn hình POS → menu ⋯ → "Ca thu ngân".', 'No shifts in this range. Open one from the POS → ⋯ menu → "Cashier shift".')}
          </div>
        ) : isMobile ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rows.map((r) => (
              <button key={r.id} type="button" onClick={() => void show(r.id)} style={{ ...ui.card, padding: 14, textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'inherit' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{fmtInTz(r.openedAt, { day: '2-digit', month: '2-digit', hour: 'numeric', minute: '2-digit' })} → {r.closedAt ? fmtInTz(r.closedAt, { hour: 'numeric', minute: '2-digit' }) : L('đang mở', 'open')}</span>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: varianceColor(r.varianceCents) }}>{varianceText(r.varianceCents)}</span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{r.openedByName || '—'}{r.closedByName ? ` → ${r.closedByName}` : ''} · {r.orders ?? '…'} {L('đơn', 'sales')} · {L('tiền mặt', 'cash')} {r.cashCents !== null ? fmt(r.cashCents) : '…'}</div>
              </button>
            ))}
          </div>
        ) : (
          <div style={{ ...ui.card, padding: 0, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  <th style={ui.th}>{L('Mở ca', 'Opened')}</th>
                  <th style={ui.th}>{L('Chốt ca', 'Closed')}</th>
                  <th style={ui.th}>{L('Người', 'Cashier')}</th>
                  <th style={{ ...ui.th, textAlign: 'right' }}>{L('Đơn', 'Sales')}</th>
                  <th style={{ ...ui.th, textAlign: 'right' }}>{L('Doanh thu', 'Revenue')}</th>
                  <th style={{ ...ui.th, textAlign: 'right' }}>{L('Két phải có', 'Expected')}</th>
                  <th style={{ ...ui.th, textAlign: 'right' }}>{L('Đếm được', 'Counted')}</th>
                  <th style={{ ...ui.th, textAlign: 'right' }}>{L('Chênh lệch', 'Variance')}</th>
                  <th style={ui.th} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--line)', color: 'var(--ce2e8f0)' }}>
                    <td style={ui.td}>{fmtInTz(r.openedAt, { day: '2-digit', month: '2-digit', hour: 'numeric', minute: '2-digit' })}</td>
                    <td style={ui.td}>{r.closedAt ? fmtInTz(r.closedAt, { day: '2-digit', month: '2-digit', hour: 'numeric', minute: '2-digit' }) : <span style={{ color: 'var(--ink-good)', fontWeight: 600 }}>{L('Đang mở', 'Open')}</span>}</td>
                    <td style={ui.td}>{r.openedByName || '—'}{r.closedByName && r.closedByName !== r.openedByName ? ` → ${r.closedByName}` : ''}</td>
                    <td style={{ ...ui.td, textAlign: 'right' }}>{r.orders ?? '…'}</td>
                    <td style={{ ...ui.td, textAlign: 'right' }}>{r.revenueCents !== null ? fmt(r.revenueCents) : '…'}</td>
                    <td style={{ ...ui.td, textAlign: 'right' }}>{r.expectedCashCents !== null ? fmt(r.expectedCashCents) : '…'}</td>
                    <td style={{ ...ui.td, textAlign: 'right' }}>{r.countedCents !== null ? fmt(r.countedCents) : '—'}</td>
                    <td style={{ ...ui.td, textAlign: 'right', fontWeight: 700, color: varianceColor(r.varianceCents) }}>{varianceText(r.varianceCents)}</td>
                    <td style={{ ...ui.td, textAlign: 'right' }}><button type="button" onClick={() => void show(r.id)} style={{ ...ui.primaryBtn, padding: '6px 12px' }}>{L('Xem', 'View')}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {open && (
        <div onClick={() => setOpen(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.7)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...ui.card, width: 'min(520px, 96vw)', maxHeight: '90vh', overflowY: 'auto', padding: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{open.shift.status === 'CLOSED' ? L('Phiếu chốt ca', 'Hand-over sheet') : L('Ca đang mở', 'Open shift')}</span>
              <button type="button" onClick={() => setOpen(null)} aria-label={L('Đóng', 'Close')} style={{ background: 'none', border: 'none', color: 'var(--c94a3b8)', fontSize: 22, cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <ShiftSheet shift={open.shift} summary={open.summary} vi={vi} fmt={fmt} />
              <button type="button" onClick={() => printSheet(open.shift, open.summary, vi, fmt, salonName)} style={{ ...ui.primaryBtn, padding: '11px 14px', fontSize: 14 }}>{L('In phiếu', 'Print')}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
