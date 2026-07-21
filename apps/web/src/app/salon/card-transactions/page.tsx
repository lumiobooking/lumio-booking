'use client';

import { useCallback, useEffect, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui, formatPrice } from '../../../lib/ui';
import { useLang } from '../../../lib/i18n';

/**
 * Card-terminal transactions: what the terminal actually did, and the two
 * corrections a salon admin can make — Void (same day, before settlement) and
 * Refund (after settlement, can be partial).
 *
 * Unresolved payments are surfaced at the top rather than buried, because an
 * unresolved payment is the one case where a salon can accidentally charge a
 * customer twice.
 */

interface Refund { id: string; amountCents: number; status: string; reason?: string | null; createdAt: string; }
interface Txn {
  id: string; provider: string; status: string; amountCents: number; currency: string;
  reference?: string | null; orderId?: string | null; approvalCode?: string | null;
  cardBrand?: string | null; last4?: string | null; entryType?: string | null;
  tipCents?: number | null; batchNumber?: string | null; rrn?: string | null;
  refundedCents: number; canVoid: boolean; canRefund: boolean; unresolved: boolean;
  lastError?: string | null; createdAt: string; succeededAt?: string | null; refunds: Refund[];
}

const STATUS_COLOR: Record<string, string> = {
  SUCCEEDED: '#22c55e', FAILED: '#ef4444', CANCELED: '#94a3b8',
  PROCESSING: '#f59e0b', REQUIRES_PAYMENT: '#f59e0b', QUEUED: '#f59e0b',
};

export default function CardTransactionsPage() {
  return (
    <SalonShell>
      <Inner />
    </SalonShell>
  );
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const L = vi
    ? { title: 'Giao dịch máy cà thẻ', sub: 'Kết quả thật từ máy — và hai cách sửa sai: Huỷ hoặc Hoàn tiền.',
        refresh: 'Làm mới', empty: 'Chưa có giao dịch nào.', loading: 'Đang tải…',
        unresolvedTitle: 'Giao dịch chưa rõ kết quả',
        unresolvedBody: 'Chưa biết khách đã bị trừ tiền hay chưa. Xem màn hình máy cà thẻ, rồi bấm Kiểm tra lại.',
        recheck: 'Kiểm tra lại', voidBtn: 'Huỷ giao dịch', refundBtn: 'Hoàn tiền',
        card: 'Thẻ', approval: 'Mã duyệt', tip: 'Tip', batch: 'Batch', ref: 'Mã giao dịch',
        refunded: 'Đã hoàn', voidConfirm: 'Huỷ hẳn giao dịch này? Chỉ làm được trong ngày, trước khi máy chốt sổ (settle).',
        refundPrompt: 'Hoàn bao nhiêu? Nhập số tiền (ví dụ 25.50). Tối đa còn lại:',
        refundNote: 'Khách phải quẹt lại thẻ trên máy để nhận tiền hoàn.',
        voidVsRefund: 'Huỷ hay Hoàn tiền?',
        voidVsRefundBody: '<b>Huỷ</b> dùng trong ngày, trước khi máy chốt sổ — giao dịch biến mất, khách không thấy gì trên sao kê. <b>Hoàn tiền</b> dùng sau khi đã chốt sổ, hoàn được một phần, nhưng khách phải có mặt để quẹt lại thẻ.',
        badAmount: 'Số tiền không hợp lệ.', done: 'Xong.', settled: 'đã hoàn tất' }
    : { title: 'Card transactions', sub: 'What the terminal actually did — and the two corrections you can make.',
        refresh: 'Refresh', empty: 'No transactions yet.', loading: 'Loading…',
        unresolvedTitle: 'Unresolved payment',
        unresolvedBody: 'We cannot tell whether the customer was charged. Check the terminal screen, then press Check again.',
        recheck: 'Check again', voidBtn: 'Void', refundBtn: 'Refund',
        card: 'Card', approval: 'Approval', tip: 'Tip', batch: 'Batch', ref: 'Reference',
        refunded: 'Refunded', voidConfirm: 'Void this transaction outright? Only possible before the batch settles.',
        refundPrompt: 'Refund how much? Enter an amount (e.g. 25.50). Remaining:',
        refundNote: 'The customer must present their card on the terminal to receive the refund.',
        voidVsRefund: 'Void or Refund?',
        voidVsRefundBody: '<b>Void</b> works the same day, before the batch settles — the sale disappears and never reaches the customer’s statement. <b>Refund</b> works after settlement, can be partial, but the customer must be present to tap their card again.',
        badAmount: 'That amount is not valid.', done: 'Done.', settled: 'settled' };

  const [rows, setRows] = useState<Txn[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try { setRows(await apiFetch<Txn[]>('/payments-hub/intents?limit=100', { token })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function recheck(t: Txn) {
    setBusy(t.id); setError(null); setMsg(null);
    try { await apiFetch(`/payments-hub/intents/${t.id}`, { token }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'error'); }
    finally { setBusy(null); }
  }

  async function doVoid(t: Txn) {
    if (!confirm(L.voidConfirm)) return;
    setBusy(t.id); setError(null); setMsg(null);
    try { await apiFetch('/payments-hub/void', { method: 'POST', token, body: { intentId: t.id } }); setMsg(L.done); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'error'); }
    finally { setBusy(null); }
  }

  async function doRefund(t: Txn) {
    const remaining = t.amountCents - t.refundedCents;
    const raw = prompt(`${L.refundPrompt} ${formatPrice(remaining, t.currency)}\n\n${L.refundNote}`, (remaining / 100).toFixed(2));
    if (raw === null) return;
    const cents = Math.round(parseFloat(raw.replace(',', '.')) * 100);
    if (!Number.isFinite(cents) || cents <= 0 || cents > remaining) { setError(L.badAmount); return; }
    setBusy(t.id); setError(null); setMsg(null);
    try { await apiFetch('/payments-hub/refund', { method: 'POST', token, body: { intentId: t.id, amountCents: cents } }); setMsg(L.done); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'error'); }
    finally { setBusy(null); }
  }

  const unresolved = rows.filter((r) => r.unresolved);
  const box: React.CSSProperties = { border: '1px solid #334155', borderRadius: 12, padding: 14, marginBottom: 10, background: '#0f172a' };
  const meta: React.CSSProperties = { color: '#94a3b8', fontSize: 12 };

  function Row({ t }: { t: Txn }) {
    const color = STATUS_COLOR[t.status] ?? '#94a3b8';
    return (
      <div style={{ ...box, borderColor: t.unresolved ? '#f59e0b' : '#334155' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0' }}>
            {formatPrice(t.amountCents, t.currency)}
            {t.tipCents ? <span style={{ ...meta, marginLeft: 8 }}>({L.tip} {formatPrice(t.tipCents, t.currency)})</span> : null}
          </div>
          <div style={{ color, fontWeight: 700, fontSize: 13 }}>{t.status}</div>
        </div>

        <div style={{ ...meta, marginTop: 6, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <span>{new Date(t.createdAt).toLocaleString('en-US')}</span>
          {t.cardBrand && <span>{L.card}: {t.cardBrand} •••• {t.last4 ?? '——'}{t.entryType ? ` · ${t.entryType}` : ''}</span>}
          {t.approvalCode && <span>{L.approval}: {t.approvalCode}</span>}
          {t.batchNumber && <span>{L.batch}: {t.batchNumber}</span>}
          {t.reference && <span>{L.ref}: {t.reference}</span>}
        </div>

        {t.refundedCents > 0 && (
          <div style={{ ...meta, marginTop: 6, color: '#fbbf24' }}>
            {L.refunded}: {formatPrice(t.refundedCents, t.currency)} / {formatPrice(t.amountCents, t.currency)}
          </div>
        )}
        {t.lastError && <div style={{ ...meta, marginTop: 6, color: '#fca5a5' }}>{t.lastError}</div>}

        {t.unresolved && (
          <div style={{ marginTop: 10, background: '#1e293b', borderLeft: '3px solid #f59e0b', borderRadius: 6, padding: 10 }}>
            <div style={{ color: '#fbbf24', fontWeight: 700, fontSize: 13 }}>{L.unresolvedTitle}</div>
            <div style={{ color: '#cbd5e1', fontSize: 12.5, marginTop: 4, lineHeight: 1.5 }}>{L.unresolvedBody}</div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {t.unresolved && (
            <button onClick={() => recheck(t)} disabled={busy === t.id} style={ui.primaryBtn}>
              {busy === t.id ? '…' : L.recheck}
            </button>
          )}
          {t.canVoid && (
            <button onClick={() => doVoid(t)} disabled={busy === t.id} style={ui.dangerBtn}>
              {busy === t.id ? '…' : L.voidBtn}
            </button>
          )}
          {t.canRefund && (
            <button onClick={() => doRefund(t)} disabled={busy === t.id}
              style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#e2e8f0', fontSize: 14, cursor: 'pointer' }}>
              {busy === t.id ? '…' : L.refundBtn}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>{L.title}</h1>
          <p style={{ color: '#94a3b8', marginTop: 0, fontSize: 14 }}>{L.sub}</p>
        </div>
        <button onClick={load} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#e2e8f0', fontSize: 13, cursor: 'pointer' }}>{L.refresh}</button>
      </div>

      {error && <div style={ui.banner}>{error}</div>}
      {msg && <div style={{ ...ui.banner, background: '#064e3b', borderColor: '#059669', color: '#d1fae5' }}>{msg}</div>}

      {unresolved.length > 0 && (
        <div style={{ border: '1px solid #f59e0b', background: '#1c1917', borderRadius: 12, padding: 14, margin: '14px 0' }}>
          <div style={{ color: '#fbbf24', fontWeight: 700 }}>
            {unresolved.length} {vi ? 'giao dịch chưa rõ kết quả' : 'unresolved payment(s)'}
          </div>
          <div style={{ color: '#cbd5e1', fontSize: 13, marginTop: 4, lineHeight: 1.55 }}>{L.unresolvedBody}</div>
        </div>
      )}

      <div style={{ border: '1px solid #334155', borderRadius: 12, padding: 12, background: '#1e293b', margin: '14px 0', fontSize: 13, lineHeight: 1.6, color: '#cbd5e1' }}>
        <strong style={{ color: '#a5b4fc' }}>{L.voidVsRefund}</strong>{' '}
        <span dangerouslySetInnerHTML={{ __html: L.voidVsRefundBody }} />
      </div>

      {loading ? <p style={{ color: '#94a3b8' }}>{L.loading}</p>
        : rows.length === 0 ? <p style={{ color: '#64748b', fontSize: 13 }}>{L.empty}</p>
        : rows.map((t) => <Row key={t.id} t={t} />)}
    </section>
  );
}
