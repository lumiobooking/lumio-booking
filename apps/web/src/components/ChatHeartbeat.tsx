'use client';

import { useEffect } from 'react';
import { useAuth } from '../lib/auth';
import { apiFetch } from '../lib/api';

/**
 * "Has Lumio open" — one of the chat-turn tests a salon can require.
 *
 * While the app is on screen, tell the server once a minute. A hidden tab, a
 * locked phone or a closed app sends nothing, so the person drops out of the
 * turn queue on their own after the salon's "online within X minutes" window.
 * No text, no ids in the body — the server takes the person and the salon from
 * the login, as every other call does.
 */
export function ChatHeartbeat() {
  const { token, user } = useAuth();
  const role = String(user?.role ?? '');
  const eligible = !!token && (role === 'SALON_ADMIN' || role === 'STAFF') && !user?.supportSession;
  useEffect(() => {
    if (!eligible || !token) return undefined;
    const beat = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void apiFetch('/messenger/turns/heartbeat', { method: 'POST', token }).catch(() => undefined);
    };
    beat();
    const id = window.setInterval(beat, 60_000);
    const onVis = () => { if (document.visibilityState === 'visible') beat(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [eligible, token]);
  return null;
}
