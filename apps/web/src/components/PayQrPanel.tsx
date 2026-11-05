'use client';

/**
 * The QR block of a payment screen, dressed for the button the cashier
 * picked: bank transfer (indigo), MoMo (pink) or ZaloPay (blue) — title,
 * colour and the guest's steps change, so picking MoMo visibly switches the
 * screen even when the code underneath is the same VietQR (MoMo and ZaloPay
 * scan it). A wallet's own QR picture, when the shop added one, replaces it.
 * Always on white, as a QR must be, in both themes.
 */
import { payLook } from '../lib/pay-qr';

export function PayQrPanel({ method, src, exact, amount, lines, note, waiting, vi, onBig }: {
  method: string;
  src: string;
  /** The QR carries the amount (VietQR); a wallet's own static QR does not. */
  exact: boolean;
  amount: string;
  lines: string[];
  note?: string | null;
  /** The bank feed is listening for this bill (SePay / Casso). */
  waiting?: boolean;
  vi: boolean;
  onBig: () => void;
}) {
  const L = (v: string, e: string) => (vi ? v : e);
  const look = payLook(method, vi, exact);
  return (
    <div style={{ borderRadius: 18, background: '#ffffff', border: `1.5px solid ${look.color}33`, overflow: 'hidden', color: '#0f172a' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: look.tint }}>
        <span style={{ height: 26, padding: '0 10px', borderRadius: 999, background: look.color, color: '#ffffff', fontSize: 12.5, fontWeight: 800, display: 'flex', alignItems: 'center' }}>{look.app}</span>
        <b style={{ fontSize: 14.5, color: look.color }}>{look.title}</b>
      </div>
      <div style={{ display: 'flex', gap: 16, padding: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={onBig} aria-label={L('Phóng to mã QR cho khách quét', 'Show the QR full screen')}
          style={{ padding: 6, border: `2px solid ${look.color}`, borderRadius: 14, background: '#ffffff', cursor: 'zoom-in', flexShrink: 0 }}>
          <img src={src} alt={look.title} style={{ width: 168, height: 168, objectFit: 'contain', display: 'block' }} />
        </button>
        <div style={{ flex: '1 1 170px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13.5, lineHeight: 1.45 }}>
          <b style={{ fontSize: 24, letterSpacing: '-.01em' }}>{amount}</b>
          {lines.map((l, i) => <span key={i} style={i === 0 ? { fontWeight: 700 } : { color: '#334155' }}>{l}</span>)}
          {note && <span>{L('Nội dung', 'Reference')}: <b style={{ letterSpacing: '.04em' }}>{note}</b></span>}
          <span style={{ color: '#64748b' }}>{look.steps}</span>
          {waiting && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start', padding: '5px 10px', borderRadius: 999, background: '#fff7ed', color: '#9a3412', fontSize: 12.5, fontWeight: 700 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b' }} />
              {L('Đang chờ tiền về', 'Waiting for the money')}
            </span>
          )}
        </div>
      </div>
      <div style={{ padding: '0 14px 14px' }}>
        <button type="button" onClick={onBig}
          style={{ width: '100%', minHeight: 50, border: 'none', borderRadius: 14, background: look.color, color: '#ffffff', fontFamily: 'inherit', fontSize: 15, fontWeight: 800, cursor: 'pointer' }}>
          {L('Đưa khách quét (toàn màn hình)', 'Show to the guest (full screen)')}
        </button>
      </div>
    </div>
  );
}
