'use client';

import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { apiFetch } from '../lib/api';
import { useLang } from '../lib/i18n';

// VAPID public key (base64url) -> Uint8Array for pushManager.subscribe.
function urlB64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/**
 * Prompts the owner to turn on Web Push so new bookings alert their phone even
 * when the app is closed. Renders nothing when: unsupported, already enabled, or
 * the server hasn't been given VAPID keys (feature off).
 */
export function PushEnable() {
  const { token } = useAuth();
  const { lang } = useLang();
  const L = (vi: string, en: string) => (lang === 'vi' ? vi : en);
  const [state, setState] = useState<'hidden' | 'prompt' | 'busy' | 'denied'>('hidden');

  useEffect(() => {
    let alive = true;
    (async () => {
      if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
      if (!token) return;
      let enabled = false;
      try { const r = await apiFetch<{ enabled: boolean }>('/push/public-key', { token }); enabled = !!(r && r.enabled); } catch { enabled = false; }
      if (!enabled || !alive) return;
      if (Notification.permission === 'denied') { setState('denied'); return; }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (alive) setState(sub ? 'hidden' : 'prompt');
      } catch { if (alive) setState('prompt'); }
    })();
    return () => { alive = false; };
  }, [token]);

  async function enable() {
    setState('busy');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setState(perm === 'denied' ? 'denied' : 'prompt'); return; }
      const keyRes = await apiFetch<{ key: string; enabled: boolean }>('/push/public-key', { token });
      if (!keyRes || !keyRes.key) { setState('prompt'); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(keyRes.key) as unknown as BufferSource });
      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      await apiFetch('/push/subscribe', { method: 'POST', token, body: { endpoint: json.endpoint, keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth } } });
      setState('hidden');
    } catch { setState('prompt'); }
  }

  if (state === 'hidden') return null;

  const box: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: '11px 13px', margin: '4px 0 12px' };

  if (state === 'denied') {
    return (
      <div style={box}>
        <span style={{ fontSize: 18 }}>🔕</span>
        <div style={{ fontSize: 13, color: '#94a3b8' }}>{L('Thông báo đẩy đang bị chặn trong cài đặt trình duyệt. Hãy bật lại để nhận báo khi có booking mới.', 'Push is blocked in your browser settings. Re-enable it to get new-booking alerts.')}</div>
      </div>
    );
  }

  return (
    <div style={box}>
      <span style={{ fontSize: 18 }}>🔔</span>
      <div style={{ flex: 1, fontSize: 13, color: '#cbd5e1' }}>{L('Nhận thông báo ngay khi có booking mới — kể cả khi đã đóng app.', 'Get alerted the moment a booking arrives — even with the app closed.')}</div>
      <button onClick={enable} disabled={state === 'busy'} style={{ padding: '8px 14px', borderRadius: 9, border: 'none', background: '#6366f1', color: '#fff', fontWeight: 700, fontSize: 13, cursor: state === 'busy' ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>{state === 'busy' ? L('Đang bật…', 'Enabling…') : L('Bật', 'Enable')}</button>
    </div>
  );
}
