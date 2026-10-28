/**
 * The header's booking inbox, shared by the yellow "N cần xác nhận" pill, the
 * bell's three tabs and the pop-up toasts (the approved "Lịch — thông báo"
 * canvas, boards 2A / 2B / 2C). One poll in the bell fills it; everyone else
 * reads. The API decides what goes where (api activity/booking-inbox.ts) and
 * scopes it to the signed-in salon.
 */
import { useEffect, useState } from 'react';

export type InboxTab = 'needs' | 'fresh' | 'cancelled';

export interface InboxItem {
  id: string;
  status: string;
  customer: string;
  service: string;
  extra: number;
  startTime: string;
  staff: string | null;
  priceCents: number;
  currency: string;
  source: string | null;
  utmSource: string | null;
  attrReferrer: string | null;
  attrLandingUrl: string | null;
  at: string;
  cancelledBy?: string | null;
}

export interface Inbox { needs: InboxItem[]; fresh: InboxItem[]; cancelled: InboxItem[] }

export const EMPTY_INBOX: Inbox = { needs: [], fresh: [], cancelled: [] };

/** Same key + event as the activity page and the old bell, so "seen" agrees everywhere. */
export const SEEN_KEY = 'lumio_activity_seen';
export const SEEN_EVENT = 'lumio-activity-seen';
/** The pill asks the bell to open on a tab. */
export const OPEN_EVENT = 'lumio-inbox-open';
/** "Tiếng báo" — on unless switched off on this device. */
export const SOUND_KEY = 'lumio.bookings.sound';
export const SOUND_EVENT = 'lumio-bookings-sound';
/** How long a toast stays (board 2B). */
export const TOAST_MS = 8000;
/** A booking older than this when first seen is not "just now" — no toast, no ting. */
export const TOAST_FRESH_MS = 15 * 60_000;

export function cleanInbox(raw: unknown): Inbox {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const list = (v: unknown) => (Array.isArray(v) ? (v as InboxItem[]).filter((x) => x && typeof x.id === 'string') : []);
  return { needs: list(r.needs), fresh: list(r.fresh), cancelled: list(r.cancelled) };
}

/** Bell badge: everything not seen yet. A booking still waiting for a yes always counts. */
export function unseenCount(inbox: Inbox, seenAt: number): number {
  const after = (i: InboxItem) => new Date(i.at).getTime() > seenAt;
  return inbox.needs.length + inbox.fresh.filter(after).length + inbox.cancelled.filter(after).length;
}

export interface ToastItem { key: string; tab: InboxTab; item: InboxItem }

/**
 * What to pop up after a reload: items that were not there last time and
 * happened just now. The first load of the page is the baseline (`prev` null):
 * nobody wants nine toasts for the morning's bookings when the tab opens.
 */
export function newArrivals(prev: Inbox | null, next: Inbox, now: number): ToastItem[] {
  if (!prev) return [];
  const had = new Set<string>([
    ...prev.needs.map((i) => `needs:${i.id}`), ...prev.fresh.map((i) => `fresh:${i.id}`), ...prev.cancelled.map((i) => `cancelled:${i.id}`),
    // A booking that moved from "to confirm" to "new" (someone confirmed it) is not news.
    ...prev.needs.map((i) => `fresh:${i.id}`),
  ]);
  const out: ToastItem[] = [];
  const take = (tab: InboxTab, list: InboxItem[]) => {
    for (const item of list) {
      const key = `${tab}:${item.id}`;
      if (had.has(key)) continue;
      if (now - new Date(item.at).getTime() > TOAST_FRESH_MS) continue;
      out.push({ key, tab, item });
    }
  };
  take('needs', next.needs);
  take('cancelled', next.cancelled);
  take('fresh', next.fresh);
  return out;
}

// ---------------------------------------------------------------- the shared store

let current: Inbox = EMPTY_INBOX;
let loaded = false;
const subs = new Set<() => void>();

export function setInbox(next: Inbox) { current = next; loaded = true; subs.forEach((f) => f()); }
export function getInbox(): Inbox { return current; }

/** The latest inbox, re-rendering when the bell reloads it. */
export function useInbox(): { inbox: Inbox; loaded: boolean } {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((x) => x + 1);
    subs.add(f);
    return () => { subs.delete(f); };
  }, []);
  return { inbox: current, loaded };
}

/** Drop a booking from every list at once (after "Xác nhận" / "Từ chối"), before the reload confirms it. */
export function removeFromInbox(id: string, from: InboxTab[] = ['needs']) {
  const next: Inbox = { ...current };
  for (const t of from) next[t] = next[t].filter((i) => i.id !== id);
  setInbox(next);
}

export function soundOn(): boolean {
  try { return window.localStorage.getItem(SOUND_KEY) !== '0'; } catch { return true; }
}

export function setSoundOn(on: boolean) {
  try { window.localStorage.setItem(SOUND_KEY, on ? '1' : '0'); } catch { /* private mode: this session only */ }
  try { window.dispatchEvent(new Event(SOUND_EVENT)); } catch { /* old browsers */ }
}

export function useSoundOn(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(true);
  useEffect(() => {
    setOn(soundOn());
    const f = () => setOn(soundOn());
    window.addEventListener(SOUND_EVENT, f);
    window.addEventListener('storage', f);
    return () => { window.removeEventListener(SOUND_EVENT, f); window.removeEventListener('storage', f); };
  }, []);
  return [on, (v: boolean) => { setSoundOn(v); setOn(v); }];
}

/** Open the bell's panel on a tab (the pill does this). */
export function openInbox(tab: InboxTab) {
  try { window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: tab })); } catch { /* old browsers */ }
}
