'use client';

/**
 * rt208 — does THIS team member answer customers? (ticked in Chia turn, or a
 * role that opens the Inbox). The technicians' app asks once and shows the
 * Inbox tab when the answer is yes.
 *
 * rt214 — "lúc load lúc đầu tài khoản báo không có quyền sau đó mới vào". The
 * answer used to start as NO while the question was still on its way, so the
 * Inbox page flashed "Bạn chưa được giao trả lời tin nhắn" for a second or
 * two. Now there are three answers: still asking, yes, no. The last answer is
 * remembered on this device so a reload opens straight away, and a failed
 * request (a server waking up) is asked once more before saying no.
 */
import { useEffect, useState } from 'react';
import { apiFetch } from './api';

export type SeatState = 'loading' | 'yes' | 'no';

const STORE = 'lumio_chat_seat';
let cached: { at: number; token: string; on: boolean } | null = null;

const keyOf = (token: string) => token.slice(-24);

function remembered(token: string | null | undefined): boolean | null {
  if (!token) return null;
  if (cached && cached.token === token) return cached.on;
  try {
    const raw = window.localStorage.getItem(STORE);
    const v = raw ? JSON.parse(raw) as { k?: string; on?: boolean } : null;
    if (v && v.k === keyOf(token) && typeof v.on === 'boolean') return v.on;
  } catch { /* fine without */ }
  return null;
}

function remember(token: string, on: boolean) {
  cached = { at: Date.now(), token, on };
  try { window.localStorage.setItem(STORE, JSON.stringify({ k: keyOf(token), on })); } catch { /* fine without */ }
}

export function useChatSeatState(token: string | null | undefined): SeatState {
  const [state, setState] = useState<SeatState>(() => {
    if (typeof window === 'undefined') return 'loading';
    const r = remembered(token);
    return r === null ? 'loading' : r ? 'yes' : 'no';
  });
  useEffect(() => {
    if (!token) { setState('loading'); return; }
    const r = remembered(token);
    if (r !== null) setState(r ? 'yes' : 'no');
    if (cached && cached.token === token && Date.now() - cached.at < 60_000) return;
    let gone = false;
    const ask = (tries: number) => {
      apiFetch<{ me?: { canInbox?: boolean } | null }>('/messenger/turns', { token })
        .then((res) => { const v = !!res?.me?.canInbox; remember(token, v); if (!gone) setState(v ? 'yes' : 'no'); })
        .catch(() => {
          if (gone) return;
          if (tries > 0) { setTimeout(() => { if (!gone) ask(tries - 1); }, 1500); return; }
          // Still nothing: keep what this device knew; otherwise say no.
          if (remembered(token) === null) setState('no');
        });
    };
    ask(1);
    return () => { gone = true; };
  }, [token]);
  return state;
}

/** Yes/no for places that only show or hide a tab: still asking counts as no. */
export function useChatSeat(token: string | null | undefined): boolean {
  return useChatSeatState(token) === 'yes';
}
