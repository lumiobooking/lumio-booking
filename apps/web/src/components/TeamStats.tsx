'use client';

/**
 * rt219 — the team's performance on one tab: the scoreboard and every turn let
 * go (TurnTeamPanel in statsOnly mode), with the team list it needs. The owner
 * sees everyone; staff only themselves (the server decides).
 */
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { TurnTeamPanel } from './TurnTeamPanel';

export function TeamStats({ token, vi }: { token: string | null; vi: boolean }) {
  const [agents, setAgents] = useState<{ userId: string; name: string }[] | null>(null);
  useEffect(() => {
    if (!token) return;
    void apiFetch<{ agents?: { userId: string; name: string }[] }>('/messenger/turns', { token })
      .then((r) => setAgents((r?.agents ?? []).map((a) => ({ userId: a.userId, name: a.name }))))
      .catch(() => setAgents([]));
  }, [token]);
  if (!agents) return <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{vi ? 'Đang tải…' : 'Loading…'}</div>;
  return <TurnTeamPanel token={token} vi={vi} agents={agents} canEdit={false} weighted={false} statsOnly />;
}
