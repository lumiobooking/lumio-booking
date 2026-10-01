'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { shrink, type FeedbackCtx } from '../../../../components/feedback/FeedbackFlow';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005/api';
const C = { page: '#faf9f7', ink: '#1c1917', muted: '#6f6a64', faint: '#a39d96', line: '#e7e3dd', bad: '#b91c1c' };
const SERIF = 'Baskerville, "Libre Baskerville", "Iowan Old Style", Georgia, serif';

/**
 * /f/<token>/photo — opened by the QR on the shared customer screen. The
 * customer answers on the salon's screen but takes the photo with their OWN
 * phone; it lands with their note (or joins it, if they already sent it).
 */
export default function FeedbackPhotoPage() {
  const { token } = useParams<{ token: string }>();
  const [ctx, setCtx] = useState<FeedbackCtx | null>(null);
  const [missing, setMissing] = useState(false);
  const [state, setState] = useState<'pick' | 'busy' | 'done' | 'error'>('pick');
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/public/feedback/${encodeURIComponent(token)}`)
      .then(async (r) => { if (!r.ok) throw new Error(); setCtx(await r.json()); })
      .catch(() => setMissing(true));
  }, [token]);

  const vi = ctx?.lang === 'vi';
  const L = (a: string, b: string) => (vi ? a : b);
  const accent = ctx?.accentColor || '#6366f1';

  async function pick(f: File | undefined) {
    if (!f) return;
    setState('busy');
    try {
      const dataUrl = await shrink(f);
      setPreview(dataUrl);
      const r = await fetch(`${API_URL}/public/feedback/${encodeURIComponent(token)}/photo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl }) });
      if (!r.ok) throw new Error();
      setState('done');
    } catch { setState('error'); }
  }

  const closed = ctx && (!ctx.askPhoto || ctx.expired || ctx.answered === 'HAPPY' || (ctx.hasPhoto && state !== 'done'));

  return (
    <div style={{ minHeight: '100dvh', background: C.page, color: C.ink, fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', display: 'flex', flexDirection: 'column', padding: '40px 22px calc(24px + env(safe-area-inset-bottom, 0px))', boxSizing: 'border-box', colorScheme: 'light' }}>
      {missing && <p style={{ textAlign: 'center', color: C.muted, marginTop: 120 }}>This link is no longer valid.</p>}
      {!missing && !ctx && <p style={{ textAlign: 'center', color: C.faint, marginTop: 120 }}>…</p>}
      {ctx && (
        <>
          <div style={{ font: '700 11.5px system-ui', letterSpacing: '.14em', textTransform: 'uppercase', color: C.faint }}>✦ {ctx.salonName}</div>
          {closed ? (
            <div style={{ textAlign: 'center', marginTop: 90 }}>
              <div style={{ fontSize: 44 }}>{ctx.hasPhoto ? '✓' : '💅'}</div>
              <p style={{ fontSize: 16, lineHeight: 1.55, color: C.muted, marginTop: 12 }}>
                {ctx.hasPhoto ? L('Tiệm đã nhận ảnh của bạn. Cảm ơn bạn!', 'The salon already has your photo. Thank you!') : L('Không cần gửi ảnh cho lần ghé này. Cảm ơn bạn!', 'No photo is needed for this visit. Thank you!')}
              </p>
            </div>
          ) : state === 'done' ? (
            <div style={{ textAlign: 'center', marginTop: 60 }}>
              <div style={{ width: 84, height: 84, borderRadius: '50%', background: accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, margin: '0 auto', boxShadow: `0 14px 30px ${accent}55` }}>✓</div>
              <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 28, marginTop: 20 }}>{L('Đã gửi ảnh', 'Photo sent')}</div>
              <p style={{ fontSize: 16, lineHeight: 1.55, color: C.muted, margin: '10px 6px 0' }}>
                {ctx.answered ? L('Ảnh đã được thêm vào góp ý của bạn.', 'It has been added to your note.') : L('Bạn quay lại màn hình của tiệm và bấm “Gửi tới chủ tiệm” nhé.', 'Head back to the salon’s screen and tap “Send to the owner”.')}
              </p>
              {preview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="" style={{ marginTop: 22, width: 160, height: 160, objectFit: 'cover', borderRadius: 18, boxShadow: '0 12px 30px rgba(28,25,23,.12)' }} />
              )}
            </div>
          ) : (
            <>
              <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 28, marginTop: 14, lineHeight: 1.15 }}>{L('Gửi ảnh cho chủ tiệm', 'Add a photo for the owner')}</div>
              <p style={{ fontSize: 15.5, lineHeight: 1.55, color: C.muted, margin: '10px 0 0' }}>
                {L('Chụp chỗ chưa ổn (móng bị bong, sơn lem…). Ảnh chỉ gửi tới chủ tiệm. Không bắt buộc.', 'Snap what wasn’t right — a chip, a smudge. It goes only to the owner. Optional.')}
              </p>
              <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => pick(e.target.files?.[0])} />
              <button type="button" onClick={() => fileRef.current?.click()} disabled={state === 'busy'}
                style={{ marginTop: 28, minHeight: 190, borderRadius: 22, border: `2px dashed ${accent}77`, background: '#fff', color: C.ink, fontFamily: 'inherit', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, overflow: 'hidden', padding: 0 }}>
                {preview
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={preview} alt="" style={{ width: '100%', maxHeight: 320, objectFit: 'cover', opacity: state === 'busy' ? 0.6 : 1 }} />
                  : <>
                      <span style={{ width: 64, height: 64, borderRadius: 20, background: `${accent}14`, color: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30 }}>📷</span>
                      <b style={{ fontSize: 17 }}>{L('Chụp hoặc chọn ảnh', 'Take or choose a photo')}</b>
                    </>}
              </button>
              {state === 'busy' && <p style={{ textAlign: 'center', color: C.muted, marginTop: 14 }}>{L('Đang gửi ảnh…', 'Sending your photo…')}</p>}
              {state === 'error' && <p style={{ textAlign: 'center', color: C.bad, marginTop: 14 }}>{L('Chưa gửi được — thử lại nhé.', 'Could not send — please try again.')}</p>}
              <p style={{ marginTop: 'auto', paddingTop: 30, textAlign: 'center', fontSize: 13, color: C.faint }}>🔒 {L('Tên bạn không bao giờ hiện cho thợ.', 'Your name is never shown to the technician.')}</p>
            </>
          )}
        </>
      )}
    </div>
  );
}
