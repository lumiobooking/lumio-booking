'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useLang } from '../lib/i18n';

/**
 * The light/dark switch.
 *
 * The choice lives on the DEVICE (localStorage), not on the account: the same
 * receptionist wants light on the sun-lit front desk iPad and dark on her own
 * phone at night. Applying is one attribute on <html> — every colour in the
 * product is a CSS variable keyed off that attribute, so there is nothing else
 * to notify and nowhere for a stale colour to hide. Default is dark, exactly
 * what every existing salon has been looking at.
 */
/** Every switch on the page shows the same state (the phone header and the menu sheet both carry one). */
const EVT = 'lumio-theme';

function useTheme(): [boolean, () => void] {
  const [light, setLight] = useState(false);
  useEffect(() => {
    const read = () => setLight(document.documentElement.dataset.theme === 'light');
    read();
    window.addEventListener(EVT, read);
    return () => window.removeEventListener(EVT, read);
  }, []);
  const flip = () => {
    const next = document.documentElement.dataset.theme !== 'light';
    if (next) document.documentElement.dataset.theme = 'light';
    else delete document.documentElement.dataset.theme;
    try { localStorage.setItem('lumio.theme', next ? 'light' : 'dark'); } catch { /* private mode */ }
    setLight(next);
    try { window.dispatchEvent(new Event(EVT)); } catch { /* old browsers */ }
  };
  return [light, flip];
}

const Sun = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);
const Moon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
);

/**
 * `size` gives the phone header a touch-sized square (the desktop keeps its
 * small pill); `labelled` is the menu-sheet row "Giao diện: Sáng | Tối".
 */
export function ThemeToggle({ size, labelled }: { size?: number; labelled?: boolean } = {}) {
  const { lang } = useLang();
  const vi = lang === 'vi';
  const [light, flip] = useTheme();
  const label = light ? (vi ? 'Chuyển chế độ tối' : 'Switch to dark') : (vi ? 'Chuyển chế độ sáng' : 'Switch to light');

  if (labelled) {
    const seg = (on: boolean, text: string, icon: ReactNode) => (
      <button type="button" aria-pressed={on} onClick={on ? undefined : flip}
        style={{ flex: 1, minHeight: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, border: 0, borderRadius: 8, cursor: on ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: on ? 700 : 600,
          background: on ? '#4f46e5' : 'transparent', color: on ? '#fff' : 'var(--ccbd5e1)' }}>
        {icon}{text}
      </button>
    );
    return (
      <div role="group" aria-label={vi ? 'Giao diện sáng hoặc tối' : 'Light or dark'} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)', flex: '0 0 auto' }}>{vi ? 'Giao diện' : 'Theme'}</span>
        <div style={{ flex: 1, display: 'flex', gap: 4, padding: 3, border: '1px solid var(--c334155)', borderRadius: 10 }}>
          {seg(light, vi ? 'Sáng' : 'Light', <Sun />)}
          {seg(!light, vi ? 'Tối' : 'Dark', <Moon />)}
        </div>
      </div>
    );
  }

  if (size) {
    return (
      <button type="button" onClick={flip} title={label} aria-label={label}
        style={{ width: size, height: size, borderRadius: 10, border: '1px solid var(--c334155)', background: 'var(--c1e293b)', color: 'var(--ce2e8f0)', cursor: 'pointer', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        {light ? <Moon /> : <Sun />}
      </button>
    );
  }

  return (
    <button onClick={flip}
      title={label}
      aria-label={light ? 'Switch to dark mode' : 'Switch to light mode'}
      style={{
        padding: '8px 11px', borderRadius: 8, border: '1px solid var(--c475569)',
        background: 'transparent', color: 'var(--ce2e8f0)', fontSize: 14, cursor: 'pointer', lineHeight: 1,
      }}>
      {light ? '🌙' : '☀️'}
    </button>
  );
}
