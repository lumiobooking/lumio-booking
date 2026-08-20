'use client';

/**
 * Which system am I looking at right now.
 *
 * The two markets are separate servers with separate databases, so a salon in
 * one can never see the other — that isolation needs no switch and no setting.
 * The risk that remains is not the customers' at all; it is ours. Two dashboards
 * that look identical, two tabs open, and an evening spent editing prices in the
 * wrong one. That has already happened once in this project with two tenants
 * that merely had similar names.
 *
 * So this is not a control. There is nothing to choose here: it says where you
 * are, in a colour you cannot mistake.
 *
 * It now reads the region at RUNTIME, because lumiobooking.com serves both
 * markets from one build and the answer is therefore a fact about the visitor,
 * not about the build. On a single-market deployment it falls back to
 * NEXT_PUBLIC_MARKET and behaves exactly as it did before — which is to say,
 * invisible on the US site.
 */
import { useEffect, useState } from 'react';
import { activeRegion } from '../lib/region';

const MARKETS: Record<string, { label: string; fg: string; bg: string; border: string }> = {
  VN: { label: '🇻🇳 VIỆT NAM', fg: '#fca5a5', bg: 'rgba(153,27,27,0.28)', border: '#b91c1c' },
  US: { label: '🇺🇸 US / CA', fg: '#93c5fd', bg: 'rgba(30,58,138,0.28)', border: '#1d4ed8' },
};

/** Build-time market, for deployments that serve exactly one. */
export function marketCode(): string {
  return (process.env.NEXT_PUBLIC_MARKET || '').trim().toUpperCase();
}

export default function MarketBadge({ compact = false }: { compact?: boolean }) {
  // Empty during the server render and the first paint, then filled in: the
  // chosen region lives in localStorage, which does not exist on the server.
  // Rendering nothing first is correct rather than merely convenient — it keeps
  // the markup identical on both sides and avoids a hydration mismatch.
  const [code, setCode] = useState('');
  useEffect(() => setCode(activeRegion() || marketCode()), []);

  // No badge on the plain US deployment: adding a label there would be a
  // visible change to a system that is meant to stay untouched.
  if (!code || code === 'US') return null;

  const m = MARKETS[code] ?? { label: code, fg: '#fbbf24', bg: 'rgba(120,53,15,0.28)', border: '#b45309' };
  return (
    <span
      title="Hệ thống riêng của thị trường này — dữ liệu tách hoàn toàn khỏi thị trường khác"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
        padding: compact ? '2px 8px' : '4px 11px',
        borderRadius: 999, border: `1px solid ${m.border}`, background: m.bg, color: m.fg,
        fontSize: compact ? 10.5 : 11.5, fontWeight: 800, letterSpacing: 0.4, whiteSpace: 'nowrap',
      }}
    >
      {m.label}
    </span>
  );
}
