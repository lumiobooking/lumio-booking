'use client';

/**
 * "Sửa" under an AUTOMATIC REMINDER in the Inbox.
 *
 * A reminder ("I am still here — …") is not an AI answer: it is a fixed line
 * the follow-up sweep sends when a customer goes quiet (api messenger/followup).
 * AI instructions never reach it, so opening "Teach the AI" on it saved a rule
 * that changed nothing. Here the owner rewrites the reminder itself — the same
 * two lines as Messenger settings › Follow up quiet customers — or turns the
 * reminders off. Saved per salon (settings key chat_followup).
 */
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { ui } from '../lib/ui';
import { useIsMobile } from '../lib/responsive';
import { NudgeWordingFields, type FollowUp } from './FollowUpBox';

const L = (vi: boolean, v: string, e: string) => (vi ? v : e);

export function NudgeTextPanel(p: {
  token: string | null;
  vi: boolean;
  /** The reminder that was sent. */
  reply: string;
  /** Only the owner changes the salon's settings; others see why the button does nothing. */
  canEdit: boolean;
  onClose: () => void;
}) {
  const { vi, onClose } = p;
  const mobile = useIsMobile();
  const [s, setS] = useState<FollowUp | null>(null);
  const [words, setWords] = useState({ messageVi: '', messageEn: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!p.token) return;
    apiFetch<FollowUp>('/settings/chat-followup', { token: p.token })
      .then((r) => { setS(r); setWords({ messageVi: r.messageVi ?? '', messageEn: r.messageEn ?? '' }); })
      .catch((e) => setErr(e instanceof Error ? e.message : L(vi, 'Không tải được cài đặt', 'Could not load the settings')));
  }, [p.token, vi]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const dirty = !!s && (words.messageVi.trim() !== (s.messageVi ?? '') || words.messageEn.trim() !== (s.messageEn ?? ''));

  async function patch(body: Partial<FollowUp>, ok: string) {
    if (!p.token || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch<FollowUp>('/settings/chat-followup', { method: 'PATCH', token: p.token, body });
      setS(r); setWords({ messageVi: r.messageVi ?? '', messageEn: r.messageEn ?? '' });
      setDone(ok);
      window.setTimeout(() => onClose(), 1200);
    } catch (e) {
      setErr(e instanceof Error ? e.message : L(vi, 'Không lưu được', 'Could not save'));
    } finally { setBusy(false); }
  }

  const sectionLabel = { fontSize: 12, fontWeight: 700, color: 'var(--c94a3b8)', letterSpacing: '.02em' } as const;

  return (
    <div role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(2,6,23,.55)', display: 'flex', justifyContent: mobile ? 'stretch' : 'flex-end', alignItems: mobile ? 'flex-end' : 'stretch' }}>
      <aside role="dialog" aria-modal="true" aria-label={L(vi, 'Sửa câu nhắc lại tự động', 'Edit the automatic follow-up')}
        style={{
          width: mobile ? '100%' : 460, maxWidth: '100%', maxHeight: mobile ? '92vh' : '100vh', boxSizing: 'border-box',
          background: 'var(--c1e293b)', borderLeft: mobile ? 0 : '1px solid #6366f1', borderTop: mobile ? '1px solid var(--c475569)' : 0,
          borderRadius: mobile ? '18px 18px 0 0' : 0, display: 'flex', flexDirection: 'column', color: 'var(--ce2e8f0)',
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--c334155)' }}>
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 16, fontWeight: 800 }}>{L(vi, 'Sửa câu nhắc lại tự động', 'Edit the automatic follow-up')}</span>
            <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{L(vi, 'Chỉ áp dụng cho tiệm của bạn', 'Your salon only')}</span>
          </span>
          <button type="button" aria-label={L(vi, 'Đóng', 'Close')} onClick={onClose}
            style={{ width: 40, height: 40, borderRadius: 8, border: '1px solid var(--c475569)', background: 'transparent', color: 'var(--ccbd5e1)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', flex: 1 }}>
          <div style={{ borderRadius: 10, padding: '10px 12px', background: 'rgba(99,102,241,.12)', border: '1px solid rgba(99,102,241,.35)', fontSize: 13, lineHeight: 1.55 }}>
            {L(vi,
              'Đây là tin NHẮC LẠI tự động khi khách im lặng — không phải AI trả lời, nên “Dạy AI” không đổi được câu này. Viết câu của tiệm ở dưới: lần nhắc sau bot gửi đúng nguyên văn.',
              'This is an automatic FOLLOW-UP sent when a customer goes quiet — not an AI answer, so “Teach the AI” cannot change it. Write your own line below: the next follow-up sends it word for word.')}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={sectionLabel}>{L(vi, 'BOT ĐÃ GỬI', 'THE BOT SENT')}</span>
            <span style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink-bad)', textDecoration: 'line-through' }}>“{p.reply}”</span>
          </div>

          {!p.canEdit && (
            <div role="note" style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{L(vi, 'Chỉ chủ tiệm sửa được câu nhắc lại.', 'Only the salon owner can change the follow-up.')}</div>
          )}

          {s && <NudgeWordingFields vi={vi} valueVi={words.messageVi} valueEn={words.messageEn} onChange={setWords} disabled={!p.canEdit || busy} />}
          {!s && !err && <span style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{L(vi, 'Đang tải…', 'Loading…')}</span>}

          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.6 }}>
            <li>{L(vi, 'Bot không nhắc khi khách đã cảm ơn / từ chối / chào, hoặc bot đã chào khách.', 'No follow-up after the customer said no thanks or goodbye, or after the bot signed off.')}</li>
            <li>{L(vi, 'Mỗi câu chỉ gửi một lần cho cùng một khách.', 'Each line is sent at most once to the same customer.')}</li>
          </ul>

          {err && <div role="alert" style={{ fontSize: 13, color: 'var(--ink-bad)', lineHeight: 1.5 }}>{err}</div>}
          {done && <div role="status" style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink-good)' }}>✓ {done}</div>}
        </div>

        <div style={{ borderTop: '1px solid var(--c334155)', padding: '12px 16px', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {s?.enabled && (
            <button type="button" disabled={!p.canEdit || busy} onClick={() => void patch({ enabled: false }, L(vi, 'Đã tắt nhắn lại tự động.', 'Automatic follow-ups are off.'))}
              style={{ flex: '1 1 140px', minHeight: 44, borderRadius: 8, border: '1px solid var(--c475569)', background: 'transparent', color: 'var(--ce2e8f0)', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', opacity: !p.canEdit || busy ? 0.55 : 1 }}>
              {L(vi, 'Tắt nhắn lại', 'Turn off follow-ups')}
            </button>
          )}
          <button type="button" disabled={!p.canEdit || !dirty || busy}
            onClick={() => void patch({ messageVi: words.messageVi.trim(), messageEn: words.messageEn.trim() }, L(vi, 'Đã lưu — lần nhắc sau dùng câu mới.', 'Saved — the next follow-up uses it.'))}
            style={{ ...ui.primaryBtn, flex: '2 1 200px', minHeight: 44, fontSize: 14, fontWeight: 700, background: '#4f46e5', opacity: p.canEdit && dirty && !busy ? 1 : 0.55 }}>
            {busy ? L(vi, 'Đang lưu…', 'Saving…') : L(vi, 'Lưu câu nhắc', 'Save wording')}
          </button>
        </div>
      </aside>
    </div>
  );
}
