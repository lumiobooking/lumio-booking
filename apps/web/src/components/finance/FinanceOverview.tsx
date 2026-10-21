'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../lib/api';
import { ui, formatPrice } from '../../lib/ui';
import { PeriodFilter, usePeriod, Delta } from '../PeriodFilter';
import { PayPayrollDialog, PayRecurringDialog, PayStockDialog } from './FinanceDialogs';
import { cleanErr, fundLabel, groupLabel, pnlRowLabel, type FinanceCtx, type Pending, type Pnl, type PnlResponse, type TrendPoint } from './finance-types';

/**
 * Tổng quan: did the salon make money, where is the money now, and what is
 * still waiting to be written down. Revenue is the very number Reports
 * shows; staff cost is the closed payroll; the rest is the cash book.
 */
export function FinanceOverview({ fx }: { fx: FinanceCtx }) {
  const { token, L, vi, currency, funds, version } = fx;
  const fmt = (c: number) => formatPrice(c, currency);
  const range = usePeriod('finance', 'thisMonth');
  const [data, setData] = useState<PnlResponse | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [trend, setTrend] = useState<TrendPoint[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dlg, setDlg] = useState<{ kind: 'payroll'; i: number } | { kind: 'stock'; i: number } | { kind: 'rec'; i: number } | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setErr(null);
    const q = new URLSearchParams({ from: range.from, to: range.to });
    if (range.cmp) { q.set('cmpFrom', range.cmp.from); q.set('cmpTo', range.cmp.to); }
    try {
      const [p, pend] = await Promise.all([
        apiFetch<PnlResponse>(`/finance/pnl?${q.toString()}`, { token }),
        apiFetch<Pending>('/finance/pending', { token }),
      ]);
      setData(p); setPending(pend);
    } catch (e) { setErr(cleanErr(e)); }
    apiFetch<TrendPoint[]>('/finance/trend?months=6', { token }).then(setTrend).catch(() => setTrend([]));
  }, [token, range.from, range.to, range.cmp?.from, range.cmp?.to, version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);

  const cur = data?.current;
  const prev = data?.previous ?? null;
  const onHand = funds.filter((f) => !f.archived).reduce((n, f) => n + f.balanceCents, 0);
  const pct = (c: number) => (cur && cur.revenue.netCents > 0 ? `${((c / cur.revenue.netCents) * 100).toFixed(1)}%` : '—');
  const pendingCount = pending ? pending.payroll.length + pending.stock.length + pending.recurring.length + (pending.drawerToReview.count ? 1 : 0) : 0;

  const tile: CSSProperties = { ...ui.card, padding: '13px 15px', display: 'flex', flexDirection: 'column', gap: 2 };
  const cap: CSSProperties = { fontSize: 11.5, fontWeight: 800, letterSpacing: '.04em', color: 'var(--c94a3b8)' };
  const big: CSSProperties = { fontSize: 23, fontWeight: 800 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PeriodFilter state={range} vi={vi} showCompare />
      {err && <div style={ui.banner}>{err}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
        <div style={tile}>
          <span style={cap}>{L('DOANH THU THUẦN', 'NET SALES')}</span>
          <span style={{ ...big, color: 'var(--ce2e8f0)' }}>{cur ? fmt(cur.revenue.netCents) : '…'}</span>
          {cur && <Delta cur={cur.revenue.netCents} prev={prev?.revenue.netCents} vi={vi} />}
        </div>
        <div style={tile}>
          <span style={cap}>{L('TỔNG CHI PHÍ', 'TOTAL COSTS')}</span>
          <span style={{ ...big, color: 'var(--ink-warn)' }}>{cur ? fmt(cur.expenseCents) : '…'}</span>
          <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{cur ? `${pct(cur.expenseCents)} ${L('doanh thu', 'of sales')}` : ''}</span>
          {cur && <Delta cur={cur.expenseCents} prev={prev?.expenseCents} vi={vi} invert />}
        </div>
        <div style={{ ...tile, border: `1px solid ${cur && cur.profitCents < 0 ? 'var(--ink-bad)' : 'var(--ink-good)'}` }}>
          <span style={cap}>{cur && cur.profitCents < 0 ? L('LỖ', 'LOSS') : L('LỢI NHUẬN', 'PROFIT')}</span>
          <span style={{ ...big, color: cur && cur.profitCents < 0 ? 'var(--ink-bad)' : 'var(--ink-good)' }}>{cur ? fmt(cur.profitCents) : '…'}</span>
          <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{cur?.marginBp != null ? `${L('Biên lãi', 'Margin')} ${(cur.marginBp / 100).toFixed(1)}%` : ''}</span>
          {cur && <Delta cur={cur.profitCents} prev={prev?.profitCents} vi={vi} />}
        </div>
        <div style={tile}>
          <span style={cap}>{L('TIỀN ĐANG CÓ (HÔM NAY)', 'MONEY ON HAND (TODAY)')}</span>
          <span style={{ ...big, color: 'var(--ink-sky)' }}>{fmt(onHand)}</span>
          <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{funds.filter((f) => !f.archived).map((f) => `${fundLabel(f, L)} ${fmt(f.balanceCents)}`).join(' · ')}</span>
        </div>
      </div>

      {pending && pendingCount > 0 && (
        <div style={{ ...ui.card, padding: 14, display: 'flex', flexDirection: 'column', gap: 8, border: '1px solid var(--ink-warn)' }}>
          <b style={{ fontSize: 15, color: 'var(--ce2e8f0)' }}>{L('Cần ghi sổ', 'Needs recording')} · {pendingCount}</b>
          {pending.payroll.map((r, i) => (
            <div key={r.runId} style={rowStyle}>
              <span style={{ flex: 1, minWidth: 0 }}><b>{L('Lương đã chốt chưa ghi trả', 'Closed payroll not yet paid')}</b><span style={sub}>{r.periodFrom} → {r.periodTo}</span></span>
              <b>{fmt(r.netPayCents)}</b>
              <button type="button" onClick={() => setDlg({ kind: 'payroll', i })} style={smallBtn}>{L('Ghi đã trả', 'Mark paid')}</button>
            </div>
          ))}
          {pending.recurring.map((r, i) => (
            <div key={r.id} style={rowStyle}>
              <span style={{ flex: 1, minWidth: 0 }}><b>{r.name}</b><span style={{ ...sub, color: r.overdue ? 'var(--ink-bad)' : 'var(--c94a3b8)' }}>{r.overdue ? L('Quá hạn', 'Overdue') : L('Đến hạn', 'Due')} {r.nextDue}</span></span>
              <b>{r.amountCents ? fmt(r.amountCents) : L('nhập số', 'enter amount')}</b>
              <button type="button" onClick={() => setDlg({ kind: 'rec', i })} style={smallBtn}>{L('Đã trả', 'Paid')}</button>
            </div>
          ))}
          {pending.stock.map((s, i) => (
            <div key={s.movementId} style={rowStyle}>
              <span style={{ flex: 1, minWidth: 0 }}><b>{L('Nhập kho chưa ghi trả', 'Stock bought, not yet paid')}: {s.item} × {s.qty}</b><span style={sub}>{s.supplier ?? ''}</span></span>
              <b>{fmt(s.amountCents)}</b>
              <button type="button" onClick={() => setDlg({ kind: 'stock', i })} style={smallBtn}>{L('Ghi đã trả', 'Mark paid')}</button>
            </div>
          ))}
          {pending.drawerToReview.count > 0 && (
            <div style={rowStyle}>
              <span style={{ flex: 1, minWidth: 0 }}><b>{L(`${pending.drawerToReview.count} khoản chi / thu ngăn kéo chưa phân loại`, `${pending.drawerToReview.count} drawer movements not classified`)}</b><span style={sub}>{L('Đang tạm tính là chi phí — chọn loại để lãi lỗ đúng.', 'Counted as a cost for now — classify them for an exact P&L.')}</span></span>
              <b>{fmt(pending.drawerToReview.cents)}</b>
              <Link href="/salon/finance?tab=ledger&review=1" style={{ ...smallBtn, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>{L('Phân loại', 'Classify')}</Link>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: 14, alignItems: 'start' }}>
        {cur ? <Statement fx={fx} cur={cur} prev={prev} /> : <div style={{ ...ui.card, color: 'var(--c94a3b8)' }}>{L('Đang tải…', 'Loading…')}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {cur && <Breakdown fx={fx} cur={cur} />}
          <Trend fx={fx} points={trend} />
        </div>
      </div>

      {dlg?.kind === 'payroll' && pending?.payroll[dlg.i] && <PayPayrollDialog fx={fx} run={pending.payroll[dlg.i]} onClose={() => setDlg(null)} />}
      {dlg?.kind === 'stock' && pending?.stock[dlg.i] && <PayStockDialog fx={fx} item={pending.stock[dlg.i]} onClose={() => setDlg(null)} />}
      {dlg?.kind === 'rec' && pending?.recurring[dlg.i] && <PayRecurringDialog fx={fx} rec={pending.recurring[dlg.i]} onClose={() => setDlg(null)} />}
    </div>
  );
}

const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 10, background: 'var(--c0f172a)', color: 'var(--ce2e8f0)', fontSize: 13.5, flexWrap: 'wrap' };
const sub: CSSProperties = { display: 'block', fontSize: 12, color: 'var(--c94a3b8)', fontWeight: 500 };
const smallBtn: CSSProperties = { ...ui.primaryBtn, padding: '0 12px', height: 36 };

/** The statement itself: sales → other income → costs by group → profit, each with its share of net sales. */
function Statement({ fx, cur, prev }: { fx: FinanceCtx; cur: Pnl; prev: Pnl | null }) {
  const { L, currency } = fx;
  const fmt = (c: number) => formatPrice(c, currency);
  const net = cur.revenue.netCents;
  const pct = (c: number) => (net > 0 ? `${((c / net) * 100).toFixed(1)}%` : '');
  const prevOf = (group: string, key: string) => prev?.expenses.find((s) => s.group === group)?.rows.find((r) => r.key === key)?.cents
    ?? (group === 'INCOME' ? prev?.otherIncome.rows.find((r) => r.key === key)?.cents : undefined);
  const head: CSSProperties = { padding: '9px 16px 3px', fontSize: 11, fontWeight: 800, letterSpacing: '.06em', color: 'var(--c94a3b8)', borderTop: '1px solid var(--line)' };
  const row = (label: string, cents: number, opts: { neg?: boolean; bold?: boolean; prev?: number; tint?: string } = {}) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px 62px 96px', gap: 8, padding: '7px 16px', fontSize: opts.bold ? 14 : 13, fontWeight: opts.bold ? 800 : 500, color: opts.tint ?? 'var(--ce2e8f0)', background: opts.bold ? 'var(--c0f172a)' : 'transparent' }}>
      <span style={{ minWidth: 0 }}>{label}</span>
      <span style={{ textAlign: 'right' }}>{opts.neg && cents ? '−' : ''}{fmt(cents)}</span>
      <span style={{ textAlign: 'right', color: 'var(--c94a3b8)', fontWeight: 500 }}>{pct(cents)}</span>
      <span style={{ textAlign: 'right', fontWeight: 500, color: 'var(--c94a3b8)' }}>{opts.prev !== undefined ? fmt(opts.prev) : ''}</span>
    </div>
  );
  return (
    <div style={{ ...ui.card, padding: 0, overflowX: 'auto' }}>
      <div style={{ minWidth: 460 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px' }}>
          <b style={{ fontSize: 15, color: 'var(--ce2e8f0)' }}>{L('Lãi / lỗ', 'Profit & loss')}</b>
          <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{prev ? L('cột cuối: kỳ so sánh', 'last column: compared period') : ''}</span>
        </div>
        {row(L('Doanh số (giá niêm yết)', 'Gross sales'), cur.revenue.grossCents, { prev: prev?.revenue.grossCents })}
        {row(L('Giảm giá', 'Discounts'), cur.revenue.discountCents, { neg: true, prev: prev?.revenue.discountCents })}
        {row(L('Hoàn tiền', 'Refunds'), cur.revenue.refundCents, { neg: true, prev: prev?.revenue.refundCents })}
        {row(L('Doanh thu thuần (= Báo cáo)', 'Net sales (= Reports)'), net, { bold: true, prev: prev?.revenue.netCents })}
        {cur.otherIncome.rows.length > 0 && <div style={head}>{L('THU NHẬP KHÁC', 'OTHER INCOME')}</div>}
        {cur.otherIncome.rows.map((r) => <div key={r.key}>{row(pnlRowLabel(r, L), r.cents, { prev: prevOf('INCOME', r.key) })}</div>)}
        {cur.expenses.map((s) => s.rows.length > 0 && (
          <div key={s.group}>
            <div style={head}>{groupLabel(s.group, L).toUpperCase()} · {fmt(s.totalCents)}</div>
            {s.rows.map((r) => (
              <div key={r.key}>
                {row(pnlRowLabel(r, L), r.cents, { neg: true, prev: prevOf(s.group, r.key), tint: r.budgetCents && r.cents > r.budgetCents ? 'var(--ink-bad)' : undefined })}
                {r.budgetCents ? <div style={{ padding: '0 16px 6px', fontSize: 11.5, color: r.cents > r.budgetCents ? 'var(--ink-bad)' : 'var(--c94a3b8)' }}>{L('Ngân sách', 'Budget')} {fmt(r.budgetCents)} · {Math.round((r.cents / r.budgetCents) * 100)}%</div> : null}
              </div>
            ))}
          </div>
        ))}
        <div style={{ borderTop: '2px solid var(--c475569)' }}>
          {row(L('Tổng chi phí', 'Total costs'), cur.expenseCents, { neg: true, bold: true, prev: prev?.expenseCents })}
          {row(cur.profitCents < 0 ? L('LỖ', 'LOSS') : L('LỢI NHUẬN', 'PROFIT'), cur.profitCents, { bold: true, prev: prev?.profitCents, tint: cur.profitCents < 0 ? 'var(--ink-bad)' : 'var(--ink-good)' })}
        </div>
        <div style={{ padding: '10px 16px 14px', fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.55, borderTop: '1px solid var(--line)' }}>
          {L('Không tính vào lãi lỗ (chỉ là tiền đi qua tiệm):', 'Not on the P&L (money that only passed through):')} {L('tip', 'tips')} {fmt(cur.outside.tipsCents)} · {L('thuế bán hàng thu hộ', 'sales tax collected')} {fmt(cur.outside.taxCents)}
          {cur.outside.nonPlInCents ? ` · ${L('vốn / vay vào', 'owner money / loans in')} ${fmt(cur.outside.nonPlInCents)}` : ''}
          {cur.outside.nonPlOutCents ? ` · ${L('rút vốn, trả nợ, tạm ứng…', 'draws, loan repayments, advances…')} ${fmt(cur.outside.nonPlOutCents)}` : ''}.
          {cur.unreviewedCents > 0 && <span style={{ color: 'var(--ink-warn)' }}> {L(`Có ${fmt(cur.unreviewedCents)} chi ngăn kéo chưa phân loại đang tính tạm là chi phí.`, `${fmt(cur.unreviewedCents)} of unclassified drawer cash is counted as a cost for now.`)}</span>}
        </div>
      </div>
    </div>
  );
}

function Breakdown({ fx, cur }: { fx: FinanceCtx; cur: Pnl }) {
  const { L, currency } = fx;
  const total = cur.expenseCents || 1;
  const groups = cur.expenses.filter((s) => s.totalCents > 0);
  return (
    <div style={{ ...ui.card, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <b style={{ fontSize: 15, color: 'var(--ce2e8f0)' }}>{L('Chi theo nhóm', 'Costs by group')}</b>
      {groups.length === 0 && <span style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{L('Chưa có chi phí trong kỳ.', 'No costs in this period.')}</span>}
      {groups.map((s) => {
        const w = Math.round((s.totalCents / total) * 100);
        return (
          <div key={s.group} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--ce2e8f0)' }}><span>{groupLabel(s.group, L)}</span><span><b>{formatPrice(s.totalCents, currency)}</b> · {w}%</span></div>
            <div style={{ height: 9, borderRadius: 5, background: 'var(--c0f172a)' }}><div style={{ height: 9, width: `${w}%`, borderRadius: 5, background: '#6366f1' }} /></div>
          </div>
        );
      })}
    </div>
  );
}

function Trend({ fx, points }: { fx: FinanceCtx; points: TrendPoint[] | null }) {
  const { L, currency } = fx;
  if (!points) return <div style={{ ...ui.card, color: 'var(--c94a3b8)', fontSize: 13 }}>{L('Đang tải 6 tháng…', 'Loading 6 months…')}</div>;
  const max = Math.max(1, ...points.map((p) => Math.max(p.incomeCents, p.expenseCents)));
  const short = (c: number) => `${c < 0 ? '−' : ''}${formatPrice(Math.abs(c), currency).replace(/\.00$/, '')}`;
  return (
    <div style={{ ...ui.card, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 15, color: 'var(--ce2e8f0)' }}>{L('Thu – chi 6 tháng', 'Income vs costs, 6 months')}</b>
        <span style={{ display: 'flex', gap: 10, fontSize: 11.5, color: 'var(--c94a3b8)' }}>
          <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: '#38bdf8' }} /> {L('Thu', 'Income')}</span>
          <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: '#f59e0b' }} /> {L('Chi', 'Costs')}</span>
        </span>
      </div>
      <div style={{ height: 150, display: 'flex', gap: 10, marginTop: 12, alignItems: 'flex-end' }}>
        {points.map((p) => (
          <div key={p.month} title={`${p.month}: ${short(p.incomeCents)} / ${short(p.expenseCents)}`} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div style={{ flex: 1, width: '100%', display: 'flex', gap: 3, alignItems: 'flex-end' }}>
              <div style={{ flex: 1, height: `${Math.max(1, (p.incomeCents / max) * 100)}%`, background: '#38bdf8', borderRadius: '3px 3px 0 0' }} />
              <div style={{ flex: 1, height: `${Math.max(1, (p.expenseCents / max) * 100)}%`, background: '#f59e0b', borderRadius: '3px 3px 0 0' }} />
            </div>
            <span style={{ fontSize: 11, color: 'var(--c94a3b8)' }}>{p.month.slice(5)}/{p.month.slice(2, 4)}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.6 }}>
        {L('Lợi nhuận', 'Profit')}: {points.map((p) => <span key={p.month} style={{ marginRight: 8, color: p.profitCents < 0 ? 'var(--ink-bad)' : 'var(--ce2e8f0)' }}>{p.month.slice(5)}/{p.month.slice(2, 4)} {short(p.profitCents)}</span>)}
      </div>
    </div>
  );
}
