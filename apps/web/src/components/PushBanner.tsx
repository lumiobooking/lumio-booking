'use client';

/**
 * "WHY DOESN'T MY PHONE RING?" — answered at the top of every screen, once.
 *
 * The owner's iPhone had Lumio on the home screen and still showed nothing:
 * the only place to switch notifications on was a card inside the inbox and
 * the activity page; a technician's app had none at all; and a phone whose
 * subscription the server had lost (a reinstall, a switch of salon) stayed
 * silent with nothing to say so.
 *
 * This component:
 *  - re-registers this device with the server whenever notifications are
 *    already allowed (idempotent), so a lost subscription heals by itself;
 *  - offers ONE button to switch them on when they are not (a real tap, as
 *    browsers require), with the iPhone "Add to Home Screen" step when needed;
 *  - clears the app-icon badge when the app is opened.
 * Dismissed for 7 days with ×.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { apiFetch } from '../lib/api';
import { useLang } from '../lib/i18n';
import { isNativeApp } from '../lib/native';
import { pushMessage, pushState, pushSupported, subscribeToPush, isIosNotInstalled, type PushState } from '../lib/push-client';
import { setAppBadge } from '../lib/app-badge';

const DISMISS_KEY = 'lumio_push_banner_until';

export function PushBanner() {
  const { token, user } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const [state, setState] = useState<PushState | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // Opening the app = the alerts were seen: the icon's number goes.
  useEffect(() => {
    const clear = () => { if (document.visibilityState === 'visible') setAppBadge(0); };
    clear();
    document.addEventListener('visibilitychange', clear);
    return () => document.removeEventListener('visibilitychange', clear);
  }, []);

  useEffect(() => {
    if (!token || !user || isNativeApp()) return;
    let alive = true;
    (async () => {
      let k: { key: string; enabled: boolean } | null = null;
      try { k = await apiFetch<{ key: string; enabled: boolean }>('/push/public-key', { token }); } catch { return; }
      if (!alive) return;
      const st = pushState(!!k?.enabled && !!k?.key);
      setKey(k?.key ?? '');
      // Already allowed: make sure THIS device is on the server, for THIS login.
      if (st === 'ready' && pushSupported()) {
        try {
          const reg = await navigator.serviceWorker.ready;
          const sub = await reg.pushManager.getSubscription();
          if (sub) {
            const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
            const mark = `lumio_push_synced_${user.id}_${(j.endpoint ?? '').slice(-24)}`;
            if (j.endpoint && j.keys?.p256dh && j.keys?.auth && !sessionStorage.getItem(mark)) {
              await apiFetch('/push/subscribe', { method: 'POST', token, body: { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } } });
              try { sessionStorage.setItem(mark, '1'); } catch { /* private mode */ }
            }
            if (alive) setState('ready');
            return;
          }
          if (alive) setState('ask'); // allowed once, but this browser has no subscription any more
          return;
        } catch { if (alive) setState('ask'); return; }
      }
      if (alive) setState(st);
    })();
    return () => { alive = false; };
  }, [token, user]);

  let dismissedUntil = 0;
  try { dismissedUntil = Number(localStorage.getItem(DISMISS_KEY) || 0); } catch { /* storage refused */ }
  const show = state === 'ask' || state === 'denied' || (state === 'ios-install' && isIosNotInstalled()) || state === 'server-off';
  if (done || !show || Date.now() < dismissedUntil) return null;

  async function enable() {
    if (!token) return;
    setBusy(true);
    try {
      const r = await subscribeToPush(key);
      if (r.ok && r.subscription) {
        await apiFetch('/push/subscribe', { method: 'POST', token, body: r.subscription });
        setDone(true);
      } else setState(r.state);
    } finally { setBusy(false); }
  }
  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now() + 7 * 86_400_000)); } catch { /* storage refused */ }
    setDone(true);
  }

  const canAsk = state === 'ask';
  return (
    <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0 10px', padding: '10px 12px', borderRadius: 12, border: '1px solid var(--ink-warn)', background: 'var(--wash-amber-2)' }}>
      <span style={{ fontSize: 18 }}>{state === 'denied' ? '🔕' : '🔔'}</span>
      <div style={{ flex: 1, fontSize: 13, lineHeight: 1.45, color: 'var(--ce2e8f0)' }}>
        {canAsk
          ? (vi ? 'Bật thông báo để điện thoại reo khi có booking mới hoặc khách nhắn tin — kể cả khi đã đóng app.' : 'Turn on alerts so this phone rings for new bookings and messages — even with the app closed.')
          : pushMessage(state as PushState, vi)}
      </div>
      {canAsk && (
        <button type="button" onClick={enable} disabled={busy}
          style={{ padding: '8px 14px', borderRadius: 9, border: 'none', background: '#6366f1', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          {busy ? '…' : vi ? 'Bật' : 'Turn on'}
        </button>
      )}
      <button type="button" onClick={dismiss} aria-label={vi ? 'Ẩn' : 'Hide'} style={{ background: 'none', border: 'none', color: 'var(--c94a3b8)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
    </div>
  );
}
