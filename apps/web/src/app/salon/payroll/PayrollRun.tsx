'use client';

import { Fragment, useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { apiFetch } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { ui, formatPrice } from '../../../lib/ui';
import { toMinorUnits, fromMinorUnits, priceInputStep, minorUnitDigits } from '../../../lib/money';
import { uiCurrency } from '../../../lib/ui-currency';
import { useIsMobile } from '../../../lib/responsive';
import { NavIcon } from '../../../components/NavIcon';
import { ind } from '../../../lib/ui-industry';

/**
 * PAYROLL FOR ONE PAY PERIOD — what each person is owed, how it was worked
 * out, the owner's corrections, and closing the period.
 *
 * Every number on this screen comes from GET /payroll (payroll/pay-calc.ts on
 * the server); the page only lays it out. While the period is open the slips
 * are live; once closed they are the frozen record of what was paid.
 */

type PayType = 'COMMISSION' | 'HOURLY' | 'DAILY_GUARANTEE' | 'SALARY';
interface Adjustment { label: string; cents: number }
interface PayDay { day: string; serviceCents: number; commissionCents: number; guaranteeCents: number; paidCents: number; off: boolean }
interface Slip {
  staffId: string; name: string; payType: PayType; commissionPercent: number; productCommissionPercent: number;
  serviceCents: number; productCents: number; serviceCount: number; visits: number; supplyFeeCents: number;
  serviceCommissionCents: number; productCommissionCents: number;
  hours: number; hoursFromSchedule: number; hoursSource?: 'SCHEDULE' | 'CLOCK'; clockedHours?: number; leaveDays?: string[]; hourlyRateCents: number; hourlyPayCents: number;
  daysWorked: number; dailyGuaranteeCents: number; guaranteeTopUpCents: number;
  salaryCents: number; salaryForPeriodCents: number; earningsCents: number;
  tipsCents: number; cardTipsCents: number; cardTipFeeCents: number; tipsNetCents: number;
  adjustments: Adjustment[]; adjustmentsCents: number; netPayCents: number; checkPercent: number; checkCents: number; cashCents: number;
  days: PayDay[];
}
interface Settings {
  payPeriod: 'WEEKLY' | 'BIWEEKLY' | 'SEMIMONTHLY' | 'MONTHLY'; periodAnchor: string;
  supplyFeeMode: 'NONE' | 'PER_SERVICE' | 'PERCENT'; supplyFeeCents: number; supplyFeePercent: number;
  cardTipFeePercent: number; defaultCheckPercent: number;
  staffPayView?: 'LIVE' | 'FINAL' | 'OFF';
  hoursSource?: 'SCHEDULE' | 'CLOCK';
}
interface Preview {
  period: { from: string; to: string }; today: string; running: boolean; settings: Settings;
  periods: { from: string; to: string; status: string | null }[];
  history: { id: string; periodFrom: string; periodTo: string; finalizedAt: string | null; totals: { netPayCents?: number } | null }[];
  run: { id: string; status: string; finalizedAt: string | null; note: string | null } | null;
  frozen: boolean;
  slips: Slip[];
  totals: Record<string, number>;
  unassigned: { serviceCents: number; productCents: number; tipsCents: number; visits: number } | null;
}
interface Override { hours?: number | null; offDays?: string[]; adjustments?: Adjustment[] }

const money = (c: number) => formatPrice(c ?? 0);
const shortDay = (k: string, vi: boolean) => {
  const d = new Date(`${k}T12:00:00Z`);
  return d.toLocaleDateString(vi ? 'vi-VN' : 'en-US', { day: 'numeric', month: 'numeric', timeZone: 'UTC' });
};
const weekday = (k: string, vi: boolean) => new Date(`${k}T12:00:00Z`).toLocaleDateString(vi ? 'vi-VN' : 'en-US', { weekday: 'short', timeZone: 'UTC' });

export function payTypeName(t: string, vi: boolean) {
  return t === 'HOURLY' ? (vi ? 'Theo giờ' : 'Hourly') : t === 'DAILY_GUARANTEE' ? (vi ? 'Bao lương ngày' : 'Daily guarantee') : t === 'SALARY' ? (vi ? 'Lương cố định' : 'Salary') : (vi ? 'Hoa hồng' : 'Commission');
}

export function PayrollRun({ vi }: { vi: boolean }) {
  const { token } = useAuth();
  const L = (v: string, e: string) => ind(vi ? v : e);
  const isMobile = useIsMobile(767);
  const [data, setData] = useState<Preview | null>(null);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [custom, setCustom] = useState(false);

  const load = useCallback(async (r: { from: string; to: string } | null) => {
    if (!token) return;
    setError(null);
    try {
      const q = r ? `?from=${r.from}&to=${r.to}` : '';
      const d = await apiFetch<Preview>(`/payroll${q}`, { token });
      setData(d);
      if (!r) setRange(d.period);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
  }, [token]);
  useEffect(() => { load(null); }, [load]);

  const pick = (r: { from: string; to: string }) => { setRange(r); setOpen(null); load(r); };

  const act = async (fn: () => Promise<Preview>) => {
    setBusy(true); setError(null);
    try { setData(await fn()); } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  };
  const saveOverride = (staffId: string, override: Override) => data && act(() => apiFetch<Preview>('/payroll/override', { method: 'PATCH', token, body: { from: data.period.from, to: data.period.to, staffId, override } }));
  const finalize = () => {
    if (!data) return;
    const msg = data.running
      ? L('Kỳ lương này chưa kết thúc. Chốt bây giờ sẽ cố định số liệu đến hôm nay. Tiếp tục?', 'This period has not ended yet. Closing now freezes the figures as of today. Continue?')
      : L(`Chốt kỳ lương ${shortDay(data.period.from, vi)} – ${shortDay(data.period.to, vi)}? Số liệu sẽ được lưu cố định.`, `Close ${data.period.from} – ${data.period.to}? The figures will be frozen.`);
    if (!window.confirm(msg)) return;
    act(() => apiFetch<Preview>('/payroll/finalize', { method: 'POST', token, body: { from: data.period.from, to: data.period.to } }));
  };
  const reopen = () => {
    if (!data?.run) return;
    if (!window.confirm(L('Mở lại kỳ đã chốt? Số liệu sẽ được tính lại từ bán hàng hiện tại.', 'Reopen this closed period? Figures will be recalculated from current sales.'))) return;
    act(() => apiFetch<Preview>(`/payroll/runs/${data.run!.id}/reopen`, { method: 'POST', token }));
  };

  const slips = data?.slips ?? [];
  const tot = data?.totals ?? {};

  function exportCsv() {
    if (!data) return;
    const digits = minorUnitDigits(uiCurrency());
    const d = (c: number) => ((c ?? 0) / 10 ** digits).toFixed(digits);
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const head = ['Technician', 'Pay type', 'Visits', 'Service sales', 'Retail sales', 'Supply fee', 'Commission', 'Hours', 'Hourly pay', 'Days', 'Guarantee top-up', 'Salary', 'Earnings', 'Tips', 'Card tip fee', 'Tips paid', 'Adjustments', 'Net pay', 'Check', 'Cash'];
    const rows = slips.map((s) => [s.name, s.payType, String(s.visits), d(s.serviceCents), d(s.productCents), d(s.supplyFeeCents), d(s.serviceCommissionCents + s.productCommissionCents), String(s.hours), d(s.hourlyPayCents), String(s.daysWorked), d(s.guaranteeTopUpCents), d(s.salaryForPeriodCents), d(s.earningsCents), d(s.tipsCents), d(s.cardTipFeeCents), d(s.tipsNetCents), d(s.adjustmentsCents), d(s.netPayCents), d(s.checkCents), d(s.cashCents)]);
    const lines = [[`Pay period ${data.period.from} - ${data.period.to}${data.frozen ? ' (closed)' : ' (draft)'}`], [], head, ...rows].map((r) => r.map((c) => esc(String(c))).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + lines], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `payroll_${data.period.from}_${data.period.to}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  function printSlips(only?: Slip) {
    if (!data) return;
    const list = only ? [only] : slips;
    const w = window.open('', '_blank', 'width=720,height=900');
    if (!w) return;
    const row = (k: string, v: string, strong = false) => `<tr><td>${k}</td><td style="text-align:right;${strong ? 'font-weight:700' : ''}">${v}</td></tr>`;
    const body = list.map((s) => `
      <section>
        <h2>${escapeHtml(s.name)}</h2>
        <p class="sub">${L('Kỳ lương', 'Pay period')} ${data.period.from} → ${data.period.to} · ${payTypeName(s.payType, vi)}${data.frozen ? '' : ` · ${L('TẠM TÍNH', 'DRAFT')}`}</p>
        <table>
          ${row(L('Doanh thu dịch vụ', 'Service sales'), money(s.serviceCents))}
          ${s.supplyFeeCents ? row(L('Trừ phí nguyên liệu', 'Supply fee'), '− ' + money(s.supplyFeeCents)) : ''}
          ${s.serviceCommissionCents ? row(`${L('Hoa hồng dịch vụ', 'Service commission')} ${s.commissionPercent}%`, money(s.serviceCommissionCents)) : ''}
          ${s.productCommissionCents ? row(`${L('Hoa hồng sản phẩm', 'Retail commission')} ${s.productCommissionPercent}%`, money(s.productCommissionCents)) : ''}
          ${s.payType === 'HOURLY' ? row(`${s.hours} ${L('giờ', 'h')} × ${money(s.hourlyRateCents)}`, money(s.hourlyPayCents)) : ''}
          ${s.payType === 'DAILY_GUARANTEE' ? row(`${L('Bù bao lương', 'Guarantee top-up')} (${s.daysWorked} ${L('ngày', 'days')})`, money(s.guaranteeTopUpCents)) : ''}
          ${s.payType === 'SALARY' ? row(L('Lương cố định (theo ngày của kỳ)', 'Salary (prorated)'), money(s.salaryForPeriodCents)) : ''}
          ${row(L('Lương / hoa hồng', 'Earnings'), money(s.earningsCents), true)}
          ${row(L('Tip', 'Tips'), money(s.tipsCents))}
          ${s.cardTipFeeCents ? row(L('Trừ phí thẻ trên tip', 'Card fee on tips'), '− ' + money(s.cardTipFeeCents)) : ''}
          ${s.adjustments.map((a) => row(escapeHtml(a.label || L('Điều chỉnh', 'Adjustment')), (a.cents < 0 ? '− ' : '') + money(Math.abs(a.cents)))).join('')}
          ${row(L('THỰC NHẬN', 'NET PAY'), money(s.netPayCents), true)}
          ${row(`Check (${s.checkPercent}%)`, money(s.checkCents))}
          ${row(L('Tiền mặt', 'Cash'), money(s.cashCents))}
        </table>
        <p class="sign">${L('Thợ ký nhận', 'Received by')}: ____________________</p>
      </section>`).join('');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Payroll ${data.period.from}</title>
      <style>body{font-family:system-ui,sans-serif;color:#111;margin:24px}section{page-break-after:always;max-width:520px}h2{margin:0 0 4px}
      .sub{color:#555;margin:0 0 12px;font-size:13px}table{width:100%;border-collapse:collapse;font-size:14px}td{padding:6px 0;border-bottom:1px solid #ddd}.sign{margin-top:28px;font-size:13px}</style>
      </head><body>${body}<script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  }

  if (error && !data) return <div style={ui.banner}>{error}</div>;
  if (!data || !range) return <p style={{ color: 'var(--c94a3b8)' }}>{L('Đang tải…', 'Loading…')}</p>;

  const periodLabel = (p: { from: string; to: string }) => `${shortDay(p.from, vi)} – ${shortDay(p.to, vi)}`;
  const inList = data.periods.some((p) => p.from === range.from && p.to === range.to);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, opacity: busy ? 0.7 : 1 }}>
      {/* Period + actions */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ccbd5e1)' }}>{L('Kỳ lương', 'Pay period')}</span>
          <select value={custom || !inList ? 'custom' : `${range.from}|${range.to}`} onChange={(e) => {
            if (e.target.value === 'custom') { setCustom(true); return; }
            setCustom(false);
            const [from, to] = e.target.value.split('|'); pick({ from, to });
          }} style={{ ...ui.input, width: 'auto', minWidth: 220 }}>
            {data.periods.map((p, i) => (
              <option key={p.from} value={`${p.from}|${p.to}`}>
                {periodLabel(p)}{i === 0 ? L(' (kỳ này)', ' (current)') : ''}{p.status === 'FINAL' ? L(' · đã chốt', ' · closed') : ''}
              </option>
            ))}
            <option value="custom">{L('Chọn ngày…', 'Custom dates…')}</option>
          </select>
        </label>
        {(custom || !inList) && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="date" lang="en-US" value={range.from} max={range.to} onChange={(e) => e.target.value && pick({ from: e.target.value, to: range.to })} style={{ ...ui.input, width: 'auto' }} />
            <span style={{ color: 'var(--c94a3b8)' }}>→</span>
            <input type="date" lang="en-US" value={range.to} min={range.from} onChange={(e) => e.target.value && pick({ from: range.from, to: e.target.value })} style={{ ...ui.input, width: 'auto' }} />
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => setShowSettings((v) => !v)} style={ghostBtn}><NavIcon name="cog" size={15} />{L('Cài đặt lương', 'Payroll settings')}</button>
        <button type="button" onClick={exportCsv} style={ghostBtn}><NavIcon name="fileText" size={15} />CSV</button>
        <button type="button" onClick={() => printSlips()} disabled={!slips.length} style={ghostBtn}><NavIcon name="receipt" size={15} />{L('In phiếu lương', 'Print payslips')}</button>
      </div>

      {showSettings && <SettingsPanel vi={vi} value={data.settings} onSaved={() => { setShowSettings(false); load(range); }} />}
      {error && <div style={ui.banner}>{error}</div>}

      {/* Where the period stands */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 14px', borderRadius: 12, border: '1px solid var(--line)',
        background: data.frozen ? 'var(--c052e16)' : 'var(--c111827)' }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: data.frozen ? '#16a34a' : data.running ? '#f59e0b' : '#6366f1', flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 220, fontSize: 13.5, color: 'var(--ce2e8f0)', lineHeight: 1.45 }}>
          {data.frozen
            ? <><b style={{ color: 'var(--ink-good)' }}>{L('Đã chốt', 'Closed')}</b> {data.run?.finalizedAt ? L(`ngày ${new Date(data.run.finalizedAt).toLocaleDateString('vi-VN')}`, `on ${new Date(data.run.finalizedAt).toLocaleDateString('en-US')}`) : ''} — {L('đây là số đã trả, sửa đơn cũ cũng không làm thay đổi.', 'this is what was paid; editing old tickets will not change it.')}</>
            : data.running
              ? <><b style={{ color: 'var(--ink-warn)' }}>{L('Kỳ đang chạy', 'Period in progress')}</b> — {L('số tạm tính đến hôm nay. Chốt khi kỳ kết thúc.', 'figures so far, up to today. Close it when the period ends.')}</>
              : <><b style={{ color: 'var(--ink-link)' }}>{L('Chưa chốt', 'Not closed')}</b> — {L('kiểm tra từng thợ, điều chỉnh nếu cần rồi bấm Chốt kỳ lương.', 'check each person, adjust if needed, then close the period.')}</>}
        </span>
        {data.frozen
          ? <button type="button" onClick={reopen} disabled={busy} style={ghostBtn}>{L('Mở lại kỳ', 'Reopen')}</button>
          : <button type="button" onClick={finalize} disabled={busy || !slips.length} style={{ ...ui.primaryBtn, display: 'flex', alignItems: 'center', gap: 8 }}><NavIcon name="docCheck" size={16} />{L('Chốt kỳ lương', 'Close pay period')}</button>}
      </div>

      {/* Totals */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
        <Tile label={L('Tổng thực nhận', 'Total net pay')} value={money(tot.netPayCents)} accent="#16a34a" strong span={isMobile} />
        <Tile label={L('Lương & hoa hồng', 'Earnings')} value={money(tot.earningsCents)} accent="#6366f1" sub={L(`trên ${money(tot.serviceCents)} doanh thu DV`, `on ${money(tot.serviceCents)} service sales`)} />
        <Tile label={L('Tip trả thợ', 'Tips paid out')} value={money(tot.tipsNetCents)} accent="#a855f7" sub={tot.cardTipFeeCents ? L(`đã trừ ${money(tot.cardTipFeeCents)} phí thẻ`, `${money(tot.cardTipFeeCents)} card fee taken`) : undefined} />
        <Tile label={L('Check / Tiền mặt', 'Check / Cash')} value={`${money(tot.checkCents)}`} accent="#0ea5e9" sub={`${L('Tiền mặt', 'Cash')} ${money(tot.cashCents)}`} />
      </div>

      {data.unassigned && (data.unassigned.serviceCents + data.unassigned.productCents) > 0 && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(245,158,11,.4)', background: 'rgba(245,158,11,.10)', fontSize: 13.5, color: 'var(--ink-warn)' }}>
          <b>⚠</b>
          <span style={{ flex: 1 }}>{L(`${money(data.unassigned.serviceCents + data.unassigned.productCents)} doanh thu chưa gán thợ (${data.unassigned.visits} lượt) — không ai được tính lương cho phần này.`, `${money(data.unassigned.serviceCents + data.unassigned.productCents)} of sales has no technician (${data.unassigned.visits} visits) — no one is paid on it.`)}</span>
          <a href="/salon/orders" style={{ color: 'var(--ink-link)', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>{L('Xem đơn →', 'Open orders →')}</a>
        </div>
      )}

      {/* People */}
      {slips.length === 0 ? <p style={{ color: 'var(--c94a3b8)', fontSize: 13.5 }}>{L('Chưa có thợ hoặc doanh thu trong kỳ này.', 'No staff or sales in this period.')}</p> : isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {slips.map((s) => (
            <div key={s.staffId} style={{ borderRadius: 14, border: '1px solid var(--line)', background: 'var(--c111827)', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button type="button" onClick={() => setOpen(open === s.staffId ? null : s.staffId)} style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
                <Initial name={s.name} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: 'var(--cf1f5f9)' }}>{s.name}</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--c94a3b8)' }}>{payTypeName(s.payType, vi)} · {s.visits} {L('lượt', 'visits')}</span>
                </span>
                <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--ink-good)' }}>{money(s.netPayCents)}</span>
              </button>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--c94a3b8)' }}>
                <span>{L('Lương', 'Earn')} <b style={{ color: 'var(--ce2e8f0)' }}>{money(s.earningsCents)}</b></span>
                <span>Tip <b style={{ color: 'var(--ce2e8f0)' }}>{money(s.tipsNetCents)}</b></span>
                <span>Check <b style={{ color: 'var(--ce2e8f0)' }}>{money(s.checkCents)}</b></span>
              </div>
              {open === s.staffId && <SlipDetail s={s} vi={vi} frozen={data.frozen} period={data.period} onSave={(o) => saveOverride(s.staffId, o)} onPrint={() => printSlips(s)} />}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ border: '1px solid var(--line)', borderRadius: 14, overflowX: 'auto', background: 'var(--c0f172a)' }}>
          <table style={{ width: '100%', minWidth: 880, borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: 'var(--c111827)' }}>
                <th style={th}>{L('Thợ', 'Technician')}</th>
                <th style={thR}>{L('Lượt', 'Visits')}</th>
                <th style={thR}>{L('Doanh thu DV', 'Service sales')}</th>
                <th style={thR}>{L('Lương / hoa hồng', 'Earnings')}</th>
                <th style={thR}>Tip</th>
                <th style={thR}>{L('Thưởng / trừ', 'Adjust.')}</th>
                <th style={thR}>{L('Thực nhận', 'Net pay')}</th>
                <th style={thR}>{L('Check · Tiền mặt', 'Check · Cash')}</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {slips.map((s) => (
                <Fragment key={s.staffId}>
                  <tr style={{ borderTop: '1px solid var(--line)', background: open === s.staffId ? 'var(--c111827)' : undefined }}>
                    <td style={{ ...td, minWidth: 190, whiteSpace: 'nowrap', cursor: 'pointer' }} onClick={() => setOpen(open === s.staffId ? null : s.staffId)}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Initial name={s.name} />
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: 'block', fontWeight: 700, color: 'var(--cf1f5f9)' }}>{s.name}</span>
                          <span style={{ display: 'block', fontSize: 12, color: 'var(--c94a3b8)' }}>{payTypeName(s.payType, vi)}{earnHint(s, vi)}</span>
                        </span>
                      </span>
                    </td>
                    <td style={tdR}>{s.visits}</td>
                    <td style={tdR}>{money(s.serviceCents)}</td>
                    <td style={tdR}>{money(s.earningsCents)}</td>
                    <td style={tdR}>{money(s.tipsNetCents)}</td>
                    <td style={{ ...tdR, color: s.adjustmentsCents < 0 ? 'var(--ink-bad)' : s.adjustmentsCents > 0 ? 'var(--ink-good)' : 'var(--c94a3b8)' }}>{s.adjustmentsCents ? (s.adjustmentsCents > 0 ? '+' : '−') + money(Math.abs(s.adjustmentsCents)) : '—'}</td>
                    <td style={{ ...tdR, fontWeight: 800, fontSize: 15, color: 'var(--ink-good)' }}>{money(s.netPayCents)}</td>
                    <td style={{ ...tdR, fontSize: 12.5, color: 'var(--ccbd5e1)' }}>{money(s.checkCents)}<br /><span style={{ color: 'var(--c94a3b8)' }}>{money(s.cashCents)}</span></td>
                    <td style={{ ...td, textAlign: 'right', width: 46, paddingLeft: 0 }}>
                      <button type="button" onClick={() => setOpen(open === s.staffId ? null : s.staffId)} aria-expanded={open === s.staffId}
                        aria-label={open === s.staffId ? L(`Đóng chi tiết ${s.name}`, `Close ${s.name}`) : L(`Chi tiết ${s.name}`, `Details for ${s.name}`)} title={L('Chi tiết & điều chỉnh', 'Details & corrections')}
                        style={{ ...ghostBtn, width: 34, height: 34, padding: 0, justifyContent: 'center' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ transform: open === s.staffId ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}><path d="m6 9 6 6 6-6" /></svg>
                      </button>
                    </td>
                  </tr>
                  {open === s.staffId && (
                    <tr><td colSpan={9} style={{ padding: 16, background: 'var(--c111827)' }}>
                      <SlipDetail s={s} vi={vi} frozen={data.frozen} period={data.period} onSave={(o) => saveOverride(s.staffId, o)} onPrint={() => printSlips(s)} />
                    </td></tr>
                  )}
                </Fragment>
              ))}
              <tr style={{ borderTop: '2px solid var(--c334155)', background: 'var(--c111827)' }}>
                <td style={{ ...td, fontWeight: 700, color: 'var(--cf1f5f9)' }}>{L('Tổng', 'Total')}</td>
                <td style={tdR}>{tot.visits}</td>
                <td style={tdR}>{money(tot.serviceCents)}</td>
                <td style={tdR}>{money(tot.earningsCents)}</td>
                <td style={tdR}>{money(tot.tipsNetCents)}</td>
                <td style={tdR}>{tot.adjustmentsCents ? money(tot.adjustmentsCents) : '—'}</td>
                <td style={{ ...tdR, fontWeight: 800, color: 'var(--ink-good)' }}>{money(tot.netPayCents)}</td>
                <td style={{ ...tdR, fontSize: 12.5, color: 'var(--ccbd5e1)' }}>{money(tot.checkCents)}<br /><span style={{ color: 'var(--c94a3b8)' }}>{money(tot.cashCents)}</span></td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p style={{ margin: 0, fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.5 }}>
        {L('Doanh thu dịch vụ = tiền dịch vụ của thợ đã trừ giảm giá trên bill (không gồm thuế, tip). Lịch hẹn hoàn thành mà không thu qua quầy được tính theo giá lịch hẹn. Giờ làm và ngày làm lấy theo lịch làm việc của thợ (hoặc theo chấm công nếu tiệm chọn trong Cài đặt), chỉnh được trong Chi tiết trước khi chốt.',
          'Service sales = the tech\'s service lines after ticket discounts (no tax, no tips). Bookings completed without the till count at their price. Hours and days come from the work schedule (or the time clock, if chosen in Settings) and can be corrected under Details before closing.')}
      </p>
    </div>
  );
}

function earnHint(s: Slip, vi: boolean): string {
  if (s.payType === 'HOURLY') return ` · ${s.hours}${vi ? ' giờ' : ' h'}`;
  if (s.payType === 'DAILY_GUARANTEE') return ` · ${s.daysWorked} ${vi ? 'ngày' : 'days'}`;
  if (s.payType === 'SALARY') return s.commissionPercent ? ` + ${s.commissionPercent}%` : '';
  return ` ${s.commissionPercent}%`;
}

/** How one payslip was worked out, with the owner's corrections. */
function SlipDetail({ s, vi, frozen, period, onSave, onPrint }: {
  s: Slip; vi: boolean; frozen: boolean; period: { from: string; to: string };
  onSave: (o: Override) => void; onPrint: () => void;
}) {
  const L = (v: string, e: string) => ind(vi ? v : e);
  const cur = uiCurrency();
  // The hours the payslip would use untouched: the time clock's when the salon pays by it, else the schedule's.
  const baseHours = s.hoursSource === 'CLOCK' ? (s.clockedHours ?? 0) : s.hoursFromSchedule;
  const [hours, setHours] = useState<string>(s.payType === 'HOURLY' && s.hours !== baseHours ? String(s.hours) : '');
  const [offDays, setOffDays] = useState<string[]>(s.days.filter((d) => d.off).map((d) => d.day));
  const [adj, setAdj] = useState<{ label: string; amount: string; sign: 1 | -1 }[]>(
    s.adjustments.map((a) => ({ label: a.label, amount: fromMinorUnits(Math.abs(a.cents), cur), sign: a.cents < 0 ? -1 : 1 })),
  );
  useEffect(() => {
    setAdj(s.adjustments.map((a) => ({ label: a.label, amount: fromMinorUnits(Math.abs(a.cents), cur), sign: a.cents < 0 ? -1 : 1 })));
    setOffDays(s.days.filter((d) => d.off).map((d) => d.day));
  }, [s, cur]);
  const save = () => onSave({
    hours: hours.trim() === '' ? null : Number(hours),
    offDays,
    adjustments: adj.filter((a) => Number(a.amount) > 0).map((a) => ({ label: a.label.trim() || (a.sign < 0 ? L('Khấu trừ', 'Deduction') : L('Thưởng', 'Bonus')), cents: a.sign * (toMinorUnits(a.amount, cur) || 0) })),
  });

  const line = (label: ReactNode, value: string, opts: { minus?: boolean; strong?: boolean; muted?: boolean } = {}) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--line)', fontSize: 13.5 }}>
      <span style={{ color: opts.muted ? 'var(--c94a3b8)' : 'var(--ccbd5e1)' }}>{label}</span>
      <span style={{ fontWeight: opts.strong ? 800 : 600, color: opts.minus ? 'var(--ink-bad)' : opts.strong ? 'var(--ink-good)' : 'var(--ce2e8f0)', whiteSpace: 'nowrap' }}>{opts.minus ? '− ' : ''}{value}</span>
    </div>
  );
  const editable = !frozen;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
      <div>
        <div style={detailHead}>{L('Cách tính', 'How it adds up')}</div>
        {line(L(`Doanh thu dịch vụ (${s.serviceCount} dịch vụ, ${s.visits} lượt)`, `Service sales (${s.serviceCount} services, ${s.visits} visits)`), money(s.serviceCents))}
        {s.supplyFeeCents > 0 && line(L('Phí nguyên liệu', 'Supply fee'), money(s.supplyFeeCents), { minus: true })}
        {(s.serviceCommissionCents > 0 || s.payType === 'COMMISSION') && line(L(`Hoa hồng dịch vụ ${s.commissionPercent}%`, `Service commission ${s.commissionPercent}%`), money(s.serviceCommissionCents))}
        {s.productCents > 0 && line(L(`Hoa hồng sản phẩm ${s.productCommissionPercent}% × ${money(s.productCents)}`, `Retail ${s.productCommissionPercent}% × ${money(s.productCents)}`), money(s.productCommissionCents))}
        {(s.leaveDays?.length ?? 0) > 0 && line(<>{L('Nghỉ phép đã duyệt', 'Approved time off')} <span style={{ color: 'var(--c94a3b8)' }}>({s.leaveDays!.length} {L('ngày', 'days')} · {s.leaveDays!.map((d) => shortDay(d, vi)).join(', ')})</span></>, '')}
        {s.payType === 'HOURLY' && line(<>{s.hours} {L('giờ', 'h')} × {money(s.hourlyRateCents)} <span style={{ color: 'var(--c94a3b8)' }}>({s.hours !== baseHours ? L('đã chỉnh', 'corrected') : s.hoursSource === 'CLOCK' ? L('theo chấm công', 'from the time clock') : L('theo lịch', 'from schedule')})</span></>, money(s.hourlyPayCents))}
        {s.payType === 'DAILY_GUARANTEE' && line(L(`Bù cho đủ mức bao ${money(s.dailyGuaranteeCents)}/ngày · ${s.daysWorked} ngày`, `Guarantee top-up ${money(s.dailyGuaranteeCents)}/day · ${s.daysWorked} days`), money(s.guaranteeTopUpCents))}
        {s.payType === 'SALARY' && line(L(`Lương ${money(s.salaryCents)} tính theo số ngày của kỳ`, `Salary ${money(s.salaryCents)} prorated to the period`), money(s.salaryForPeriodCents))}
        {line(L('Lương / hoa hồng', 'Earnings'), money(s.earningsCents), { strong: false })}
        {line(L('Tip', 'Tips'), money(s.tipsCents))}
        {s.cardTipFeeCents > 0 && line(L(`Phí thẻ trên ${money(s.cardTipsCents)} tip quẹt thẻ`, `Card fee on ${money(s.cardTipsCents)} card tips`), money(s.cardTipFeeCents), { minus: true })}
        {s.adjustments.map((a, i) => <Fragment key={i}>{line(a.label, money(Math.abs(a.cents)), { minus: a.cents < 0 })}</Fragment>)}
        {line(L('Thực nhận', 'Net pay'), money(s.netPayCents), { strong: true })}
        {line(`Check ${s.checkPercent}% · ${L('Tiền mặt', 'Cash')} ${100 - s.checkPercent}%`, `${money(s.checkCents)} · ${money(s.cashCents)}`, { muted: true })}
        <button type="button" onClick={onPrint} style={{ ...ghostBtn, marginTop: 12 }}><NavIcon name="receipt" size={15} />{L('In phiếu lương', 'Print payslip')}</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={detailHead}>{editable ? L('Điều chỉnh trước khi chốt', 'Corrections before closing') : L('Kỳ đã chốt — mở lại để điều chỉnh', 'Closed — reopen to correct')}</div>

        {s.payType === 'HOURLY' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={detailLabel}>{s.hoursSource === 'CLOCK' ? L(`Số giờ làm (chấm công: ${baseHours} giờ · lịch: ${s.hoursFromSchedule} giờ)`, `Hours worked (clock: ${baseHours} h · schedule: ${s.hoursFromSchedule} h)`) : L(`Số giờ làm (theo lịch: ${s.hoursFromSchedule} giờ)`, `Hours worked (schedule: ${s.hoursFromSchedule} h)`)}</span>
            <input type="number" min={0} step="0.25" disabled={!editable} value={hours} placeholder={String(baseHours)} onChange={(e) => setHours(e.target.value)} style={{ ...ui.input, maxWidth: 180 }} />
          </label>
        )}

        {s.payType === 'DAILY_GUARANTEE' && s.days.length > 0 && (
          <div>
            <span style={detailLabel}>{L('Ngày làm — bấm để đánh dấu ngày nghỉ (không bao lương)', 'Days — tap to mark a day off (no guarantee)')}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {s.days.map((d) => {
                const leave = (s.leaveDays ?? []).includes(d.day);
                const off = leave || offDays.includes(d.day);
                return (
                  <button key={d.day} type="button" disabled={!editable || leave} onClick={() => setOffDays((x) => (off ? x.filter((y) => y !== d.day) : [...x, d.day]))}
                    title={leave ? L('Nghỉ phép đã duyệt (sửa trên trang Thợ → Ngày nghỉ)', 'Approved time off (change it on Staff → Time off)') : `${L('Doanh thu', 'Sales')} ${money(d.serviceCents)} · ${L('Hoa hồng', 'Commission')} ${money(d.commissionCents)} · ${L('Được', 'Paid')} ${money(d.paidCents)}`}
                    style={{ padding: '6px 9px', borderRadius: 9, cursor: editable ? 'pointer' : 'default', fontSize: 12, lineHeight: 1.25, textAlign: 'center',
                      border: off ? '1px dashed var(--c475569)' : '1px solid var(--line)', background: off ? 'transparent' : 'var(--c0f172a)', color: off ? 'var(--c94a3b8)' : 'var(--ce2e8f0)', textDecoration: off ? 'line-through' : 'none' }}>
                    <b>{weekday(d.day, vi)} {shortDay(d.day, vi)}</b><br />{leave ? L('nghỉ phép', 'leave') : money(d.paidCents)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <span style={detailLabel}>{L('Thưởng / khấu trừ (ứng lương, phạt, phụ cấp…)', 'Bonus / deduction (advance, allowance…)')}</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
            {adj.map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <select disabled={!editable} value={a.sign} onChange={(e) => setAdj(adj.map((x, j) => (j === i ? { ...x, sign: Number(e.target.value) as 1 | -1 } : x)))} style={{ ...ui.input, width: 'auto' }}>
                  <option value={1}>{L('+ Thưởng', '+ Bonus')}</option>
                  <option value={-1}>{L('− Trừ', '− Deduct')}</option>
                </select>
                <input disabled={!editable} value={a.label} onChange={(e) => setAdj(adj.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder={L('Ghi chú', 'Note')} style={{ ...ui.input, flex: 1, minWidth: 0 }} />
                <input disabled={!editable} type="number" min={0} step={priceInputStep(cur)} value={a.amount} onChange={(e) => setAdj(adj.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} style={{ ...ui.input, width: 110 }} />
                {editable && <button type="button" aria-label={L('Bỏ', 'Remove')} onClick={() => setAdj(adj.filter((_, j) => j !== i))} style={{ ...ghostBtn, padding: '8px 10px' }}>✕</button>}
              </div>
            ))}
            {editable && <button type="button" onClick={() => setAdj([...adj, { label: '', amount: '', sign: 1 }])} style={{ ...ghostBtn, alignSelf: 'flex-start' }}>+ {L('Thêm dòng', 'Add line')}</button>}
          </div>
        </div>
        {editable && <button type="button" onClick={save} style={{ ...ui.primaryBtn, alignSelf: 'flex-start' }}>{L('Lưu điều chỉnh', 'Save corrections')}</button>}
        <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{L(`Kỳ ${period.from} → ${period.to}. Điều chỉnh được ghi vào nhật ký hoạt động.`, `Period ${period.from} → ${period.to}. Corrections are written to the activity log.`)}</span>
      </div>
    </div>
  );
}

function SettingsPanel({ vi, value, onSaved }: { vi: boolean; value: Settings; onSaved: () => void }) {
  const { token } = useAuth();
  const L = (v: string, e: string) => ind(vi ? v : e);
  const cur = uiCurrency();
  const [f, setF] = useState({
    payPeriod: value.payPeriod, periodAnchor: value.periodAnchor,
    supplyFeeMode: value.supplyFeeMode, supplyFee: value.supplyFeeMode === 'PER_SERVICE' ? fromMinorUnits(value.supplyFeeCents, cur) : String(value.supplyFeePercent || ''),
    cardTipFeePercent: String(value.cardTipFeePercent || ''), defaultCheckPercent: String(value.defaultCheckPercent),
    staffPayView: value.staffPayView ?? 'LIVE',
    hoursSource: value.hoursSource ?? 'SCHEDULE',
  });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true); setErr(null);
    try {
      await apiFetch('/payroll/settings', { method: 'PATCH', token, body: {
        payPeriod: f.payPeriod, periodAnchor: f.periodAnchor, supplyFeeMode: f.supplyFeeMode,
        supplyFeeCents: f.supplyFeeMode === 'PER_SERVICE' ? Math.max(0, toMinorUnits(f.supplyFee || '0', cur) || 0) : 0,
        supplyFeePercent: f.supplyFeeMode === 'PERCENT' ? Math.max(0, Math.min(100, Number(f.supplyFee) || 0)) : 0,
        cardTipFeePercent: Math.max(0, Math.min(20, Number(f.cardTipFeePercent) || 0)),
        defaultCheckPercent: Math.max(0, Math.min(100, Math.round(Number(f.defaultCheckPercent) || 0))),
        staffPayView: f.staffPayView,
        hoursSource: f.hoursSource,
      } });
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setSaving(false); }
  };
  const lab = (label: string, input: ReactNode, hint?: string) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <span style={detailLabel}>{label}</span>{input}
      {hint && <span style={{ fontSize: 11.5, color: 'var(--c94a3b8)', lineHeight: 1.35 }}>{hint}</span>}
    </label>
  );
  return (
    <div style={{ padding: 16, borderRadius: 14, border: '1px solid var(--line)', background: 'var(--c111827)', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--cf1f5f9)' }}>{L('Cài đặt lương của tiệm', 'Salon payroll settings')}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 }}>
        {lab(L('Kỳ trả lương', 'Pay period'), (
          <select value={f.payPeriod} onChange={(e) => setF({ ...f, payPeriod: e.target.value as Settings['payPeriod'] })} style={ui.input}>
            <option value="WEEKLY">{L('Hằng tuần', 'Weekly')}</option>
            <option value="BIWEEKLY">{L('2 tuần một lần', 'Every 2 weeks')}</option>
            <option value="SEMIMONTHLY">{L('2 lần / tháng (1–15, 16–cuối)', 'Twice a month (1–15, 16–end)')}</option>
            <option value="MONTHLY">{L('Hằng tháng', 'Monthly')}</option>
          </select>
        ))}
        {(f.payPeriod === 'WEEKLY' || f.payPeriod === 'BIWEEKLY') && lab(L('Kỳ bắt đầu từ ngày', 'A period starts on'), (
          <input type="date" lang="en-US" value={f.periodAnchor} onChange={(e) => setF({ ...f, periodAnchor: e.target.value })} style={ui.input} />
        ), L('Chọn ngày đầu của một kỳ bất kỳ, ví dụ thứ Hai.', 'The first day of any period, e.g. a Monday.'))}
        {lab(L('Phí nguyên liệu (trừ trước khi tính hoa hồng)', 'Supply fee (before commission)'), (
          <span style={{ display: 'flex', gap: 6 }}>
            <select value={f.supplyFeeMode} onChange={(e) => setF({ ...f, supplyFeeMode: e.target.value as Settings['supplyFeeMode'] })} style={{ ...ui.input, width: 'auto' }}>
              <option value="NONE">{L('Không trừ', 'None')}</option>
              <option value="PER_SERVICE">{L('Số tiền / dịch vụ', 'Amount / service')}</option>
              <option value="PERCENT">{L('% doanh thu DV', '% of service sales')}</option>
            </select>
            {f.supplyFeeMode !== 'NONE' && <input type="number" min={0} step={f.supplyFeeMode === 'PER_SERVICE' ? priceInputStep(cur) : '0.5'} value={f.supplyFee} onChange={(e) => setF({ ...f, supplyFee: e.target.value })} style={{ ...ui.input, flex: 1, minWidth: 0 }} placeholder={f.supplyFeeMode === 'PERCENT' ? '%' : ''} />}
          </span>
        ))}
        {lab(L('Phí quẹt thẻ trừ trên tip (%)', 'Card fee taken from card tips (%)'), (
          <input type="number" min={0} max={20} step="0.1" value={f.cardTipFeePercent} placeholder="0" onChange={(e) => setF({ ...f, cardTipFeePercent: e.target.value })} style={ui.input} />
        ), L('0 = trả đủ tip quẹt thẻ cho thợ.', '0 = card tips paid in full.'))}
        {lab(L('Mặc định trả bằng check (%)', 'Default paid by check (%)'), (
          <input type="number" min={0} max={100} value={f.defaultCheckPercent} onChange={(e) => setF({ ...f, defaultCheckPercent: e.target.value })} style={ui.input} />
        ), L('Phần còn lại trả tiền mặt. Từng thợ có thể đặt riêng.', 'The rest is cash. Each tech can override.'))}
        {lab(L('Thợ xem lương trong app', 'Techs see their pay in the app'), (
          <select value={f.staffPayView} onChange={(e) => setF({ ...f, staffPayView: e.target.value as 'LIVE' | 'FINAL' | 'OFF' })} style={ui.input}>
            <option value="LIVE">{L('Tạm tính kỳ này + bảng lương đã chốt', 'Running estimate + closed payslips')}</option>
            <option value="FINAL">{L('Chỉ bảng lương đã chốt', 'Closed payslips only')}</option>
            <option value="OFF">{L('Không cho xem', 'Not shown')}</option>
          </select>
        ), L('Mỗi thợ chỉ thấy lương của chính mình.', 'Each tech sees only their own pay.'))}
        {lab(L('Giờ làm & ngày công tính theo', 'Hours and days worked come from'), (
          <select value={f.hoursSource} onChange={(e) => setF({ ...f, hoursSource: e.target.value as 'SCHEDULE' | 'CLOCK' })} style={ui.input}>
            <option value="SCHEDULE">{L('Lịch làm việc', 'The work schedule')}</option>
            <option value="CLOCK">{L('Chấm công (thợ bấm Vào ca / Ra ca)', 'The time clock (techs clock in / out)')}</option>
          </select>
        ), f.hoursSource === 'CLOCK'
          ? L('Dùng cho lương theo giờ và lương bảo đảm theo ngày. Thợ thấy nút Vào ca / Ra ca trong app; ngày không chấm công thì không tính bảo đảm.', 'Used for hourly pay and the daily guarantee. Techs get a Clock in / out button; a day not clocked earns no guarantee.')
          : L('Chọn "Chấm công" để thợ bấm Vào ca / Ra ca trong app.', 'Pick "time clock" to give techs a Clock in / out button.'))}
      </div>
      {err && <div style={ui.banner}>{err}</div>}
      <div><button type="button" onClick={save} disabled={saving} style={ui.primaryBtn}>{saving ? L('Đang lưu…', 'Saving…') : L('Lưu cài đặt', 'Save settings')}</button></div>
    </div>
  );
}

function Tile({ label, value, accent, sub, strong, span }: { label: string; value: string; accent: string; sub?: string; strong?: boolean; span?: boolean }) {
  return (
    <div style={{ borderRadius: 14, border: '1px solid var(--line)', background: 'var(--c111827)', padding: '14px 16px', boxShadow: `inset 3px 0 0 ${accent}`, minWidth: 0, gridColumn: span ? '1 / -1' : undefined }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c94a3b8)' }}>{label}</div>
      <div style={{ fontSize: strong ? 28 : 22, fontWeight: 800, marginTop: 4, color: strong ? 'var(--ink-good)' : 'var(--cf1f5f9)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
    </div>
  );
}

function Initial({ name }: { name: string }) {
  const hue = useMemo(() => ['#be185d', '#0e7490', '#7c3aed', '#c2410c', '#15803d', '#1d4ed8', '#a16207', '#0f766e'][[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 8], [name]);
  return <span aria-hidden style={{ width: 32, height: 32, flexShrink: 0, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700, background: hue, color: '#fff' }}>{(name.trim()[0] || '?').toUpperCase()}</span>;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

const ghostBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--c0f172a)', color: 'var(--ce2e8f0)', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' };
const th: CSSProperties = { padding: '10px 12px', fontSize: 12.5, fontWeight: 700, color: 'var(--c94a3b8)', textAlign: 'left', lineHeight: 1.25, verticalAlign: 'bottom' };
const thR: CSSProperties = { ...th, textAlign: 'right' };
const td: CSSProperties = { padding: '12px 12px', color: 'var(--ce2e8f0)', verticalAlign: 'middle' };
const tdR: CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const detailHead: CSSProperties = { fontSize: 12, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--c94a3b8)', marginBottom: 6 };
const detailLabel: CSSProperties = { fontSize: 12.5, fontWeight: 600, color: 'var(--ccbd5e1)' };
