'use client';

/**
 * The logged-in door to the approval screen.
 *
 * Thin on purpose: auth and fetch plumbing only. Everything the owner sees
 * lives in PostReview, shared with the group-chat link, so the two doors can
 * never drift apart. Comments ride the existing /content/chat routes — the
 * same thread the team already reads beside each post.
 */

import { useMemo } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { PostReview, type ReviewApi, type ReviewFeed, type ReviewMsg } from '../../../components/PostReview';
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

  return <PostReview api={api} vi={lang === 'vi'} />;
}
