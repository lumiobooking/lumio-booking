/**
 * The brand mark, everywhere it appears.
 *
 * One file so the header, the login screen, the agency console and the
 * "Powered by" line all draw the same picture at the same weight. The mark is
 * the flat PNG cut from the master logo (public/logo/lumio-mark.png, brand
 * blue on transparent), so it reads the same on the dark shell and on a
 * white booking page. `wordmark` adds the name beside it.
 */
export const BRAND_BLUE = '#0a80f5';

export function LumioLogo({ size = 28, wordmark = true, sub, color = 'var(--ce2e8f0)' }: {
  /** Height of the mark in px; the wordmark scales with it. */
  size?: number;
  wordmark?: boolean;
  /** Small grey line under the name, e.g. "Booking" or "Support". */
  sub?: string;
  color?: string;
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(size * 0.3), minWidth: 0 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo/lumio-mark.png" alt="Lumio" width={size} height={size} style={{ width: size, height: size, display: 'block', flexShrink: 0 }} />
      {wordmark && (
        <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1.05, minWidth: 0 }}>
          <span style={{ fontSize: Math.round(size * 0.68), fontWeight: 800, color, letterSpacing: -0.2, whiteSpace: 'nowrap' }}>Lumio</span>
          {sub && <span style={{ fontSize: Math.max(10, Math.round(size * 0.36)), fontWeight: 600, color: 'var(--c64748b)', whiteSpace: 'nowrap' }}>{sub}</span>}
        </span>
      )}
    </span>
  );
}
