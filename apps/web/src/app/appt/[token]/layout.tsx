import type { ReactNode } from 'react';
import { FixedPalette } from '../../../components/FixedPalette';

/**
 * rt249 — a page the salon's CUSTOMER opens from a text / email. It is drawn in
 * its own fixed light design, so it must not follow the light/dark switch of
 * whoever last used this browser (the theme variables flip in light mode and
 * would turn its pale greys dark).
 */
export default function CustomerPageLayout({ children }: { children: ReactNode }) {
  return <><FixedPalette />{children}</>;
}
