'use client';

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth';
import { apiFetch } from '../lib/api';
import { useLang } from '../lib/i18n';
import { useIsMobile } from '../lib/responsive';
import { useLiveTopics } from '../lib/useLiveEvents';
import { installSoundUnlock, playChime } from '../lib/inbox-sound';
import {
  cleanInbox, getInbox, newArrivals, OPEN_EVENT, SEEN_EVENT, SEEN_KEY, setInbox, soundOn, unseenCount,
  type Inbox, type InboxTab, type ToastItem,
} from '../lib/booking-inbox';
import { BookingDetailSheet } from './BookingDetailSheet';
import { BookingToasts, InboxPanel } from './BookingInbox';
import { ind } from '../lib/ui-industry';

/** The rest of the activity feed (payments, reports, posts) — counted, listed on /salon/activity. */
interface FeedItem { id: string; type: string; at: string }

const seenAt = () => { try { return new Date(window.localStorage.getItem(SEEN_KEY) || 0).getTime(); } catch { return 0; } };

/**
 * The bell in the top bar (desktop and phone). Since the "Lịch — thông báo"
 * canvas (board 2A) it opens the booking inbox in three tabs — to confirm,
 * new, cancelled — with Confirm / Decline in the row; on a phone it is a sheet
 * from the bottom (2C). It is also the engine: it polls the inbox (and is
 * nudged by the live "bookings" stream), fills lib/booking-inbox for the pill,
 * and pops a toast + "ting" when a customer books or cancels (2B).
 *
 * Uses the same 'lumio_activity_seen' key + 'lumio-activity-seen' event as the
 * mobile tab bar and the activity page so the badge agrees everywhere.
 */
export function NotificationBell() {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const isMobile = useIsMobile();
  const router = useRouter();
  const L = (v: string, e: string) => ind(vi ? v : e);
  const [badge, setBadge] = useState(0);
  const [others, setOthers] = useState(0);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<InboxTab>('needs');
  const [openId, setOpenId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const prev = useRef<Inbox | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const feed = useRef<FeedItem[]>([]);

  const recount = useCallback(() => {
    const s = seenAt();
    const o = feed.current.filter((i) => i.type !== 'booking' && i.type !== 'cancel' && new Date(i.at).getTime() > s).length;
    setOthers(o);
    setBadge(unseenCount(getInbox(), s) + o);
  }, []);

  const loadInbox = useCallback(() => {
    if (!token) return;
    apiFetch<unknown>('/activity/inbox', { token })
      .then((raw) => {
        const next = cleanInbox(raw);
        const fresh = newArrivals(prev.current, next, Date.now());
        prev.current = next;
        setInbox(next);
        recount();
        if (fresh.length) {
          setToasts((t) => [...fresh, ...t.filter((x) => !fresh.some((f) => f.key === x.key))].slice(0, 6));
          if (soundOn()) void playChime();
        }
      })
      .catch(() => undefined);
  }, [token, recount]);

  const loadFeed = useCallback(() => {
    if (!token) return;
    apiFetch<FeedItem[]>('/activity', { token })
      .then((list) => { if (Array.isArray(list)) { feed.current = list; recount(); } })
      .catch(() => undefined);
  }, [token, recount]);

  useEffect(() => {
    if (!token) return;
    loadInbox(); loadFeed();
    // Every 30 s while the tab is visible (the live stream usually beats it); a hidden tab stops asking.
    const iv = window.setInterval(() => { if (document.visibilityState === 'visible') loadInbox(); }, 30_000);
    const iv2 = window.setInterval(() => { if (document.visibilityState === 'visible') loadFeed(); }, 90_000);
    const onSeen = () => recount();
    const onVis = () => { if (document.visibilityState === 'visible') { loadInbox(); loadFeed(); } };
    const onOpen = (e: Event) => { const t = (e as CustomEvent<InboxTab>).detail; setTab(t === 'fresh' || t === 'cancelled' ? t : 'needs'); setOpen(true); loadInbox(); };
    window.addEventListener(SEEN_EVENT, onSeen);
    window.addEventListener(OPEN_EVENT, onOpen);
    document.addEventListener('visibilitychange', onVis);
    // The first click anywhere lets the browser play the "ting".
    const unlock = installSoundUnlock();
    return () => {
      window.clearInterval(iv); window.clearInterval(iv2); unlock();
      window.removeEventListener(SEEN_EVENT, onSeen); window.removeEventListener(OPEN_EVENT, onOpen);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [token, loadInbox, loadFeed, recount]);

  // A booking written anywhere (another device, the booking page, the bot) nudges this at once.
  useLiveTopics(['bookings'], token, loadInbox);

  const markSeen = () => {
    try { window.localStorage.setItem(SEEN_KEY, new Date().toISOString()); } catch { /* ignore */ }
    window.dispatchEvent(new Event(SEEN_EVENT));
    recount();
  };
  const openPanel = () => { setOpen(true); setTab(getInbox().needs.length ? 'needs' : 'fresh'); loadInbox(); };
  const close = () => { setOpen(false); markSeen(); };
  const changed = () => { loadInbox(); };
  const dismiss = useCallback((key: string) => setToasts((t) => t.filter((x) => x.key !== key)), []);

  const bellBtn: CSSProperties = { position: 'relative', width: 40, height: 40, borderRadius: 10, border: `1px solid ${open ? '#a5b4fc' : 'var(--c334155)'}`, background: open ? 'var(--wash-blue)' : 'var(--c1e293b)', color: open ? 'var(--ink-link)' : 'var(--ce2e8f0)', cursor: 'pointer', display: 'grid', placeItems: 'center', flexShrink: 0 };
  const badgeStyle: CSSProperties = { position: 'absolute', top: -6, right: -6, minWidth: 20, height: 20, padding: '0 5px', boxSizing: 'border-box', borderRadius: 999, background: '#dc2626', color: '#fff', fontSize: 11, fontWeight: 800, display: 'grid', placeItems: 'center', border: '2px solid var(--c111827)' };
  const panel: CSSProperties = isMobile
    ? { position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 71, background: 'var(--c0f172a)', borderRadius: '18px 18px 0 0', boxShadow: '0 -10px 30px rgba(15,23,42,0.35)', maxHeight: '78vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }
    : { position: 'fixed', top: 68, right: 24, width: 460, zIndex: 71, background: 'var(--c0f172a)', border: '1px solid var(--c223047)', borderRadius: 14, boxShadow: '0 20px 48px rgba(15,23,42,0.35)', maxHeight: '78vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' };

  return (
    <>
      <button onClick={() => (open ? close() : openPanel())} aria-label={L('Thông báo', 'Notifications')} aria-expanded={open} style={bellBtn}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {badge > 0 && <span style={badgeStyle}>{badge > 99 ? '99+' : badge}</span>}
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <>
          <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 70, background: isMobile ? 'rgba(2,6,23,0.45)' : 'transparent' }} />
          <div role="dialog" aria-label={L('Thông báo', 'Notifications')} style={panel}>
            {isMobile && <span aria-hidden="true" style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, background: 'var(--c475569)', margin: '8px 0 6px', flexShrink: 0 }} />}
            <InboxPanel token={token} vi={vi} mobile={isMobile} tab={tab} setTab={setTab} others={others}
              onOpen={(id) => { setOpen(false); setOpenId(id); }}
              onClose={close} onSeen={markSeen} onChanged={changed}
              onAll={() => { close(); router.push('/salon/activity'); }} />
          </div>
        </>,
        document.body,
      )}

      {mounted && toasts.length > 0 && createPortal(
        <BookingToasts toasts={toasts} vi={vi} mobile={isMobile} token={token} dismiss={dismiss} onOpen={(id) => setOpenId(id)} onChanged={changed} />,
        document.body,
      )}

      {openId && <BookingDetailSheet token={token} apptId={openId} onClose={() => setOpenId(null)} lang={lang} L={L} />}
    </>
  );
}
