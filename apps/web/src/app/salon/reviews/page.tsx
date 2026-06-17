'use client';

import { useCallback, useEffect, useState, FormEvent } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { usePaged, Pager } from '../../../components/ListFilter';

interface ReviewSettings { enabled: boolean; googleReviewUrl: string; staffPointsPerFeedback: number; staffBonusFor5Star: number; customerPoints: number; minRatingForGoogle: number; requireRealVisit: boolean; visitWindowHours: number; dailyCapPerStaff: number; dedupDays: number }
interface LeaderRow { id: string; name: string; avatarUrl: string | null; rewardPoints: number; feedbackCount: number; avgRating: number }
interface FeedbackRow { id: string; rating: number; comment: string | null; createdAt: string; invitedToGoogle: boolean; verified: boolean; staff: { firstName: string; lastName: string | null } | null; customer: { firstName: string; phone: string | null } | null }

export default function ReviewsPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token } = useAuth();
  const [settings, setSettings] = useState<ReviewSettings | null>(null);
  const [board, setBoard] = useState<LeaderRow[]>([]);
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const [s, b, f] = await Promise.all([
        apiFetch<{ review: ReviewSettings }>('/settings', { token }),
        apiFetch<LeaderRow[]>('/reviews/leaderboard', { token }),
        apiFetch<FeedbackRow[]>('/reviews/feedback', { token }),
      ]);
      setSettings(s.review);
      setBoard(b);
      setFeedback(f);
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function adjust(id: string, delta: number) {
    const reason = delta < 0 ? (prompt('Redeem reason (e.g. cash bonus, gift)') ?? 'Redeemed') : 'Manual add';
    try { await apiFetch(`/reviews/staff/${id}/adjust`, { method: 'POST', token, body: { delta, reason } }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
  }

  const fbPage = usePaged(feedback, 20);

  if (loading) return <SalonShellLoading />;

  return (
    <section>
      <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>Reviews &amp; staff rewards</h1>
      <p style={{ color: '#94a3b8', margin: '0 0 18px', fontSize: 14 }}>Customers rate your team on a quick page, then are invited to Google. Staff earn points; customers earn loyalty points.</p>

      {error && <div style={ui.banner}>{error}</div>}

      {settings && <SettingsCard token={token!} initial={settings} onSaved={load} />}

      <h2 style={{ fontSize: 16, margin: '24px 0 10px' }}>Staff leaderboard</h2>
      <div style={{ border: '1px solid #334155', borderRadius: 12, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead><tr style={{ background: '#1e293b' }}>
            <th style={ui.th}>Technician</th><th style={ui.th}>Points</th><th style={ui.th}>Feedbacks</th><th style={ui.th}>Avg ★</th><th style={ui.th}>Adjust</th>
          </tr></thead>
          <tbody>
            {board.length === 0 && <tr><td style={ui.td} colSpan={5}>No staff yet.</td></tr>}
            {board.map((s) => (
              <tr key={s.id} style={{ borderTop: '1px solid #334155' }}>
                <td style={ui.td}>{s.name}</td>
                <td style={ui.td}><strong style={{ color: '#eab308' }}>{s.rewardPoints}</strong></td>
                <td style={ui.td}>{s.feedbackCount}</td>
                <td style={ui.td}>{s.avgRating ? `${s.avgRating}★` : '—'}</td>
                <td style={ui.td}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => adjust(s.id, 10)} style={miniBtn}>+10</button>
                    <button onClick={() => adjust(s.id, -50)} style={{ ...miniBtn, borderColor: '#ef4444', color: '#ef4444' }}>Redeem 50</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ fontSize: 16, margin: '24px 0 10px' }}>Recent feedback</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {feedback.length === 0 && <p style={{ color: '#94a3b8', fontSize: 14 }}>No feedback yet.</p>}
        {fbPage.paged.map((f) => (
          <div key={f.id} style={{ ...ui.card, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: '#f59e0b' }}>{'★'.repeat(f.rating)}<span style={{ color: '#334155' }}>{'★'.repeat(5 - f.rating)}</span></span>
              <span style={{ color: '#64748b' }}>{new Date(f.createdAt).toLocaleString()}</span>
            </div>
            <div style={{ fontSize: 13, color: '#cbd5e1', marginTop: 4 }}>
              {f.staff ? `${f.staff.firstName} ${f.staff.lastName ?? ''}`.trim() : 'Salon'} · {f.customer?.phone ?? f.customer?.firstName ?? 'Anonymous'}
              {f.verified
                ? <span style={{ marginLeft: 8, color: '#22c55e', fontSize: 11 }}>● verified visit · points awarded</span>
                : <span style={{ marginLeft: 8, color: '#f59e0b', fontSize: 11 }}>● no matching visit · no points</span>}
              {f.invitedToGoogle && <span style={{ marginLeft: 8, color: '#818cf8', fontSize: 11 }}>● invited to Google</span>}
            </div>
            {f.comment && <div style={{ fontSize: 14, marginTop: 6, color: '#e2e8f0' }}>“{f.comment}”</div>}
          </div>
        ))}
        <Pager paged={fbPage} />
      </div>
    </section>
  );
}

function SettingsCard({ token, initial, onSaved }: { token: string; initial: ReviewSettings; onSaved: () => void }) {
  const [f, setF] = useState({
    enabled: initial.enabled,
    googleReviewUrl: initial.googleReviewUrl,
    staffPointsPerFeedback: String(initial.staffPointsPerFeedback),
    staffBonusFor5Star: String(initial.staffBonusFor5Star),
    customerPoints: String(initial.customerPoints),
    minRatingForGoogle: String(initial.minRatingForGoogle),
    requireRealVisit: initial.requireRealVisit ?? true,
    dailyCapPerStaff: String(initial.dailyCapPerStaff ?? 10),
    dedupDays: String(initial.dedupDays ?? 7),
    visitWindowHours: String(initial.visitWindowHours ?? 48),
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault(); setSaving(true); setErr(null); setSaved(false);
    try {
      await apiFetch('/settings/review', { method: 'PATCH', token, body: {
        enabled: f.enabled,
        googleReviewUrl: f.googleReviewUrl,
        staffPointsPerFeedback: parseInt(f.staffPointsPerFeedback, 10) || 0,
        staffBonusFor5Star: parseInt(f.staffBonusFor5Star, 10) || 0,
        customerPoints: parseInt(f.customerPoints, 10) || 0,
        minRatingForGoogle: Math.min(5, Math.max(1, parseInt(f.minRatingForGoogle, 10) || 4)),
        requireRealVisit: f.requireRealVisit,
        dailyCapPerStaff: parseInt(f.dailyCapPerStaff, 10) || 0,
        dedupDays: parseInt(f.dedupDays, 10) || 0,
        visitWindowHours: parseInt(f.visitWindowHours, 10) || 0,
      } });
      setSaved(true); onSaved();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={save} style={ui.card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <Toggle on={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} />
        <span style={{ fontWeight: 600 }}>Enable review &amp; rewards program</span>
      </div>
      {err && <div style={ui.banner}>{err}</div>}
      <label style={{ display: 'block', marginBottom: 12 }}>
        <span style={ui.label}>Google review link (your salon&apos;s &quot;write a review&quot; URL)</span>
        <input style={ui.input} value={f.googleReviewUrl} onChange={(e) => setF({ ...f, googleReviewUrl: e.target.value })} placeholder="https://g.page/r/…/review" />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <label><span style={ui.label}>Staff points / feedback</span><input style={ui.input} type="number" min={0} value={f.staffPointsPerFeedback} onChange={(e) => setF({ ...f, staffPointsPerFeedback: e.target.value })} /></label>
        <label><span style={ui.label}>Bonus for 5★</span><input style={ui.input} type="number" min={0} value={f.staffBonusFor5Star} onChange={(e) => setF({ ...f, staffBonusFor5Star: e.target.value })} /></label>
        <label><span style={ui.label}>Customer loyalty points</span><input style={ui.input} type="number" min={0} value={f.customerPoints} onChange={(e) => setF({ ...f, customerPoints: e.target.value })} /></label>
        <label><span style={ui.label}>Show Google when rating ≥</span>
          <select style={ui.input} value={f.minRatingForGoogle} onChange={(e) => setF({ ...f, minRatingForGoogle: e.target.value })}>
            <option value="1">Always (1★+)</option><option value="4">4★ and up</option><option value="5">Only 5★</option>
          </select>
        </label>
      </div>
      <p style={{ color: '#64748b', fontSize: 12, margin: '10px 0 0' }}>Note: rewarding customers for a Google review violates Google policy — points here are for completing your in-house feedback, and the Google step is only an invitation.</p>

      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #334155' }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: '#cbd5e1', marginBottom: 6 }}>Anti-fraud (stops staff farming their own points)</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <Toggle on={f.requireRealVisit} onChange={(v) => setF({ ...f, requireRealVisit: v })} />
          <span style={{ fontSize: 14 }}>Only reward when feedback matches a real recent appointment (recommended)</span>
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          <label><span style={ui.label}>Visit window (hours)</span><input style={ui.input} type="number" min={1} value={f.visitWindowHours} onChange={(e) => setF({ ...f, visitWindowHours: e.target.value })} /></label>
          <label><span style={ui.label}>Max rewarded / staff / day</span><input style={ui.input} type="number" min={1} value={f.dailyCapPerStaff} onChange={(e) => setF({ ...f, dailyCapPerStaff: e.target.value })} /></label>
          <label><span style={ui.label}>Same client cooldown (days)</span><input style={ui.input} type="number" min={1} value={f.dedupDays} onChange={(e) => setF({ ...f, dedupDays: e.target.value })} /></label>
        </div>
        <p style={{ color: '#64748b', fontSize: 12, margin: '8px 0 0' }}>With this on, a feedback only earns points if the customer (by phone) had a real appointment with that technician in the window — one reward per visit, capped per day, and the same client can&apos;t re-reward the same tech within the cooldown.</p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
        <button type="submit" disabled={saving} style={ui.primaryBtn}>{saving ? 'Saving…' : 'Save settings'}</button>
        {saved && <span style={{ color: '#22c55e', fontSize: 13 }}>✓ Saved</span>}
      </div>
    </form>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!on)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
      <span style={{ width: 38, height: 22, borderRadius: 999, background: on ? '#6366f1' : '#475569', position: 'relative', display: 'inline-block' }}>
        <span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 18, height: 18, borderRadius: '50%', background: 'white' }} />
      </span>
    </button>
  );
}

function SalonShellLoading() { return <p style={{ color: '#94a3b8' }}>Loading…</p>; }

const miniBtn: React.CSSProperties = { padding: '4px 10px', borderRadius: 6, border: '1px solid #475569', background: 'transparent', color: '#cbd5e1', fontSize: 12, cursor: 'pointer' };
