'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { FeedbackFlow, type FeedbackCtx } from '../../../components/feedback/FeedbackFlow';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005/api';

/** /f/<token> — one visit's "how was it?", on the customer's own phone. */
export default function FeedbackPage() {
  const { token } = useParams<{ token: string }>();
  const [ctx, setCtx] = useState<FeedbackCtx | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/public/feedback/${encodeURIComponent(token)}`)
      .then(async (r) => { if (!r.ok) throw new Error(); setCtx(await r.json()); })
      .catch(() => setMissing(true));
  }, [token]);

  if (missing) {
    return (
      <main style={{ minHeight: '100dvh', background: '#faf9f7', display: 'grid', placeItems: 'center', padding: 24, fontFamily: 'system-ui, sans-serif', color: '#6f6a64', textAlign: 'center' }}>
        <div><div style={{ fontSize: 40 }}>💅</div><p style={{ fontSize: 16, lineHeight: 1.5 }}>This link isn’t valid any more.<br />Thank you for visiting!</p></div>
      </main>
    );
  }
  if (!ctx) return <main style={{ minHeight: '100dvh', background: '#faf9f7' }} />;
  return <main style={{ maxWidth: 520, margin: '0 auto' }}><FeedbackFlow token={token} ctx={ctx} variant="phone" /></main>;
}
