'use client';

/**
 * XOÁ DỮ LIỆU BÁN HÀNG THỬ — before the shop is handed over, the owner wipes
 * the bills rung up while trying the till: everything, or from one day on.
 * Shows what goes and what stays, then asks for the word XOA. Owner only
 * (the server checks too). Rules: apps/api/src/pos/test-reset.ts.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ui, formatPrice } from '../lib/ui';

interface Preview {
  fromDay: string | null; today: string;
  bills: number; paidBills: number; revenueCents: number; currency: string | null; firstAt: string | null;
  tableBills: number; shifts: number; heldBills: number; printJobs: number; billsKept: number;
  lockedPayroll: { periodFrom: string; periodTo: string } | null;
}
interface Result { bills: number; tableBills: number; shifts: number; printJobs: number; heldBills: number }

const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const isWord = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').trim().toUpperCase() === 'XOA';

export function TestDataReset({ vi, onClose, onDone }: { vi: boolean; onClose: () => void; onDone: () => void }) {
  const { token } = useAuth();
  const L = (v: string, e: string) => (vi ? v : e);
  const [all, setAll] = useState(true);
  const [from, setFrom] = useState(todayKey());
  const [p, setP] = useState<Preview | null>(null);
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<Result | null>(null);

  useEffect(() => {
    if (!token) return;
    let live = true;
    setP(null); setErr(null);
    apiFetch<Preview>(`/pos/test-reset${all ? '' : `?from=${from}`}`, { token })
      .then((r) => { if (live) setP(r); })
      .catch((e) => { if (live) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [token, all, from]);

  async function run() {
    if (!token || !isWord(word) || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch<Result>('/pos/test-reset', { token, method: 'POST', body: { confirm: word, ...(all ? {} : { from }) } });
      setDone(r); onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const nothing = p && p.bills + p.tableBills + p.shifts + p.heldBills + p.printJobs === 0;
  const can = !!p && !nothing && !p.lockedPayroll && isWord(word) && !busy;
  const money = (c: number) => formatPrice(c, p?.currency ?? undefined);
  const choice = (on: boolean): CSSProperties => ({
    flex: '1 1 200px', minWidth: 0, textAlign: 'left', padding: '11px 13px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--cf8fafc)',
    border: `1.5px solid ${on ? '#f43f5e' : 'var(--c334155)'}`, background: on ? 'rgba(244,63,94,.10)' : 'transparent',
  });
  const stat = (n: number | string, label: string) => (
    <div style={{ background: 'var(--c111827)', border: '1px solid var(--c334155)', borderRadius: 12, padding: '9px 12px', minWidth: 0 }}>
      <div style={{ fontSize: 18, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n}</div>
      <div style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{label}</div>
    </div>
  );

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 80, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 16, overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label={L('Xoá dữ liệu bán hàng thử', 'Clear test sales')} style={{ ...ui.card, width: '100%', maxWidth: 560, marginTop: 30 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: 18, flex: 1 }}>{L('Xoá dữ liệu bán hàng thử', 'Clear test sales')}</h2>
          <button type="button" onClick={onClose} aria-label={L('Đóng', 'Close')} style={{ background: 'none', border: 'none', color: 'var(--c94a3b8)', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>

        {done ? (
          <>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '14px 0' }}>
              <span style={{ width: 30, height: 30, borderRadius: '50%', background: '#10b981', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, flexShrink: 0 }}>✓</span>
              <div style={{ fontSize: 14.5, lineHeight: 1.5 }}>
                {L(`Đã xoá ${done.bills} bill, ${done.tableBills} bill bàn, ${done.shifts} ca thu ngân. Doanh thu các ngày này về 0 — bill mới bắt đầu lại số.`,
                  `Removed ${done.bills} bills, ${done.tableBills} table bills, ${done.shifts} cashier shifts. Those days' sales are now zero and bill numbers start again.`)}
              </div>
            </div>
            <button type="button" onClick={onClose} style={{ ...ui.primaryBtn, width: '100%' }}>{L('Xong', 'Done')}</button>
          </>
        ) : (
          <>
            <p style={{ margin: '0 0 12px', color: 'var(--c94a3b8)', fontSize: 13, lineHeight: 1.55 }}>
              {L('Dùng trước khi bàn giao: xoá các bill đã bấm thử để doanh thu, báo cáo và sơ đồ bàn sạch sẽ. Không lấy lại được.',
                'Use before handing over: removes the bills rung up while testing, so sales, reports and the floor start clean. This cannot be undone.')}
            </p>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <button type="button" onClick={() => setAll(true)} aria-pressed={all} style={choice(all)}>
                <b style={{ display: 'block', fontSize: 14 }}>{L('Tất cả', 'Everything')}</b>
                <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{L('Mọi bill từ trước tới nay', 'Every bill so far')}</span>
              </button>
              <button type="button" onClick={() => setAll(false)} aria-pressed={!all} style={choice(!all)}>
                <b style={{ display: 'block', fontSize: 14 }}>{L('Từ một ngày', 'From a day')}</b>
                <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{L('Giữ các bill trước ngày đó', 'Keeps bills before that day')}</span>
              </button>
            </div>
            {!all && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, fontSize: 13.5 }}>
                <span style={{ whiteSpace: 'nowrap' }}>{L('Xoá từ ngày', 'From')}</span>
                <input type="date" value={from} max={todayKey()} onChange={(e) => e.target.value && setFrom(e.target.value)} style={{ ...ui.input, marginBottom: 0, width: 'auto' }} />
                <span style={{ color: 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>{L('đến hôm nay', 'to today')}</span>
              </label>
            )}

            {!p && !err && <div style={{ color: 'var(--c94a3b8)', fontSize: 13, padding: '8px 0' }}>{L('Đang đếm…', 'Counting…')}</div>}
            {p && (
              <>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.06em', color: '#f43f5e', marginBottom: 6 }}>{L('SẼ XOÁ', 'WILL BE REMOVED')}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, marginBottom: 10 }}>
                  {stat(p.bills, L('bill bán hàng', 'sales bills'))}
                  {stat(money(p.revenueCents), L(`doanh thu (${p.paidBills} bill đã thu)`, `revenue (${p.paidBills} paid)`))}
                  {stat(p.tableBills, L('bill bàn (cả bàn đang mở)', 'table bills (open too)'))}
                  {stat(p.shifts, L('ca thu ngân', 'cashier shifts'))}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.55, marginBottom: 10 }}>
                  {L(`Cùng ${p.printJobs} phiếu in, ${p.heldBills} bill chờ. Hàng đã bán trả lại kho, điểm tích luỹ và tiền thẻ quà tặng trả lại như cũ.`,
                    `Also ${p.printJobs} print jobs and ${p.heldBills} parked carts. Stock sold goes back, loyalty points and gift-card money are restored.`)}
                  {!all && p.billsKept > 0 && L(` Giữ ${p.billsKept} bill trước ngày ${from}.`, ` Keeps ${p.billsKept} bills before ${from}.`)}
                </div>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.06em', color: '#10b981', marginBottom: 4 }}>{L('GIỮ NGUYÊN', 'KEPT')}</div>
                <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.55, marginBottom: 14 }}>
                  {L('Thực đơn, bàn & sơ đồ, nhân viên, sản phẩm, khách hàng, lịch hẹn, cài đặt, máy in, sổ Thu & Chi.',
                    'Menu, tables & floor plan, staff, products, clients, bookings, settings, printers, the Thu & Chi book.')}
                </div>
                {p.lockedPayroll && (
                  <div style={ui.banner}>{L(`Kỳ lương ${p.lockedPayroll.periodFrom} → ${p.lockedPayroll.periodTo} đã chốt nằm trong những ngày này. Mở lại kỳ lương hoặc chọn "Từ một ngày" sau kỳ đó.`,
                    `Payroll ${p.lockedPayroll.periodFrom} → ${p.lockedPayroll.periodTo} is closed and covers these days. Reopen it, or pick a day after it.`)}</div>
                )}
                {nothing && <div style={{ fontSize: 13.5, padding: '4px 0 10px' }}>{L('Không có gì để xoá.', 'Nothing to remove.')}</div>}
              </>
            )}
            {err && <div style={ui.banner}>{err}</div>}

            {p && !nothing && !p.lockedPayroll && (
              <>
                <label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>
                  {L('Gõ ', 'Type ')}<b style={{ letterSpacing: '.08em' }}>XOA</b>{L(' để xác nhận', ' to confirm')}
                </label>
                <input value={word} onChange={(e) => setWord(e.target.value)} autoCapitalize="characters" autoComplete="off" placeholder="XOA" style={{ ...ui.input, marginBottom: 12, letterSpacing: '.1em', fontWeight: 700 }} />
              </>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8 }}>
              <button type="button" onClick={onClose} style={{ ...ui.primaryBtn, minHeight: 42, background: 'transparent', border: '1px solid var(--c475569)', color: 'var(--ccbd5e1)' }}>{L('Huỷ', 'Cancel')}</button>
              <button type="button" onClick={() => void run()} disabled={!can} style={{ ...ui.dangerBtn, minHeight: 42, fontWeight: 700, background: can ? '#e11d48' : 'transparent', borderColor: '#e11d48', color: can ? '#ffffff' : '#fb7185', opacity: can ? 1 : 0.5, cursor: can ? 'pointer' : 'not-allowed' }}>
                {busy ? L('Đang xoá…', 'Removing…') : L('Xoá vĩnh viễn', 'Remove for good')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
