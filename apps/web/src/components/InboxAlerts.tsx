'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { useLang } from '../lib/i18n';
import { apiFetch, apiStream } from '../lib/api';
import {
  AlertRow, Alert, AlertMemory, emptyMemory, nextAlerts, unreadCount, tabTitle, alertHeadline,
} from '../lib/inbox-alerts';
import { PushState, pushState, subscribeToPush, pushMessage } from '../lib/push-client';

/**
 * The thing that tells somebody a customer is waiting.
 *
 * WHY IT LIVES IN THE SHELL AND NOT ON THE INBOX PAGE
 *
 * Nobody sits on the inbox waiting for it to light up. A technician is on their
 * bookings, or their chair, or has the tab in the background while doing a set
 * of nails. An alert that only works on the page you are already looking at is
 * an alert for a problem you do not have. So this rides in the shell and is
 * therefore live on every screen of the portal.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It never shows the customer's message. Not in the toast, not in the system
 * notification. A notification is read over somebody's shoulder, on a lock
 * screen, at the front desk with customers standing there — a salon's messages
 * are private and a phone lying face-up on the counter is not a private place.
 * The name and "vừa nhắn tin" is enough to make somebody open the app, which is
 * the entire job.
 *
 * The rules about WHEN to make a noise are not here: they are in
 * lib/inbox-alerts.ts with a test each, because "too loud" is how notification
 * features die and every one of those rules is easy to get subtly wrong.
 */

const MUTE_KEY = 'lumio.inbox.muted';

/** A short two-note chime, synthesised. No audio file to 404 or fail to load. */
function playChime() {
  try {
    const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext });
    const AudioCtor = Ctx.AudioContext || Ctx.webkitAudioContext;
    if (!AudioCtor) return;
    const ctx = new AudioCtor();
    const now = ctx.currentTime;
    [880, 1170].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      // A quick fade in and out. A square-edged tone clicks, and a click is
      // what people describe as "that horrible noise".
      gain.gain.setValueAtTime(0.0001, now + i * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.22, now + i * 0.16 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.16 + 0.30);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.16);
      osc.stop(now + i * 0.16 + 0.32);
    });
    setTimeout(() => void ctx.close().catch(() => undefined), 1200);
  } catch { /* a browser that will not make a noise is not a reason to fail */ }
}

export function InboxAlerts({ href = '/staff/inbox', label = 'Inbox' }: { href?: string; label?: string }) {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';

  const [count, setCount] = useState(0);
  const [toasts, setToasts] = useState<Alert[]>([]);
  const [muted, setMuted] = useState(false);
  const [push, setPush] = useState<PushState>('unsupported');
  const [pushNote, setPushNote] = useState<string | null>(null);
  const [pushKey, setPushKey] = useState<string | null>(null);

  const memRef = useRef<AlertMemory>(emptyMemory());
  const mutedRef = useRef(false);
  const baseTitle = useRef<string>('');

  useEffect(() => {
    baseTitle.current = document.title;
    try {
      const m = window.localStorage.getItem(MUTE_KEY) === '1';
      setMuted(m); mutedRef.current = m;
    } catch { /* private mode */ }
  }, []);

  // Ask the server whether push is actually configured BEFORE offering it.
  // Offering a button that cannot work is worse than not offering one: somebody
  // presses it, sees no error, and believes they will be notified.
  useEffect(() => {
    if (!token) return;
    let gone = false;
    void (async () => {
      try {
        // The push subsystem this uses already existed for booking alerts —
        // same endpoint, same VAPID key, same subscription table. A customer
        // message is simply another reason to wake the same phone.
        const st = await apiFetch<{ key: string; enabled: boolean }>('/push/public-key', { token });
        if (gone) return;
        setPushKey(st?.key || null);
        setPush(pushState(!!st?.enabled && !!st?.key));
      } catch {
        if (!gone) setPush(pushState(false));
      }
    })();
    return () => { gone = true; };
  }, [token]);

  // Re-subscribe on every load once permission exists. A browser can retire a
  // subscription on its own — after an update, or a long idle period — and the
  // only sign is that notifications quietly stop arriving.
  useEffect(() => {
    if (!token || !pushKey || push !== 'ready') return;
    void (async () => {
      const res = await subscribeToPush(pushKey);
      if (res.ok && res.subscription) {
        await apiFetch('/push/subscribe', { method: 'POST', token, body: res.subscription }).catch(() => undefined);
      }
    })();
  }, [token, pushKey, push]);

  const fire = useCallback((alerts: Alert[]) => {
    if (!alerts.length) return;

    if (!mutedRef.current) playChime();

    // Newest first, and only ever three on screen. A stack of eleven cards is
    // not information, it is a wall the person has to dismiss before working.
    setToasts((prev) => [...alerts, ...prev].slice(0, 3));

    // The system notification is for when the app is NOT the thing being looked
    // at. Firing it over a visible page duplicates the toast for no gain.
    if (document.hidden && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        const n = new Notification(alertHeadline(alerts, vi), {
          body: vi ? 'Mở Lumio để trả lời khách' : 'Open Lumio to reply',
          tag: 'lumio-inbox',   // replaces the previous one instead of stacking
          icon: '/icons/icon-192.png',
        });
        n.onclick = () => { window.focus(); window.location.href = href; n.close(); };
      } catch { /* denied or unsupported */ }
    }
  }, [vi, href]);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const rows = await apiFetch<AlertRow[]>('/messenger/threads', { token });
      const list = Array.isArray(rows) ? rows : [];
      setCount(unreadCount(list));
      // The conversation on screen is excluded by the inbox page itself, which
      // knows which one is open; here in the shell nothing is open.
      const { memory, alerts } = nextAlerts(memRef.current, list, {});
      memRef.current = memory;
      fire(alerts);
    } catch { /* a failed poll is not worth telling anybody about */ }
  }, [token, fire]);

  useEffect(() => {
    if (!token) return;
    let stop: (() => void) | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let gone = false;

    void refresh();

    const connect = () => {
      if (gone) return;
      stop = apiStream('/messenger/stream', token, () => void refresh(), () => {
        if (gone) return;
        retry = setTimeout(connect, 5000);
      });
    };
    connect();

    // The same safety net the inbox uses. A stream that dies quietly leaves a
    // screen that LOOKS live, and here that means an alarm that never rings.
    const poll = setInterval(() => void refresh(), 30_000);

    return () => { gone = true; stop?.(); if (retry) clearTimeout(retry); clearInterval(poll); };
  }, [token, refresh]);

  // The count in the tab title, so a background tab still says how many.
  useEffect(() => {
    if (!baseTitle.current) return;
    document.title = tabTitle(baseTitle.current, count);
  }, [count]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next); mutedRef.current = next;
    try { window.localStorage.setItem(MUTE_KEY, next ? '1' : '0'); } catch { /* private mode */ }
  };

  /** Always from a click. See subscribeToPush for why that matters. */
  const enablePush = async () => {
    if (!pushKey || !token) { setPushNote(pushMessage('server-off', vi)); return; }
    const res = await subscribeToPush(pushKey);
    setPush(res.state);
    setPushNote(pushMessage(res.state, vi));
    if (res.ok && res.subscription) {
      await apiFetch('/push/subscribe', { method: 'POST', token, body: res.subscription }).catch(() => undefined);
    }
    setTimeout(() => setPushNote(null), 12_000);
  };

  return (
    <>
      <a href={href} style={{
        position: 'relative', padding: '8px 14px', borderRadius: 8,
        border: `1px solid ${count > 0 ? '#ef4444' : 'var(--c475569)'}`,
        background: count > 0 ? 'var(--c7f1d1d)' : 'transparent',
        color: 'var(--ce2e8f0)', fontSize: 13, textDecoration: 'none', fontWeight: count > 0 ? 700 : 400,
      }}>
        💬 {label}
        {count > 0 && (
          <span style={{
            marginLeft: 7, background: '#ef4444', color: '#fff', borderRadius: 999,
            padding: '1px 7px', fontSize: 12, fontWeight: 800,
          }}>{count}</span>
        )}
      </a>

      <button onClick={toggleMute} title={muted ? (vi ? 'Bật tiếng' : 'Unmute') : (vi ? 'Tắt tiếng' : 'Mute')}
        aria-label={muted ? 'Unmute' : 'Mute'}
        style={{
          padding: '8px 10px', borderRadius: 8, border: '1px solid var(--c475569)',
          background: 'transparent', color: muted ? 'var(--c64748b)' : 'var(--ce2e8f0)', fontSize: 13, cursor: 'pointer',
        }}>{muted ? '🔇' : '🔔'}</button>

      {push !== 'ready' && (
        // Asked with a button, never on page load. A browser shows the
        // permission box once; spending it the second somebody logs in, before
        // they know what the app is, is how you get a permanent "Block".
        <button onClick={() => void enablePush()}
          title={pushMessage(push, vi)}
          style={{
            padding: '8px 12px', borderRadius: 8, border: '1px solid #6366f1',
            background: 'var(--c312e81)', color: 'var(--cc7d2fe)', fontSize: 12, cursor: 'pointer',
          }}>
          {vi ? 'Bật thông báo' : 'Turn on alerts'}
        </button>
      )}

      {pushNote && (
        // Says WHY when it did not work. "Notifications are not working" with
        // no explanation is a support call; "your iPhone needs the app on the
        // home screen first" is three taps.
        <div style={{
          position: 'fixed', left: 16, bottom: 16, zIndex: 60, maxWidth: 340,
          background: 'var(--c1e293b)', border: '1px solid var(--c475569)', borderRadius: 10,
          padding: '11px 13px', fontSize: 12, color: 'var(--ccbd5e1)', lineHeight: 1.5,
        }}>
          {pushNote}
          <button onClick={() => setPushNote(null)}
            style={{ marginLeft: 8, background: 'none', border: 'none', color: 'var(--c64748b)', cursor: 'pointer' }}>×</button>
        </div>
      )}

      {toasts.length > 0 && (
        <div style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 60, display: 'grid', gap: 8, maxWidth: 320 }}>
          {toasts.map((t) => (
            <a key={`${t.id}-${t.name}`} href={href}
              onClick={() => setToasts((p) => p.filter((x) => x.id !== t.id))}
              style={{
                display: 'block', textDecoration: 'none',
                background: 'var(--c1e293b)', border: '1px solid #6366f1', borderLeft: '4px solid #6366f1',
                borderRadius: 10, padding: '11px 13px', boxShadow: '0 10px 30px rgba(0,0,0,.45)',
              }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{t.name}</p>
              <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--c94a3b8)' }}>
                {vi ? 'vừa nhắn tin' : 'sent a message'}{t.pageName ? ` · ${t.pageName}` : ''}
              </p>
              <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--c818cf8)', fontWeight: 600 }}>
                {vi ? 'Bấm để trả lời →' : 'Tap to reply →'}
              </p>
            </a>
          ))}
        </div>
      )}
    </>
  );
}

/** Kept as a named export so shells can drop the nav link in without ceremony. */
export const InboxNavLink = InboxAlerts;
