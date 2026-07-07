'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Usage & costs now lives inside Billing & plan. Redirect old links there. */
export default function UsageCostsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/salon/billing?tab=usage'); }, [router]);
  return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#94a3b8' }}>…</div>;
}
