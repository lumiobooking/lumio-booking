'use client';

/**
 * The salon's own screen — the only one a client account really lives in.
 *
 * TWO TABS, BECAUSE IT WAS ONE LONG SCROLL
 *
 * Three things arrived here in turn: what Lumio suggested, what the shop has to
 * film this week, and what is waiting for a yes. Stacked, that is a page a shop
 * owner scrolls past the middle of on a phone and never reaches the end of — and
 * the end was the part with the buttons. So it splits where the WORK splits:
 * one tab is "things I have to go and do", the other is "things I have to look
 * at and say yes to". Nobody has to decide which section they are in.
 *
 * The tab that opens first is the one with something waiting, decided once when
 * the counts arrive and never again — a bar that re-picks a tab while somebody
 * is reading it is worse than picking the wrong one.
 *
 * Auth and fetch plumbing only. Everything drawn lives in SalonWorkspace and
 * PostReview, the second of which is shared with the group-chat link so the two
 * doors cannot drift apart.
 */

import { useEffect, useMemo, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { PostReview, type ReviewApi, type ReviewFeed, type ReviewMsg } from '../../../components/PostReview';
import { SalonWorkspace } from '../../../components/SalonWorkspace';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { useLang } from '../../../lib/i18n';

type Tab = 'work' | 'approve';

export default function ApprovePostsPage() {
  return (
    <SalonShell>
      <Inner />
    </SalonShell>
  );
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const T = (v: string, e: string) => (vi ? v : e);

  const [tab, setTab] = useState<Tab>('work');
  const [picked, setPicked] = useState(false);
  const [toDo, setToDo] = useState<number | null>(null);
  const [toApprove, setToApprove] = useState<number | null>(null);

  // Open on whatever is waiting, once. Both counts have to be in before the
  // choice is made, or the tab jumps under the reader's thumb when the second
  // request lands.
  useEffect(() => {
    if (picked || toDo === null || toApprove === null) return;
    setTab(toApprove > 0 && toDo === 0 ? 'approve' : 'work');
    setPicked(true);
  }, [picked, toDo, toApprove]);

  const api = useMemo<ReviewApi>(() => ({
    needsName: false, // the account IS the name
    feed: () => apiFetch<ReviewFeed>('/content/review', { token }),
    approve: (postId) => apiFetch(`/content/review/${postId}/approve`, { method: 'POST', token }),
    comments: async (postId) => {
      const r = await apiFetch<{ messages: ReviewMsg[] }>(`/content/chat?subject=${encodeURIComponent(`post:${postId}`)}`, { token });
      return { messages: r?.messages ?? [] };
    },
    comment: (postId, body) => apiFetch('/content/chat', { method: 'POST', token, body: { subject: `post:${postId}`, body } }),
  }), [token]);

  /**
   * Written as a function that returns JSX, not as a component declared inside
   * this one. A component defined in a render body is a NEW type on every
   * render, so React unmounts and remounts it — which throws away focus, and is
   * a bug waiting for the first person who puts an input inside it.
   */
  const tabButton = ({ id, icon, label, count }: { id: Tab; icon: string; label: string; count: number | null }) => {
    const on = tab === id;
    return (
      <button
        key={id}
        onClick={() => { setTab(id); setPicked(true); }}
        style={{
          // 48px and equal halves: a thumb at the top of a phone, and no
          // guessing which of two similarly-worded tabs is wider.
          flex: '1 1 0', minHeight: 48, padding: '10px 12px', borderRadius: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          cursor: 'pointer', fontSize: 14.5, fontWeight: on ? 700 : 600,
          border: `1px solid ${on ? '#6366f1' : 'var(--c334155)'}`,
          background: on ? '#6366f1' : 'transparent',
          color: on ? '#fff' : 'var(--c94a3b8)',
        }}
      >
        <span aria-hidden style={{ fontSize: 16 }}>{icon}</span>
        <span>{label}</span>
        {!!count && (
          <span style={{
            minWidth: 21, height: 21, borderRadius: 20, padding: '0 6px',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11.5, fontWeight: 800,
            background: on ? 'rgba(255,255,255,.22)' : '#ef4444',
            color: '#fff',
          }}>{count}</span>
        )}
      </button>
    );
  };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {tabButton({ id: 'work', icon: '🎬', label: T('Việc của tiệm', 'Your jobs'), count: toDo })}
        {tabButton({ id: 'approve', icon: '✅', label: T('Duyệt bài', 'Approve posts'), count: toApprove })}
      </div>

      {/* Both stay mounted: switching tabs must not refetch and must not lose a
          half-finished upload or a comment somebody is in the middle of. */}
      <div style={{ display: tab === 'work' ? 'block' : 'none' }}>
        <SalonWorkspace token={token} vi={vi} onCount={setToDo} />
      </div>
      <div style={{ display: tab === 'approve' ? 'block' : 'none' }}>
        <PostReview api={api} vi={vi} onCount={setToApprove} />
      </div>
    </div>
  );
}
