import { redirect } from 'next/navigation';

// /super-admin has no page of its own — send it to the Salons (tenants) screen.
// Having this real route also stops the catch-all "/:slug" rewrite from treating
// "super-admin" as a salon slug.
export default function SuperAdminIndex() {
  redirect('/super-admin/tenants');
}
