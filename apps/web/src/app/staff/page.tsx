import { redirect } from 'next/navigation';

// /staff has no page of its own — send it to the technician's home screen (Hôm nay). Also stops
// the catch-all "/:slug" rewrite from treating "staff" as a salon slug.
export default function StaffIndex() {
  redirect('/staff/today');
}
