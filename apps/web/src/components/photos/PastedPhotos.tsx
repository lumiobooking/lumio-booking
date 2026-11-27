'use client';
/**
 * rt244: photos pasted or dropped onto the reply box wait here for one tap:
 * "Gửi n ảnh" or "Bỏ". Nothing goes to the customer on paste alone.
 */
import { useEffect, useMemo } from 'react';

const L = (vi: boolean, v: string, e: string) => (vi ? v : e);

export function PastedPhotos({ files, vi, busy, disabled, onSend, onRemove, onClear }: {
  files: File[]; vi: boolean; busy: boolean; disabled?: boolean;
  onSend: () => void; onRemove: (i: number) => void; onClear: () => void;
}) {
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => { urls.forEach((u) => URL.revokeObjectURL(u)); }, [urls]);
  if (!files.length) return null;
  return (
    <div role="group" aria-label={L(vi, 'Ảnh chờ gửi', 'Photos waiting to send')}
      style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: 8, borderRadius: 12, border: '1px solid var(--c334155)', background: 'var(--c0b1220)' }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: '1 1 160px', minWidth: 0 }}>
        {urls.map((u, i) => (
          <div key={u} style={{ position: 'relative', width: 56, height: 56, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--c334155)' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={u} alt={files[i]?.name || L(vi, 'Ảnh dán', 'Pasted photo')} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            <button type="button" onClick={() => onRemove(i)} aria-label={L(vi, 'Bỏ ảnh này', 'Remove this photo')}
              style={{ position: 'absolute', top: 2, right: 2, width: 22, height: 22, borderRadius: 999, border: 0, background: 'rgba(15,23,42,.75)', color: '#fff', fontSize: 13, lineHeight: '22px', cursor: 'pointer', padding: 0 }}>×</button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button type="button" onClick={onClear} disabled={busy}
          style={{ minHeight: 40, padding: '0 12px', borderRadius: 10, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ccbd5e1)', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>{L(vi, 'Bỏ', 'Discard')}</button>
        <button type="button" onClick={onSend} disabled={busy || disabled}
          style={{ minHeight: 40, padding: '0 14px', borderRadius: 10, border: 0, background: '#4f46e5', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', opacity: busy || disabled ? 0.55 : 1 }}>
          {busy ? L(vi, 'Đang gửi…', 'Sending…') : L(vi, `Gửi ${files.length} ảnh`, `Send ${files.length} photo${files.length > 1 ? 's' : ''}`)}
        </button>
      </div>
    </div>
  );
}
