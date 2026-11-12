'use client';

/**
 * /review-posts/{token}: the first address of the client's review link.
 *
 * NOT /review/{token} — that path belongs to the customer review QR page.
 * New links are /plan/{token}; the ones already shared keep working here and
 * show the same month plan (components/PlanLinkPage).
 */
import { PlanLinkPage } from '../../../components/PlanLinkPage';

export default function PublicReviewPage() {
  return <PlanLinkPage />;
}
