'use client';

/**
 * Settings → Branding: the salon picks how the empty cart on its booking page
 * looks (lib/cart-art.ts templates for its trade first), may type its own
 * headline and line, and sees the result in its own accent as it types.
 */
import { CartArt } from './CartArt';
import { cartCopy, templatesFor } from '../lib/cart-art';
import type { IndustryKey } from '../lib/ui-industry';

const INK = '#0f2a52';
const MUTED = '#64748b';

function tint(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return `rgba(99,102,241,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export function CartTemplatePicker({ vi, industry, accent, value, title, hint, onChange }: {
  vi: boolean; industry: IndustryKey; accent: string;
  value: string; title: string; hint: string;
  onChange: (patch: { cartArt?: string; cartTitle?: string; cartHint?: string }) => void;
}) {
  const lang = vi ? 'vi' : 'en';
  const list = templatesFor(industry);
  const current = value && value !== 'auto' && list.some((t) => t.key === value) ? value : list[0]?.key;
  const preview = cartCopy({ key: current, industry, lang, title, hint });
  const auto = cartCopy({ key: current, industry, lang });

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', gap: 8 }}>
        {list.map((t) => {
          const on = t.key === current;
          return (
            <button key={t.key} type="button" onClick={() => onChange({ cartArt: t.key })} aria-pressed={on}
              title={vi ? t.title.vi : t.title.en}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '10px 6px', borderRadius: 10, cursor: 'pointer',
                background: on ? tint(accent, 0.14) : 'var(--c0f172a)', border: `1.5px solid ${on ? accent : 'var(--c334155)'}`,
              }}>
              <span style={{ width: 44, height: 44, borderRadius: '50%', background: tint(accent, 0.12), display: 'grid', placeItems: 'center' }}>
                <CartArt kind={t.art} color={accent} size={26} />
              </span>
              <span style={{ fontSize: 11.5, color: on ? 'var(--ce2e8f0)' : 'var(--c94a3b8)', fontWeight: on ? 700 : 500, textAlign: 'center', lineHeight: 1.3 }}>
                {vi ? t.name.vi : t.name.en}
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 10 }}>
        <label style={{ fontSize: 12.5 }}>
          <span style={{ display: 'block', color: 'var(--c94a3b8)', marginBottom: 3 }}>{vi ? 'Tiêu đề (tuỳ chọn)' : 'Headline (optional)'}</span>
          <input value={title} maxLength={80} placeholder={auto.title} onChange={(e) => onChange({ cartTitle: e.target.value })}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--ce2e8f0)', fontSize: 13 }} />
        </label>
        <label style={{ fontSize: 12.5 }}>
          <span style={{ display: 'block', color: 'var(--c94a3b8)', marginBottom: 3 }}>{vi ? 'Dòng hướng dẫn (tuỳ chọn)' : 'Line under it (optional)'}</span>
          <input value={hint} maxLength={140} placeholder={auto.hint} onChange={(e) => onChange({ cartHint: e.target.value })}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--ce2e8f0)', fontSize: 13 }} />
        </label>
      </div>

      <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--c64748b)' }}>{vi ? 'Xem trước trên trang đặt lịch:' : 'Preview on the booking page:'}</div>
      <div style={{ marginTop: 6, maxWidth: 360, borderRadius: 12, background: '#ffffff', padding: '18px 14px', border: '1px solid var(--c334155)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 58, height: 58, borderRadius: '50%', background: tint(accent, 0.10), display: 'grid', placeItems: 'center', margin: '0 auto 10px' }}>
            <CartArt kind={preview.art} color={accent} size={32} />
          </div>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: INK }}>{preview.title}</div>
          <div style={{ fontSize: 12.5, color: MUTED, marginTop: 4, lineHeight: 1.5 }}>{preview.hint}</div>
        </div>
        <div style={{ display: 'grid', gap: 6, marginTop: 12 }}>
          {preview.perks.slice(0, 2).map((p) => (
            <div key={p.title} style={{ display: 'flex', gap: 8, padding: '8px 10px', borderRadius: 10, background: '#f4f6fb' }}>
              <span style={{ fontSize: 14 }}>{p.icon}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: INK }}>{p.title}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
