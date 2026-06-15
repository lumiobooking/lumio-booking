import type { CSSProperties } from 'react';

// Shared style tokens for the dashboard pages.
export const ui = {
  card: {
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 12,
    padding: 20,
  } as CSSProperties,
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '9px 11px',
    borderRadius: 8,
    border: '1px solid #475569',
    background: '#0f172a',
    color: '#e2e8f0',
    fontSize: 14,
    colorScheme: 'dark',
  } as CSSProperties,
  primaryBtn: {
    padding: '9px 14px',
    borderRadius: 8,
    border: 'none',
    background: '#6366f1',
    color: 'white',
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
  } as CSSProperties,
  dangerBtn: {
    padding: '6px 12px',
    borderRadius: 8,
    border: '1px solid #ef4444',
    background: 'transparent',
    color: '#ef4444',
    fontSize: 13,
    cursor: 'pointer',
  } as CSSProperties,
  th: { padding: '12px 14px', fontWeight: 600, color: '#cbd5e1', textAlign: 'left' } as CSSProperties,
  td: { padding: '12px 14px' } as CSSProperties,
  banner: {
    background: '#7f1d1d',
    color: '#fecaca',
    padding: '8px 12px',
    borderRadius: 8,
    fontSize: 13,
    margin: '12px 0',
  } as CSSProperties,
  label: { display: 'block', fontSize: 12, color: '#cbd5e1', marginBottom: 6 } as CSSProperties,
};

export function formatPrice(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }