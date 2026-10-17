'use client';

/**
 * Sign with a finger. Always dark ink on white, whatever the theme, so the
 * stored PNG prints like paper. Reports a PNG data URL once there is enough
 * ink to be a signature, null after "Clear".
 */
import { useEffect, useRef, useState } from 'react';
import type { FormPalette } from './FormRenderer';

const W = 640, H = 200;
const PAPER_BG = '#ffffff';
const PAPER_INK = '#111827';
const PAPER_HINT = '#9ca3af';

export function SignaturePad({ onChange, palette, vi, height = 160 }: { onChange: (dataUrl: string | null) => void; palette: FormPalette; vi: boolean; height?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const ink = useRef(0);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.fillStyle = PAPER_BG;
    ctx.fillRect(0, 0, W, H);
  }, []);

  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ref.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    try { ref.current?.setPointerCapture(e.pointerId); } catch { /* older Safari */ }
    drawing.current = true;
    last.current = at(e);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = ref.current?.getContext('2d');
    const p = at(e);
    if (!ctx || !last.current) return;
    ctx.strokeStyle = PAPER_INK;
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ink.current += Math.hypot(p.x - last.current.x, p.y - last.current.y);
    last.current = p;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    if (ink.current > 60 && ref.current) {
      setEmpty(false);
      onChange(ref.current.toDataURL('image/png'));
    }
  };
  const clear = () => {
    const ctx = ref.current?.getContext('2d');
    if (ctx) { ctx.fillStyle = PAPER_BG; ctx.fillRect(0, 0, W, H); }
    ink.current = 0;
    setEmpty(true);
    onChange(null);
  };

  return (
    <div>
      <div style={{ position: 'relative', borderRadius: 14, border: `1.5px dashed ${palette.line}`, overflow: 'hidden', background: PAPER_BG }}>
        <canvas ref={ref} width={W} height={H} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up}
          style={{ display: 'block', width: '100%', height, touchAction: 'none', cursor: 'crosshair' }} aria-label={vi ? 'Ký tên' : 'Signature'} />
        {empty && <div style={{ position: 'absolute', left: 0, right: 0, bottom: 12, textAlign: 'center', fontSize: 13, color: PAPER_HINT, pointerEvents: 'none' }}>{vi ? 'Ký bằng ngón tay ở đây' : 'Sign here with your finger'}</div>}
      </div>
      <button type="button" onClick={clear} style={{ marginTop: 6, background: 'transparent', border: 'none', color: palette.sub, fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: '6px 0' }}>
        {vi ? 'Ký lại' : 'Clear'}
      </button>
    </div>
  );
}
