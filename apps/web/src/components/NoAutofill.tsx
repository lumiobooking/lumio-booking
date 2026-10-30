'use client';

import { useEffect } from 'react';
import { applyNoAutofill } from '../lib/no-autofill';

/** Mounted once in the root layout: every text box, now and as screens open, says autocomplete="off" (see lib/no-autofill). */
export function NoAutofill() {
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    applyNoAutofill(document);
    const mo = new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'attributes') { applyNoAutofill(m.target as Element); continue; }
        m.addedNodes.forEach((node) => { if (node.nodeType === 1) applyNoAutofill(node as Element); });
      }
    });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['autocomplete', 'type'] });
    return () => mo.disconnect();
  }, []);
  return null;
}
