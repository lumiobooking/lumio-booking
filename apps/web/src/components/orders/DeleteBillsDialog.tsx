'use client';

/**
 * XOÁ BILL ĐÃ CHỌN — the owner ticked bills in the list and pressed Delete.
 *
 * Two deliberate steps so a stray tap never removes money from the books:
 *   1. see exactly what goes (how many, how many were paid, how much money)
 *      and pick a reason;
 *   2. tick "I understand" — only then the red button works.
 * Each bill goes to the Thùng rác (restorable); stock, gift cards, points and
 * the booking are put back by the server (pos.service removeOrder). A bill
 * inside a closed payroll is refused on its own and listed here.
 */
import { useState } from 'react';
import { apiFetch } from '../../lib/api';
import { ui, formatPrice } from '../../lib/ui';
import { EditDialog } from '../EditDialog';

export interface BillToDelete {
  id: string; orderNumber: number; status: string; totalCents: number; currency: string;
  refundedCents?: number;
  customer?: { firstName: string; lastName: string | null } | null;
}

const REASONS: { k: string; vi: string; en: string }[] = [
  { k: 'test', vi: 'Bill tạo thử / bấm nhầm', en: 'Test or mistaken bill' },
  { k: 'dup', vi: 'Bill bị trùng', en: 'Duplicate bill' },
  { k: 'wrong', vi: 'Nhập sai, đã làm lại bill khác', en: 'Wrong entry, re-done on another bill' },
  { k: 'other', vi: 'Lý do khác', en: 'Other' },
];

export function DeleteBillsDialog({ vi, token, bills, onClose, onDone }: {
  vi: boolean; token: string | null; bills: BillToDelete[]; onClose: () => void; onDone: () => void;
}) {
  const L = (a: string, b: string) => (vi ? a : b);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ no: number; error: string }[] | null>(null);

  const cur = bills[0]?.currency;
  const live = bills.filter((b) => b.status === 'PAID');
  const liveCents = live.reduce((n, b) => n + b.totalCents - (b.refundedCents ?? 0), 0);
  const why = [REASONS.find((r) => r.k === reason)?.[vi ? 'vi' : 'en'], note.trim()].filter(Boolean).join(' · ');
  const ok = !!reason && (reason !== 'other' || note.trim().length >= 3) && sure;

  async function run() {
    if (!ok) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch<{ deleted: number; failed: { id: string; error: string }[] }>('/pos/orders/bulk-delete', {
        method: 'POST', token, body: { ids: bills.map((b) => b.id), reason: why },
      });
      if (r.failed?.length) {
        setFailed(r.failed.map((f) => ({ no: bills.find((b) => b.id === f.id)?.orderNumber ?? 0, error: f.error })));
      } else onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally { setBusy(false); }
  }

  if (failed) {
    return (
      <EditDialog open title={L('Một số bill chưa xoá được', 'Some bills were not deleted')} onClose={onDone} width={480}>
        <p style={{ fontSize: 13.5, color: 'var(--ccbd5e1)', marginTop: 0 }}>
          {L(`Đã xoá ${bills.length - failed.length} bill. Những bill dưới đây được giữ lại:`, `${bills.length - failed.length} deleted. These were kept:`)}
        </p>
        {failed.map((f) => <div key={f.no} style={{ fontSize: 13, padding: '6px 0', borderTop: '1px solid var(--c334155)' }}><b>#{f.no}</b> — <span style={{ color: 'var(--ink-warn)' }}>{f.error}</span></div>)}
        <button type="button" onClick={onDone} style={{ ...ui.primaryBtn, marginTop: 12, width: '100%' }}>{L('Đóng', 'Close')}</button>
      </EditDialog>
    );
  }

  return (
    <EditDialog open title={<span style={{ color: 'var(--ink-bad)' }}>🗑 {L(`Xoá ${bills.length} bill`, `Delete ${bills.length} bill(s)`)}</span>} onClose={onClose} width={520}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8, marginBottom: 12 }}>
        {[
          [L('Bill chọn', 'Bills'), String(bills.length)],
          [L('Đã thu tiền', 'Paid'), String(live.length)],
          [L('Doanh thu bị trừ', 'Revenue removed'), formatPrice(liveCents, cur)],
        ].map(([k, v]) => (
          <div key={k} style={{ border: '1px solid var(--c334155)', borderRadius: 10, padding: '8px 10px' }}>
            <div style={{ fontSize: 11, color: 'var(--c94a3b8)', fontWeight: 700, textTransform: 'uppercase' }}>{k}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--cf8fafc)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid var(--c334155)', borderRadius: 10, marginBottom: 12 }}>
        {bills.map((b) => (
          <div key={b.id} style={{ display: 'flex', gap: 8, fontSize: 13, padding: '6px 10px', borderTop: '1px solid var(--c334155)' }}>
            <b style={{ width: 54 }}>#{b.orderNumber}</b>
            <span style={{ flex: 1, minWidth: 0, color: 'var(--ccbd5e1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.customer ? `${b.customer.firstName} ${b.customer.lastName ?? ''}`.trim() : L('Khách lẻ', 'Walk-in')}</span>
            <span style={{ whiteSpace: 'nowrap', color: b.status === 'PAID' ? 'var(--cf8fafc)' : 'var(--c94a3b8)' }}>{formatPrice(b.totalCents, b.currency)}</span>
          </div>
        ))}
      </div>

      <span style={ui.label}>{L('Lý do xoá', 'Why')} <span style={{ color: 'var(--ink-bad)' }}>*</span></span>
      <div style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
        {REASONS.map((r) => (
          <label key={r.k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--ce2e8f0)', cursor: 'pointer' }}>
            <input type="radio" name="del-reason" checked={reason === r.k} onChange={() => setReason(r.k)} /> {vi ? r.vi : r.en}
          </label>
        ))}
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder={L('Ghi chú (bắt buộc nếu chọn Lý do khác)', 'Note (required for Other)')} style={ui.input} />

      <div style={{ fontSize: 12.5, color: 'var(--ink-warn)', background: 'var(--wash-amber)', borderRadius: 10, padding: '9px 11px', margin: '4px 0 10px', lineHeight: 1.5 }}>
        {L('Bill bị xoá không còn tính doanh thu, tip, hoa hồng. Hàng bán được trả lại kho, thẻ quà tặng và điểm thưởng được hoàn, lịch hẹn mở lại. Bill nằm trong Thùng rác và khôi phục được. Bill thuộc kỳ lương đã chốt sẽ không xoá.',
          'Deleted bills stop counting for revenue, tips and commission. Stock, gift-card money and points are put back; the booking reopens. Bills go to the Trash and can be restored. Bills inside a closed payroll are kept.')}
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13.5, color: 'var(--ce2e8f0)', cursor: 'pointer', marginBottom: 12 }}>
        <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} style={{ marginTop: 3 }} />
        <span>{L(`Tôi chắc chắn muốn xoá ${bills.length} bill này.`, `I am sure I want to delete these ${bills.length} bill(s).`)}</span>
      </label>
      {err && <div style={ui.banner}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onClose} style={{ ...ui.primaryBtn, background: 'var(--c334155)', color: 'var(--ce2e8f0)' }}>{L('Không xoá', 'Cancel')}</button>
        <button type="button" disabled={!ok || busy} onClick={() => void run()} style={{ ...ui.dangerBtn, padding: '9px 16px', opacity: ok ? 1 : 0.5 }}>
          {busy ? '…' : L(`Xoá ${bills.length} bill`, `Delete ${bills.length}`)}
        </button>
      </div>
    </EditDialog>
  );
}
