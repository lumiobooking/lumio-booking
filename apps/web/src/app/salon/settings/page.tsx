'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SalonShell } from '../../../components/SalonShell';
import { SettingsScreen } from '../../../components/settings/SettingsScreen';

/**
 * Settings › Salon settings. How messages go out (e-mail / SMS) and the
 * automatic reminders moved to Settings › Notifications, next to the message
 * templates and the send history — old links land there.
 */
const MOVED: Record<string, string> = { notifications: 'channels', reminders: 'reminders' };

export default function SettingsPage() {
  const router = useRouter();
  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get('tab');
    if (want && MOVED[want]) router.replace(`/salon/notifications?tab=${MOVED[want]}`);
  }, [router]);
  return <SalonShell><SettingsScreen exclude={['notifications', 'reminders']} /></SalonShell>;
}
