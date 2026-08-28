/**
 * Shown by Next the INSTANT a navigation into this section starts, before the
 * page's code or data exist. The dead half-second between tapping a menu item
 * and anything changing is where people tap again and call the app frozen —
 * a skeleton in that gap is the difference between "loading" and "broken".
 * Server component: no hooks, no data, nothing to slow the very thing it masks.
 */
export default function SectionLoading() {
  const bar = (w: string, h = 14) => (
    <div style={{
      width: w, height: h, borderRadius: 8,
      background: 'linear-gradient(90deg, var(--c1e293b) 25%, var(--c334155) 37%, var(--c1e293b) 63%)',
      backgroundSize: '800px 100%', animation: 'lumio-shimmer 1.2s linear infinite',
    }} />
  );
  return (
    <div style={{ padding: '24px 20px', display: 'grid', gap: 18, maxWidth: 980, margin: '0 auto' }} aria-busy>
      {bar('38%', 26)}
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ background: 'var(--c111827)', border: '1px solid var(--c1e293b)', borderRadius: 12, padding: 16, display: 'grid', gap: 10 }}>
            {bar('55%', 12)}
            {bar('75%', 22)}
          </div>
        ))}
      </div>
      <div style={{ background: 'var(--c111827)', border: '1px solid var(--c1e293b)', borderRadius: 12, padding: 16, display: 'grid', gap: 12 }}>
        {bar('30%', 16)}
        {bar('100%')}
        {bar('92%')}
        {bar('96%')}
        {bar('64%')}
      </div>
    </div>
  );
}
