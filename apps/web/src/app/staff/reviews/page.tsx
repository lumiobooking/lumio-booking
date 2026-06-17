'use client';

import { useCallback, useEffect, useState } from 'react';
import { StaffShell } from '../../../components/StaffShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';

interface Mine { staffId: string; slug: string; rewardPoints: number; recent: { id: string; rating: number; comment: string | null; createdAt: string }[] }

export default function StaffReviewsPage() {
  return <StaffShell title="My Reviews"><Inner /></StaffShell>;
}

function Inner() {
  const { token } = useAuth();
  const [data, setData] = useState<Mine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try { setData(await apiFetch<Mine>('/reviews/me', { token })); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load'); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  if (error) return <p style={{ color: '#ef4444' }}>{error}</p>;
  if (!data) return <p style={{ color: '#94a3b8' }}>Loading…</p>;

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://lumiobooking.com';
  const reviewUrl = `${origin}/review/${data.slug}/${data.staffId}`;
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(reviewUrl)}`;

  async function copy() {
    try { await navigator.clipboard.writeText(reviewUrl); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ }
  }

  return (
    <section>
      <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 16, padding: 22, textAlign: 'center', marginBottom: 18 }}>
        <div style={{ fontSize: 13, color: '#94a3b8' }}>Your reward points</div>
        <div style={{ fontSize: 40, fontWeight: 800, color: '#eab308', margin: '2px 0 14px' }}>{data.rewardPoints}</div>

        <div style={{ background: '#fff', borderRadius: 14, padding: 14, display: 'inline-block' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="Review QR" width={200} height={200} style={{ display: 'block' }} />
        </div>
        <p style={{ color: '#cbd5e1', fontSize: 14, margin: '14px 0 4px', fontWeight: 600 }}>Ask your client to scan this after their service</p>
        <p style={{ color: '#64748b', fontSize: 12, margin: 0 }}>They rate you (you earn points), then can post on Google.</p>

        <button onClick={copy} style={{ marginTop: 14, padding: '10px 16px', borderRadius: 10, border: '1px solid #475569', background: copied ? '#16a34a' : 'transparent', color: '#e2e8f0', fontSize: 14, cursor: 'pointer' }}>
          {copied ? '✓ Link copied' : 'Copy my review link'}
        </button>
      </div>

      <h2 style={{ fontSize: 16, margin: '0 0 10px' }}>Recent feedback</h2>
      {data.recent.length === 0 ? (
        <p style={{ color: '#94a3b8', fontSize: 14 }}>No feedback yet — start asking your clients!</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.recent.map((r) => (
            <div key={r.id} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 10, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#f59e0b' }}>{'★'.repeat(r.rating)}<span style={{ color: '#334155' }}>{'★'.repeat(5 - r.rating)}</span></span>
                <span style={{ color: '#64748b', fontSize: 12 }}>{new Date(r.createdAt).toLocaleDateString()}</span>
              </div>
              {r.comment && <div style={{ fontSize: 14, marginTop: 6, color: '#e2e8f0' }}>“{r.comment}”</div>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
