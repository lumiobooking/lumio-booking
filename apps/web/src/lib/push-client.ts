/**
 * Subscribing this browser to push notifications.
 *
 * Every step here can fail for a reason that is nobody's fault — an older
 * browser, a locked-down phone, an iPhone that has not been added to the home
 * screen — so every function reports WHY rather than returning a bare false.
 * "Notifications are not working" with no explanation is a support call; "your
 * iPhone needs the app added to the home screen first" is not.
 */

export type PushState =
  | 'ready'          // subscribed and working
  | 'ask'            // supported, permission not yet requested
  | 'denied'         // the person said no, or the browser blocked it
  | 'unsupported'    // this browser cannot do push at all
  | 'ios-install'    // iPhone/iPad: needs Add to Home Screen first
  | 'server-off';    // the salon's server has no VAPID keys configured

/** iOS only allows push from a web app that has been added to the home screen. */
export function isIosNotInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent || '';
  const iOS = /iPad|iPhone|iPod/.test(ua)
    // iPadOS reports itself as a Mac; the touch points give it away.
    || (/Macintosh/.test(ua) && typeof document !== 'undefined' && navigator.maxTouchPoints > 1);
  if (!iOS) return false;
  const standalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true
    || window.matchMedia?.('(display-mode: standalone)').matches === true;
  return !standalone;
}

export function pushSupported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

/** Where this browser stands, before anybody is asked anything. */
export function pushState(serverEnabled: boolean): PushState {
  if (!pushSupported()) return isIosNotInstalled() ? 'ios-install' : 'unsupported';
  if (isIosNotInstalled()) return 'ios-install';
  if (!serverEnabled) return 'server-off';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'granted') return 'ready';
  return 'ask';
}

/** VAPID keys travel as base64url; PushManager wants raw bytes. */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export interface SubscribeResult {
  ok: boolean;
  state: PushState;
  subscription?: { endpoint: string; keys: { p256dh: string; auth: string } };
  error?: string;
}

/**
 * Ask permission and register with the browser's push service.
 *
 * Must be called from a real click. Browsers ignore a permission request that
 * did not come from a gesture, and — worse — some of them count it against you,
 * so asking on page load can permanently block the salon from ever asking again.
 */
export async function subscribeToPush(publicKey: string): Promise<SubscribeResult> {
  if (!pushSupported()) return { ok: false, state: isIosNotInstalled() ? 'ios-install' : 'unsupported' };
  if (isIosNotInstalled()) return { ok: false, state: 'ios-install' };
  if (!publicKey) return { ok: false, state: 'server-off' };

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return { ok: false, state: permission === 'denied' ? 'denied' : 'ask' };

    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    // Reuse an existing subscription. Calling subscribe() twice with the same
    // key returns the same endpoint, but an OLD subscription made with a
    // different key throws — so drop that one first rather than failing.
    let sub = await reg.pushManager.getSubscription();
    if (sub) {
      const same = sub.options?.applicationServerKey
        && bytesEqual(new Uint8Array(sub.options.applicationServerKey as ArrayBuffer), urlBase64ToUint8Array(publicKey));
      if (!same) { await sub.unsubscribe().catch(() => undefined); sub = null; }
    }
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,   // required; browsers revoke silent push
        applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
      });
    }

    const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      return { ok: false, state: 'unsupported', error: 'incomplete subscription' };
    }
    return {
      ok: true,
      state: 'ready',
      subscription: { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } },
    };
  } catch (e) {
    return { ok: false, state: 'unsupported', error: String(e).slice(0, 200) };
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/** What to tell the person, in their own language. */
export function pushMessage(state: PushState, vi: boolean): string {
  switch (state) {
    case 'ready':
      return vi ? 'Đã bật thông báo trên thiết bị này.' : 'Notifications are on for this device.';
    case 'ask':
      return vi ? 'Bật thông báo để biết ngay khi khách nhắn tin.' : 'Turn on alerts to know the moment a customer writes.';
    case 'denied':
      return vi
        ? 'Trình duyệt đang chặn thông báo. Mở phần cài đặt trang web của trình duyệt và cho phép Thông báo cho trang này.'
        : 'The browser is blocking notifications. Allow them for this site in the browser’s site settings.';
    case 'ios-install':
      // The single most common "it does not work on my iPhone" — and the fix is
      // three taps, if somebody says what they are.
      return vi
        ? 'Trên iPhone/iPad: mở Safari → nút Chia sẻ → "Thêm vào MH chính", rồi mở Lumio từ biểu tượng đó và bật lại. iPhone chỉ cho phép thông báo theo cách này.'
        : 'On iPhone/iPad: Safari → Share → "Add to Home Screen", then open Lumio from that icon and turn alerts on there. iOS only allows notifications this way.';
    case 'server-off':
      return vi
        ? 'Máy chủ chưa cấu hình khoá thông báo (VAPID). Chuông trong app vẫn chạy bình thường.'
        : 'The server has no notification keys (VAPID) configured yet. The in-app chime still works.';
    default:
      return vi
        ? 'Trình duyệt này không hỗ trợ thông báo ngoài app. Chuông trong app vẫn chạy khi đang mở phần mềm.'
        : 'This browser cannot do background notifications. The in-app chime still works while Lumio is open.';
  }
}
