'use client';

/**
 * LỊCH SỬ TỪ HỆ THỐNG CŨ & ĐIỂM — on the customer page.
 * What the client spent and how often they came before Lumio (from the import,
 * or typed by the owner), and points added / removed by hand with a reason.
 * API: PATCH /customers/:id { pastSpentCents, pastVisits, lastVisitAt } and
 * POST /customers/:id/points { points, reason } — owner only.
 */
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { ui, formatPrice } from '../lib/ui';

export interface Past { spentCents: number; visits: number; lastVisitAt: string | null; source: string | null; importedAt: string | null }

export function PastHistoryCard({ token, customerId, past, smsConsent, currency, vi, isOwner, onSaved }: {
  token: string | null; customerId: string; past?: Past; smsConsent?: boolean; currency: string; vi: boolean; isOwner: boolean; onSaved: () => void;
}) {
  const p: Past = past ?? { spentCents: 0, visits: 0, lastVisitAt: null, source: null, importedAt: null };
  const [edit, setEdit] = useState(false);
  const [spent, setSpent] = useState('');
  const [visits, setVisits] = useState('');
  const [last, setLast] = useState('');
  const [pts, setPts] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setSpent((p.spentCents / 100).toFixed(2)); setVisits(String(p.visits)); setLast(p.lastVisitAt ? p.lastVisitAt.slice(0, 10) : '');
  }, [p.spentCents, p.visits, p.lastVisitAt]);
  const L = (v: string, e: string) => (vi ? v : e);
  const has = p.spentCents > 0 || p.visits > 0 || !!p.lastVisitAt || !!p.source;
  if (!has && !isOwner) return null;

  async function saveHistory() {
    setBusy(true); setMsg(null);
    try {
      await apiFetch(`/customers/${customerId}`, { method: 'PATCH', token, body: {
        pastSpentCents: Math.max(0, Math.round((parseFloat(spent.replace(/[^\d.]/g, '')) || 0) * 100)),
        pastVisits: Math.max(0, parseInt(visits, 10) || 0),
        lastVisitAt: last || null,
      } });
      setEdit(false); setMsg(L('Đã lưu', 'Saved')); onSaved();
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  }
  async function adjust(sign: 1 | -1) {
    const n = Math.abs(parseInt(pts, 10) || 0);
    if (!n) return;
    setBusy(true); setMsg(null);
    try {
      await apiFetch(`/customers/${customerId}/points`, { method: 'POST', token, body: { points: sign * n, reason: reason.trim() || undefined } });
      setPts(''); setReason(''); setMsg(sign > 0 ? L(`Đã cộng ${n} điểm`, `Added ${n} points`) : L(`Đã trừ ${n} điểm`, `Removed ${n} points`)); onSaved();
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  }

  const chip = (k: string, v: string) => (
    <div style={{ padding: '8px 10px', border: '1px solid var(--c334155)', borderRadius: 9 }}>
      <div style={{ fontSize: 11.5, color: 'var(--c94a3b8)' }}>{k}</div>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{v}</div>
    </div>
  );
  return (
    <div style={{ ...ui.card, marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 15, flex: 1 }}>{L('Lịch sử từ hệ thống cũ & điểm', 'History from the old system & points')}</h3>
        {isOwner && !edit && <button type="button" onClick={() => setEdit(true)} style={{ background: 'none', border: 'none', color: 'var(--c818cf8)', cursor: 'pointer', fontSize: 13 }}>{L('Sửa', 'Edit')}</button>}
      </div>
      {!edit ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
          {chip(L('Đã chi (hệ thống cũ)', 'Spent (old system)'), formatPrice(p.spentCents, currency))}
          {chip(L('Số lần ghé (cũ)', 'Visits (old)'), String(p.visits))}
          {chip(L('Lần ghé cuối (cũ)', 'Last visit (old)'), p.lastVisitAt ? new Date(p.lastVisitAt).toLocaleDateString(vi ? 'vi-VN' : 'en-US', { timeZone: 'UTC' }) : '—')}
          {chip(L('Nguồn', 'Source'), p.source ? `${p.source}${p.importedAt ? ' · ' + new Date(p.importedAt).toLocaleDateString(vi ? 'vi-VN' : 'en-US') : ''}` : L('Nhập tay', 'Manual'))}
          {chip(L('Đồng ý SMS quảng cáo', 'Marketing SMS consent'), smsConsent ? L('Có', 'Yes') : L('Chưa', 'Not yet'))}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, alignItems: 'end' }}>
          <label><span style={ui.label}>{L('Đã chi (hệ thống cũ)', 'Spent (old system)')}</span><input style={ui.input} inputMode="decimal" value={spent} onChange={(e) => setSpent(e.target.value)} /></label>
          <label><span style={ui.label}>{L('Số lần ghé (cũ)', 'Visits (old)')}</span><input style={ui.input} type="number" min={0} value={visits} onChange={(e) => setVisits(e.target.value)} /></label>
          <label><span style={ui.label}>{L('Lần ghé cuối (cũ)', 'Last visit (old)')}</span><input style={ui.input} type="date" value={last} onChange={(e) => setLast(e.target.value)} /></label>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={saveHistory} disabled={busy} style={ui.primaryBtn}>{L('Lưu', 'Save')}</button>
            <button type="button" onClick={() => setEdit(false)} style={{ ...ui.primaryBtn, background: 'transparent', border: '1px solid var(--c475569)', color: 'var(--ccbd5e1)' }}>{L('Huỷ', 'Cancel')}</button>
          </div>
        </div>
      )}
      {isOwner && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
          <label style={{ width: 110 }}><span style={ui.label}>{L('Điểm', 'Points')}</span><input style={ui.input} type="number" min={1} value={pts} onChange={(e) => setPts(e.target.value)} /></label>
          <label style={{ flex: '1 1 200px' }}><span style={ui.label}>{L('Lý do (tuỳ chọn)', 'Reason (optional)')}</span><input style={ui.input} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={L('VD: chuyển điểm từ thẻ giấy', 'e.g. moved from punch card')} /></label>
          <button type="button" disabled={busy || !pts} onClick={() => adjust(1)} style={{ ...ui.primaryBtn, background: '#16a34a' }}>+ {L('Cộng điểm', 'Add')}</button>
          <button type="button" disabled={busy || !pts} onClick={() => adjust(-1)} style={{ ...ui.primaryBtn, background: '#b45309' }}>− {L('Trừ điểm', 'Remove')}</button>
        </div>
      )}
      {msg && <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 8 }}>{msg}</div>}
    </div>
  );
}
