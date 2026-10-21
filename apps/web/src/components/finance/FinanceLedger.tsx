'use client';

import { Fragment, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '../../lib/api';
import { ui, formatPrice } from '../../lib/ui';
import { fmtInTz, uiLocale } from '../../lib/datetime';
import { useIsMobile } from '../../lib/responsive';
import { PeriodFilter, usePeriod } from '../PeriodFilter';
import { TransferDialog, VoidDialog } from './FinanceDialogs';
import { cleanErr, fundLabel, lineLabel, sourceLabel, type FinanceCtx, type Ledger, type Line } from './finance-types';

/**
 * Sổ quỹ: every movement of real money, newest first, each with the balance
 * right after it. Opening + in − out = closing, for one fund or all of them.
 *
 * Lines the system reads from elsewhere are locked — they are corrected where
 * they were made (the bill, the shift, the payroll run). A drawer movement can
 * be told what it was for right here; a typed voucher can be corrected on its
 * day and voided after.
 */
type SourceFilter = 'all' | 'auto' | 'manual';

export function FinanceLedger({ fx }: { fx: FinanceCtx }) {
  const { token, L, vi, currency, funds, categories, version, today } = fx;
  const fmt = (c: number) => formatPrice(c, currency);
  const isMobile = useIsMobile();
  const sp = useSearchParams();
  const range = usePeriod('financeLedger', 'thisMonth');
  const [fundId, setFundId] = useState<string>('');
  const [data, setData] = useState<Ledger | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [src, setSrc] = useState<SourceFilter>('all');
  const [onlyReview, setOnlyReview] = useState(sp.get('review') === '1');
  const [showVoided, setShowVoided] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [bills, setBills] = useState<Record<string, { id: string; at: string; amountCents: number; orderId: string | null; orderNumber: number | string | null; provider: string | null }[]>>({});
  const [transfer, setTransfer] = useState(false);
  const [voiding, setVoiding] = useState<Line | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setErr(null);
    const p = new URLSearchParams({ from: range.from, to: range.to });
    if (fundId) p.set('fundId', fundId);
    try { setData(await apiFetch<Ledger>(`/finance/ledger?${p.toString()}`, { token })); }
    catch (e) { setErr(cleanErr(e)); }
  }, [token, range.from, range.to, fundId, version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);

  const catName = useCallback((id: string | null) => (id ? categories.find((c) => c.id === id)?.name ?? null : null), [categories]);
  const fundOf = (id: string) => (data?.fundList ?? funds).find((f) => f.id === id);
  const lines = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.lines ?? []).filter((l) => {
      if (!showVoided && l.voided) return false;
      if (onlyReview && !l.needsReview) return false;
      if (src === 'manual' && !(l.source === 'MANUAL' || l.source === 'RECURRING' || (l.source === 'TRANSFER' && !l.id.startsWith('mv:')))) return false;
      if (src === 'auto' && (l.source === 'MANUAL' || l.source === 'RECURRING')) return false;
      if (!needle) return true;
      const hay = [l.code, lineLabel(l, catName, L), l.payee, l.note, l.detail, l.createdByName].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }, [data, q, src, onlyReview, showVoided, catName, L]);

  async function expandSales(l: Line) {
    if (open === l.id) { setOpen(null); return; }
    setOpen(l.id);
    if (bills[l.id] || !token || l.ref?.kind !== 'salesDay') return;
    const [day, fid] = l.ref.id.split('|');
    try {
      const rows = await apiFetch<{ id: string; at: string; amountCents: number; orderId: string | null; orderNumber: number | string | null; provider: string | null }[]>(`/finance/sales-day?day=${day}&fundId=${fid}`, { token });
      setBills((b) => ({ ...b, [l.id]: rows }));
    } catch (e) { setErr(cleanErr(e)); }
  }

  async function classify(l: Line, categoryId: string) {
    if (!token) return;
    try {
      await apiFetch(`/finance/drawer/${l.id.slice(3)}`, { method: 'PATCH', token, body: { categoryId: categoryId || null } });
      fx.refresh();
    } catch (e) { setErr(cleanErr(e)); }
  }

  function exportCsv() {
    if (!data) return;
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = [L('Mã phiếu', 'Code'), L('Ngày', 'Date'), L('Giờ', 'Time'), L('Loại', 'Type'), L('Nội dung', 'Details'), L('Quỹ', 'Fund'), L('Nguồn', 'Source'), L('Thu', 'In'), L('Chi', 'Out'), L('Tồn', 'Balance'), L('Tính lãi lỗ', 'On P&L'), L('Trạng thái', 'Status')];
    const rows = lines.map((l) => [
      l.code ?? '', l.day, fmtInTz(l.at, { hour: '2-digit', minute: '2-digit' }), lineLabel(l, catName, L),
      [l.payee, l.note, l.detail].filter(Boolean).join(' · '), fundLabel(fundOf(l.fundId), L), sourceLabel(l.source, L),
      l.direction === 'IN' ? (l.amountCents / 100).toFixed(2) : '', l.direction === 'OUT' ? (l.amountCents / 100).toFixed(2) : '',
      l.balanceCents === null ? '' : (l.balanceCents / 100).toFixed(2), l.countsInPl ? 'x' : '', l.voided ? `${L('Đã huỷ', 'Void')}: ${l.voided.reason ?? ''}` : '',
    ]);
    const csv = '﻿' + [head, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `so-quy_${range.from}_${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // Lines grouped by day, with the day's own in / out.
  const byDay = useMemo(() => {
    const m = new Map<string, Line[]>();
    for (const l of lines) { const a = m.get(l.day) ?? []; a.push(l); m.set(l.day, a); }
    return [...m.entries()];
  }, [lines]);
  const dayTotal = (day: string) => data?.days.find((d) => d.day === day);
  const dayName = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(uiLocale(), { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
  const reviewCount = (data?.lines ?? []).filter((l) => l.needsReview && !l.voided).length;

  const tile: CSSProperties = { ...ui.card, padding: '12px 15px', display: 'flex', flexDirection: 'column', gap: 2 };
  const cap: CSSProperties = { fontSize: 11.5, fontWeight: 800, letterSpacing: '.04em', color: 'var(--c94a3b8)' };
  const segBase: CSSProperties = { padding: '7px 11px', borderRadius: 8, border: 'none', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' };
  const seg = (on: boolean): CSSProperties => (on
    ? { ...segBase, background: '#4f46e5', color: '#fff' }
    : { ...segBase, background: 'transparent', color: 'var(--c94a3b8)' });

  const outCats = categories.filter((c) => c.direction === 'OUT' && !c.hidden && !c.system);
  const inCats = categories.filter((c) => c.direction === 'IN' && !c.hidden && !c.system);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <PeriodFilter state={range} vi={vi} />
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => setTransfer(true)} style={{ ...ui.primaryBtn, background: 'transparent', color: 'var(--ce2e8f0)', border: '1px solid var(--c475569)', height: 38 }}>⇄ {L('Chuyển quỹ', 'Transfer')}</button>
        <button type="button" onClick={exportCsv} disabled={!data} style={{ ...ui.primaryBtn, background: 'transparent', color: 'var(--ce2e8f0)', border: '1px solid var(--c475569)', height: 38 }}>{L('Xuất CSV', 'Export CSV')}</button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[{ id: '', name: L('Tất cả quỹ', 'All funds'), bal: (data?.fundList ?? funds).filter((f) => !f.archived).reduce((n, f) => n + f.balanceCents, 0) },
          ...(data?.fundList ?? funds).filter((f) => !f.archived || f.id === fundId).map((f) => ({ id: f.id, name: fundLabel(f, L), bal: f.balanceCents }))].map((f) => (
          <button key={f.id || 'all'} type="button" onClick={() => setFundId(f.id)}
            style={{ textAlign: 'left', padding: '7px 14px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', border: fundId === f.id ? '2px solid #6366f1' : '1px solid var(--c334155)', background: fundId === f.id ? 'rgba(99,102,241,.14)' : 'transparent', color: 'var(--ce2e8f0)' }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>{f.name}</span>
            <span style={{ fontSize: 11.5, color: 'var(--c94a3b8)' }}>{L('hôm nay', 'today')} {fmt(f.bal)}</span>
          </button>
        ))}
      </div>

      {err && <div style={ui.banner}>{err}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        <div style={tile}><span style={cap}>{L('TỒN ĐẦU KỲ', 'OPENING')} · {range.from}</span><span style={{ fontSize: 21, fontWeight: 800, color: 'var(--ce2e8f0)' }}>{data ? fmt(data.openingCents) : '…'}</span></div>
        <div style={tile}><span style={cap}>{L('TỔNG THU', 'MONEY IN')}</span><span style={{ fontSize: 21, fontWeight: 800, color: 'var(--ink-good)' }}>{data ? `+${fmt(data.inCents)}` : '…'}</span></div>
        <div style={tile}><span style={cap}>{L('TỔNG CHI', 'MONEY OUT')}</span><span style={{ fontSize: 21, fontWeight: 800, color: 'var(--ink-warn)' }}>{data ? `−${fmt(data.outCents)}` : '…'}</span>
          {data && !fundId && data.transferCents > 0 && <span style={{ fontSize: 11.5, color: 'var(--c94a3b8)' }}>{L('chuyển giữa quỹ', 'moved between funds')} {fmt(data.transferCents)} {L('không tính', 'not counted')}</span>}
        </div>
        <div style={{ ...tile, border: '1px solid var(--ink-sky)' }}><span style={cap}>{L('TỒN CUỐI KỲ', 'CLOSING')} · {range.to}</span><span style={{ fontSize: 21, fontWeight: 800, color: 'var(--ink-sky)' }}>{data ? fmt(data.closingCents) : '…'}</span><span style={{ fontSize: 11.5, color: 'var(--c94a3b8)' }}>= {L('đầu kỳ + thu − chi', 'opening + in − out')}</span></div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L('Tìm mã phiếu, nội dung, người nhận…', 'Search code, details, payee…')} style={{ ...ui.input, flex: '1 1 220px', width: 'auto', height: 38 }} />
        <span style={{ display: 'inline-flex', padding: 3, borderRadius: 10, border: '1px solid var(--c334155)' }}>
          <button type="button" style={seg(src === 'all')} onClick={() => setSrc('all')}>{L('Tất cả', 'All')}</button>
          <button type="button" style={seg(src === 'auto')} onClick={() => setSrc('auto')}>{L('Tự động', 'Automatic')}</button>
          <button type="button" style={seg(src === 'manual')} onClick={() => setSrc('manual')}>{L('Gõ tay', 'Typed')}</button>
        </span>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: reviewCount ? 'var(--ink-warn)' : 'var(--c94a3b8)' }}>
          <input type="checkbox" checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)} /> {L('Chưa phân loại', 'Unclassified')} ({reviewCount})
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--c94a3b8)' }}>
          <input type="checkbox" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} /> {L('Hiện phiếu đã huỷ', 'Show voided')}
        </label>
      </div>

      {!data ? <p style={{ color: 'var(--c94a3b8)' }}>{L('Đang tải…', 'Loading…')}</p>
        : byDay.length === 0 ? <div style={{ ...ui.card, color: 'var(--c94a3b8)', fontSize: 14 }}>{L('Không có khoản nào trong kỳ này.', 'Nothing in this period.')}</div>
        : (
          <div style={{ ...ui.card, padding: 0, overflowX: 'auto' }}>
            <div style={{ minWidth: isMobile ? 0 : 980 }}>
              {byDay.map(([day, ls]) => {
                const t = dayTotal(day);
                return (
                  <Fragment key={day}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '8px 14px', background: 'var(--c0f172a)', borderTop: '1px solid var(--line)', fontSize: 12.5, fontWeight: 800, color: 'var(--ce2e8f0)', flexWrap: 'wrap' }}>
                      <span style={{ textTransform: 'capitalize' }}>{dayName(day)}</span>
                      {t && <span style={{ color: 'var(--c94a3b8)', fontWeight: 700 }}>{L('thu', 'in')} <span style={{ color: 'var(--ink-good)' }}>+{fmt(t.inCents)}</span> · {L('chi', 'out')} <span style={{ color: 'var(--ink-warn)' }}>−{fmt(t.outCents)}</span></span>}
                    </div>
                    {ls.map((l) => {
                      const label = lineLabel(l, catName, L);
                      const detail = [l.payee, l.note, l.detail].filter(Boolean).join(' · ');
                      const struck = l.voided ? { textDecoration: 'line-through', opacity: 0.6 } as CSSProperties : {};
                      const entryId = l.id.startsWith('entry:') ? l.id.slice(6) : null;
                      const amount = <span style={{ fontWeight: 800, color: l.direction === 'IN' ? 'var(--ink-good)' : 'var(--ink-warn)', ...struck }}>{l.direction === 'IN' ? '+' : '−'}{fmt(l.amountCents)}</span>;
                      const refLink = l.ref?.kind === 'order' ? `/salon/orders?id=${l.ref.id}` : l.ref?.kind === 'shift' ? '/salon/pos/shifts' : l.ref?.kind === 'payroll' ? '/salon/payroll' : l.ref?.kind === 'stock' ? '/salon/inventory' : null;
                      const actions = (
                        <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          {l.source === 'SALES' && <button type="button" onClick={() => void expandSales(l)} style={linkBtn}>{open === l.id ? L('Ẩn', 'Hide') : L(`${l.ref?.count ?? ''} bill ▸`, `${l.ref?.count ?? ''} bills ▸`)}</button>}
                          {refLink && <Link href={refLink} style={{ ...linkBtn, textDecoration: 'none' }}>{L('Mở', 'Open')} ↗</Link>}
                          {entryId && !l.voided && l.source === 'MANUAL' && l.day === today && <button type="button" style={linkBtn} onClick={() => fx.openEntry({ id: entryId, direction: l.direction, amountCents: l.amountCents, fundId: l.fundId, categoryId: l.categoryId, day: l.day, payee: l.payee ?? null, note: l.note ?? null, countsInPl: l.countsInPl })}>{L('Sửa', 'Edit')}</button>}
                          {entryId && !l.voided && <button type="button" style={{ ...linkBtn, color: 'var(--ink-bad)' }} onClick={() => setVoiding(l)}>{L('Huỷ', 'Void')}</button>}
                        </span>
                      );
                      const classifySel = l.id.startsWith('mv:') && !l.id.endsWith(':bank') && !l.voided && (
                        <select value={l.categoryId ?? ''} onChange={(e) => void classify(l, e.target.value)} aria-label={L('Chi cho việc gì', 'What it was for')}
                          style={{ ...ui.input, width: 'auto', maxWidth: 220, height: 32, padding: '0 8px', fontSize: 12.5, borderColor: l.needsReview ? 'var(--ink-warn)' : 'var(--c475569)' }}>
                          <option value="">{L('— Chưa phân loại —', '— Unclassified —')}</option>
                          {(l.direction === 'OUT' ? outCats : inCats).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      );
                      return (
                        <Fragment key={l.id}>
                          {isMobile ? (
                            <div style={{ padding: '10px 14px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 4, color: 'var(--ce2e8f0)' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                                <span style={{ fontWeight: 700, fontSize: 13.5, ...struck }}>{label}</span>{amount}
                              </div>
                              <div style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{fmtInTz(l.at, { hour: 'numeric', minute: '2-digit' })} · {fundLabel(fundOf(l.fundId), L)} · {sourceLabel(l.source, L)}{l.code ? ` · ${l.code}` : ''}{l.balanceCents !== null ? ` · ${L('tồn', 'bal.')} ${fmt(l.balanceCents)}` : ''}</div>
                              {detail && <div style={{ fontSize: 12.5, color: 'var(--ccbd5e1)' }}>{detail}</div>}
                              {l.voided && <div style={{ fontSize: 12, color: 'var(--ink-warn)' }}>{L('Đã huỷ', 'Voided')}{l.voided.by ? ` · ${l.voided.by}` : ''}: {l.voided.reason}</div>}
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>{classifySel}{actions}</div>
                            </div>
                          ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: '108px 56px minmax(0,1.2fr) minmax(0,1.8fr) 130px 110px 100px 100px minmax(120px,auto)', gap: 10, padding: '9px 14px', borderTop: '1px solid var(--line)', alignItems: 'center', fontSize: 13, color: 'var(--ce2e8f0)', background: l.needsReview ? 'rgba(245,158,11,.06)' : 'transparent' }}>
                              <span style={{ fontWeight: 700, fontSize: 12, ...struck }}>{l.code ?? '—'}</span>
                              <span style={{ color: 'var(--c94a3b8)', fontSize: 12 }}>{l.source === 'SALES' ? L('cả ngày', 'all day') : fmtInTz(l.at, { hour: 'numeric', minute: '2-digit' })}</span>
                              <span style={{ fontWeight: 700, ...struck }}>{label}{!l.countsInPl && l.source !== 'SALES' && l.source !== 'REFUND' && l.source !== 'TRANSFER' ? <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700, color: 'var(--c94a3b8)' }}>{L('ngoài lãi lỗ', 'off P&L')}</span> : null}</span>
                              <span style={{ minWidth: 0 }}>
                                <span style={{ color: 'var(--ccbd5e1)', ...struck }}>{detail || '—'}</span>
                                {l.createdByName && <span style={{ color: 'var(--c94a3b8)', fontSize: 12 }}> · {l.createdByName}</span>}
                                {l.voided && <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-warn)' }}>{L('Đã huỷ', 'Voided')}{l.voided.by ? ` · ${l.voided.by}` : ''}: {l.voided.reason}</span>}
                                {classifySel && <span style={{ display: 'block', marginTop: 4 }}>{classifySel}</span>}
                              </span>
                              <span style={{ fontSize: 12.5 }}>{fundLabel(fundOf(l.fundId), L)}</span>
                              <span><span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 6, border: '1px solid var(--c334155)', color: 'var(--c94a3b8)', fontWeight: 700, whiteSpace: 'nowrap' }}>{sourceLabel(l.source, L)}{l.locked ? ' 🔒' : ''}</span></span>
                              <span style={{ textAlign: 'right' }}>{amount}</span>
                              <span style={{ textAlign: 'right', fontWeight: 700 }}>{l.balanceCents === null ? '—' : fmt(l.balanceCents)}</span>
                              {actions}
                            </div>
                          )}
                          {open === l.id && (
                            <div style={{ padding: '6px 14px 10px 40px', background: 'var(--c0f172a)', fontSize: 12.5, color: 'var(--ccbd5e1)' }}>
                              {!bills[l.id] ? L('Đang tải…', 'Loading…') : bills[l.id].map((b) => (
                                <div key={b.id} style={{ display: 'flex', gap: 10, padding: '3px 0' }}>
                                  <span style={{ width: 64, color: 'var(--c94a3b8)' }}>{fmtInTz(b.at, { hour: 'numeric', minute: '2-digit' })}</span>
                                  <span style={{ flex: 1 }}>{b.orderId ? <Link href={`/salon/orders?id=${b.orderId}`} style={{ color: 'var(--ink-link)' }}>{L('Bill', 'Bill')} #{b.orderNumber ?? '…'}</Link> : (b.provider ?? '')}</span>
                                  <b>{fmt(b.amountCents)}</b>
                                </div>
                              ))}
                            </div>
                          )}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                );
              })}
            </div>
          </div>
        )}

      <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.55 }}>
        {L('🔒 Dòng tự động: sửa ở chỗ gốc (bill, ca thu ngân, bảng lương, kho). Phiếu gõ tay: sửa trong ngày lập, sau đó chỉ huỷ được — phiếu huỷ vẫn ở lại sổ.', '🔒 Automatic lines are corrected where they were made (bill, cashier shift, payroll, inventory). Typed vouchers can be edited on their day, then only voided — a voided voucher stays in the book.')}
      </div>

      {transfer && <TransferDialog fx={fx} onClose={() => setTransfer(false)} />}
      {voiding && voiding.id.startsWith('entry:') && <VoidDialog fx={fx} entryId={voiding.id.slice(6)} code={voiding.code ?? ''} amountCents={voiding.amountCents} onClose={() => setVoiding(null)} />}
    </div>
  );
}

const linkBtn: CSSProperties = { background: 'none', border: '1px solid var(--c334155)', borderRadius: 8, padding: '4px 9px', color: 'var(--ink-link)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' };
