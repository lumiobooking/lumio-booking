'use client';

import { ReactNode } from 'react';
import { SalonShell } from '../../components/SalonShell';

// Mount the salon chrome (sidebar + auth gate + plan/feature/business-type loads)
// ONCE for the whole /salon section. Next.js keeps this layout mounted while you
// navigate between salon pages, so the shell no longer remounts and refetches on
// every click — which was making the sidebar (and the Tables/Menu items) flash.
// Pages still wrapping themselves in <SalonShell> are detected as nested and
// render as pass-throughs.
export default function SalonLayout({ children }: { children: ReactNode }) {
  return <SalonShell>{children}</SalonShell>;
}
