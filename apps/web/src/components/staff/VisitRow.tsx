'use client';

// One visit of the technician's that is not a booking: a walk-in she served,
// or a sale the till credited to her (GET /my-chair/visits). Drawn exactly
// like a booking row of her schedule — time on the left, a card on the right
// — so her day reads as one list. Her lines and her money only.

import { fmtInTz } from '../../lib/datetime';
import { formatPrice } from '../../lib/ui';
import { L, Pill, st } from './kit';

export interface StaffVisit {
  id: string;
  kind: 'walkin' | 'sale';
  at: string;
  customer: string | null;
  services: string[];
  cents: number;
  tipsCents: number;
  status: 'waiting' | 'serving' | 'to_pay' | 'paid';
  /** The salon's currency (the same on every row). */
  currency?: string;
}

export function visitStatus(v: StaffVisit, vi: boolean): { text: string; tone: 'good' | 'warn' | 'info' | 'mute' | 'bad' | 'sky' } {
  switch (v.status) {
    case 'serving': return { text: L(vi, 'Đang làm', 'Working'), tone: 'info' };
    case 'waiting': return { text: L(vi, 'Đang chờ', 'Waiting'), tone: 'warn' };
    case 'to_pay': return { text: L(vi, 'Chờ thanh toán', 'To pay'), tone: 'sky' };
    default: return { text: L(vi, 'Đã thanh toán', 'Paid'), tone: 'good' };
  }
}

export function VisitRow({ v, vi }: { v: StaffVisit; vi: boolean }) {
  const currency = v.currency || 'USD';
  const s = visitStatus(v, vi);
  const who = v.customer?.trim() || (v.kind === 'walkin' ? 'Walk-in' : L(vi, 'Khách tại quầy', 'Counter sale'));
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <div style={{ width: 54, flexShrink: 0, paddingTop: 14, textAlign: 'right' }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ce2e8f0)' }}>{fmtInTz(v.at, { hour: 'numeric', minute: '2-digit' })}</div>
        <div style={{ fontSize: 11, color: 'var(--c94a3b8)', marginTop: 2 }}>{v.kind === 'walkin' ? 'Walk-in' : 'POS'}</div>
      </div>
      <div style={{ ...st.card, flex: 1, minWidth: 0, padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 700, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--ce2e8f0)' }}>{who}</span>
          <Pill text={s.text} tone={s.tone} />
        </div>
        <div style={{ fontSize: 14, color: 'var(--ccbd5e1)', marginTop: 3 }}>
          {v.services.length ? v.services.join(' · ') : L(vi, 'Chưa ghi dịch vụ', 'No service recorded yet')}
        </div>
        {(v.cents > 0 || v.tipsCents > 0) && (
          <div style={{ fontSize: 13, color: 'var(--c94a3b8)', marginTop: 4 }}>
            {formatPrice(v.cents, currency)}
            {v.tipsCents > 0 && <span style={{ color: 'var(--ink-good)', fontWeight: 700 }}> · Tip {formatPrice(v.tipsCents, currency)}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
