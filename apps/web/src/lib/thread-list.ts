'use client';

/**
 * rt229 — one read of the conversation list, shared.
 *
 * The inbox screen and the bell/alerts both listen to the same live stream
 * and both poll every 30 s, and both asked the server for the whole list —
 * two identical reads on every nudge (seen on Lumio Agency: the list read
 * twice per second-or-so of activity, "load liên tục"). Asks that land within
 * a moment of each other now share one answer.
 */
import { apiFetch } from './api';

const SHARE_MS = 1500;
let last: { token: string; at: number; p: Promise<unknown[]> } | null = null;

export function threadList<T>(token: string): Promise<T[]> {
  const now = Date.now();
  if (last && last.token === token && now - last.at < SHARE_MS) return last.p as Promise<T[]>;
  const p = apiFetch<unknown[]>('/messenger/threads', { token, quiet: true }).then((r) => (Array.isArray(r) ? r : []));
  last = { token, at: now, p };
  // A failed ask is not handed to the next caller.
  p.catch(() => { if (last?.p === p) last = null; });
  return p as Promise<T[]>;
}

/** For tests. */
export function forgetThreadList(): void { last = null; }
