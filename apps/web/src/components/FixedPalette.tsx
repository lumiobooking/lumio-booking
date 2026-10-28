'use client';

import { useEffect } from 'react';

/**
 * The screens CUSTOMERS look at — the customer display, the till's customer
 * screen, the self check-in iPad — are drawn in their own fixed light design.
 * They must not follow the salon's light/dark switch.
 *
 * Why: every colour is a CSS variable named after its dark-mode value
 * (var(--c0f172a) = #0f172a). With the device switched to LIGHT, those
 * variables flip — dark ink turns near-white — so on the salon's iPad
 * "Enjoying your visit?" vanished from the review card and the salon name went
 * faint over the photo. Without the light attribute each variable is exactly
 * the colour written, which is what these screens were designed with.
 *
 * Removes the attribute while the screen is up and puts it back on the way
 * out (the admin app can navigate here and back in one tab). The inline
 * script in each layout does the same before the first paint (no flash).
 */
export const FIXED_PALETTE_SCRIPT = "try{document.documentElement.removeAttribute('data-theme')}catch(e){}";

export function FixedPalette() {
  useEffect(() => {
    const el = document.documentElement;
    const before = el.dataset.theme;
    const drop = () => { if (el.dataset.theme) delete el.dataset.theme; };
    drop();
    // Something re-applying the device theme (a ThemeToggle elsewhere) is undone at once.
    const mo = new MutationObserver(drop);
    mo.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { mo.disconnect(); if (before) el.dataset.theme = before; };
  }, []);
  return <script dangerouslySetInnerHTML={{ __html: FIXED_PALETTE_SCRIPT }} />;
}
