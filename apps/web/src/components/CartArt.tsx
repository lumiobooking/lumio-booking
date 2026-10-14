/**
 * The pictures of the empty cart (lib/cart-art.ts), drawn in the salon's own
 * accent so every template matches every brand.
 *
 * Flat, layered spot illustrations — a solid body, a darker accent, a white
 * highlight — instead of a thin outline icon in a circle, which read as a
 * generic stock glyph and stayed tiny however much room it was given. With
 * `tile`, the picture brings its own soft rounded tile, so callers lay it out
 * beside the text instead of stacking a circle above it.
 *
 * Inline SVG: no image to host, sharp at any size, nothing for a slow phone to
 * download.
 */
import type { ArtKind } from '../lib/cart-art';

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The four tones every picture is painted with, from one brand colour. */
export function artTones(color: string): { A: string; D: string; L: string; P: string } {
  const c = rgb(color) ?? [99, 102, 241];
  const hex = (v: number[]) => '#' + v.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
  return {
    A: hex(c),
    D: hex(c.map((v) => v * 0.62)),
    L: hex(c.map((v) => v + (255 - v) * 0.6)),
    P: hex(c.map((v) => v + (255 - v) * 0.86)),
  };
}

export function CartArt({ kind, color, size = 30, tile = false }: { kind: ArtKind; color: string; size?: number; tile?: boolean }) {
  const { A, D, L, P } = artTones(color);
  const art: Record<ArtKind, JSX.Element> = {
    lotus: (
      <>
        <path d="M15 50 Q23.5 46.5 32 50 T49 50" fill="none" stroke={D} strokeWidth="2.6" strokeLinecap="round" />
        <path d="M31 46 C22 46 14 40 12 29 C21 29 28 35 31 46Z" fill={L} />
        <path d="M33 46 C42 46 50 40 52 29 C43 29 36 35 33 46Z" fill={L} />
        <path d="M31 46 C24 41 21 33 23 24 C29 28 32 36 31 46Z" fill={A} opacity=".55" />
        <path d="M33 46 C40 41 43 33 41 24 C35 28 32 36 33 46Z" fill={A} opacity=".55" />
        <path d="M32 47 C26 39 26 26 32 15 C38 26 38 39 32 47Z" fill={A} />
        <path d="M32 22 C30.4 27 30.3 32 31.4 37" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".6" />
      </>
    ),
    stones: (
      <>
        <ellipse cx="32" cy="54" rx="17" ry="2.6" fill={D} opacity=".18" />
        <path d="M41 8 q-3 3 0 6 q3 3 0 6 M47.5 11 q-2.5 2.5 0 5 q2.5 2.5 0 5" fill="none" stroke={L} strokeWidth="2.4" strokeLinecap="round" />
        <ellipse cx="32" cy="45" rx="19" ry="7.5" fill={D} />
        <ellipse cx="31" cy="34" rx="14" ry="6" fill={A} />
        <ellipse cx="33" cy="24.5" rx="9" ry="4.6" fill={L} />
        <path d="M19.5 43 q4.5 -3 11 -3.6 M22.5 32.6 q3 -2 7.5 -2.4" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".5" />
      </>
    ),
    polish: (
      <>
        <ellipse cx="32" cy="55" rx="16" ry="2.6" fill={D} opacity=".18" />
        <rect x="26" y="7" width="12" height="17" rx="4" fill={D} />
        <rect x="29" y="10" width="2.6" height="10" rx="1.3" fill="#fff" opacity=".35" />
        <rect x="23" y="22" width="18" height="7" rx="2.5" fill={D} />
        <rect x="14" y="28" width="36" height="25" rx="9" fill={A} />
        <rect x="19.5" y="32.5" width="4" height="15" rx="2" fill="#fff" opacity=".45" />
        <path d="M53 35.5 c0 0 -4.2 5 -4.2 7.6 a4.2 4.2 0 0 0 8.4 0 c0 -2.6 -4.2 -7.6 -4.2 -7.6z" fill={L} />
      </>
    ),
    sparkle: (
      <>
        <path d="M28 9 C30 24 34 28 48 30 C34 32 30 36 28 51 C26 36 22 32 8 30 C22 28 26 24 28 9Z" fill={A} />
        <path d="M28 17 C29 23.5 30.5 26 33.5 27.8" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".5" />
        <path d="M48 37 C49 43.5 50.5 45 56.5 46 C50.5 47 49 48.5 48 55 C47 48.5 45.5 47 39.5 46 C45.5 45 47 43.5 48 37Z" fill={D} />
        <circle cx="50" cy="15" r="3.2" fill={L} />
        <circle cx="13" cy="50" r="2.2" fill={L} />
      </>
    ),
    lash: (
      <>
        <path d="M14 26 l-4.2 -5 M21 21 l-2.2 -6 M28 18.6 l-1 -6.2 M36 18.6 l1 -6.2 M43 21 l2.2 -6 M50 26 l4.2 -5" fill="none" stroke={D} strokeWidth="2.6" strokeLinecap="round" />
        <path d="M8 34 Q32 12 56 34 Q32 54 8 34Z" fill="#fff" stroke={D} strokeWidth="2.6" strokeLinejoin="round" />
        <circle cx="32" cy="34" r="9.5" fill={A} />
        <circle cx="32" cy="34" r="4.2" fill={D} />
        <circle cx="35.2" cy="30.8" r="2.1" fill="#fff" />
      </>
    ),
    scissors: (
      <>
        <path d="M24 37 L45 9 M40 37 L19 9" fill="none" stroke={D} strokeWidth="4.4" strokeLinecap="round" />
        <circle cx="32" cy="26.6" r="2.8" fill="#fff" stroke={D} strokeWidth="1.6" />
        <circle cx="19" cy="45" r="9.5" fill={A} />
        <circle cx="45" cy="45" r="9.5" fill={A} />
        <circle cx="19" cy="45" r="4.3" fill={P} />
        <circle cx="45" cy="45" r="4.3" fill={P} />
      </>
    ),
    tooth: (
      <>
        <g transform="translate(5 8) scale(0.84)">
        <path d="M20 10 C11 10 9 21 11 29 C13 37 15 54 21 54 C27 54 26 40 32 40 C38 40 37 54 43 54 C49 54 51 37 53 29 C55 21 53 10 44 10 C38 10 36 14 32 14 C28 14 26 10 20 10Z" fill="#fff" stroke={A} strokeWidth="3" strokeLinejoin="round" />
        <path d="M18 19 q-3.2 4.5 -2.2 11" fill="none" stroke={L} strokeWidth="3.2" strokeLinecap="round" />
        </g>
        <path d="M53 4 C53.8 9 54.2 9.4 59 10.2 C54.2 11 53.8 11.4 53 16.4 C52.2 11.4 51.8 11 47 10.2 C51.8 9.4 52.2 9 53 4Z" fill={D} />
      </>
    ),
    plate: (
      <>
        <circle cx="32" cy="34" r="17" fill={A} />
        <circle cx="32" cy="34" r="11.5" fill="#fff" opacity=".92" />
        <circle cx="32" cy="34" r="7" fill="none" stroke={L} strokeWidth="2" />
        <path d="M6.5 13 V21.5 Q6.5 25.5 9.5 25.5 Q12.5 25.5 12.5 21.5 V13 M9.5 13 V54" fill="none" stroke={D} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M57.5 13 Q51 19.5 53 31.5 H57.5 V54" fill={D} stroke={D} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
    cup: (
      <>
        <path d="M22 8 q-3 4 0 8 M30 6 q-3 4 0 8 M38 8 q-3 4 0 8" fill="none" stroke={L} strokeWidth="2.4" strokeLinecap="round" />
        <ellipse cx="30" cy="52" rx="21" ry="4.6" fill={D} />
        <path d="M45 29.5 H48.5 C55.5 29.5 55.5 42.5 48.5 42.5 H45" fill="none" stroke={A} strokeWidth="4.2" strokeLinecap="round" />
        <path d="M11 24 H47 V37 C47 46.5 39.5 51.5 29 51.5 C18.5 51.5 11 46.5 11 37Z" fill={A} />
        <ellipse cx="29" cy="24" rx="18" ry="3.2" fill={D} opacity=".55" />
        <path d="M16.5 31 V40" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" opacity=".45" />
      </>
    ),
    house: (
      <>
        <ellipse cx="32" cy="55" rx="20" ry="2.6" fill={D} opacity=".18" />
        <rect x="41.5" y="13" width="6" height="12" rx="1.5" fill={D} />
        <rect x="15" y="27" width="34" height="26" rx="2.5" fill={L} />
        <path d="M9.5 30.5 L32 11.5 L54.5 30.5Z" fill={A} stroke={A} strokeWidth="3.5" strokeLinejoin="round" />
        <rect x="27" y="37" width="10" height="16" rx="2.2" fill={D} />
        <rect x="40" y="34.5" width="6" height="6" rx="1.4" fill="#fff" />
        <rect x="18" y="34.5" width="6" height="6" rx="1.4" fill="#fff" />
      </>
    ),
    tools: (
      <>
        <path d="M40 8 a12 12 0 0 0 -10 17 L10 45 a5 5 0 0 0 7 7 L37 32 a12 12 0 0 0 17 -10 l-7 7 l-6 -2 l-2 -6Z" fill={A} stroke={A} strokeWidth="2.5" strokeLinejoin="round" />
        <circle cx="13.6" cy="48.4" r="1.9" fill={P} />
        <path d="M34.5 21.5 l-17 17" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".45" />
        <path d="M48 39.5 l5.6 3.2 v6.6 l-5.6 3.2 l-5.6 -3.2 v-6.6Z" fill={D} />
        <circle cx="48" cy="46" r="2.4" fill={P} />
      </>
    ),
    calendar: (
      <>
        <rect x="20" y="7" width="4.5" height="11" rx="2.25" fill={D} />
        <rect x="39.5" y="7" width="4.5" height="11" rx="2.25" fill={D} />
        <rect x="10" y="13" width="44" height="41" rx="7" fill="#fff" stroke={L} strokeWidth="2.4" />
        <path d="M10 20 a7 7 0 0 1 7 -7 H47 a7 7 0 0 1 7 7 V25 H10Z" fill={A} />
        <path d="M23 39.5 l6 6 l12 -12" fill="none" stroke={A} strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
    bag: (
      <>
        <ellipse cx="32" cy="56" rx="17" ry="2.6" fill={D} opacity=".18" />
        <path d="M24 25 V18 a8 8 0 0 1 16 0 V25" fill="none" stroke={D} strokeWidth="3.4" strokeLinecap="round" />
        <path d="M14 22 H50 L47.5 53 H16.5Z" fill={A} stroke={A} strokeWidth="3" strokeLinejoin="round" />
        <circle cx="24" cy="27.5" r="2" fill={D} />
        <circle cx="40" cy="27.5" r="2" fill={D} />
        <path d="M20.5 33 V46" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" opacity=".45" />
      </>
    ),
  };
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false" style={{ display: 'block', flexShrink: 0 }}>
      {tile && <rect width="64" height="64" rx="18" fill={P} />}
      {tile ? <g transform="translate(6.4 6.4) scale(0.8)">{art[kind] ?? art.bag}</g> : (art[kind] ?? art.bag)}
    </svg>
  );
}
