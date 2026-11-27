'use client';

/**
 * rt248 — the turn I am holding, above the reply box: what I must do and by
 * when, and "Không nhận" to release it at once to the next person (instead of
 * letting the timer run out, which counts as a turn lost).
 */
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { countdown } from '../lib/turn-countdown';

export function TurnStrip({ token, vi, threadId, dueAt, aiOn, onDone }: {
  token: string | null; vi: boolean; threadId: string; dueAt: string | null | undefined; aiOn: boolean;
  onDone: (msg: string, ok: boolean) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(false);
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id); }, []);
  useEffect(() => { setAsk(false); }, [threadId]);
  const c = countdown(dueAt, now);
  if (!c) return null;
  const decline = async () => {
    if (!token) return;
    setBusy(true);
    try {
      const r = await apiFetch<{ ok: boolean; to: string | null }>(`/messenger/turns/${threadId}/decline`, { method: 'POST', token });
      onDone(r.ok ? (vi ? 'Đã chuyển khách cho người kế tiếp.' : 'Passed to the next person.') : (vi ? 'Không còn ai trực để nhận — khách vẫn ở với bạn.' : 'Nobody else is on duty — the customer stays with you.'), r.ok);
    } catch (e) { onDone(e instanceof Error ? e.message : 'error', false); }
    finally { setBusy(false); setAsk(false); }
  };
  const tone = c.tone === 'bad' ? { bg: 'var(--wash-red)', ink: 'var(--ink-bad)' } : c.tone === 'warn' ? { bg: 'var(--wash-amber-3)', ink: 'var(--ink-warn)' } : { bg: 'var(--wash-blue)', ink: 'var(--ink-link)' };
  return (
    <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 10px', borderRadius: 10, background: tone.bg }}>
      <div style={{ flex: '1 1 220px', minWidth: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--ce2e8f0)' }}>
        <b style={{ color: tone.ink }}>⏱ {vi ? c.text : c.text.replace('còn', 'left').replace('đang chuyển…', 'passing on…')}</b>{' · '}
        {vi
          ? (aiOn ? 'Khách đang được giao cho bạn. AI trả lời trước, nhưng bạn vẫn phải tự trả lời khách trước khi hết giờ — nếu không, khách chuyển người khác và tính là bỏ turn.' : 'Khách đang được giao cho bạn — trả lời trước khi hết giờ, nếu không khách chuyển người khác và tính là bỏ turn.')
          : (aiOn ? 'This customer is yours. The AI answers first, but you still need to reply yourself before time runs out — otherwise it passes on and counts as a turn let go.' : 'This customer is yours — reply before time runs out, otherwise it passes on and counts as a turn let go.')}
      </div>
      {!ask ? (
        <button type="button" onClick={() => setAsk(true)} disabled={busy}
          style={{ minHeight: 40, padding: '0 12px', borderRadius: 10, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ce2e8f0)', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
          {vi ? 'Không nhận' : 'Decline'}
        </button>
      ) : (
        <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => void decline()} disabled={busy}
            style={{ minHeight: 40, padding: '0 12px', borderRadius: 10, border: 0, background: '#b45309', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
            {busy ? '…' : (vi ? 'Chuyển người khác ngay' : 'Pass it on now')}
          </button>
          <button type="button" onClick={() => setAsk(false)} disabled={busy}
            style={{ minHeight: 40, padding: '0 12px', borderRadius: 10, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ce2e8f0)', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
            {vi ? 'Thôi' : 'Keep it'}
          </button>
        </span>
      )}
    </div>
  );
}
