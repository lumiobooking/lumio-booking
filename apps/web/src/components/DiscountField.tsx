'use client';

/**
 * Giá gạch & giảm giá (19/11/2026) — one field for services, products and
 * dishes: no sale / a percent off / an amount off, with the result shown the
 * way the customer will see it (old price struck through, new price, badge).
 */
import type { CSSProperties } from 'react';
import { badgeText, pctOf, salePrice, type DiscountKind } from '../lib/discount';

export function DiscountField({ kind, value, priceCents, toCents, money, vi, onChange, inputStyle, labelStyle }: {
  kind: DiscountKind; value: string; priceCents: number;
  toCents: (s: string) => number; money: (cents: number) => string; vi: boolean;
  onChange: (kind: DiscountKind, value: string) => void;
  inputStyle?: CSSProperties; labelStyle?: CSSProperties;
}) {
  const L = (v: string, e: string) => (vi ? v : e);
  const row = kind === 'percent' ? { priceCents, discountPercent: pctOf(parseInt(value, 10) || 0) }
    : kind === 'amount' ? { priceCents, discountCents: Math.max(0, toCents(value || '0') || 0) }
      : { priceCents };
  const sale = salePrice(row);
  const badge = badgeText(row, money);
  const tooMuch = kind === 'amount' && priceCents > 0 && (toCents(value || '0') || 0) >= priceCents;
  const seg = (k: DiscountKind, label: string) => (
    <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => onChange(k, k === kind ? value : '')}
      style={{ flex: '1 1 auto', minHeight: 36, padding: '0 10px', border: 0, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
        background: kind === k ? '#4f46e5' : 'transparent', color: kind === k ? '#fff' : 'var(--ce2e8f0)' }}>{label}</button>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, gridColumn: '1 / -1' }}>
      <span style={labelStyle}>{L('Giảm giá (giá gạch)', 'Sale (struck-through price)')}</span>
      <div role="radiogroup" aria-label={L('Kiểu giảm giá', 'Kind of sale')} style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 10, border: '1px solid var(--line-strong)', flexWrap: 'wrap' }}>
        {seg('none', L('Không giảm', 'No sale'))}
        {seg('percent', L('Giảm %', 'Percent off'))}
        {seg('amount', L('Giảm số tiền', 'Amount off'))}
      </div>
      {kind !== 'none' && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 1 200px' }}>
            <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{kind === 'percent' ? L('Phần trăm giảm', 'Percent off') : L('Số tiền giảm', 'Amount off')}</span>
            <input type="number" min={0} max={kind === 'percent' ? 90 : undefined} step={kind === 'percent' ? 1 : 'any'} value={value} onChange={(e) => onChange(kind, e.target.value)}
              placeholder={kind === 'percent' ? '20' : '50000'} style={{ ...inputStyle, width: '100%' }} />
            <b style={{ color: 'var(--c94a3b8)' }}>{kind === 'percent' ? '%' : ''}</b>
          </label>
          {priceCents > 0 && badge && (
            <span style={{ fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <s style={{ color: 'var(--c94a3b8)' }}>{money(priceCents)}</s>
              <b style={{ color: 'var(--ink-good)' }}>{money(sale)}</b>
              <span style={{ background: '#ef4444', color: '#fff', borderRadius: 6, padding: '1px 7px', fontSize: 12, fontWeight: 700 }}>{badge}</span>
            </span>
          )}
        </div>
      )}
      {kind === 'percent' && (parseInt(value, 10) || 0) > 90 && <span style={{ fontSize: 12, color: 'var(--ink-warn)' }}>{L('Tối đa giảm 90%.', 'At most 90% off.')}</span>}
      {tooMuch && <span style={{ fontSize: 12, color: 'var(--ink-warn)' }}>{L('Số tiền giảm không được bằng hoặc lớn hơn giá.', 'The amount off must be less than the price.')}</span>}
    </div>
  );
}

/** A price as the customer sees it: struck-through old price, sale price, badge — or just the price. */
export function SalePriceText({ priceCents, discountPercent, discountCents, money, compact }: {
  priceCents: number; discountPercent?: number | null; discountCents?: number | null; money: (cents: number) => string; compact?: boolean;
}) {
  const row = { priceCents, discountPercent, discountCents };
  const badge = badgeText(row, money);
  if (!badge) return <>{money(priceCents)}</>;
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      <span style={{ textDecoration: 'line-through', color: 'var(--c94a3b8)', marginRight: 6 }}>{money(priceCents)}</span>
      <span style={{ color: 'var(--ink-good)', fontWeight: 600 }}>{money(salePrice(row))}</span>
      {!compact && <span style={{ marginLeft: 6, background: '#ef4444', color: '#fff', borderRadius: 6, padding: '1px 6px', fontSize: 11, fontWeight: 600 }}>{badge}</span>}
    </span>
  );
}
