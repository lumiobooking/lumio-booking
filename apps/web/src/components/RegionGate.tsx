'use client';

/**
 * Asked once, at lumiobooking.com: which region are you in.
 *
 * The answer is remembered and never asked again, and it is only ever used to
 * follow a link. See lib/region.ts for why this is a door and not a switch.
 *
 * Deliberately mounted on the landing page and the login page ONLY. A customer
 * who was sent a direct booking link by their salon must never meet this — that
 * link already points at the right system, and asking a person booking a
 * manicure which continent's server they would like is absurd.
 *
 * Renders nothing at all until two regions have URLs configured.
 */
import { useEffect, useState, CSSProperties } from 'react';
import { decideRegion, configuredRegions, REGION_KEY, Region } from '../lib/region';

export default function RegionGate() {
  const [asking, setAsking] = useState(false);
  const [regions, setRegions] = useState<Region[]>([]);

  useEffect(() => {
    const all = configuredRegions();
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(REGION_KEY);
    } catch {
      // Private mode, storage disabled. Falling through means we ask, which is
      // a mild annoyance; throwing here would blank the landing page.
    }

    const decision = decideRegion({
      currentMarket: process.env.NEXT_PUBLIC_MARKET,
      saved,
      regions: all,
      currentHost: window.location.host,
    });

    if (decision.action === 'go') {
      // replace(), not assign(): the browser Back button should return to
      // wherever they actually came from, not bounce off this redirect.
      window.location.replace(decision.url + window.location.pathname + window.location.search);
      return;
    }
    if (decision.action === 'ask') {
      setRegions(all.filter((r) => r.url.trim()));
      setAsking(true);
    }
  }, []);

  function choose(r: Region) {
    try {
      window.localStorage.setItem(REGION_KEY, r.code);
    } catch {
      // Can't remember it — still honour the choice for this visit.
    }
    const here = (process.env.NEXT_PUBLIC_MARKET || 'US').toUpperCase();
    if (r.code === here) {
      setAsking(false);
      return;
    }
    window.location.replace(r.url.replace(/\/+$/, '') + window.location.pathname + window.location.search);
  }

  if (!asking) return null;

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
  useEffect(() => {
    setShow(configuredRegions().filter((r) => r.url.trim()).length >= 2);
  }, []);
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
