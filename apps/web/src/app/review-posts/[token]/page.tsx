'use client';

/**
 * The group-chat door: /review-posts/{token}, no login.
 *
 * NOT /review/{token} — that path already belongs to the customer review QR
 * page, and Next refuses two different param names on one route.
 *
 * The token in the URL is the whole credential — the server resolves it to
 * exactly one salon or refuses (see api post-review.ts). This page adds no
 * shell and no navigation: someone arriving from Zalo sees their posts and
 * nothing that hints at what else lives on this domain. Language follows the
 * device's earlier choice when there is one, and defaults to Vietnamese —
 * the owners this link is sent to read Vietnamese.
 */

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { PostReview, type ReviewApi, type ReviewFeed, type ReviewMsg } from '../../../components/PostReview';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005/api';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body as { message?: string })?.message || 'Không tải được, thử lại giúp em.');
  return body as T;
}

export default function PublicReviewPage() {
  const params = useParams();
  const token = String((params as Record<string, string | string[]>)?.token ?? '');
  const [vi, setVi] = useState<boolean>(() => {
    try { return (window.localStorage.getItem('lumio_lang') ?? 'vi') !== 'en'; } catch { return true; }
  });

  const api = useMemo<ReviewApi>(() => {
    const base = `/public/review/${encodeURIComponent(token)}`;
    return {
      needsName: true, // no account behind this door — ask once, remember on the phone
      feed: () => call<ReviewFeed>(base),
      approve: (postId, name) => call(`${base}/posts/${postId}/approve`, { method: 'POST', body: JSON.stringify({ name }) }),
      comments: (postId) => call<{ messages: ReviewMsg[] }>(`${base}/posts/${postId}/comments`),
      comment: (postId, body, name) => call(`${base}/posts/${postId}/comments`, { method: 'POST', body: JSON.stringify({ name, body }) }),
    };
  }, [token]);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--c0f172a)', color: 'var(--ce2e8f0)', padding: '14px 14px 0' }}>
      <div style={{ maxWidth: 640, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 6 }}>
        <span style={{ fontSize: 16, fontWeight: 800 }}>Lumio<span style={{ color: '#818cf8' }}>Booking</span></span>
        <button
          onClick={() => { setVi((v) => { try { window.localStorage.setItem('lumio_lang', v ? 'en' : 'vi'); } catch { /* fine */ } return !v; }); }}
          style={{ marginLeft: 'auto', font: 'inherit', fontSize: 12, fontWeight: 700, color: 'var(--c94a3b8)', background: 'var(--c151f38)', border: '1px solid var(--c334155)', borderRadius: 8, padding: '7px 12px', cursor: 'pointer', minHeight: 36 }}
        >
          {vi ? 'EN' : 'VI'}
        </button>
      </div>
      <PostReview api={api} vi={vi} />
    </div>
  );
}
