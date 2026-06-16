import { redirect } from 'next/navigation';

// /staff has no page of its own — send it to the staff booking queue. Also stops
// the catch-all "/:slug" rewrite from treating "staff" as a salon slug.
export default function StaffIndex() {
  redirect('/staff/bookings');
}
