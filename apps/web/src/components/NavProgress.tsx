'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

/**
 * The thin bar that answers "did my tap register?" for NAVIGATION.
 *
 * Between tapping a menu item and the next page's code arriving over the
 * network there is genuine dead time, and this app showed nothing at all in
 * it — the second tap people make in that silence is how double-navigations
 * and "phần mềm bị đơ" reports happen. GitHub, YouTube and Linear all answer
 * with the same 3-pixel bar; people have already learned what it means.
 *
 * Start: a click on any internal link (captured at the document, so no link
 * needs to know). Finish: the pathname actually changes. A safety timeout
 * clears a bar whose navigation never landed (blocked, same page, new tab).
 */
export function NavProgress() {
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      // New-tab / download / modified clicks navigate elsewhere or not at all.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.('a');
      if (!a) return;
      const href = a.getAttribute('href') || '';
      if (!href.startsWith('/') || a.target === '_blank' || a.hasAttribute('download')) return;
      // Same page → router will not fire → the bar would hang. Skip.
      if (href === window.location.pathname) return;
      setActive(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setActive(false), 8000);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  // Arrival: the URL changed, the new page is mounting.
  useEffect(() => {
    setActive(false);
    if (timerRef.current) clearTimeout(timerRef.current);
  }, [pathname]);

  if (!active) return null;

  return (
    <div aria-hidden style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 3, zIndex: 10000, background: 'transparent', pointerEvents: 'none' }}>
      <div style={{
        height: '100%', width: '40%', borderRadius: 3,
        background: 'linear-gradient(90deg,#6366f1,#a855f7)',
        boxShadow: '0 0 10px #6366f188',
        animation: 'lumio-nav-slide 1s ease-in-out infinite',
      }} />
    </div>
  );
}
