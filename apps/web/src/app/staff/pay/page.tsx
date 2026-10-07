'use client';

// "Thu nhập" — the technician's own pay, line by line.
//
// What a technician asks most is "how much have I made this pay period, and
// how was it worked out?". This shows HER payslip only (GET /my-pay): the
// running estimate of the open period when the owner allows it, every closed
// payslip, and how the number adds up — services, supply fee, commission,
// hourly / guarantee / salary, tips and the card fee on them, bonuses and
// deductions, check / cash. Never a colleague's line, never the salon's totals.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { StaffShell } from '../../../components/StaffShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { formatPrice } from '../../../lib/ui';
import { useLang } from '../../../lib/i18n';
import { L, st } from '../../../components/staff/kit';

interface Adjustment { label: string; cents: number }
interface PayDay { day: string; serviceCents: number; commissionCents: number; guaranteeCents: number; paidCents: number; off: boolean }
interface Slip {
  payType: 'COMMISSION' | 'HOURLY' | 'DAILY_GUARANTEE' | 'SALARY'; commissionPercent: number; productCommissionPercent: number;
  serviceCents: number; productCents: number; serviceCount: number; visits: number; supplyFeeCents: number;
  serviceCommissionCents: number; productCommissionCents: number; hours: number; hourlyRateCents: number; hourlyPayCents: number; hoursSource?: 'SCHEDULE' | 'CLOCK';
  daysWorked: number; dailyGuaranteeCents: number; guaranteeTopUpCents: number; salaryForPeriodCents: number; earningsCents: number;
  tipsCents: number; cardTipsCents: number; cardTipFeeCents: number; tipsNetCents: number;
  adjustments: Adjustment[]; adjustmentsCents: number; netPayCents: number; checkPercent: number; checkCents: number; cashCents: number; days: PayDay[];
}
interface MyPay {
  view: 'LIVE' | 'FINAL' | 'OFF'; period: { from: string; to: string }; today: string; running?: boolean; frozen: boolean;
  slip: Slip | null; history: { from: string; to: string; netPayCents: number }[]; currency: string;
}

export default function StaffPayPage() {
  const { lang } = useLang();
  return <StaffShell title={L(lang === 'vi', 'Thu nhập', 'My pay')}><Inner /></StaffShell>;
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const [sel, setSel] = useState<{ from: string; to: string } | null>(null);
  const [data, setData] = useState<MyPay | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [current, setCurrent] = useState<{ from: string; to: string } | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const q = sel ? `?from=${sel.from}&to=${sel.to}` : '';
      const r = await apiFetch<MyPay>(`/my-pay${q}`, { token });
      setData(r); setErr(null);
      if (!sel) setCurrent(r.period);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }, [token, sel]);
  useEffect(() => { void load(); }, [load]);

  const d = (k: string) => { const [, m, dd] = k.split('-').map(Number); return vi ? `${dd}/${m}` : `${m}/${dd}`; };
  const range = (p: { from: string; to: string }) => `${d(p.from)} – ${d(p.to)}`;
  const cur = data?.currency ?? 'USD';
  const money = (c: number) => formatPrice(c, cur);
  const s = data?.slip ?? null;

  if (err) return <div style={{ ...st.card, color: 'var(--ink-bad)' }}>{err}</div>;
  if (!data) return <div style={{ color: 'var(--c94a3b8)' }}>…</div>;
  if (data.view === 'OFF') {
    return <div style={{ ...st.card, color: 'var(--ccbd5e1)', lineHeight: 1.6 }}>{L(vi, 'Tiệm chưa mở phần xem lương trong app. Hỏi chủ tiệm để xem bảng lương của bạn.', 'Your salon has not opened pay in the app. Ask the owner for your payslip.')}</div>;
  }

  const periods = [...(current ? [{ ...current, netPayCents: null as number | null, open: true }] : []),
    ...data.history.filter((h) => !current || h.from !== current.from).map((h) => ({ ...h, open: false }))];
  const row = (label: string, value: string, sub?: string, tone?: string) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 15, color: 'var(--ce2e8f0)' }}>{label}</div>
        {sub && <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 2 }}>{sub}</div>}
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: tone ?? 'var(--ce2e8f0)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{value}</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
        {periods.map((p) => {
          const on = (sel ?? current)?.from === p.from;
          return (
            <button key={p.from} type="button" onClick={() => setSel(p.open ? null : { from: p.from, to: p.to })} aria-pressed={on}
              style={{ flexShrink: 0, minHeight: 44, padding: '6px 12px', borderRadius: 12, cursor: 'pointer', textAlign: 'left',
                border: on ? '1px solid #4f46e5' : '1px solid var(--line-strong)', background: on ? 'var(--c1e1b4b)' : 'transparent', color: 'var(--ce2e8f0)' }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{range(p)}</div>
              <div style={{ fontSize: 11.5, color: 'var(--c94a3b8)' }}>{p.open ? L(vi, 'Kỳ này', 'This period') : money(p.netPayCents ?? 0)}</div>
            </button>
          );
        })}
      </div>

      {!s ? (
        <div style={{ ...st.card, color: 'var(--ccbd5e1)', lineHeight: 1.6 }}>
          {data.view === 'FINAL' && !data.frozen
            ? L(vi, 'Lương kỳ này sẽ hiện ở đây khi tiệm chốt bảng lương.', 'This period shows here once the salon closes payroll.')
            : L(vi, 'Chưa có số liệu cho kỳ này.', 'Nothing for this period yet.')}
        </div>
      ) : (
        <>
          <div style={st.card}>
            <div style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>
              {data.frozen ? L(vi, 'Thực nhận (đã chốt)', 'Take-home (closed)') : L(vi, 'Thực nhận tạm tính', 'Take-home so far (estimate)')}
            </div>
            <div style={{ fontSize: 34, fontWeight: 800, color: 'var(--ink-good)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{money(s.netPayCents)}</div>
            <div style={{ fontSize: 13, color: 'var(--c94a3b8)', marginTop: 4 }}>
              {L(vi, `Check ${money(s.checkCents)} · Tiền mặt ${money(s.cashCents)}`, `Check ${money(s.checkCents)} · Cash ${money(s.cashCents)}`)}
            </div>
            {!data.frozen && (
              <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 8, lineHeight: 1.5 }}>
                {L(vi, 'Tính theo các bill đã thanh toán tới hôm nay. Chủ tiệm có thể điều chỉnh (giờ làm, ngày nghỉ, thưởng/khấu trừ) trước khi chốt.', 'From bills paid up to today. The owner may adjust hours, days off, bonuses or deductions before closing.')}
              </div>
            )}
          </div>

          <div style={st.card}>
            <div style={{ ...st.label, marginBottom: 4 }}>{L(vi, 'Cách tính', 'How it adds up')}</div>
            {row(L(vi, 'Doanh thu dịch vụ của bạn', 'Your service sales'), money(s.serviceCents), L(vi, `${s.serviceCount} dịch vụ · ${s.visits} lượt khách`, `${s.serviceCount} services · ${s.visits} visits`))}
            {s.supplyFeeCents > 0 && row(L(vi, 'Phí nguyên liệu', 'Supply fee'), `− ${money(s.supplyFeeCents)}`)}
            {(s.serviceCommissionCents > 0 || s.commissionPercent > 0) && row(L(vi, `Hoa hồng dịch vụ (${s.commissionPercent}%)`, `Service commission (${s.commissionPercent}%)`), money(s.serviceCommissionCents))}
            {s.productCommissionCents > 0 && row(L(vi, `Hoa hồng bán lẻ (${s.productCommissionPercent}%)`, `Retail commission (${s.productCommissionPercent}%)`), money(s.productCommissionCents), L(vi, `Bán lẻ ${money(s.productCents)}`, `Retail ${money(s.productCents)}`))}
            {s.hourlyPayCents > 0 && row(L(vi, 'Lương giờ', 'Hourly pay'), money(s.hourlyPayCents), `${s.hours} × ${money(s.hourlyRateCents)}${s.hoursSource === 'CLOCK' ? L(vi, ' · theo chấm công', ' · from the time clock') : ''}`)}
            {s.guaranteeTopUpCents > 0 && row(L(vi, 'Bù lương tối thiểu ngày', 'Daily guarantee top-up'), money(s.guaranteeTopUpCents), L(vi, `${s.daysWorked} ngày làm · bảo đảm ${money(s.dailyGuaranteeCents)}/ngày`, `${s.daysWorked} days · ${money(s.dailyGuaranteeCents)}/day guaranteed`))}
            {s.salaryForPeriodCents > 0 && row(L(vi, 'Lương cố định kỳ này', 'Base salary this period'), money(s.salaryForPeriodCents))}
            {row(L(vi, 'Tip', 'Tips'), money(s.tipsCents), s.cardTipsCents ? L(vi, `trong đó quẹt thẻ ${money(s.cardTipsCents)}`, `card ${money(s.cardTipsCents)}`) : undefined)}
            {s.cardTipFeeCents > 0 && row(L(vi, 'Phí quẹt thẻ trên tip', 'Card fee on tips'), `− ${money(s.cardTipFeeCents)}`)}
            {s.adjustments.map((a, i) => <div key={i}>{row(a.label || (a.cents >= 0 ? L(vi, 'Thưởng', 'Bonus') : L(vi, 'Khấu trừ', 'Deduction')), `${a.cents >= 0 ? '+' : '−'} ${money(Math.abs(a.cents))}`, undefined, a.cents >= 0 ? 'var(--ink-good)' : 'var(--ink-bad)')}</div>)}
            {row(L(vi, 'Thực nhận', 'Take-home'), money(s.netPayCents), undefined, 'var(--ink-good)')}
          </div>

          {s.days.length > 0 && (
            <div style={st.card}>
              <div style={{ ...st.label, marginBottom: 6 }}>{L(vi, 'Theo ngày', 'By day')}</div>
              {s.days.filter((x) => x.serviceCents > 0 || x.paidCents > 0 || x.off).map((x) => (
                <div key={x.day} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--line)', fontSize: 14 }}>
                  <span style={{ width: 60, color: 'var(--c94a3b8)' }}>{d(x.day)}</span>
                  <span style={{ flex: 1, color: 'var(--ccbd5e1)' }}>{x.off ? L(vi, 'Nghỉ', 'Off') : money(x.serviceCents)}</span>
                  <span style={{ fontWeight: 700, color: 'var(--ce2e8f0)', fontVariantNumeric: 'tabular-nums' }}>{money(x.paidCents)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <Link href="/staff/pay/year" style={{ ...st.card, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{L(vi, 'Bảng thu nhập cả năm', 'Year earnings statement')}</div>
          <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{L(vi, 'Tổng các kỳ đã chốt · in hoặc lưu PDF cho khai thuế', 'All closed periods · print or save as PDF for your taxes')}</div>
        </div>
        <span style={{ color: 'var(--c94a3b8)', fontSize: 18 }}>›</span>
      </Link>
    </div>
  );
}
