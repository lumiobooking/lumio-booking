'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** The kitchen screen moved to /kitchen (full screen, no salon menu). Old links and bookmarks land there. */
export default function OldKitchenPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/kitchen'); }, [router]);
  return null;
}
