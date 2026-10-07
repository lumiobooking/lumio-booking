'use client';

// "Thu nhập cả năm" — the statement a technician prints for her taxes.
//
// Her closed payslips of one year added up (GET /my-pay/year): sales,
// commission / hourly / guarantee / salary, tips and the card fee on them,
// bonuses and deductions, net pay, check and cash — then every pay period
// on its own line. "In / Lưu PDF" prints just the paper; on an iPhone the
// print sheet offers "Save to Files" as a PDF. Her line only, never the
// salon's totals.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { StaffShell } from '../../../../components/StaffShell';
import { useAuth } from '../../../../lib/auth';
import { apiFetch } from '../../../../lib/api';
import { formatPrice } from '../../../../lib/ui';
import { useLang } from '../../../../lib/i18n';
import { L, st } from '../../../../components/staff/kit';

interface Totals {
  periods: number; visits: number;
  serviceCents: number; productCents: number; supplyFeeCents: number; serviceCommissionCents: number; productCommissionCents: number;
  hourlyPayCents: number; guaranteeTopUpCents: number; salaryForPeriodCents: number; earningsCents: number;
  tipsCents: number; cardTipFeeCents: number; tipsNetCents: number; adjustmentsCents: number; netPayCents: number; checkCents: number; cashCents: number;
}
interface Row extends Totals { from: string; to: string }
interface Year { view: 'LIVE' | 'FINAL' | 'OFF'; year: number | null; years: number[]; name: string; salon: string; currency: string; rows: Row[]; totals: Totals | null; generatedAt?: string }

const PAPER = { background: '#ffffff', color: '#111111' } as const;

export default function StaffYearPage() {
  const { lang } = useLang();
  return <StaffShell title={L(lang === 'vi', 'Thu nhập cả năm', 'Year statement')}><Inner /></StaffShell>;
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const [year, setYear] = useState<number | null>(null);
  const [data, setData] = useState<Year | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try { const r = await apiFetch<Year>(`/my-pay/year${year ? `?year=${year}` : ''}`, { token }); setData(r); setErr(null); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }, [token, year]);
  useEffect(() => { void load(); }, [load]);

  if (err) return <div style={{ ...st.card, color: 'var(--ink-bad)' }}>{err}</div>;
  if (!data) return <div style={{ color: 'var(--c94a3b8)' }}>…</div>;
  if (data.view === 'OFF' || !data.totals) {
    return <div style={{ ...st.card, color: 'var(--ccbd5e1)', lineHeight: 1.6 }}>{L(vi, 'Tiệm chưa mở phần xem lương trong app. Hỏi chủ tiệm để lấy bảng thu nhập của bạn.', 'Your salon has not opened pay in the app. Ask the owner for your statement.')}</div>;
  }
  const t = data.totals;
  const cur = data.currency;
  const money = (c: number) => formatPrice(c, cur);
  const d = (k: string) => { const [, m, dd] = k.split('-').map(Number); return vi ? `${dd}/${m}` : `${m}/${dd}`; };
  const commission = t.serviceCommissionCents + t.productCommissionCents;
  const line = (label: string, value: string, opts: { strong?: boolean; minus?: boolean; muted?: boolean } = {}) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px solid #e5e7eb', fontSize: opts.strong ? 16 : 14, fontWeight: opts.strong ? 800 : 500, color: opts.muted ? '#6b7280' : '#111111' }}>
      <span>{label}</span><span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{opts.minus ? '− ' : ''}{value}</span>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <style>{`@media print { body * { visibility: hidden !important; } #year-statement, #year-statement * { visibility: visible !important; } #year-statement { position: absolute; left: 0; top: 0; width: 100%; margin: 0; border: none; border-radius: 0; } }`}</style>

      <div className="no-print" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {(data.years.length ? data.years : [data.year!]).map((y) => (
          <button key={y} type="button" aria-pressed={y === data.year} onClick={() => setYear(y)}
            style={{ ...st.ghost, height: 44, borderColor: y === data.year ? '#4f46e5' : 'var(--line-strong)', background: y === data.year ? '#4f46e5' : 'transparent', color: y === data.year ? '#fff' : 'var(--ce2e8f0)' }}>{y}</button>
        ))}
        <button type="button" onClick={() => window.print()} style={{ ...st.primary, marginLeft: 'auto', height: 44 }}>{L(vi, 'In / Lưu PDF', 'Print / Save PDF')}</button>
      </div>
      <div className="no-print" style={{ fontSize: 13, color: 'var(--c94a3b8)', lineHeight: 1.5, margin: '-4px 2px 0' }}>
        {L(vi, 'Chỉ gồm các kỳ lương chủ tiệm đã chốt. Trên iPhone: bấm In, rồi chọn "Lưu vào Tệp" để có file PDF.', 'Closed pay periods only. On an iPhone: tap Print, then "Save to Files" for a PDF.')}
      </div>

      {/* the paper */}
      <div id="year-statement" style={{ ...PAPER, borderRadius: 16, padding: 20, border: '1px solid #e5e7eb' }}>
        <div style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6b7280', fontWeight: 700 }}>{data.salon}</div>
        <div style={{ fontSize: 22, fontWeight: 800, marginTop: 2 }}>{L(vi, `Bảng thu nhập năm ${data.year}`, `${data.year} earnings statement`)}</div>
        <div style={{ fontSize: 14, color: '#374151', marginTop: 2 }}>{data.name} · {L(vi, `${t.periods} kỳ lương đã chốt`, `${t.periods} closed pay periods`)}{t.visits ? ` · ${t.visits} ${L(vi, 'lượt khách', 'visits')}` : ''}</div>

        <div style={{ marginTop: 16 }}>
          {line(L(vi, 'Doanh thu dịch vụ', 'Service sales'), money(t.serviceCents), { muted: true })}
          {t.productCents > 0 && line(L(vi, 'Doanh thu sản phẩm', 'Retail sales'), money(t.productCents), { muted: true })}
          {t.supplyFeeCents > 0 && line(L(vi, 'Trừ phí nguyên liệu', 'Supply fee'), money(t.supplyFeeCents), { minus: true, muted: true })}
          {commission !== 0 && line(L(vi, 'Hoa hồng', 'Commission'), money(commission))}
          {t.hourlyPayCents > 0 && line(L(vi, 'Lương giờ', 'Hourly pay'), money(t.hourlyPayCents))}
          {t.guaranteeTopUpCents > 0 && line(L(vi, 'Bù lương tối thiểu ngày', 'Daily guarantee top-up'), money(t.guaranteeTopUpCents))}
          {t.salaryForPeriodCents > 0 && line(L(vi, 'Lương cố định', 'Salary'), money(t.salaryForPeriodCents))}
          {line(L(vi, 'Lương / hoa hồng', 'Earnings'), money(t.earningsCents), { strong: true })}
          {line(L(vi, 'Tip', 'Tips'), money(t.tipsCents))}
          {t.cardTipFeeCents > 0 && line(L(vi, 'Trừ phí thẻ trên tip', 'Card fee on tips'), money(t.cardTipFeeCents), { minus: true })}
          {t.adjustmentsCents !== 0 && line(L(vi, 'Thưởng / khấu trừ', 'Bonuses / deductions'), money(Math.abs(t.adjustmentsCents)), { minus: t.adjustmentsCents < 0 })}
          {line(L(vi, 'TỔNG THỰC NHẬN', 'TOTAL NET PAY'), money(t.netPayCents), { strong: true })}
          {line(L(vi, 'Trong đó: check', 'Of which: check'), money(t.checkCents), { muted: true })}
          {line(L(vi, 'Trong đó: tiền mặt', 'Of which: cash'), money(t.cashCents), { muted: true })}
        </div>

        <div style={{ fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#6b7280', fontWeight: 700, marginTop: 18 }}>{L(vi, 'Từng kỳ lương', 'By pay period')}</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6, fontSize: 13 }}>
          <thead>
            <tr style={{ color: '#6b7280' }}>
              <th style={{ textAlign: 'left', padding: '4px 0', fontWeight: 600 }}>{L(vi, 'Kỳ', 'Period')}</th>
              <th style={{ textAlign: 'right', padding: '4px 0', fontWeight: 600 }}>{L(vi, 'Lương/HH', 'Earnings')}</th>
              <th style={{ textAlign: 'right', padding: '4px 0', fontWeight: 600 }}>Tip</th>
              <th style={{ textAlign: 'right', padding: '4px 0', fontWeight: 600 }}>{L(vi, 'Thực nhận', 'Net')}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.from} style={{ borderTop: '1px solid #e5e7eb' }}>
                <td style={{ padding: '5px 0', whiteSpace: 'nowrap' }}>{d(r.from)} – {d(r.to)}</td>
                <td style={{ padding: '5px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(r.earningsCents)}</td>
                <td style={{ padding: '5px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(r.tipsNetCents)}</td>
                <td style={{ padding: '5px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{money(r.netPayCents)}</td>
              </tr>
            ))}
            {data.rows.length === 0 && <tr><td colSpan={4} style={{ padding: '8px 0', color: '#6b7280' }}>{L(vi, 'Chưa có kỳ lương nào được chốt trong năm này.', 'No closed pay period in this year yet.')}</td></tr>}
          </tbody>
        </table>
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 16, lineHeight: 1.5 }}>
          {L(vi, 'Bảng này tổng hợp các phiếu lương đã chốt trong hệ thống của tiệm; không phải tờ khai thuế. Lập ngày', 'A summary of closed payslips in the salon’s system, not a tax form. Generated')} {new Date(data.generatedAt ?? Date.now()).toLocaleDateString(vi ? 'vi-VN' : 'en-US')}.
        </div>
      </div>

      <Link href="/staff/pay" className="no-print" style={{ color: 'var(--ink-link)', fontSize: 14, fontWeight: 700, textDecoration: 'none', padding: '8px 2px' }}>{L(vi, '← Thu nhập kỳ này', '← This period')}</Link>
    </div>
  );
}
