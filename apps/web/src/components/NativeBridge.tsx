'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth';
import { apiFetch } from '../lib/api';
import { isNativeApp, plugins, registerNativePush } from '../lib/native';

/**
 * Mounted once in the root layout. Does nothing in a browser.
 *
 * In the store app it: marks the document (`data-native`) so styles can
 * hide browser-only UI; registers the phone for push once somebody is
 * signed in; opens the right screen when a notification is tapped; makes
 * Android's back button go back; sets the status bar; hides the splash.
 */
export function NativeBridge() {
  const { token } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isNativeApp()) return;
    document.documentElement.dataset.native = '1';
    const p = plugins();
    void p.SplashScreen?.hide().catch(() => undefined);
    void p.StatusBar?.setStyle({ style: 'DARK' }).catch(() => undefined);

    const subs: { remove: () => unknown }[] = [];
    const on = async (add: (() => Promise<{ remove: () => unknown }> | { remove: () => unknown }) | undefined) => {
      if (!add) return;
      try { subs.push(await add()); } catch { /* plugin missing in this build */ }
    };

    // Back button: history first, then background the app — never a crash-quit.
    void on(() => p.App!.addListener('backButton', (e) => {
      const canGoBack = (e as { canGoBack?: boolean })?.canGoBack ?? window.history.length > 1;
      if (canGoBack) window.history.back();
      else void p.App?.minimizeApp?.();
    }));
    // A notification tapped while the app was closed or in the background.
    void on(() => p.PushNotifications!.addListener('pushNotificationActionPerformed', (e) => {
      const url = (e as { notification?: { data?: { url?: string } } })?.notification?.data?.url;
      if (url && url.startsWith('/')) router.push(url);
    }));
    return () => { subs.forEach((s) => { try { void s.remove(); } catch { /* ignore */ } }); };
  }, [router]);

  // Push: once per sign-in. The token is tied to the user, so a sign-out and
  // a different sign-in on the same phone re-registers under the new person.
  useEffect(() => {
    if (!isNativeApp() || !token) return;
    void registerNativePush((t, platform) => apiFetch('/push/native', { method: 'POST', token, body: { token: t, platform } }).then(() => undefined));
  }, [token]);

  return null;
}
