'use client';

/**
 * The guest check (phiếu tạm tính) as it comes out of the printer, on screen:
 * shown after "In tạm tính" so the cashier sees what went to the counter —
 * and can turn the screen round when the printer is out of paper. Drawn from
 * the very text the printer got: centred lines centred, amounts on the right,
 * the QR line as the code itself.
 */
import { createPortal } from 'react-dom';
import { qrDataUrl } from '../lib/vietqr';
import { slipRows } from '../lib/slip-rows';

export function SlipPreview({ text, vi, onClose, onReprint }: { text: string; vi: boolean; onClose: () => void; onReprint?: () => void }) {
  const L = (v: string, e: string) => (vi ? v : e);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(15,23,42,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label={L('Phiếu tạm tính', 'Guest check')} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '94vh', width: 'min(360px, 100%)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#ffffff', fontWeight: 700, fontSize: 14 }}>
          <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#10b981', display: 'grid', placeItems: 'center', fontSize: 13 }}>✓</span>
          {L('Đã gửi phiếu tạm tính ra máy in', 'Guest check sent to the printer')}
        </div>
        <div style={{ overflowY: 'auto', background: '#ffffff', color: '#000000', borderRadius: 6, padding: '18px 16px 24px', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: 13.5, lineHeight: 1.4, boxShadow: '0 12px 32px rgba(0,0,0,.3)', fontVariantNumeric: 'tabular-nums' }}>
          {slipRows(text).map((r, i) => {
            if (r.kind === 'rule') return <div key={i} style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />;
            if (r.kind === 'qr') return <div key={i} style={{ display: 'flex', justifyContent: 'center', margin: '6px 0' }}><img src={qrDataUrl(r.text, 190)} alt={L('Mã QR chuyển khoản', 'Transfer QR')} style={{ width: 190, height: 190 }} /></div>;
            const st = { fontSize: r.size === 'title' ? 19 : r.size === 'bold' ? 16 : 13.5, fontWeight: r.size === 'normal' ? 400 : 700 } as const;
            if (r.right) return <div key={i} style={{ ...st, display: 'flex', justifyContent: 'space-between', gap: 10, whiteSpace: 'pre' }}><span>{r.text}</span><span>{r.right}</span></div>;
            return <div key={i} style={{ ...st, textAlign: r.centre ? 'center' : 'left', whiteSpace: 'pre-wrap', minHeight: '1.4em' }}>{r.text}</div>;
          })}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: onReprint ? 'repeat(2, minmax(0,1fr))' : '1fr', gap: 8 }}>
          {onReprint && <button type="button" onClick={onReprint} style={{ minHeight: 48, borderRadius: 14, border: 'none', background: 'rgba(255,255,255,.16)', color: '#ffffff', fontFamily: 'inherit', fontSize: 14.5, fontWeight: 700, cursor: 'pointer' }}>{L('In lại', 'Print again')}</button>}
          <button type="button" onClick={onClose} style={{ minHeight: 48, borderRadius: 14, border: 'none', background: '#ffffff', color: '#0f172a', fontFamily: 'inherit', fontSize: 14.5, fontWeight: 800, cursor: 'pointer' }}>{L('Xong', 'Done')}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
