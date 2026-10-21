'use client';

import { useState, type ReactNode } from 'react';
import { apiFetch } from '../../lib/api';
import { ui, formatPrice, toMinorUnits, fromMinorUnits } from '../../lib/ui';
import { cleanErr, fundLabel, type FinanceCtx, type Fund, type Pending } from './finance-types';

/**
 * The small "mark it paid" / "move money" / "void" dialogs of Thu & Chi.
 * Each one writes exactly one thing through the API and reloads every view.
 */

function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.6)', zIndex: 310, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()} style={{ ...ui.card, padding: 0, width: 'min(460px, 96vw)', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <span style={{ flex: 1, fontSize: 16, fontWeight: 800, color: 'var(--ce2e8f0)' }}>{title}</span>
          <button type="button" onClick={onClose} aria-label="×" style={{ background: 'none', border: 'none', color: 'var(--c94a3b8)', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
        <div style={{ display: 'flex', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--line)' }}>{footer}</div>
      </div>
    </div>
  );
}

const lbl = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, fontWeight: 700, color: 'var(--c94a3b8)' } as const;
const ghost = { ...ui.primaryBtn, background: 'transparent', color: 'var(--ce2e8f0)', border: '1px solid var(--c475569)', height: 42 } as const;

function FundSelect({ funds, value, onChange, L, kinds }: { funds: Fund[]; value: string; onChange: (v: string) => void; L: FinanceCtx['L']; kinds?: Fund['kind'][] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...ui.input, height: 42 }}>
      {funds.filter((f) => !f.archived && (!kinds || kinds.includes(f.kind))).map((f) => <option key={f.id} value={f.id}>{fundLabel(f, L)}</option>)}
    </select>
  );
}

function useSubmit(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try { await fn(); onDone(); } catch (e) { setErr(cleanErr(e)); } finally { setBusy(false); }
  };
  return { busy, err, run };
}

/** A closed payroll run, paid: the cash part from the drawer, the rest from the bank. */
export function PayPayrollDialog({ fx, run, onClose }: { fx: FinanceCtx; run: Pending['payroll'][number]; onClose: () => void }) {
  const { L, currency, today, funds } = fx;
  const [cash, setCash] = useState(fromMinorUnits(run.cashCents, currency));
  const [bank, setBank] = useState(fromMinorUnits(run.bankCents, currency));
  const [bankFund, setBankFund] = useState(funds.find((f) => f.kind === 'BANK' && f.isDefault)?.id ?? funds.find((f) => f.kind !== 'CASH')?.id ?? '');
  const [day, setDay] = useState(today);
  const { busy, err, run: submit } = useSubmit(() => { fx.refresh(); onClose(); });
  const c = toMinorUnits(cash || '0', currency), b = toMinorUnits(bank || '0', currency);
  const ok = c >= 0 && b >= 0 && c + b > 0;
  return (
    <Modal title={L(`Ghi đã trả lương ${run.periodFrom} → ${run.periodTo}`, `Payroll ${run.periodFrom} → ${run.periodTo} paid`)} onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} style={ghost}>{L('Huỷ', 'Cancel')}</button>
        <button type="button" disabled={!ok || busy} style={{ ...ui.primaryBtn, flex: 1, height: 42, opacity: ok ? 1 : 0.5 }}
          onClick={() => void submit(() => apiFetch(`/finance/payroll/${run.runId}/pay`, { method: 'POST', token: fx.token, body: { day, cashCents: c, bankCents: b, bankFundId: bankFund || undefined } }))}>
          {L('Ghi', 'Record')} −{formatPrice(c + b, currency)}
        </button>
      </>}>
      <div style={{ fontSize: 13, color: 'var(--c94a3b8)', lineHeight: 1.5 }}>
        {L('Bảng lương đã chốt: thực nhận', 'Closed payroll: net pay')} <b style={{ color: 'var(--ce2e8f0)' }}>{formatPrice(run.netPayCents, currency)}</b>. {L('Chi phí nhân sự trên lãi lỗ đã tính từ bảng lương — phiếu này chỉ ghi tiền ra khỏi quỹ.', 'Staff cost on the P&L already comes from the payroll — this only records the money leaving.')}
      </div>
      <label style={lbl}>{L('Trả tiền mặt (từ két)', 'Paid in cash')}<input inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} style={ui.input} /></label>
      <label style={lbl}>{L('Trả qua ngân hàng / séc', 'Paid by bank / cheque')}<input inputMode="decimal" value={bank} onChange={(e) => setBank(e.target.value)} style={ui.input} /></label>
      {b > 0 && <label style={lbl}>{L('Từ quỹ', 'From')}<FundSelect funds={funds} value={bankFund} onChange={setBankFund} L={L} kinds={['BANK', 'OTHER']} /></label>}
      <label style={lbl}>{L('Ngày trả', 'Paid on')}<input type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} style={ui.input} /></label>
      {err && <div style={ui.banner}>{err}</div>}
    </Modal>
  );
}

/** A stock purchase (bought in at cost in Inventory), paid from one fund. */
export function PayStockDialog({ fx, item, onClose }: { fx: FinanceCtx; item: Pending['stock'][number]; onClose: () => void }) {
  const { L, currency, today, funds } = fx;
  const [fund, setFund] = useState(funds.find((f) => f.kind === 'BANK' && f.isDefault)?.id ?? funds[0]?.id ?? '');
  const [day, setDay] = useState(today);
  const { busy, err, run } = useSubmit(() => { fx.refresh(); onClose(); });
  return (
    <Modal title={L('Ghi đã trả tiền nhập kho', 'Stock purchase paid')} onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} style={ghost}>{L('Huỷ', 'Cancel')}</button>
        <button type="button" disabled={busy || !fund} style={{ ...ui.primaryBtn, flex: 1, height: 42 }}
          onClick={() => void run(() => apiFetch(`/finance/stock/${item.movementId}/pay`, { method: 'POST', token: fx.token, body: { fundId: fund, day } }))}>
          {L('Ghi', 'Record')} −{formatPrice(item.amountCents, currency)}
        </button>
      </>}>
      <div style={{ fontSize: 13.5, color: 'var(--ce2e8f0)' }}>{item.item} × {item.qty} · {formatPrice(item.unitCostCents, currency)}{item.supplier ? ` · ${item.supplier}` : ''}</div>
      <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{L('Giá vốn vật tư đã tính trên lãi lỗ từ lúc nhập kho — phiếu này chỉ ghi tiền ra khỏi quỹ.', 'Supplies cost is on the P&L from the moment it was bought in — this only records the money leaving.')}</div>
      <label style={lbl}>{L('Trả từ quỹ', 'Paid from')}<FundSelect funds={funds} value={fund} onChange={setFund} L={L} /></label>
      <label style={lbl}>{L('Ngày trả', 'Paid on')}<input type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} style={ui.input} /></label>
      {err && <div style={ui.banner}>{err}</div>}
    </Modal>
  );
}

/** "Paid" on a recurring cost: one voucher for its due day; the reminder moves on. */
export function PayRecurringDialog({ fx, rec, onClose }: { fx: FinanceCtx; rec: { id: string; name: string; nextDue: string; amountCents: number | null; fundId: string }; onClose: () => void }) {
  const { L, currency, today, funds } = fx;
  const [amount, setAmount] = useState(rec.amountCents ? fromMinorUnits(rec.amountCents, currency) : '');
  const [fund, setFund] = useState(rec.fundId);
  const [day, setDay] = useState(today);
  const [pin, setPin] = useState('');
  const { busy, err, run } = useSubmit(() => { fx.refresh(); onClose(); });
  const cents = toMinorUnits(amount || '0', currency);
  const askPin = !fx.canSelfApprove && fx.approvalOverCents > 0 && cents > fx.approvalOverCents;
  const ok = cents > 0 && (!askPin || pin.length >= 4);
  return (
    <Modal title={`${rec.name} · ${rec.nextDue}`} onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} style={ghost}>{L('Huỷ', 'Cancel')}</button>
        <button type="button" disabled={!ok || busy} style={{ ...ui.primaryBtn, flex: 1, height: 42, opacity: ok ? 1 : 0.5 }}
          onClick={() => void run(() => apiFetch(`/finance/recurring/${rec.id}/pay`, { method: 'POST', token: fx.token, body: { amountCents: cents, fundId: fund, day, ...(askPin ? { approvalPin: pin } : {}) } }))}>
          {L('Đã trả', 'Paid')} −{formatPrice(cents, currency)}
        </button>
      </>}>
      <label style={lbl}>{L('Số tiền', 'Amount')}<input inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} style={{ ...ui.input, fontSize: 20, fontWeight: 800 }} /></label>
      <label style={lbl}>{L('Trả từ quỹ', 'Paid from')}<FundSelect funds={funds} value={fund} onChange={setFund} L={L} /></label>
      <label style={lbl}>{L('Ngày trả', 'Paid on')}<input type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} style={ui.input} /></label>
      {askPin && <label style={lbl}>{L('PIN duyệt của chủ / quản lý', 'Owner / manager PIN')}<input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} style={{ ...ui.input, maxWidth: 160 }} /></label>}
      {err && <div style={ui.banner}>{err}</div>}
    </Modal>
  );
}

/** Money that only changes place: cash banked, a wallet withdrawn. Never income or cost. */
export function TransferDialog({ fx, onClose }: { fx: FinanceCtx; onClose: () => void }) {
  const { L, currency, today, funds } = fx;
  const live = funds.filter((f) => !f.archived);
  const [from, setFrom] = useState(live.find((f) => f.kind === 'CASH')?.id ?? live[0]?.id ?? '');
  const [to, setTo] = useState(live.find((f) => f.kind === 'BANK' && f.isDefault)?.id ?? live[1]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState(today);
  const [note, setNote] = useState('');
  const { busy, err, run } = useSubmit(() => { fx.refresh(); onClose(); });
  const cents = toMinorUnits(amount || '0', currency);
  const ok = cents > 0 && !!from && !!to && from !== to;
  return (
    <Modal title={L('Chuyển quỹ', 'Move money between funds')} onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} style={ghost}>{L('Huỷ', 'Cancel')}</button>
        <button type="button" disabled={!ok || busy} style={{ ...ui.primaryBtn, flex: 1, height: 42, opacity: ok ? 1 : 0.5 }}
          onClick={() => void run(() => apiFetch('/finance/transfers', { method: 'POST', token: fx.token, body: { fromFundId: from, toFundId: to, amountCents: cents, day, note: note.trim() || undefined } }))}>
          {L('Chuyển', 'Move')} {formatPrice(cents, currency)}
        </button>
      </>}>
      <label style={lbl}>{L('Từ quỹ', 'From')}<FundSelect funds={funds} value={from} onChange={setFrom} L={L} /></label>
      <label style={lbl}>{L('Sang quỹ', 'To')}<FundSelect funds={funds} value={to} onChange={setTo} L={L} /></label>
      <label style={lbl}>{L('Số tiền', 'Amount')}<input inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} style={{ ...ui.input, fontSize: 20, fontWeight: 800 }} /></label>
      <label style={lbl}>{L('Ngày', 'Date')}<input type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} style={ui.input} /></label>
      <label style={lbl}>{L('Ghi chú', 'Note')}<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} style={ui.input} /></label>
      {from === to && from && <div style={{ fontSize: 12.5, color: 'var(--ink-bad)' }}>{L('Chọn hai quỹ khác nhau.', 'Pick two different funds.')}</div>}
      {err && <div style={ui.banner}>{err}</div>}
    </Modal>
  );
}

/** Never deleted: crossed out with a reason. */
export function VoidDialog({ fx, entryId, code, amountCents, onClose }: { fx: FinanceCtx; entryId: string; code: string; amountCents: number; onClose: () => void }) {
  const { L, currency } = fx;
  const [reason, setReason] = useState('');
  const { busy, err, run } = useSubmit(() => { fx.refresh(); onClose(); });
  return (
    <Modal title={L(`Huỷ phiếu ${code}`, `Void ${code}`)} onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} style={ghost}>{L('Giữ phiếu', 'Keep it')}</button>
        <button type="button" disabled={busy || !reason.trim()} style={{ ...ui.primaryBtn, flex: 1, height: 42, background: '#b91c1c', opacity: reason.trim() ? 1 : 0.5 }}
          onClick={() => void run(() => apiFetch(`/finance/entries/${entryId}/void`, { method: 'POST', token: fx.token, body: { reason: reason.trim() } }))}>
          {L('Huỷ phiếu', 'Void')} {formatPrice(amountCents, currency)}
        </button>
      </>}>
      <div style={{ fontSize: 13, color: 'var(--c94a3b8)', lineHeight: 1.5 }}>{L('Phiếu vẫn ở trong sổ, gạch ngang, không còn tính vào số dư. Phiếu chuyển quỹ huỷ cả hai đầu.', 'The voucher stays in the book, crossed out, and no longer counts. A transfer is voided at both ends.')}</div>
      <label style={lbl}>{L('Lý do huỷ', 'Reason')}<input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} style={ui.input} /></label>
      {err && <div style={ui.banner}>{err}</div>}
    </Modal>
  );
}
