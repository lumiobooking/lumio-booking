'use client';

/**
 * KHÁCH HỎI NHƯNG CHƯA ĐẶT — the warmest leads a salon has.
 *
 * Everyone who wrote on Messenger / Instagram / web chat / Zalo, or rang the
 * AI hotline, in the last two weeks and has not booked since. For each: what
 * they asked, when, and the one way to reach them that still works — open the
 * chat while Meta's 24-hour window is open, otherwise call. "Đã xử lý" takes
 * them off until they write again. The list is per salon (server-side).
 */
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLang } from '../lib/i18n';
import { ui } from '../lib/ui';
import { ind } from '../lib/ui-industry';

interface Row {
  key: string; kind: 'chat' | 'call'; refId: string; name: string | null; channel: string;
  asked: string | null; at: string; phone: string | null; email: string | null; customerId: string | null; canMessage: boolean;
}

const CH: Record<string, string> = { messenger: 'Messenger', instagram: 'Instagram', web: 'Web chat', zalo: 'Zalo', hotline: 'AI Hotline', tiktok: 'TikTok' };

function ago(iso: string, vi: boolean): string {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (m < 60) return vi ? `${m} phút trước` : `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return vi ? `${h} giờ trước` : `${h} h ago`;
  return vi ? `${Math.round(h / 24)} ngày trước` : `${Math.round(h / 24)} days ago`;
}

export function AskedNotBookedBox({ compact = false }: { compact?: boolean }) {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const L = (v: string, e: string) => ind(vi ? v : e);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(!compact);

  const load = useCallback(async () => {
    if (!token) return;
    try { setRows((await apiFetch<{ rows: Row[] }>('/campaigns/asked-not-booked', { token }))?.rows ?? []); }
    catch { setRows(null); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  async function done(r: Row) {
    if (!token) return;
    setBusy(r.key);
    try { await apiFetch('/campaigns/asked-not-booked/handled', { method: 'POST', token, body: { key: r.key } }); setRows((x) => (x ?? []).filter((y) => y.key !== r.key)); }
    catch { /* the toast already said why */ }
    finally { setBusy(null); }
  }

  if (rows === null) return null; // no permission, or not loaded
  const n = rows.length;
  const btn: React.CSSProperties = { padding: '6px 11px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap', cursor: 'pointer' };

  return (
    <div style={{ ...ui.card, marginBottom: 16, borderColor: n > 0 ? 'rgba(245,158,11,0.55)' : 'var(--c334155)' }}>
      <button type="button" onClick={() => setOpen((v) => !v)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--cf1f5f9)' }}>💬 {L('Khách hỏi nhưng chưa đặt', 'Asked but not booked')}</span>
        {n > 0 && <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 9px', borderRadius: 999, background: 'rgba(245,158,11,0.16)', color: 'var(--ink-warn)' }}>{n}</span>}
        <span style={{ marginLeft: 'auto', color: 'var(--c94a3b8)', fontSize: 12.5 }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <>
          <p style={{ fontSize: 12.5, color: 'var(--c94a3b8)', margin: '6px 0 12px', lineHeight: 1.5 }}>
            {L('Khách đã nhắn tin hoặc gọi AI hotline trong 14 ngày qua mà chưa đặt lịch. Trong 24h kể từ tin cuối của khách thì trả lời ngay trong hộp thư; quá 24h Facebook/Instagram không cho nhắn nữa — hãy gọi điện nếu có số.',
              'People who messaged or rang the AI hotline in the last 14 days and have not booked. Within 24h of their last message, answer in the inbox; after that Facebook/Instagram no longer allow a message — call them if there is a number.')}
          </p>
          {n === 0 && <div style={{ fontSize: 13, color: 'var(--ink-good)' }}>✓ {L('Không còn ai — mọi khách hỏi đều đã đặt hoặc đã được xử lý.', 'Nobody left — everyone who asked has booked or been followed up.')}</div>}
          <div style={{ display: 'grid', gap: 8 }}>
            {rows.slice(0, compact ? 8 : 100).map((r) => (
              <div key={r.key} style={{ border: '1px solid var(--c334155)', borderRadius: 10, padding: '10px 12px', background: 'var(--c0f172a)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ce2e8f0)' }}>
                    {r.name || r.phone || L('Khách', 'Guest')}
                    <span style={{ fontWeight: 500, fontSize: 12, color: 'var(--c94a3b8)' }}> · {CH[r.channel] ?? r.channel} · {ago(r.at, vi)}</span>
                  </div>
                  {r.asked && <div style={{ fontSize: 12.5, color: 'var(--ccbd5e1)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>“{r.asked}”</div>}
                  {r.kind === 'chat' && !r.canMessage && <div style={{ fontSize: 11.5, color: 'var(--ink-warn)', marginTop: 2 }}>{L('Quá 24h — không nhắn được qua Facebook/Instagram nữa', 'Past 24h — Facebook/Instagram no longer allow a message')}</div>}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {r.kind === 'chat' && (
                    <a href={`/salon/inbox?thread=${encodeURIComponent(r.refId)}`} style={{ ...btn, ...(r.canMessage ? { ...ui.primaryBtn, padding: '6px 11px', fontSize: 12.5 } : { border: '1px solid var(--c475569)', color: 'var(--ccbd5e1)' }) }}>
                      {r.canMessage ? L('Trả lời ngay', 'Reply now') : L('Xem hội thoại', 'Open chat')}
                    </a>
                  )}
                  {r.phone && <a href={`tel:${r.phone}`} style={{ ...btn, border: '1px solid var(--c475569)', color: 'var(--ccbd5e1)' }}>📞 {r.phone}</a>}
                  <button type="button" disabled={busy === r.key} onClick={() => void done(r)} style={{ ...btn, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--c94a3b8)', opacity: busy === r.key ? 0.5 : 1 }}>
                    ✓ {L('Đã xử lý', 'Done')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
