'use client';

/**
 * Asked once at lumiobooking.com: which system are you signing in to.
 *
 * The answer picks which SERVER this browser talks to. It cannot reach across
 * to the other market's data — see lib/region.ts — and it is remembered, so
 * nobody is asked twice.
 *
 * Mounted on the landing page and the login page ONLY. A customer following the
 * booking link their salon sent must never meet this: asking someone booking a
 * manicure to choose a continent is absurd, and their link already carries the
 * answer.
 *
 * Renders nothing until a second region has an API URL configured.
 */
import { useEffect, useState, CSSProperties } from 'react';
import { configuredRegions, regionChoiceEnabled, activeRegion, rememberRegion, REGION_KEY, Region } from '../lib/region';

export default function RegionGate() {
  const [regions, setRegions] = useState<Region[]>([]);

  useEffect(() => {
    const all = configuredRegions();
    // Ask only when there is a real choice AND none has been made yet.
    if (regionChoiceEnabled(all) && !activeRegion()) setRegions(all);
  }, []);

  function choose(r: Region) {
    rememberRegion(r.code);
    // A full reload, not a state update. The API client and the session are
    // both read on mount; a half-switched page is how a token from one system
    // ends up being posted to the other.
    window.location.reload();
  }

  if (!regions.length) return null;

  return (
    <div style={backdrop} role="dialog" aria-modal="true" aria-label="Choose your region">
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: 1.2, color: '#6366f1', textTransform: 'uppercase' }}>
          Lumio Booking
        </div>
        <h2 style={{ fontSize: 24, margin: '10px 0 6px', color: '#0f172a', lineHeight: 1.25 }}>
          Choose your region
        </h2>
        <p style={{ margin: 0, color: '#64748b', fontSize: 14.5, lineHeight: 1.55 }}>
          Chọn khu vực của bạn. We&apos;ll remember it — you won&apos;t be asked again.
        </p>

        <div style={{ display: 'grid', gap: 10, marginTop: 20 }}>
          {regions.map((r) => (
            <button key={r.code} onClick={() => choose(r)} style={choice} type="button">
              <span style={{ fontSize: 26, lineHeight: 1 }}>{r.flag}</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{r.label}</span>
              <span style={{ marginLeft: 'auto', color: '#94a3b8', fontSize: 18 }}>→</span>
            </button>
          ))}
        </div>

        <p style={{ margin: '16px 0 0', color: '#94a3b8', fontSize: 12, lineHeight: 1.55 }}>
          Each region is a separate system with its own data and its own login.
          Mỗi khu vực là một hệ thống riêng, dữ liệu và tài khoản tách biệt.
        </p>
      </div>
    </div>
  );
}

/**
 * The way back, for anyone who picked wrong. Put this in a footer.
 * Renders nothing when there is only one region, like the gate itself.
 */
export function ChangeRegionLink({ style }: { style?: CSSProperties }) {
  const [show, setShow] = useState(false);
  useEffect(() => setShow(regionChoiceEnabled()), []);
  if (!show) return null;
  return (
    <button
      type="button"
      onClick={() => {
        try {
          window.localStorage.removeItem(REGION_KEY);
        } catch {
          /* nothing to forget */
        }
        window.location.reload();
      }}
      style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit', textDecoration: 'underline', ...style }}
    >
      Change region · Đổi khu vực
    </button>
  );
}

const backdrop: CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 9999,
  background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(4px)',
  display: 'grid', placeItems: 'center', padding: 20,
};
const card: CSSProperties = {
  width: '100%', maxWidth: 420, background: '#fff', borderRadius: 18,
  padding: 28, boxShadow: '0 24px 60px rgba(15,23,42,0.28)',
};
const choice: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 14, width: '100%',
  padding: '15px 18px', borderRadius: 12, border: '1.5px solid #e2e8f0',
  background: '#fff', cursor: 'pointer', textAlign: 'left',
};
