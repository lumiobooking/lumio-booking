/**
 * The small pictures of the empty cart (lib/cart-art.ts), drawn in the
 * salon's own accent so every template matches every brand. Inline SVG: no
 * image to host, sharp at any size, nothing for a slow phone to download.
 */
import type { ArtKind } from '../lib/cart-art';

export function CartArt({ kind, color, size = 30 }: { kind: ArtKind; color: string; size?: number }) {
  const s = { fill: 'none', stroke: color, strokeWidth: 3, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const soft = { fill: color, fillOpacity: 0.18 };
  const solid = { fill: color };
  const art: Record<ArtKind, JSX.Element> = {
    polish: (
      <>
        <rect x="25" y="6" width="14" height="16" rx="3" {...solid} />
        <rect x="23" y="21" width="18" height="6" rx="2" {...s} />
        <rect x="14" y="27" width="36" height="30" rx="10" {...soft} {...s} />
        <path d="M22 36 q0 -4 4 -5" {...s} />
      </>
    ),
    sparkle: (
      <>
        <path d="M30 8 C32 22 38 28 52 30 C38 32 32 38 30 52 C28 38 22 32 8 30 C22 28 28 22 30 8Z" {...soft} {...s} />
        <path d="M49 42 C50 47 52 49 57 50 C52 51 50 53 49 58 C48 53 46 51 41 50 C46 49 48 47 49 42Z" {...solid} />
      </>
    ),
    lash: (
      <>
        <path d="M8 36 Q32 14 56 36 Q32 54 8 36Z" {...soft} {...s} />
        <circle cx="32" cy="36" r="7" {...solid} />
        <path d="M14 27 l-4 -6 M22 21 l-2 -7 M32 19 v-7 M42 21 l2 -7 M50 27 l4 -6" {...s} />
      </>
    ),
    scissors: (
      <>
        <circle cx="18" cy="46" r="8" {...soft} {...s} />
        <circle cx="46" cy="46" r="8" {...soft} {...s} />
        <path d="M23 40 L44 10 M41 40 L20 10" {...s} />
      </>
    ),
    lotus: (
      <>
        <path d="M32 50 C24 40 24 26 32 14 C40 26 40 40 32 50Z" {...soft} {...s} />
        <path d="M32 50 C22 50 12 42 10 30 C20 30 28 38 32 50Z" {...soft} {...s} />
        <path d="M32 50 C42 50 52 42 54 30 C44 30 36 38 32 50Z" {...soft} {...s} />
        <path d="M14 56 H50" {...s} />
      </>
    ),
    stones: (
      <>
        <ellipse cx="32" cy="50" rx="20" ry="7" {...soft} {...s} />
        <ellipse cx="32" cy="36" rx="14" ry="6" {...soft} {...s} />
        <ellipse cx="32" cy="24" rx="9" ry="4.5" {...solid} />
        <path d="M44 10 q4 4 0 8" {...s} />
      </>
    ),
    tooth: (
      <path d="M20 10 C11 10 9 21 11 29 C13 37 15 54 21 54 C27 54 26 40 32 40 C38 40 37 54 43 54 C49 54 51 37 53 29 C55 21 53 10 44 10 C38 10 36 14 32 14 C28 14 26 10 20 10Z" {...soft} {...s} />
    ),
    plate: (
      <>
        <circle cx="34" cy="34" r="20" {...soft} {...s} />
        <circle cx="34" cy="34" r="11" {...s} />
        <path d="M8 12 V26 M5 12 V20 Q5 24 8 24 Q11 24 11 20 V12 M8 26 V56" {...s} />
        <path d="M60 12 Q54 18 56 30 H60 V56" {...s} />
      </>
    ),
    cup: (
      <>
        <path d="M12 26 H46 V40 C46 50 39 56 29 56 C19 56 12 50 12 40Z" {...soft} {...s} />
        <path d="M46 30 H50 C55 30 55 42 50 42 H46" {...s} />
        <path d="M22 8 q-4 5 0 10 M30 8 q-4 5 0 10 M38 8 q-4 5 0 10" {...s} />
      </>
    ),
    house: (
      <>
        <path d="M8 30 L32 10 L56 30" {...s} />
        <path d="M14 26 V54 H50 V26" {...soft} {...s} />
        <rect x="27" y="38" width="10" height="16" rx="2" {...solid} />
      </>
    ),
    tools: (
      <>
        <path d="M40 8 a12 12 0 0 0 -10 17 L10 45 a5 5 0 0 0 7 7 L37 32 a12 12 0 0 0 17 -10 l-7 7 l-6 -2 l-2 -6Z" {...soft} {...s} />
      </>
    ),
    calendar: (
      <>
        <rect x="10" y="14" width="44" height="40" rx="6" {...soft} {...s} />
        <path d="M10 26 H54 M22 8 V18 M42 8 V18" {...s} />
        <path d="M23 40 l6 6 l12 -12" {...s} />
      </>
    ),
    bag: (
      <>
        <path d="M14 22 H50 L47 56 H17Z" {...soft} {...s} />
        <path d="M24 26 V18 a8 8 0 0 1 16 0 V26" {...s} />
      </>
    ),
  };
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      {art[kind] ?? art.bag}
    </svg>
  );
}
