import { useEffect, useRef } from 'react';
import { ACTIVE_BRANCH_KEY } from './api';

/**
 * Listen to a server nudge stream and run `onEvent` for each line.
 *
 * WHY NOT EventSource: it cannot send an Authorization header, and the only
 * other way to get the token to the server is the query string — which
 * writes it into every proxy and access log on the way. So this reads the
 * same `text/event-stream` through a normal authenticated fetch and parses
 * the lines itself. Reconnects with backoff; gives up quietly while the tab
 * is hidden and resumes when it is shown again. The page's own poll keeps
 * running underneath, so a lost stream degrades to "slower", never to
 * "broken".
 *
 * `onEvent` is read through a ref: a new closure every render does not
 * reopen the stream. Only `path` and `token` do.
 */
export function useLiveEvents(
  path: string | null,
  token: string | null | undefined,
  onEvent: (e: { topic: string; id?: string; at?: number }) => void,
) {
  const cb = useRef(onEvent);
  cb.current = onEvent;

  useEffect(() => {
    if (!path || !token || typeof window === 'undefined' || typeof ReadableStream === 'undefined') return;
    const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005/api';
    let stopped = false;
    let ctrl: AbortController | null = null;
    let retryMs = 1000;
    let timer: number | null = null;

    const branch = () => { try { return localStorage.getItem(ACTIVE_BRANCH_KEY) || null; } catch { return null; } };

    const open = async () => {
      if (stopped || document.hidden) return;
      ctrl = new AbortController();
      try {
        const b = branch();
        const res = await fetch(`${base}${path}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream', ...(b ? { 'X-Branch-Id': b } : {}) },
          signal: ctrl.signal,
          cache: 'no-store',
        });
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
        retryMs = 1000; // connected: a later drop starts the backoff from the beginning
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done || stopped) break;
          buf += dec.decode(value, { stream: true });
          // SSE: events are separated by a blank line; each has `data:` lines.
          let cut: number;
          while ((cut = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, cut); buf = buf.slice(cut + 2);
            const data = chunk.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
            if (!data) continue;
            try {
              const e = JSON.parse(data) as { topic?: string; id?: string; at?: number };
              if (e && typeof e.topic === 'string' && e.topic !== 'ping') cb.current({ topic: e.topic, id: e.id, at: e.at });
            } catch { /* not ours */ }
          }
        }
      } catch {
        /* dropped — reconnect below */
      }
      if (stopped) return;
      timer = window.setTimeout(() => { timer = null; void open(); }, retryMs);
      retryMs = Math.min(30_000, retryMs * 2);
    };

    const onVisibility = () => {
      if (document.hidden) { ctrl?.abort(); if (timer != null) { clearTimeout(timer); timer = null; } }
      else if (!timer) { retryMs = 1000; void open(); }
    };

    void open();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      ctrl?.abort();
      if (timer != null) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [path, token]);
}
