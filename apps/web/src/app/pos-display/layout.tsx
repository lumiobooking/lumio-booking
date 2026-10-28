import { FixedPalette } from '../../components/FixedPalette';

/**
 * The till's customer screen (opened next to the register or on a second
 * device). Customers see a fixed light design, never the salon's dark/light
 * switch — see components/FixedPalette.
 */
export default function PosDisplayLayout({ children }: { children: React.ReactNode }) {
  return <><FixedPalette />{children}</>;
}
