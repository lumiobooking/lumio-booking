'use client';

import { useEffect, useState } from 'react';
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
export function ThemeToggle() {
  const { lang } = useLang();
  const vi = lang === 'vi';
  const [light, setLight] = useState(false);

  useEffect(() => {
    setLight(document.documentElement.dataset.theme === 'light');
  }, []);

  const flip = () => {
    const next = !light;
    setLight(next);
    if (next) document.documentElement.dataset.theme = 'light';
    else delete document.documentElement.dataset.theme;
    try { localStorage.setItem('lumio.theme', next ? 'light' : 'dark'); } catch { /* private mode */ }
  };

  return (
    <button onClick={flip}
      title={light ? (vi ? 'Chuyển chế độ tối' : 'Switch to dark') : (vi ? 'Chuyển chế độ sáng' : 'Switch to light')}
      aria-label={light ? 'Switch to dark mode' : 'Switch to light mode'}
      style={{
        padding: '8px 11px', borderRadius: 8, border: '1px solid var(--c475569)',
        background: 'transparent', color: 'var(--ce2e8f0)', fontSize: 14, cursor: 'pointer', lineHeight: 1,
      }}>
      {light ? '🌙' : '☀️'}
    </button>
  );
}
