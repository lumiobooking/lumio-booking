/**
 * The store app, seen from the web app.
 *
 * The iOS/Android apps (store-app) are a Capacitor shell that loads this
 * site. Capacitor injects `window.Capacitor` into the page, with proxies for
 * every native plugin the shell was built with — so the site can call the
 * plugins without depending on any Capacitor package itself. Everything
 * here is a no-op in a normal browser; nothing on the web changes shape.
 *
 * What the shell changes, in one place:
 *  - push goes through APNs/FCM (an iOS WebView has no PushManager);
 *  - the subscription is never sold in-app (Apple 3.1.1) — billing hides
 *    its checkout and points at the website;
 *  - Android's back button walks history instead of killing the app.
 */

type Listener = { remove: () => Promise<void> | void };
interface CapPlugins {
  PushNotifications?: {
    checkPermissions(): Promise<{ receive: string }>;
    requestPermissions(): Promise<{ receive: string }>;
    register(): Promise<void>;
    addListener(ev: string, fn: (e: unknown) => void): Promise<Listener> | Listener;
    createChannel?(c: { id: string; name: string; importance?: number; sound?: string; vibration?: boolean }): Promise<void>;
  };
  App?: {
    addListener(ev: string, fn: (e: unknown) => void): Promise<Listener> | Listener;
    minimizeApp?(): Promise<void>;
    exitApp?(): Promise<void>;
  };
  SplashScreen?: { hide(): Promise<void> };
  StatusBar?: { setStyle(o: { style: 'DARK' | 'LIGHT' }): Promise<void>; setBackgroundColor?(o: { color: string }): Promise<void> };
  Browser?: { open(o: { url: string }): Promise<void> };
}
interface Cap {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: CapPlugins;
}

function cap(): Cap | null {
  if (typeof window === 'undefined') return null;
  const c = (window as unknown as { Capacitor?: Cap }).Capacitor;
  return c && typeof c === 'object' ? c : null;
}

/** True inside the iOS/Android app, false in every browser. */
export function isNativeApp(): boolean {
  const c = cap();
  return Boolean(c?.isNativePlatform?.());
}

export function nativePlatform(): 'ios' | 'android' | null {
  const p = cap()?.getPlatform?.();
  return p === 'ios' || p === 'android' ? p : null;
}

export function plugins(): CapPlugins {
  return cap()?.Plugins ?? {};
}

/** Open a page outside the app (system browser). Falls back to a new tab. */
export async function openExternal(url: string): Promise<void> {
  const b = plugins().Browser;
  if (isNativeApp() && b) { await b.open({ url }); return; }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Register this phone for push and hand the token to the API.
 * Returns the outcome so a screen can say "on" / "denied" / "not here".
 */
export async function registerNativePush(
  post: (token: string, platform: 'ios' | 'android') => Promise<void>,
): Promise<'registered' | 'denied' | 'unavailable'> {
  const pn = plugins().PushNotifications;
  const platform = nativePlatform();
  if (!isNativeApp() || !pn || !platform) return 'unavailable';
  let perm = await pn.checkPermissions().catch(() => ({ receive: 'prompt' }));
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
    perm = await pn.requestPermissions().catch(() => ({ receive: 'denied' }));
  }
  if (perm.receive !== 'granted') return 'denied';
  // Android 8+: a channel is required or the notification is silently dropped.
  if (platform === 'android' && pn.createChannel) {
    await pn.createChannel({ id: 'lumio', name: 'Lumio', importance: 4, sound: 'default', vibration: true }).catch(() => undefined);
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = (r: 'registered' | 'denied') => { if (!done) { done = true; resolve(r); } };
    void pn.addListener('registration', (e) => {
      const token = (e as { value?: string })?.value;
      if (!token) { finish('denied'); return; }
      post(token, platform).then(() => finish('registered')).catch(() => finish('denied'));
    });
    void pn.addListener('registrationError', () => finish('denied'));
    pn.register().catch(() => finish('denied'));
    setTimeout(() => finish('denied'), 15_000);
  });
}
