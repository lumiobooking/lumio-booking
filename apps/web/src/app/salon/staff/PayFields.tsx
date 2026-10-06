'use client';

import type { CSSProperties } from 'react';
import { ui } from '../../../lib/ui';
import { formatPrice, fromMinorUnits, priceInputStep, toMinorUnits } from '../../../lib/money';
import { uiCurrency } from '../../../lib/ui-currency';
import { NavIcon } from '../../../components/NavIcon';
import { ind } from '../../../lib/ui-industry';

/**
 * HOW THIS PERSON IS PAID — the pay part of the staff form.
 *
 * Four ways salons pay, one card each; only the fields the chosen way needs
 * are shown, and a plain sentence underneath works an example through with
 * the numbers typed, so the owner sees what the tech will take home before
 * saving (the same rules payroll applies — payroll/pay-calc.ts).
 */

export type PayType = 'COMMISSION' | 'HOURLY' | 'DAILY_GUARANTEE' | 'SALARY';
export type SalaryPeriod = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';

export interface PayForm {
  payType: PayType;
  commissionPercent: string;
  productCommissionPercent: string;
  hourlyRate: string;
  dailyGuarantee: string;
  salary: string;
  salaryPeriod: SalaryPeriod;
  /** '' = follow the salon's default */
  checkPercent: string;
}

export interface PayMember {
  payType?: string | null;
  commissionPercent?: number | null;
  productCommissionPercent?: number | null;
  hourlyRateCents?: number | null;
  dailyGuaranteeCents?: number | null;
  baseCents?: number | null;
  salaryPeriod?: string | null;
  checkPercent?: number | null;
}

const TYPES: PayType[] = ['COMMISSION', 'HOURLY', 'DAILY_GUARANTEE', 'SALARY'];

export function payFormFrom(m: PayMember | null | undefined): PayForm {
  const cur = uiCurrency();
  const t = TYPES.includes(m?.payType as PayType) ? (m!.payType as PayType) : ((m?.baseCents ?? 0) > 0 ? 'SALARY' : 'COMMISSION');
  const money = (c?: number | null) => (c ? fromMinorUnits(c, cur) : '');
  return {
    payType: t,
    commissionPercent: String(m?.commissionPercent ?? (t === 'COMMISSION' || t === 'DAILY_GUARANTEE' ? 60 : 0)),
    productCommissionPercent: String(m?.productCommissionPercent ?? 0),
    hourlyRate: money(m?.hourlyRateCents),
    dailyGuarantee: money(m?.dailyGuaranteeCents),
    salary: money(m?.baseCents),
    salaryPeriod: (['WEEKLY', 'BIWEEKLY', 'MONTHLY'].includes(String(m?.salaryPeriod)) ? m!.salaryPeriod : 'MONTHLY') as SalaryPeriod,
    checkPercent: m?.checkPercent == null ? '' : String(m.checkPercent),
  };
}

const int = (v: string, max = 100) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));

/** The body the staff endpoints take. Fields that do not apply to the chosen way are zeroed, so nothing stale is paid. */
export function payBody(f: PayForm) {
  const cur = uiCurrency();
  const minor = (v: string) => Math.max(0, toMinorUnits(v || '0', cur) || 0);
  return {
    payType: f.payType,
    commissionPercent: int(f.commissionPercent),
    productCommissionPercent: int(f.productCommissionPercent),
    hourlyRateCents: f.payType === 'HOURLY' ? minor(f.hourlyRate) : 0,
    dailyGuaranteeCents: f.payType === 'DAILY_GUARANTEE' ? minor(f.dailyGuarantee) : 0,
    baseCents: f.payType === 'SALARY' ? minor(f.salary) : 0,
    salaryPeriod: f.salaryPeriod,
    checkPercent: f.checkPercent === '' ? null : int(f.checkPercent),
  };
}

export function payTypeLabel(t: string | null | undefined, vi: boolean): string {
  switch (t) {
    case 'HOURLY': return vi ? 'Theo giờ' : 'Hourly';
    case 'DAILY_GUARANTEE': return vi ? 'Bao lương ngày' : 'Daily guarantee';
    case 'SALARY': return vi ? 'Lương cố định' : 'Salary';
    default: return vi ? 'Hoa hồng' : 'Commission';
  }
}

/** One short line for the staff list: "Hoa hồng 60%", "$15/giờ + 10%"… */
export function paySummary(m: PayMember, vi: boolean): string {
  const f = payFormFrom(m);
  const cur = uiCurrency();
  const money = (c?: number | null) => formatPrice(c ?? 0, cur).replace(/[.,]00(?=\D*$)/, '');
  const plus = Number(f.commissionPercent) > 0 ? ` + ${f.commissionPercent}%` : '';
  switch (f.payType) {
    case 'HOURLY': return `${money(m.hourlyRateCents)}/${vi ? 'giờ' : 'h'}${plus}`;
    case 'DAILY_GUARANTEE': return `${vi ? 'Bao' : 'Min'} ${money(m.dailyGuaranteeCents)}/${vi ? 'ngày' : 'day'} · ${f.commissionPercent}%`;
    case 'SALARY': return `${money(m.baseCents)}/${f.salaryPeriod === 'WEEKLY' ? (vi ? 'tuần' : 'wk') : f.salaryPeriod === 'BIWEEKLY' ? (vi ? '2 tuần' : '2 wk') : (vi ? 'tháng' : 'mo')}${plus}`;
    default: return `${vi ? 'Hoa hồng' : 'Commission'} ${f.commissionPercent}%`;
  }
}

export function PayFields({ value, onChange, vi, defaultCheckPercent }: {
  value: PayForm;
  onChange: (next: PayForm) => void;
  vi: boolean;
  /** The salon's default check share, shown when the tech follows it. */
  defaultCheckPercent?: number;
}) {
  const L = (v: string, e: string) => ind(vi ? v : e);
  const cur = uiCurrency();
  const step = priceInputStep(cur);
  const set = (patch: Partial<PayForm>) => onChange({ ...value, ...patch });
  // Moving between "% is the pay" (commission, guarantee) and "% is extra"
  // (hourly, salary) resets the % to that way's usual starting point, so a
  // 60% commission does not silently ride along onto an hourly wage.
  const switchTo = (t: PayType) => {
    if (t === value.payType) return;
    const pctIsPay = (x: PayType) => x === 'COMMISSION' || x === 'DAILY_GUARANTEE';
    let commissionPercent = value.commissionPercent;
    if (pctIsPay(value.payType) && !pctIsPay(t)) commissionPercent = '0';
    else if (!pctIsPay(value.payType) && pctIsPay(t) && !(Number(commissionPercent) > 0)) commissionPercent = '60';
    set({ payType: t, commissionPercent });
  };
  const f = value;

  const cards: { t: PayType; title: string; sub: string; icon: string }[] = [
    { t: 'COMMISSION', title: L('Hoa hồng', 'Commission'), sub: L('% doanh thu dịch vụ thợ làm', '% of the services they do'), icon: 'pie' },
    { t: 'HOURLY', title: L('Theo giờ', 'Hourly'), sub: L('Lương giờ × số giờ làm', 'Rate × hours worked'), icon: 'clock' },
    { t: 'DAILY_GUARANTEE', title: L('Bao lương ngày', 'Daily guarantee'), sub: L('Đảm bảo tối thiểu mỗi ngày đi làm', 'A minimum for every day worked'), icon: 'calendarCheck' },
    { t: 'SALARY', title: L('Lương cố định', 'Salary'), sub: L('Theo tuần, 2 tuần hoặc tháng', 'Weekly, two-weekly or monthly'), icon: 'banknote' },
  ];

  const field = (label: string, hint: string | null, input: React.ReactNode) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ccbd5e1)' }}>{label}</span>
      {input}
      {hint && <span style={{ fontSize: 11.5, color: 'var(--c94a3b8)', lineHeight: 1.35 }}>{hint}</span>}
    </label>
  );
  const unitInput = (val: string, on: (v: string) => void, unit: string, opts: { pre?: boolean; step?: string; max?: number } = {}) => (
    <span style={{ position: 'relative', display: 'block' }}>
      {opts.pre && <span style={unitPre}>{unit}</span>}
      <input type="number" inputMode="decimal" min={0} max={opts.max} step={opts.step ?? '1'} value={val} onChange={(e) => on(e.target.value)}
        style={{ ...ui.input, width: '100%', boxSizing: 'border-box', paddingLeft: opts.pre ? 30 : 12, paddingRight: opts.pre ? 12 : 34 }} />
      {!opts.pre && <span style={unitPost}>{unit}</span>}
    </span>
  );
  const sym = currencySymbol(cur);

  const commissionField = (label: string, hint: string | null) => field(label, hint, unitInput(f.commissionPercent, (v) => set({ commissionPercent: v }), '%', { max: 100 }));
  const productField = field(L('Hoa hồng bán sản phẩm', 'Retail commission'), L('% trên sản phẩm thợ bán (0 = không có)', '% of retail they sell (0 = none)'), unitInput(f.productCommissionPercent, (v) => set({ productCommissionPercent: v }), '%', { max: 100 }));

  const example = exampleLine(f, vi, cur);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div role="radiogroup" aria-label={L('Hình thức trả lương', 'Pay type')} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        {cards.map((c) => {
          const on = f.payType === c.t;
          return (
            <button key={c.t} type="button" role="radio" aria-checked={on} onClick={() => switchTo(c.t)}
              style={{ textAlign: 'left', display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 12px', borderRadius: 12, cursor: 'pointer',
                border: on ? '2px solid #6366f1' : '1px solid var(--line)', background: on ? 'var(--c1e1b4b)' : 'var(--c0f172a)', color: 'var(--ce2e8f0)' }}>
              <span aria-hidden style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 9, display: 'grid', placeItems: 'center', background: on ? '#4f46e5' : 'var(--c1e293b)', color: on ? '#fff' : 'var(--ccbd5e1)' }}><NavIcon name={c.icon} size={16} /></span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: on ? 'var(--ca5b4fc)' : 'var(--cf1f5f9)' }}>{c.title}</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.35, marginTop: 2 }}>{c.sub}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
        {f.payType === 'COMMISSION' && <>
          {commissionField(L('Hoa hồng dịch vụ', 'Service commission'), L('Thợ nhận % này trên doanh thu dịch vụ (sau giảm giá)', 'Paid on service sales, after discounts'))}
          {productField}
        </>}
        {f.payType === 'HOURLY' && <>
          {field(L('Lương mỗi giờ', 'Hourly rate'), L('Giờ làm lấy theo lịch làm việc; sửa được khi chốt lương', 'Hours come from the work schedule; editable at payroll'), unitInput(f.hourlyRate, (v) => set({ hourlyRate: v }), sym, { pre: true, step }))}
          {commissionField(L('Cộng thêm hoa hồng', 'Plus commission'), L('0 = chỉ trả theo giờ', '0 = hourly only'))}
          {productField}
        </>}
        {f.payType === 'DAILY_GUARANTEE' && <>
          {field(L('Mức bao mỗi ngày', 'Guarantee per day'), L('Ngày nào hoa hồng thấp hơn thì trả mức này', 'Paid on any day commission falls short'), unitInput(f.dailyGuarantee, (v) => set({ dailyGuarantee: v }), sym, { pre: true, step }))}
          {commissionField(L('Hoa hồng dịch vụ', 'Service commission'), L('So với mức bao từng ngày, lấy số cao hơn', 'Compared with the guarantee each day; the higher is paid'))}
          {productField}
        </>}
        {f.payType === 'SALARY' && <>
          {field(L('Lương', 'Salary'), null, (
            <span style={{ display: 'flex', gap: 8 }}>
              <span style={{ flex: 1, minWidth: 0 }}>{unitInput(f.salary, (v) => set({ salary: v }), sym, { pre: true, step })}</span>
              <select value={f.salaryPeriod} onChange={(e) => set({ salaryPeriod: e.target.value as SalaryPeriod })} style={{ ...ui.input, width: 'auto' }} aria-label={L('Mỗi', 'Per')}>
                <option value="WEEKLY">{L('/ tuần', '/ week')}</option>
                <option value="BIWEEKLY">{L('/ 2 tuần', '/ 2 weeks')}</option>
                <option value="MONTHLY">{L('/ tháng', '/ month')}</option>
              </select>
            </span>
          ))}
          {commissionField(L('Cộng thêm hoa hồng', 'Plus commission'), L('0 = chỉ lương cố định', '0 = salary only'))}
          {productField}
        </>}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--c0f172a)' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ccbd5e1)' }}>{L('Trả bằng check', 'Paid by check')}</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ce2e8f0)' }}>
          <input type="checkbox" checked={f.checkPercent === ''} onChange={(e) => set({ checkPercent: e.target.checked ? '' : String(defaultCheckPercent ?? 100) })} />
          {L(`Theo mặc định của tiệm (${defaultCheckPercent ?? 100}%)`, `Salon default (${defaultCheckPercent ?? 100}%)`)}
        </label>
        {f.checkPercent !== '' && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 96 }}>{unitInput(f.checkPercent, (v) => set({ checkPercent: v }), '%', { max: 100 })}</span>
            <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{L(`check · ${100 - int(f.checkPercent)}% tiền mặt`, `check · ${100 - int(f.checkPercent)}% cash`)}</span>
          </span>
        )}
      </div>

      {example && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 10, background: 'var(--c052e16)', border: '1px solid var(--line)' }}>
          <span style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--ink-good)' }}>{example}</span>
        </div>
      )}
    </div>
  );
}

function currencySymbol(cur: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? '$';
  } catch { return '$'; }
}

/** A worked example with the typed numbers, in the owner's words. */
export function exampleLine(f: PayForm, vi: boolean, cur: string): string | null {
  const L = (v: string, e: string) => ind(vi ? v : e);
  const fm = (minor: number) => formatPrice(Math.round(minor), cur).replace(/[.,]00(?=\D*$)/, '');
  const minor = (v: string) => Math.max(0, toMinorUnits(v || '0', cur) || 0);
  const unit = minor('1'); // one whole currency unit, in minor units
  const pct = int(f.commissionPercent);
  switch (f.payType) {
    case 'COMMISSION': {
      if (!pct) return null;
      const sales = 1000 * unit;
      return L(`Ví dụ: làm ${fm(sales)} dịch vụ trong kỳ → nhận ${fm(sales * pct / 100)}, cộng tip.`, `Example: ${fm(sales)} of services → ${fm(sales * pct / 100)}, plus tips.`);
    }
    case 'HOURLY': {
      const rate = minor(f.hourlyRate);
      if (!rate) return null;
      const extra = pct ? L(` + ${pct}% của ${fm(1000 * unit)} dịch vụ = ${fm(10 * unit * pct)}`, ` + ${pct}% of ${fm(1000 * unit)} services = ${fm(10 * unit * pct)}`) : '';
      return L(`Ví dụ: 40 giờ × ${fm(rate)} = ${fm(rate * 40)}${extra}, cộng tip.`, `Example: 40 h × ${fm(rate)} = ${fm(rate * 40)}${extra}, plus tips.`);
    }
    case 'DAILY_GUARANTEE': {
      const g = minor(f.dailyGuarantee);
      if (!g || !pct) return null;
      const low = 150 * unit, high = Math.ceil((g * 1.5) / (pct / 100) / unit) * unit;
      return L(
        `Ví dụ: ngày làm ${fm(low)} → ${pct}% = ${fm(low * pct / 100)}${low * pct / 100 < g ? `, thấp hơn mức bao nên được ${fm(g)}` : ''}. Ngày làm ${fm(high)} → được ${fm(Math.max(g, high * pct / 100))}. Cộng tip.`,
        `Example: a ${fm(low)} day → ${pct}% = ${fm(low * pct / 100)}${low * pct / 100 < g ? `, under the guarantee, so ${fm(g)}` : ''}. A ${fm(high)} day → ${fm(Math.max(g, high * pct / 100))}. Plus tips.`,
      );
    }
    case 'SALARY': {
      const s = minor(f.salary);
      if (!s) return null;
      const perWeek = f.salaryPeriod === 'WEEKLY' ? s : f.salaryPeriod === 'BIWEEKLY' ? s / 2 : (s * 12) / 52;
      const extra = pct ? L(` + ${pct}% hoa hồng`, ` + ${pct}% commission`) : '';
      return L(`Ví dụ: kỳ lương 1 tuần ≈ ${fm(perWeek)}${extra}, cộng tip. Kỳ lương được tính theo số ngày, không trả nguyên cả tháng cho 1 tuần.`, `Example: a one-week pay period ≈ ${fm(perWeek)}${extra}, plus tips. Salary is prorated by day.`);
    }
  }
  return null;
}

const unitPre: CSSProperties = { position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: 'var(--c94a3b8)', pointerEvents: 'none' };
const unitPost: CSSProperties = { position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: 'var(--c94a3b8)', pointerEvents: 'none' };
