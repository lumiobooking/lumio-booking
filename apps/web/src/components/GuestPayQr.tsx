'use client';

/**
 * The payment QR, full screen, for the staff member to hand the phone or
 * iPad to the guest: white, the amount large, the code as big as the screen
 * allows, and what the guest's app will show (bank, holder, note). Closing
 * goes back to the payment screen, where the cashier confirms the money.
 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export function GuestPayQr({ src, amount, lines, note, shop, paid, vi, onClose }: {
  src: string;
  amount: string;
  lines: string[];
  note?: string | null;
  shop?: string | null;
  /** The bank feed saw the money (SePay / Casso): say so on the guest's screen too. */
  paid?: boolean;
  vi: boolean;
  onClose: () => void;
}) {
  const L = (v: string, e: string) => (vi ? v : e);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  if (typeof document === 'undefined') return null;
  // Portalled to <body>: a card with a blur or transform would otherwise trap a fixed overlay.
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={L('Mã QR thanh toán', 'Payment QR')}
      style={{ position: 'fixed', inset: 0, zIndex: 2000, background: '#ffffff', color: '#0f172a', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '20px 16px calc(20px + env(safe-area-inset-bottom))', overflowY: 'auto', fontFamily: 'inherit' }}>
      {shop && <div style={{ fontSize: 15, fontWeight: 700, color: '#475569', textAlign: 'center' }}>{shop}</div>}
      <div style={{ fontSize: 14, fontWeight: 600, color: '#64748b' }}>{L('Quét mã để thanh toán', 'Scan to pay')}</div>
      <div style={{ fontSize: 'clamp(30px, 8vw, 46px)', fontWeight: 800, letterSpacing: '-.01em', lineHeight: 1.1 }}>{amount}</div>
      <div style={{ position: 'relative', padding: 12, borderRadius: 22, border: '2px solid #e2e8f0', background: '#fff' }}>
        <img src={src} alt={L('Mã QR chuyển khoản', 'Transfer QR')} style={{ display: 'block', width: 'min(78vw, 56vh, 440px)', height: 'min(78vw, 56vh, 440px)', objectFit: 'contain', imageRendering: 'pixelated' }} />
        {paid && (
          <div style={{ position: 'absolute', inset: 0, borderRadius: 20, background: 'rgba(236,253,245,.94)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#047857' }}>
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>
            <b style={{ fontSize: 22 }}>{L('Đã nhận đủ tiền', 'Payment received')}</b>
          </div>
        )}
      </div>
      <div style={{ textAlign: 'center', fontSize: 15, lineHeight: 1.45 }}>
        {lines.map((l, i) => <div key={i} style={i === 0 ? { fontWeight: 700 } : undefined}>{l}</div>)}
        {note && <div>{L('Nội dung', 'Reference')}: <b style={{ letterSpacing: '.04em' }}>{note}</b></div>}
      </div>
      <div style={{ fontSize: 13, color: '#64748b', textAlign: 'center', maxWidth: 420 }}>
        {L('Mở app ngân hàng, MoMo hoặc ZaloPay › Quét mã. Số tiền và nội dung đã điền sẵn.', 'Open any banking app › Scan. The amount and note are filled in.')}
      </div>
      <button type="button" onClick={onClose}
        style={{ marginTop: 6, minHeight: 52, minWidth: 220, borderRadius: 14, border: 'none', background: '#0f172a', color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
        {paid ? L('Xong', 'Done') : L('Quay lại màn hình thu ngân', 'Back to the till')}
      </button>
    </div>,
    document.body,
  );
}
