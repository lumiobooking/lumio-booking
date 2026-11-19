'use client';

import { useEffect, useState } from 'react';
import { onUiIndustryChange, uiIndustry } from './ui-industry';

/** The trades whose screens are tables and a kitchen, not appointments — the same set the bottom tab bar uses. */
export const FOOD_INDUSTRIES = new Set(['RESTAURANT', 'FAST_FOOD', 'CAFE']);

/** Is this business a restaurant / café? null until the browser has read it (no flash of the other screen). */
export function useIsFood(): boolean | null {
  const [v, setV] = useState<boolean | null>(null);
  useEffect(() => {
    const read = () => setV(FOOD_INDUSTRIES.has(uiIndustry()));
    read();
    return onUiIndustryChange(read);
  }, []);
  return v;
}
