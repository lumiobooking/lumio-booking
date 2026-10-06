'use client';

/**
 * CÂU HỎI BOT CHƯA TRẢ LỜI ĐƯỢC — the owner answers once, the bot knows from then on.
 *
 * Every question the bot had to answer with "let me check with the salon",
 * and every question a staff member answered by hand, lands here (per salon,
 * counted). Typing the answer saves it as a bot fact. Nothing becomes a fact
 * without the owner pressing Save — a staff reply is only ever a suggestion.
 */
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { ui } from '../lib/ui';
import { ind } from '../lib/ui-industry';

interface Gap {
  id: string; question: string; count: number; source: 'bot' | 'staff' | string; status: string;
  suggestedAnswer: string | null; answer: string | null; lastAt: string; answeredAt: string | null;
}

function ago(iso: string, vi: boolean): string {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (m < 60) return vi ? `${m} phút trước` : `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return vi ? `${h} giờ trước` : `${h} h ago`;
  return vi ? `${Math.round(h / 24)} ngày trước` : `${Math.round(h / 24)} days ago`;
}

export function KnowledgeGapsBox({ token, vi, onTaught }: {
  token: string | null; vi: boolean;
  /** The page keeps its own copy of the bot facts for its editor; it is told about each new one so a later "save facts" cannot drop it. */
  onTaught?: (label: string, value: string) => void;
}) {
  const [open, setOpen] = useState<Gap[] | null>(null);
  const [answered, setAnswered] = useState<Gap[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const L = (v: string, e: string) => ind(vi ? v : e);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const r = await apiFetch<{ open: Gap[]; answered: Gap[] }>('/messenger/knowledge-gaps', { token });
      setOpen(r?.open ?? []);
      setAnswered(r?.answered ?? []);
      // A staff member's reply is offered as the starting point, never saved by itself.
      setDrafts((d) => {
        const next = { ...d };
        for (const g of r?.open ?? []) if (next[g.id] === undefined && g.suggestedAnswer) next[g.id] = g.suggestedAnswer;
        return next;
      });
    } catch { setOpen([]); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  async function save(g: Gap) {
    const answer = (drafts[g.id] ?? '').trim();
    if (!token || !answer) return;
    setBusy(g.id); setError(null);
    try {
      const r = await apiFetch<{ ok: true; label: string }>(`/messenger/knowledge-gaps/${g.id}/answer`, { method: 'POST', token, body: { answer } });
      if (r?.label) onTaught?.(r.label, answer);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'error'); }
    finally { setBusy(null); }
  }

  async function dismiss(g: Gap) {
    if (!token) return;
    setBusy(g.id); setError(null);
    try { await apiFetch(`/messenger/knowledge-gaps/${g.id}/dismiss`, { method: 'POST', token }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'error'); }
    finally { setBusy(null); }
  }

  const n = open?.length ?? 0;

  return (
    <div style={{ ...ui.card, borderColor: n > 0 ? 'rgba(245,158,11,0.55)' : 'var(--c334155)', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--cf1f5f9)' }}>
          🎓 {L('Câu hỏi bot chưa trả lời được', 'Questions the bot could not answer')}
        </div>
        {n > 0 && (
          <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 9px', borderRadius: 999, background: 'rgba(245,158,11,0.16)', color: 'var(--ink-warn)' }}>
            {n} {L('câu chờ trả lời', 'waiting')}
          </span>
        )}
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--c94a3b8)', margin: '6px 0 12px', lineHeight: 1.5 }}>
        {L('Khách hỏi mà bot không có thông tin để trả lời, hoặc nhân viên đã phải tự trả lời. Bạn trả lời một lần — bot sẽ biết và tự trả lời cho mọi khách sau.',
          'Questions the bot had no information for, or that a staff member answered by hand. Answer once and the bot answers every customer after that.')}
      </p>

      {open === null && <div style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{L('Đang tải…', 'Loading…')}</div>}
      {open !== null && n === 0 && (
        <div style={{ fontSize: 13, color: 'var(--ink-good)' }}>✓ {L('Không có câu hỏi nào đang chờ. Bot đang trả lời được hết.', 'Nothing waiting — the bot has been able to answer everything.')}</div>
      )}

      <div style={{ display: 'grid', gap: 12 }}>
        {(open ?? []).map((g) => (
          <div key={g.id} style={{ border: '1px solid var(--c334155)', borderRadius: 10, padding: 12, background: 'var(--c0f172a)' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ce2e8f0)' }}>“{g.question}”</div>
            <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginTop: 3 }}>
              {L(`Khách hỏi ${g.count} lần`, `Asked ${g.count}×`)} · {L('lần cuối', 'last')} {ago(g.lastAt, vi)}
              {g.source === 'staff' && <span style={{ color: 'var(--cc7d2fe)' }}> · {L('nhân viên đã trả lời — câu trả lời được điền sẵn bên dưới', 'a staff member answered — their reply is filled in below')}</span>}
            </div>
            <textarea
              value={drafts[g.id] ?? ''}
              onChange={(e) => setDrafts((d) => ({ ...d, [g.id]: e.target.value.slice(0, 1000) }))}
              placeholder={L('Bot nên trả lời khách thế nào? (vd: Tiệm khai trương thứ Sáu 9/10, giảm 20% cả tuần đầu)', 'What should the bot tell customers? (e.g. Our grand opening is Friday Oct 9 — 20% off all week)')}
              rows={2}
              style={{ ...ui.input, marginTop: 8, resize: 'vertical', lineHeight: 1.5 }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => void save(g)} disabled={busy === g.id || !(drafts[g.id] ?? '').trim()}
                style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: 'rgba(99,102,241,0.9)', color: 'var(--cf8fafc)', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: busy === g.id || !(drafts[g.id] ?? '').trim() ? 0.5 : 1 }}>
                {busy === g.id ? L('Đang lưu…', 'Saving…') : L('Lưu cho bot', 'Teach the bot')}
              </button>
              <button type="button" onClick={() => void dismiss(g)} disabled={busy === g.id}
                style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--c475569)', background: 'transparent', color: 'var(--c94a3b8)', fontSize: 13, cursor: 'pointer' }}>
                {L('Bỏ qua', 'Dismiss')}
              </button>
            </div>
          </div>
        ))}
      </div>

      {error && <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--ink-bad)' }}>{error}</div>}

      {answered.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <button type="button" onClick={() => setShowDone((v) => !v)}
            style={{ background: 'none', border: 'none', padding: 0, color: 'var(--c94a3b8)', fontSize: 12.5, cursor: 'pointer' }}>
            {showDone ? '▾' : '▸'} {L(`Đã dạy bot (${answered.length})`, `Taught to the bot (${answered.length})`)}
          </button>
          {showDone && (
            <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
              {answered.map((g) => (
                <div key={g.id} style={{ fontSize: 12.5, color: 'var(--ccbd5e1)', lineHeight: 1.5 }}>
                  <span style={{ color: 'var(--ink-good)' }}>✓</span> “{g.question}” → {g.answer}
                </div>
              ))}
              <div style={{ fontSize: 11.5, color: 'var(--c64748b)' }}>
                {L('Sửa hoặc tắt các câu này ở mục Thông tin cho bot bên dưới.', 'Edit or switch these off in the bot facts below.')}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
