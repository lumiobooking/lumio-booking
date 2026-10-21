'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth, useCan } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { useLang } from '../../../lib/i18n';
import { ind } from '../../../lib/ui-industry';
import { dayKeyInTz } from '../../../lib/datetime';
import { EntryDrawer } from '../../../components/finance/EntryDrawer';
import { FinanceOverview } from '../../../components/finance/FinanceOverview';
import { FinanceLedger } from '../../../components/finance/FinanceLedger';
import { FinanceSetup } from '../../../components/finance/FinanceSetup';
import type { Category, EntryInit, FinanceCtx, Fund, Tr } from '../../../components/finance/finance-types';

/**
 * Thu & Chi — the salon's money as a whole.
 *
 *   ?tab=          Tổng quan   profit & loss, money on hand, what still needs a hand
 *   ?tab=ledger    Sổ quỹ      every movement of real money, fund by fund
 *   ?tab=recurring Định kỳ     rent and the like, categories, funds, limits
 *
 * Sales, refunds, drawer money and payroll are read from where they live
 * (apps/api/src/finance) — nothing here is a second copy that could drift.
 */

export default function FinancePage() {
  return <SalonShell><Suspense fallback={null}><Inner /></Suspense></SalonShell>;
}

function Inner() {
  const { token, user } = useAuth();
  const can = useCan();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const L: Tr = (v, e) => ind(vi ? v : e);
  const sp = useSearchParams();
  const tab = sp.get('tab') === 'ledger' ? 'ledger' : sp.get('tab') === 'recurring' ? 'recurring' : 'overview';
  const [funds, setFunds] = useState<Fund[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [currency, setCurrency] = useState('USD');
  const [approvalOverCents, setApproval] = useState(50_000);
  const [version, setVersion] = useState(0);
  const [entry, setEntry] = useState<EntryInit | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const today = dayKeyInTz(new Date());

  const loadBase = useCallback(async () => {
    if (!token) return;
    try {
      const [f, c, s, st] = await Promise.all([
        apiFetch<Fund[]>('/finance/funds', { token }),
        apiFetch<Category[]>('/finance/categories', { token }),
        apiFetch<{ booking?: { currency?: string } }>('/settings', { token }).catch(() => null),
        apiFetch<{ approvalOverCents: number }>('/finance/settings', { token }).catch(() => null),
      ]);
      setFunds(f); setCategories(c);
      if (s?.booking?.currency) setCurrency(s.booking.currency);
      if (st) setApproval(st.approvalOverCents);
      setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : 'error'); }
  }, [token]);
  useEffect(() => { void loadBase(); }, [loadBase, version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const fx: FinanceCtx = {
    token, L, vi, currency, today, funds, categories, approvalOverCents,
    isOwner: user?.role === 'SALON_ADMIN' || user?.role === 'SUPER_ADMIN',
    canSelfApprove: can('pos.void'),
    version, refresh, openEntry: setEntry,
  };

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ fontSize: 22, margin: 0 }}>{L('Thu & Chi', 'Income & expenses')}</h1>
          <p style={{ color: 'var(--c94a3b8)', margin: '4px 0 0', fontSize: 14 }}>
            {tab === 'ledger' ? L('Mọi khoản tiền thật vào / ra, theo từng quỹ. Bán hàng, hoàn tiền, ngăn kéo và lương tự vào sổ.', 'Every movement of real money, fund by fund. Sales, refunds, drawer and payroll come in by themselves.')
              : tab === 'recurring' ? L('Khoản chi lặp lại, loại thu chi, các quỹ và mức duyệt.', 'Costs that come round, categories, funds and limits.')
              : L('Tiệm lời hay lỗ, tiền đang ở đâu, và những khoản còn chờ ghi.', 'Did the salon make money, where the money is, and what still needs recording.')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setEntry({ direction: 'IN' })} style={{ height: 40, padding: '0 14px', borderRadius: 10, border: '1px solid #047857', background: 'transparent', color: 'var(--ink-good)', fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>+ {L('Phiếu thu', 'Money in')}</button>
          <button type="button" onClick={() => setEntry({ direction: 'OUT' })} style={{ height: 40, padding: '0 16px', borderRadius: 10, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>− {L('Phiếu chi', 'Money out')}</button>
        </div>
      </div>
      {err && <div style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--c450a0a)', color: 'var(--ink-bad)', marginBottom: 12, fontSize: 13.5 }}>{err}</div>}

      {tab === 'overview' && <FinanceOverview fx={fx} />}
      {tab === 'ledger' && <FinanceLedger fx={fx} />}
      {tab === 'recurring' && <FinanceSetup fx={fx} />}

      {entry && (
        <EntryDrawer token={token} L={L} currency={currency} today={today} funds={funds} categories={categories} init={entry}
          approvalOverCents={approvalOverCents} canSelfApprove={fx.canSelfApprove}
          onClose={() => setEntry(null)} onSaved={refresh} />
      )}
    </section>
  );
}
