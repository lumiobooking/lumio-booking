'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api';
import { fmtInTz } from '../lib/datetime';
import { fromMinorUnits, toMinorUnits, ui } from '../lib/ui';
import { ind } from '../lib/ui-industry';

/**
 * The cashier shift ("ca thu ngân") on the till.
 *
 * Three moments, one panel: open the drawer with the float you counted, log
 * cash you put in or take out while selling, and at hand-over count the
 * drawer against what the system expects. The closed sheet is frozen on the
 * server and printed from here, so the number two cashiers agreed on at 9 pm
 * is the number the owner reads in the morning.
 */

export interface ShiftView {
  id: string; status: 'OPEN' | 'CLOSED' | string;
  openedByName: string | null; openedAt: string; openingCents: number; openNote: string | null;
  closedByName: string | null; closedAt: string | null;
  expectedCashCents: number | null; countedCents: number | null; varianceCents: number | null; closeNote: string | null;
}
export interface ShiftSummary {
  orders: number; revenueCents: number; tipsCents: number;
  byMethod: { cashCents: number; cardCents: number; otherCents: number; giftCardCents: number };
  byTender: Record<string, number>;
  changeCents: number; cashInCents: number; cashOutCents: number; expectedCashCents: number;
  movements: { id: string; kind: 'IN' | 'OUT'; amountCents: number; reason: string | null; byName: string | null; at: string }[];
}
export interface ShiftState { requireShift: boolean; shift: ShiftView | null; summary: ShiftSummary | null }

const TENDER_LABEL: Record<string, [string, string]> = {
  CASH: ['Tiền mặt', 'Cash'], CARD: ['Thẻ', 'Card'], TRANSFER: ['Chuyển khoản', 'Transfer'], VIETQR: ['VietQR', 'VietQR'],
  MOMO: ['MoMo', 'MoMo'], ZALOPAY: ['ZaloPay', 'ZaloPay'], OTHER: ['Khác', 'Other'],
};

export function CashShiftPanel({ token, vi, currency, fmt, salonName, cashierName, onState, onClose, onHistory }: {
  token: string | null; vi: boolean; currency: string; fmt: (cents: number) => string;
  salonName?: string; cashierName?: string;
  /** Fires whenever the open/closed state changes so the till can show its badge and gate checkout. */
  onState?: (s: ShiftState) => void;
  onClose: () => void;
  onHistory?: () => void;
}) {
  const L = (v: string, e: string) => ind(vi ? v : e);
  const [st, setSt] = useState<ShiftState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState('');
  const [openNote, setOpenNote] = useState('');
  const [mvKind, setMvKind] = useState<'IN' | 'OUT'>('OUT');
  const [mvAmount, setMvAmount] = useState('');
  const [mvReason, setMvReason] = useState('');
  const [counted, setCounted] = useState('');
  const [closeNote, setCloseNote] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [closed, setClosed] = useState<{ shift: ShiftView; summary: ShiftSummary } | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const s = await apiFetch<ShiftState>('/pos/shifts/current', { token });
      setSt(s); onState?.(s);
    } catch (e) { setErr(e instanceof Error ? e.message : 'error'); }
  }, [token, onState]);
  useEffect(() => { void load(); }, [load]);

  const say = (e: unknown) => setErr(e instanceof Error ? e.message.replace(/^Bad Request Exception:?\s*/i, '') : String(e));

  async function open() {
    if (!token) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch<{ shift: ShiftView; summary: ShiftSummary }>('/pos/shifts/open', { method: 'POST', token, body: { openingCents: toMinorUnits(opening || '0', currency), note: openNote } });
      const next = { requireShift: st?.requireShift ?? false, ...r };
      setSt(next); onState?.(next); setOpening(''); setOpenNote('');
    } catch (e) { say(e); } finally { setBusy(false); }
  }

  async function addMove() {
    if (!token) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch<{ shift: ShiftView; summary: ShiftSummary }>('/pos/shifts/current/movements', { method: 'POST', token, body: { kind: mvKind, amountCents: toMinorUnits(mvAmount || '0', currency), reason: mvReason } });
      setSt((s) => ({ requireShift: s?.requireShift ?? false, ...r })); setMvAmount(''); setMvReason('');
    } catch (e) { say(e); } finally { setBusy(false); }
  }

  async function removeMove(id: string) {
    if (!token) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch<{ shift: ShiftView; summary: ShiftSummary }>(`/pos/shifts/current/movements/${id}`, { method: 'DELETE', token });
      setSt((s) => ({ requireShift: s?.requireShift ?? false, ...r }));
    } catch (e) { say(e); } finally { setBusy(false); }
  }

  async function close() {
    if (!token) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch<{ shift: ShiftView; summary: ShiftSummary }>('/pos/shifts/current/close', { method: 'POST', token, body: { countedCents: toMinorUnits(counted || '0', currency), note: closeNote } });
      setClosed(r);
      const next = { requireShift: st?.requireShift ?? false, shift: null, summary: null };
      setSt(next); onState?.(next); setConfirmClose(false);
    } catch (e) { say(e); } finally { setBusy(false); }
  }

  const shift = st?.shift ?? null;
  const sum = st?.summary ?? null;
  const countedCents = counted.trim() === '' ? null : toMinorUnits(counted, currency);
  const variance = countedCents === null || !sum ? null : countedCents - sum.expectedCashCents;

  const head = (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{L('Ca thu ngân', 'Cashier shift')}</span>
        {shift && <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{L('Mở lúc', 'Opened')} {fmtInTz(shift.openedAt, { hour: 'numeric', minute: '2-digit' })}{shift.openedByName ? ` · ${shift.openedByName}` : ''} · {L('Đầu ca', 'Float')} {fmt(shift.openingCents)}</span>}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {onHistory && <button type="button" onClick={onHistory} style={ghost}>{L('Lịch sử ca', 'History')}</button>}
        <button type="button" onClick={onClose} aria-label={L('Đóng', 'Close')} style={{ background: 'none', border: 'none', color: 'var(--c94a3b8)', fontSize: 22, cursor: 'pointer' }}>×</button>
      </div>
    </div>
  );

  let body: React.ReactNode;
  if (closed) {
    body = (
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ padding: '10px 12px', borderRadius: 10, background: (closed.shift.varianceCents ?? 0) === 0 ? 'var(--c052e16)' : (closed.shift.varianceCents ?? 0) < 0 ? 'rgba(239,68,68,.10)' : 'rgba(245,158,11,.12)', color: (closed.shift.varianceCents ?? 0) === 0 ? 'var(--ink-good)' : (closed.shift.varianceCents ?? 0) < 0 ? 'var(--ink-bad)' : 'var(--ink-warn)', fontSize: 14, fontWeight: 600 }}>
          {L('Đã chốt ca và bàn giao.', 'Shift closed and handed over.')} {closed.shift.varianceCents === 0 ? L('Két khớp đúng.', 'Drawer balanced.') : `${L('Chênh lệch', 'Variance')}: ${signed(closed.shift.varianceCents ?? 0, fmt)} ${(closed.shift.varianceCents ?? 0) < 0 ? L('(thiếu)', '(short)') : L('(dư)', '(over)')}`}
        </div>
        <ShiftSheet shift={closed.shift} summary={closed.summary} vi={vi} fmt={fmt} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => printSheet(closed.shift, closed.summary, vi, fmt, salonName)} style={{ ...ui.primaryBtn, flex: 1, padding: '11px 14px', fontSize: 14 }}>{L('In phiếu chốt ca', 'Print hand-over sheet')}</button>
          <button type="button" onClick={() => { setClosed(null); }} style={{ ...ghost, flex: 1 }}>{L('Vào ca mới', 'Open next shift')}</button>
        </div>
      </div>
    );
  } else if (!st) {
    body = <div style={{ padding: 16, color: 'var(--c94a3b8)', fontSize: 13 }}>{L('Đang tải…', 'Loading…')}</div>;
  } else if (!shift) {
    body = (
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(245,158,11,.12)', color: 'var(--ink-warn)', fontSize: 13.5, lineHeight: 1.45 }}>
          {L('Chưa có ca nào đang mở.', 'No shift is open.')} {st.requireShift ? L('Tiệm yêu cầu vào ca trước khi thu tiền.', 'This salon requires a shift before taking payment.') : L('Vào ca để theo dõi tiền mặt trong két.', 'Open one to track the cash drawer.')}
        </div>
        <label style={lab}>{L('Tiền mặt đầu ca (tiền lẻ để thối)', 'Opening float (cash in the drawer now)')}
          <input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder={fromMinorUnits(0, currency)} style={inp} />
        </label>
        <label style={lab}>{L('Ghi chú (không bắt buộc)', 'Note (optional)')}
          <input value={openNote} onChange={(e) => setOpenNote(e.target.value)} placeholder={L('VD: ca sáng, Lan nhận két từ Minh', 'e.g. morning shift, Lan takes over from Minh')} style={inp} />
        </label>
        {cashierName && <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{L('Người mở ca', 'Opened by')}: {cashierName}</div>}
        <button type="button" disabled={busy} onClick={() => void open()} style={{ ...ui.primaryBtn, padding: '12px 14px', fontSize: 15 }}>{L('Vào ca', 'Open shift')}</button>
      </div>
    );
  } else {
    const s = sum!;
    body = (
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
          <Stat label={L('Đơn đã thu', 'Sales')} value={String(s.orders)} />
          <Stat label={L('Doanh thu', 'Revenue')} value={fmt(s.revenueCents)} />
          <Stat label={L('Tiền mặt thu', 'Cash taken')} value={fmt(s.byMethod.cashCents)} sub={s.changeCents ? `${L('thối', 'change')} −${fmt(s.changeCents)}` : undefined} />
          <Stat label={L('Thẻ', 'Card')} value={fmt(s.byMethod.cardCents)} />
          {(s.byMethod.otherCents > 0) && <Stat label={L('Chuyển khoản / ví', 'Transfer / wallets')} value={fmt(s.byMethod.otherCents)} />}
          {(s.byMethod.giftCardCents > 0) && <Stat label={L('Gift card', 'Gift card')} value={fmt(s.byMethod.giftCardCents)} />}
          <Stat label={L('Tip', 'Tips')} value={fmt(s.tipsCents)} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={secLabel}>{L('THU / CHI TIỀN MẶT TRONG CA', 'CASH IN / OUT THIS SHIFT')}</div>
          {s.movements.length === 0 && <div style={{ fontSize: 13, color: 'var(--c64748b)' }}>{L('Chưa có khoản nào.', 'Nothing yet.')}</div>}
          {s.movements.map((m) => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--ce2e8f0)' }}>
              <span style={{ width: 60, fontWeight: 700, color: m.kind === 'IN' ? 'var(--ink-good)' : 'var(--ink-bad)' }}>{m.kind === 'IN' ? '+' : '−'}{fmt(m.amountCents)}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.reason}</span>
              <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{fmtInTz(m.at, { hour: 'numeric', minute: '2-digit' })}{m.byName ? ` · ${m.byName}` : ''}</span>
              <button type="button" disabled={busy} onClick={() => void removeMove(m.id)} aria-label={L('Xoá', 'Remove')} style={{ background: 'none', border: 'none', color: 'var(--c94a3b8)', fontSize: 18, cursor: 'pointer', padding: '0 4px' }}>×</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', borderRadius: 9, border: '1px solid var(--c334155)', overflow: 'hidden' }}>
              {(['OUT', 'IN'] as const).map((k) => (
                <button key={k} type="button" onClick={() => setMvKind(k)} style={{ height: 40, padding: '0 12px', border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer', background: mvKind === k ? '#4f46e5' : 'transparent', color: mvKind === k ? '#fff' : 'var(--c94a3b8)' }}>{k === 'OUT' ? L('− Chi', '− Out') : L('+ Thu', '+ In')}</button>
              ))}
            </div>
            <input inputMode="decimal" value={mvAmount} onChange={(e) => setMvAmount(e.target.value)} placeholder={L('Số tiền', 'Amount')} style={{ ...inp, flex: '0 0 110px', height: 40 }} />
            <input value={mvReason} onChange={(e) => setMvReason(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addMove(); }} placeholder={mvKind === 'OUT' ? L('Lý do: mua đồ, trả thợ, nộp ngân hàng…', 'Reason: supplies, pay a tech, bank drop…') : L('Lý do: đổi tiền lẻ, chủ đưa thêm…', 'Reason: change float, owner top-up…')} style={{ ...inp, flex: '1 1 160px', height: 40 }} />
            <button type="button" disabled={busy || !mvAmount || !mvReason.trim()} onClick={() => void addMove()} style={{ ...ui.primaryBtn, height: 40, opacity: !mvAmount || !mvReason.trim() ? 0.5 : 1 }}>{L('Ghi', 'Log')}</button>
          </div>
        </div>

        <div style={{ padding: 12, borderRadius: 12, border: '1px solid var(--line)', background: 'var(--c0f172a)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={secLabel}>{L('CHỐT CA & BÀN GIAO', 'CLOSE & HAND OVER')}</div>
          <Row k={L('Tiền đầu ca', 'Opening float')} v={fmt(shift.openingCents)} />
          <Row k={L('+ Tiền mặt thu (đã trừ thối)', '+ Cash taken (net of change)')} v={fmt(s.byMethod.cashCents - s.changeCents)} />
          {s.cashInCents > 0 && <Row k={L('+ Thu thêm', '+ Cash in')} v={fmt(s.cashInCents)} />}
          {s.cashOutCents > 0 && <Row k={L('− Chi ra', '− Cash out')} v={`−${fmt(s.cashOutCents)}`} />}
          <Row k={L('= Két phải có', '= Drawer should hold')} v={fmt(s.expectedCashCents)} strong />
          <label style={lab}>{L('Tiền mặt đếm được trong két', 'Cash counted in the drawer')}
            <div style={{ display: 'flex', gap: 6 }}>
              <input inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder={fromMinorUnits(s.expectedCashCents, currency)} style={{ ...inp, fontSize: 18, fontWeight: 700 }} />
              <button type="button" onClick={() => setCounted(fromMinorUnits(s.expectedCashCents, currency))} style={ghost}>{L('Khớp đúng', 'Matches')}</button>
            </div>
          </label>
          {variance !== null && (
            <div style={{ fontSize: 14, fontWeight: 700, color: variance === 0 ? 'var(--ink-good)' : variance < 0 ? 'var(--ink-bad)' : 'var(--ink-warn)' }}>
              {variance === 0 ? L('Khớp — không chênh lệch.', 'Balanced — no variance.') : `${L('Chênh lệch', 'Variance')}: ${signed(variance, fmt)} ${variance < 0 ? L('(thiếu)', '(short)') : L('(dư)', '(over)')}`}
            </div>
          )}
          <input value={closeNote} onChange={(e) => setCloseNote(e.target.value)} placeholder={L('Ghi chú bàn giao (không bắt buộc)', 'Hand-over note (optional)')} style={inp} />
          {!confirmClose ? (
            <button type="button" disabled={busy || countedCents === null} onClick={() => setConfirmClose(true)} style={{ ...ui.primaryBtn, padding: '12px 14px', fontSize: 15, opacity: countedCents === null ? 0.5 : 1 }}>{L('Chốt ca', 'Close shift')}</button>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" disabled={busy} onClick={() => void close()} style={{ ...ui.primaryBtn, flex: 1, padding: '12px 14px', fontSize: 15, background: '#dc2626' }}>{L('Xác nhận chốt & bàn giao', 'Confirm close & hand over')}</button>
              <button type="button" onClick={() => setConfirmClose(false)} style={ghost}>{L('Huỷ', 'Cancel')}</button>
            </div>
          )}
          <div style={{ fontSize: 12, color: 'var(--c64748b)', lineHeight: 1.45 }}>{L('Sau khi chốt, số liệu của ca được khoá và in được phiếu bàn giao. Tip tiền mặt nằm trong két — trả thợ rồi ghi "Chi" nếu muốn két khớp.', 'After closing, the figures are frozen and the hand-over sheet can be printed. Cash tips sit in the drawer — pay them out and log an "Out" if you want the drawer to balance.')}</div>
        </div>
      </div>
    );
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.7)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...ui.card, width: 'min(560px, 96vw)', maxHeight: '90vh', overflowY: 'auto', padding: 0 }}>
        {head}
        {err && <div style={{ margin: '12px 14px 0', padding: '9px 12px', borderRadius: 9, background: 'rgba(239,68,68,.10)', color: 'var(--ink-bad)', fontSize: 13.5, fontWeight: 600 }}>{err}</div>}
        {body}
      </div>
    </div>
  );
}

/** The frozen hand-over sheet: what the cashier signed for. Also the history page's detail. */
export function ShiftSheet({ shift, summary, vi, fmt }: { shift: ShiftView; summary: ShiftSummary; vi: boolean; fmt: (c: number) => string }) {
  const L = (v: string, e: string) => ind(vi ? v : e);
  const tenders = Object.entries(summary.byTender ?? {}).filter(([, v]) => v > 0);
  return (
    <div style={{ borderRadius: 12, border: '1px solid var(--line)', background: 'var(--c0f172a)', padding: 12, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13.5, color: 'var(--ce2e8f0)' }}>
      <Row k={L('Mở ca', 'Opened')} v={`${fmtInTz(shift.openedAt, { day: '2-digit', month: '2-digit', hour: 'numeric', minute: '2-digit' })}${shift.openedByName ? ` · ${shift.openedByName}` : ''}`} />
      {shift.closedAt && <Row k={L('Chốt ca', 'Closed')} v={`${fmtInTz(shift.closedAt, { day: '2-digit', month: '2-digit', hour: 'numeric', minute: '2-digit' })}${shift.closedByName ? ` · ${shift.closedByName}` : ''}`} />}
      <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />
      <Row k={L('Đơn đã thu', 'Sales')} v={String(summary.orders)} />
      <Row k={L('Doanh thu', 'Revenue')} v={fmt(summary.revenueCents)} />
      <Row k={L('Tip', 'Tips')} v={fmt(summary.tipsCents)} />
      {tenders.map(([m, v]) => <Row key={m} k={`  ${TENDER_LABEL[m]?.[vi ? 0 : 1] ?? m}`} v={fmt(v)} />)}
      {summary.byMethod.giftCardCents > 0 && <Row k={`  ${L('Gift card', 'Gift card')}`} v={fmt(summary.byMethod.giftCardCents)} />}
      <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />
      <Row k={L('Tiền đầu ca', 'Opening float')} v={fmt(shift.openingCents)} />
      <Row k={L('+ Tiền mặt thu (đã trừ thối)', '+ Cash taken (net of change)')} v={fmt(summary.byMethod.cashCents - summary.changeCents)} />
      {summary.cashInCents > 0 && <Row k={L('+ Thu thêm', '+ Cash in')} v={fmt(summary.cashInCents)} />}
      {summary.cashOutCents > 0 && <Row k={L('− Chi ra', '− Cash out')} v={`−${fmt(summary.cashOutCents)}`} />}
      <Row k={L('= Két phải có', '= Drawer should hold')} v={fmt(summary.expectedCashCents)} strong />
      {shift.countedCents !== null && shift.countedCents !== undefined && <Row k={L('Đếm được', 'Counted')} v={fmt(shift.countedCents)} strong />}
      {shift.varianceCents !== null && shift.varianceCents !== undefined && (
        <Row k={L('Chênh lệch', 'Variance')} v={shift.varianceCents === 0 ? L('Khớp', 'Balanced') : `${signed(shift.varianceCents, fmt)} ${shift.varianceCents < 0 ? L('(thiếu)', '(short)') : L('(dư)', '(over)')}`} strong color={shift.varianceCents === 0 ? 'var(--ink-good)' : shift.varianceCents < 0 ? 'var(--ink-bad)' : 'var(--ink-warn)'} />
      )}
      {summary.movements.length > 0 && (
        <>
          <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />
          <div style={secLabel}>{L('THU / CHI', 'CASH IN / OUT')}</div>
          {summary.movements.map((m) => <Row key={m.id} k={`${fmtInTz(m.at, { hour: 'numeric', minute: '2-digit' })} · ${m.reason ?? ''}${m.byName ? ` (${m.byName})` : ''}`} v={`${m.kind === 'IN' ? '+' : '−'}${fmt(m.amountCents)}`} />)}
        </>
      )}
      {shift.closeNote && <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 4 }}>{L('Ghi chú', 'Note')}: {shift.closeNote}</div>}
    </div>
  );
}

/** Plain-paper version of the sheet for the receipt printer / AirPrint. */
export function printSheet(shift: ShiftView, summary: ShiftSummary, vi: boolean, fmt: (c: number) => string, salonName?: string) {
  if (typeof document === 'undefined') return;
  const L = (v: string, e: string) => ind(vi ? v : e);
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
  const row = (k: string, v: string, b = false) => `<tr><td style="padding:2px 0">${esc(k)}</td><td style="padding:2px 0;text-align:right;${b ? 'font-weight:700' : ''}">${esc(v)}</td></tr>`;
  const when = (iso: string) => fmtInTz(iso, { day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const tenders = Object.entries(summary.byTender ?? {}).filter(([, v]) => v > 0).map(([m, v]) => row(`  ${TENDER_LABEL[m]?.[vi ? 0 : 1] ?? m}`, fmt(v))).join('');
  const moves = summary.movements.map((m) => row(`${fmtInTz(m.at, { hour: 'numeric', minute: '2-digit' })} ${m.reason ?? ''}`, `${m.kind === 'IN' ? '+' : '−'}${fmt(m.amountCents)}`)).join('');
  const variance = shift.varianceCents ?? 0;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(L('Phiếu chốt ca', 'Shift hand-over'))}</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:13px;color:#000;margin:0;padding:12px;max-width:340px}h1{font-size:16px;margin:0 0 2px}h2{font-size:12px;margin:10px 0 4px;letter-spacing:.6px}table{width:100%;border-collapse:collapse}hr{border:0;border-top:1px dashed #000;margin:8px 0}.sig{margin-top:22px;display:flex;justify-content:space-between;font-size:12px}.sig div{width:45%;border-top:1px solid #000;padding-top:4px;text-align:center}</style></head><body>
<h1>${esc(salonName || '')}</h1><div>${esc(L('PHIẾU CHỐT CA THU NGÂN', 'CASHIER SHIFT HAND-OVER'))}</div><hr>
<table>${row(L('Mở ca', 'Opened'), `${when(shift.openedAt)} ${shift.openedByName ?? ''}`)}${shift.closedAt ? row(L('Chốt ca', 'Closed'), `${when(shift.closedAt)} ${shift.closedByName ?? ''}`) : ''}</table><hr>
<h2>${esc(L('DOANH THU', 'SALES'))}</h2><table>${row(L('Đơn đã thu', 'Sales'), String(summary.orders))}${row(L('Doanh thu', 'Revenue'), fmt(summary.revenueCents))}${row(L('Tip', 'Tips'), fmt(summary.tipsCents))}${tenders}${summary.byMethod.giftCardCents > 0 ? row('  Gift card', fmt(summary.byMethod.giftCardCents)) : ''}</table><hr>
<h2>${esc(L('TIỀN MẶT TRONG KÉT', 'CASH DRAWER'))}</h2><table>${row(L('Tiền đầu ca', 'Opening float'), fmt(shift.openingCents))}${row(L('+ Tiền mặt thu (đã trừ thối)', '+ Cash taken (net of change)'), fmt(summary.byMethod.cashCents - summary.changeCents))}${summary.cashInCents ? row(L('+ Thu thêm', '+ Cash in'), fmt(summary.cashInCents)) : ''}${summary.cashOutCents ? row(L('− Chi ra', '− Cash out'), `−${fmt(summary.cashOutCents)}`) : ''}${row(L('= Két phải có', '= Should hold'), fmt(summary.expectedCashCents), true)}${shift.countedCents != null ? row(L('Đếm được', 'Counted'), fmt(shift.countedCents), true) : ''}${shift.varianceCents != null ? row(L('Chênh lệch', 'Variance'), variance === 0 ? L('Khớp', 'Balanced') : `${signed(variance, fmt)} ${variance < 0 ? L('(thiếu)', '(short)') : L('(dư)', '(over)')}`, true) : ''}</table>
${moves ? `<hr><h2>${esc(L('THU / CHI', 'CASH IN / OUT'))}</h2><table>${moves}</table>` : ''}
${shift.closeNote ? `<hr><div>${esc(L('Ghi chú', 'Note'))}: ${esc(shift.closeNote)}</div>` : ''}
<div class="sig"><div>${esc(L('Người giao', 'Handed over by'))}</div><div>${esc(L('Người nhận', 'Received by'))}</div></div>
</body></html>`;
  const prev = document.getElementById('lumio-print-frame');
  if (prev) prev.remove();
  const iframe = document.createElement('iframe');
  iframe.id = 'lumio-print-frame';
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0', opacity: '0' });
  document.body.appendChild(iframe);
  const win = iframe.contentWindow; const doc = win?.document;
  if (!win || !doc) return;
  doc.open(); doc.write(html); doc.close();
  win.focus();
  window.setTimeout(() => { try { win.print(); } catch { /* ignore */ } }, 250);
}

function signed(c: number, fmt: (c: number) => string) { return c < 0 ? `−${fmt(-c)}` : `+${fmt(c)}`; }

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--c0f172a)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 11.5, color: 'var(--c94a3b8)', fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--cf1f5f9)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      {sub && <span style={{ fontSize: 11.5, color: 'var(--c64748b)' }}>{sub}</span>}
    </div>
  );
}
function Row({ k, v, strong, color }: { k: string; v: string; strong?: boolean; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: strong ? 15 : 13.5, fontWeight: strong ? 700 : 500, color: color ?? (strong ? 'var(--cf1f5f9)' : 'var(--ccbd5e1)'), whiteSpace: 'pre' }}>
      <span style={{ whiteSpace: 'normal' }}>{k}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</span>
    </div>
  );
}

const lab: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, color: 'var(--ccbd5e1)', fontWeight: 600 };
const inp: React.CSSProperties = { ...ui.input, height: 44, fontSize: 15 };
const ghost: React.CSSProperties = { height: 40, padding: '0 12px', borderRadius: 9, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ccbd5e1)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' };
const secLabel: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, letterSpacing: 0.8, color: 'var(--c94a3b8)' };

export function useShiftState(token: string | null) {
  const [state, setState] = useState<ShiftState | null>(null);
  const refresh = useCallback(async () => {
    if (!token) return;
    try { setState(await apiFetch<ShiftState>('/pos/shifts/current', { token })); } catch { /* no pos cap or offline — the till simply shows no badge */ }
  }, [token]);
  useEffect(() => { void refresh(); }, [refresh]);
  const gate = useMemo(() => Boolean(state?.requireShift && !state?.shift), [state]);
  return { state, setState, refresh, mustOpen: gate };
}
