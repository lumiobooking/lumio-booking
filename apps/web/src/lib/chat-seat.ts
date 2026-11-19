'use client';

/**
 * rt208 — does THIS team member answer customers? (ticked in Chia turn, or a
 * role that opens the Inbox). The technicians' app asks once and shows the
 * Inbox tab when the answer is yes. A failed request answers no.
 */
import { useEffect, useState } from 'react';
import { apiFetch } from './api';

let cached: { at: number; token: string; on: boolean } | null = null;

export function useChatSeat(token: string | null | undefined): boolean {
  const [on, setOn] = useState<boolean>(() => !!(cached && cached.token === token && cached.on));
  useEffect(() => {
    if (!token) { setOn(false); return; }
    if (cached && cached.token === token && Date.now() - cached.at < 60_000) { setOn(cached.on); return; }
    let gone = false;
    apiFetch<{ me?: { canInbox?: boolean } | null }>('/messenger/turns', { token })
      .then((r) => { const v = !!r?.me?.canInbox; cached = { at: Date.now(), token, on: v }; if (!gone) setOn(v); })
      .catch(() => { if (!gone) setOn(false); });
    return () => { gone = true; };
  }, [token]);
  return on;
}
