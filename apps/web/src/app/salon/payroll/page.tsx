'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SalonShell } from '../../../components/SalonShell';
import { useLang, tr } from '../../../lib/i18n';
import { PayrollRun } from './PayrollRun';
import { TimeClockTab } from './TimeClockTab';
import { NavIcon } from '../../../components/NavIcon';

interface Row {
  staffId: string; name: string; commissionPercent: number; serviceCount: number;
  serviceRevenueCents: number; productRevenueCents: number; tipsCents: number; commissionCents: number; baseCents: number; totalPayCents: number;
  directTipsCents?: number;
}
interface Report {
  totals: { revenueCents: number; tipsCents: number; commissionCents: number; baseCents: number; payCents: number; orders: number; directTipsCents?: number };
  byMethod?: { cashCents: number; cardCents: number; otherCents: number; giftCardCents: number };
  staff: Row[];
}

export default function PayrollPage() {
  return <SalonShell><Hub /></SalonShell>;
}

type PayTab = 'payroll' | 'clock';

/** Pay: the payroll run and the time clock. How each tech is performing lives
 *  in Reports › By technician (one number, one place) — linked from here. */
function Hub() {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  // The tab is remembered per device: an owner who runs payroll every Monday
  // lands on it, one who checks performance lands there.
  const [tab, setTabState] = useState<PayTab>('payroll');
  useEffect(() => {
    try { const v = window.localStorage.getItem('lumio_pay_tab'); if (v === 'payroll' || v === 'clock') setTabState(v); } catch { /* ignore */ }
  }, []);
  const setTab = (v: PayTab) => { setTabState(v); try { window.localStorage.setItem('lumio_pay_tab', v); } catch { /* ignore */ } };
  const tabBtn = (id: PayTab, label: string, icon: string) => (
    <button role="tab" aria-selected={tab === id} onClick={() => setTab(id)} style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: '9px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600,
      background: tab === id ? '#4f46e5' : 'transparent', color: tab === id ? '#fff' : 'var(--ccbd5e1)',
    }}><NavIcon name={icon} size={16} />{label}</button>
  );
  return (
    <section>
      <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>{t('pf.hubTitle')}</h1>
      <p style={{ color: 'var(--c94a3b8)', margin: '0 0 16px', fontSize: 14 }}>{t('pf.hubSub')}</p>
      <div role="tablist" style={{ display: 'inline-flex', gap: 4, padding: 4, marginBottom: 18, borderRadius: 12, background: 'var(--c111827)', border: '1px solid var(--line)' }}>
        {tabBtn('payroll', t('pf.tabPayroll'), 'banknote')}
        {tabBtn('clock', lang === 'vi' ? 'Chấm công' : 'Time clock', 'clock')}
      </div>
      <Link href="/salon/pos/report" style={{ marginLeft: 10, padding: '8px 14px', borderRadius: 10, border: '1px solid var(--line)', color: 'var(--ccbd5e1)', fontSize: 13, fontWeight: 600, textDecoration: 'none', display: 'inline-block' }}>
        📊 {lang === 'vi' ? 'Hiệu suất thợ → Báo cáo' : 'Technician performance → Reports'}
      </Link>
      {tab === 'clock' ? <TimeClockTab vi={lang === 'vi'} /> : <PayrollRun vi={lang === 'vi'} />}
    </section>
  );
}
