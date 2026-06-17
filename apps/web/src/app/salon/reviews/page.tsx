'use client';

import { useCallback, useEffect, useState, FormEvent } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { usePaged, Pager } from '../../../components/ListFilter';

interface ReviewSettings { enabled: boolean; reviewMode: 'direct' | 'rate_first'; googlePlaceId: string; googleReviewUrl: string; staffPointsPerFeedback: number; staffBonusFor5Star: number; customerPoints: number; minRatingForGoogle: number; requireRealVisit: boolean; visitWindowHours: number; dailyCapPerStaff: number; dedupDays: number; staffPointsPerSend: number; sendDailyCap: number; sendDedupHours: number; anchorToVisits: boolean; visitBuffer: number; onlyBusinessHours: boolean }
interface LeaderRow { id: string; name: string; avatarUrl: string | null; rewardPoints: number; feedbackCount: number; avgRating: number; sendsTotal: number; sends30: number; sendsToday: number; rejectedToday: number; flagged: boolean }
interface SendRow { id: string; createdAt: string; counted: boolean; reason: string | null; staff: string; device: string }
interface FeedbackRow { id: string; rating: number; comment: string | null; createdAt: string; invitedToGoogle: boolean; verified: boolean; staff: { firstName: string; lastName: string | null } | null; customer: { firstName: string; phone: string | null } | null }

export default function ReviewsPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token } = useAuth();
  const [settings, setSettings] = useState<ReviewSettings | null>(null);
  const [board, setBoard] = useState<LeaderRow[]>([]);
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [sends, setSends] = useState<SendRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const [s, b, f, sn] = await Promise.all([
        apiFetch<{ review: ReviewSettings }>('/settings', { token }),
        apiFetch<LeaderRow[]>('/reviews/leaderboard', { token }),
        apiFetch<FeedbackRow[]>('/reviews/feedback', { token }),
        apiFetch<SendRow[]>('/reviews/sends', { token }).catch(() => [] as SendRow[]),
      ]);
      setSettings(s.review);
      setBoard(b);
      setFeedback(f);
      setSends(sn);
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
  const sendsPage = usePaged(sends, 20);

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
            <th style={ui.th}>Technician</th><th style={ui.th}>Points</th><th style={ui.th}>Sends (30d)</th><th style={ui.th}>Sends total</th><th style={ui.th}>Feedbacks</th><th style={ui.th}>Avg ★</th><th style={ui.th}>Adjust</th>
          </tr></thead>
          <tbody>
            {board.length === 0 && <tr><td style={ui.td} colSpan={7}>No staff yet.</td></tr>}
            {board.map((s) => (
              <tr key={s.id} style={{ borderTop: '1px solid #334155' }}>
                <td style={ui.td}>{s.name}{s.flagged && <span title={`${s.rejectedToday} blocked attempts today — possible self-farming`} style={{ marginLeft: 6, background: '#7f1d1d', color: '#fecaca', borderRadius: 6, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>⚠ CHECK</span>}</td>
                <td style={ui.td}><strong style={{ color: '#eab308' }}>{s.rewardPoints}</strong></td>
                <td style={ui.td}><strong style={{ color: '#22c55e' }}>{s.sends30}</strong>{s.sendsToday ? <span style={{ color: '#64748b', fontSize: 12 }}> · {s.sendsToday} today</span> : null}{s.rejectedToday ? <span style={{ color: '#f97316', fontSize: 12 }}> · {s.rejectedToday} blocked</span> : null}</td>
                <td style={ui.td}>{s.sendsTotal}</td>
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

      <h2 style={{ fontSize: 16, margin: '24px 0 10px' }}>Google send log <span style={{ color: '#64748b', fontSize: 12, fontWeight: 400 }}>(anti-fraud audit)</span></h2>
      <div style={{ border: '1px solid #334155', borderRadius: 12, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead><tr style={{ background: '#1e293b' }}>
            <th style={ui.th}>When</th><th style={ui.th}>Technician</th><th style={ui.th}>Device</th><th style={ui.th}>Counted</th><th style={ui.th}>Reason</th>
          </tr></thead>
          <tbody>
            {sends.length === 0 && <tr><td style={ui.td} colSpan={5}>No sends yet.</td></tr>}
            {sendsPage.paged.map((r) => (
              <tr key={r.id} style={{ borderTop: '1px solid #334155' }}>
                <td style={{ ...ui.td, color: '#94a3b8' }}>{new Date(r.createdAt).toLocaleString()}</td>
                <td style={ui.td}>{r.staff}</td>
                <td style={{ ...ui.td, color: '#64748b' }}>{r.device}</td>
                <td style={ui.td}>{r.counted ? <span style={{ color: '#22c55e', fontWeight: 600 }}>✓ +pts</span> : <span style={{ color: '#94a3b8' }}>—</span>}</td>
                <td style={ui.td}>{reasonLabel(r.reason)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: '0 14px 12px' }}><Pager paged={sendsPage} /></div>
      </div>
    </section>
  );
}

function SettingsCard({ token, initial, onSaved }: { token: string; initial: ReviewSettings; onSaved: () => void }) {
  const [f, setF] = useState({
    enabled: initial.enabled,
    reviewMode: initial.reviewMode ?? 'direct',
    googlePlaceId: initial.googlePlaceId ?? '',
    googleReviewUrl: initial.googleReviewUrl,
    staffPointsPerFeedback: String(initial.staffPointsPerFeedback),
    staffBonusFor5Star: String(initial.staffBonusFor5Star),
    customerPoints: String(initial.customerPoints),
    minRatingForGoogle: String(initial.minRatingForGoogle),
    requireRealVisit: initial.requireRealVisit ?? true,
    dailyCapPerStaff: String(initial.dailyCapPerStaff ?? 10),
    dedupDays: String(initial.dedupDays ?? 7),
    visitWindowHours: String(initial.visitWindowHours ?? 48),
    staffPointsPerSend: String(initial.staffPointsPerSend ?? 5),
    sendDailyCap: String(initial.sendDailyCap ?? 20),
    sendDedupHours: String(initial.sendDedupHours ?? 12),
    anchorToVisits: initial.anchorToVisits ?? true,
    visitBuffer: String(initial.visitBuffer ?? 3),
    onlyBusinessHours: initial.onlyBusinessHours ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault(); setSaving(true); setErr(null); setSaved(false);
    try {
      await apiFetch('/settings/review', { method: 'PATCH', token, body: {
        enabled: f.enabled,
        reviewMode: f.reviewMode,
        googlePlaceId: f.googlePlaceId,
        googleReviewUrl: f.googleReviewUrl,
        staffPointsPerFeedback: parseInt(f.staffPointsPerFeedback, 10) || 0,
        staffBonusFor5Star: parseInt(f.staffBonusFor5Star, 10) || 0,
        customerPoints: parseInt(f.customerPoints, 10) || 0,
        minRatingForGoogle: Math.min(5, Math.max(1, parseInt(f.minRatingForGoogle, 10) || 4)),
        requireRealVisit: f.requireRealVisit,
        dailyCapPerStaff: parseInt(f.dailyCapPerStaff, 10) || 0,
        dedupDays: parseInt(f.dedupDays, 10) || 0,
        visitWindowHours: parseInt(f.visitWindowHours, 10) || 0,
        staffPointsPerSend: parseInt(f.staffPointsPerSend, 10) || 0,
        sendDailyCap: parseInt(f.sendDailyCap, 10) || 0,
        sendDedupHours: parseInt(f.sendDedupHours, 10) || 0,
        anchorToVisits: f.anchorToVisits,
        visitBuffer: parseInt(f.visitBuffer, 10) || 0,
        onlyBusinessHours: f.onlyBusinessHours,
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 12 }}>
        <button type="button" onClick={() => setF({ ...f, reviewMode: 'direct' })}
          style={modeCard(f.reviewMode === 'direct')}>
          <div style={{ fontWeight: 700 }}>⭐ Straight to Google</div>
          <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 4 }}>One tap → Google review. Counts a &quot;send&quot; per technician. No bad-review filter.</div>
        </button>
        <button type="button" onClick={() => setF({ ...f, reviewMode: 'rate_first' })}
          style={modeCard(f.reviewMode === 'rate_first')}>
          <div style={{ fontWeight: 700 }}>📝 Rate first</div>
          <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 4 }}>Rate in-house, then only happy customers (≥ chosen ★) are invited to Google.</div>
        </button>
      </div>

      {f.reviewMode === 'direct' && (
        <div style={{ marginBottom: 12, padding: 12, background: '#0f172a', borderRadius: 10, border: '1px solid #334155' }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: '#cbd5e1', marginBottom: 8 }}>Reward per Google send</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <label><span style={ui.label}>Points / send</span><input style={ui.input} type="number" min={0} value={f.staffPointsPerSend} onChange={(e) => setF({ ...f, staffPointsPerSend: e.target.value })} /></label>
            <label><span style={ui.label}>Same-device cooldown (hours)</span><input style={ui.input} type="number" min={0} value={f.sendDedupHours} onChange={(e) => setF({ ...f, sendDedupHours: e.target.value })} /></label>
            <label><span style={ui.label}>Hard cap / staff / day</span><input style={ui.input} type="number" min={0} value={f.sendDailyCap} onChange={(e) => setF({ ...f, sendDailyCap: e.target.value })} /></label>
          </div>

          <div style={{ fontWeight: 600, fontSize: 14, color: '#cbd5e1', margin: '14px 0 8px' }}>Anti-fraud (stops staff farming their own points)</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <Toggle on={f.anchorToVisits} onChange={(v) => setF({ ...f, anchorToVisits: v })} />
            <span style={{ fontSize: 14 }}>Anchor to real customers — counted sends/day ≤ (completed bookings + POS checkouts) + buffer</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <Toggle on={f.onlyBusinessHours} onChange={(v) => setF({ ...f, onlyBusinessHours: v })} />
            <span style={{ fontSize: 14 }}>Only count sends during business hours</span>
          </label>
          <label style={{ display: 'block', maxWidth: 240 }}>
            <span style={ui.label}>Walk-in grace buffer / staff / day</span>
            <input style={ui.input} type="number" min={0} value={f.visitBuffer} onChange={(e) => setF({ ...f, visitBuffer: e.target.value })} disabled={!f.anchorToVisits} />
          </label>
          <p style={{ color: '#64748b', fontSize: 12, margin: '10px 0 0' }}>A technician earns points when a customer taps &quot;Leave a Google review&quot; from their QR — deduped per device, only in business hours, and capped to real customer volume (bookings + POS) plus a small buffer for untracked walk-ins. Set the buffer to 0 for the strictest limit. Note: Google can&apos;t confirm whether the review was posted, so this counts sends, not confirmed reviews — and salons that don&apos;t use bookings or POS should rely on the cooldown + daily cap.</p>
        </div>
      )}

      <label style={{ display: 'block', marginBottom: 6 }}>
        <span style={ui.label}>Google Place ID</span>
        <input style={ui.input} value={f.googlePlaceId} onChange={(e) => setF({ ...f, googlePlaceId: e.target.value })} placeholder="ChIJ… (your salon's Google Place ID)" />
      </label>
      <p style={{ color: '#64748b', fontSize: 12, margin: '0 0 6px' }}>
        Using a Place ID lets the review open in the customer&apos;s <strong>Google Maps app</strong> (where they&apos;re already signed in) instead of a browser login screen.{' '}
        <a href="https://developers.google.com/maps/documentation/places/web-service/place-id" target="_blank" rel="noopener noreferrer" style={{ color: '#818cf8' }}>Find your Place ID →</a>
        {' '}Search your salon name, copy the ID that starts with <code style={{ color: '#cbd5e1' }}>ChIJ…</code>
      </p>
      <details style={{ marginBottom: 12 }}>
        <summary style={{ cursor: 'pointer', color: '#94a3b8', fontSize: 12 }}>No Place ID? Paste a review link instead</summary>
        <input style={{ ...ui.input, marginTop: 6 }} value={f.googleReviewUrl} onChange={(e) => setF({ ...f, googleReviewUrl: e.target.value })} placeholder="https://g.page/r/…/review (fallback)" />
      </details>
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
function modeCard(active: boolean): React.CSSProperties {
  return { textAlign: 'left', padding: '12px 14px', borderRadius: 10, cursor: 'pointer', background: active ? '#312e81' : 'transparent', border: `1px solid ${active ? '#6366f1' : '#334155'}`, color: '#e2e8f0' };
}
function reasonLabel(r: string | null): React.ReactNode {
  const map: Record<string, { t: string; c: string }> = {
    ok: { t: 'Counted', c: '#22c55e' },
    dedup: { t: 'Same device (cooldown)', c: '#94a3b8' },
    'off-hours': { t: 'Outside business hours', c: '#f97316' },
    cap: { t: 'Daily cap reached', c: '#f97316' },
    'over-visits': { t: 'Over real-visit limit', c: '#f97316' },
    disabled: { t: 'Rewards off', c: '#94a3b8' },
  };
  const m = r ? map[r] : null;
  return <span style={{ color: m?.c ?? '#94a3b8', fontSize: 13 }}>{m?.t ?? (r || '—')}</span>;
}
