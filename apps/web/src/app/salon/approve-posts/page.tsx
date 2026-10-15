'use client';

/**
 * The salon's own screen — the only one a client account really lives in.
 *
 * ONE SCREEN: THE MONTH
 *
 * It used to be two tabs ("your jobs", "approve posts") over a long scroll
 * of boxes; see ClientPlan for what that cost and what replaced it. This
 * file is auth and fetch plumbing only: the review feed's fetchers (shared
 * with the group-chat link, so the two doors cannot drift apart), the push
 * prompt, the team chat window, and the calendar screen itself.
 */

import { useEffect, useMemo, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { type ReviewApi, type ReviewFeed, type ReviewMsg } from '../../../components/PostReview';
import { TeamChatWindow } from '../../../components/ContentChat';
import { ClientPlan } from '../../../components/ClientPlan';
import { PushEnable } from '../../../components/PushEnable';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { useLang } from '../../../lib/i18n';

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

  // The shop's way of reaching the team without a post to hang the question on.
  const [chatUnread, setChatUnread] = useState(0);

  useEffect(() => {
    if (!token) return;
    let off = false;
    apiFetch<{ bySubject?: Record<string, number> }>('/content/chat/unread', { token })
      .then((u) => { if (!off) setChatUnread(u?.bySubject?.general ?? 0); })
      .catch(() => { /* the button still opens; only the badge is missing */ });
    return () => { off = true; };
  }, [token]);

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

  // The calendar wants every pixel a laptop gives it: seven readable days.
  return (
    <div style={{ maxWidth: 1480, margin: '0 auto' }}>
      {/* The one place an owner opens on purpose, so the one place to ask for
          push: "the team fixed your post" then reaches their phone. Renders
          nothing once enabled or where push is unavailable. */}
      <PushEnable about="posts" />

      <ClientPlan token={token} vi={vi} api={api} />

      <TeamChatWindow token={token} unread={chatUnread} vi={vi} />
    </div>
  );
}
