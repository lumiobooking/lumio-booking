'use client';

/**
 * /salon/ai › "Lời dặn của chủ tiệm" — every instruction the owner gave the
 * AI, with how often it was used and how often it stopped a wrong reply.
 * Turn one off, edit it, try it, delete it; answer the questions the AI could
 * not, once. Every row is this salon's (api ai-brain/instructions.service.ts).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api';
import { ui } from '../lib/ui';
import { INS_CHANNELS, TeachAiPanel, type InsKind, type InstructionRow } from './TeachAiPanel';

const L = (vi: boolean, v: string, e: string) => (vi ? v : e);

interface Gap { id: string; question: string; count: number; suggestedAnswer: string | null }
type Filter = 'all' | InsKind | 'off';

const KIND_BADGE: Record<InsKind, { vi: string; en: string; bg: string; ink: string }> = {
  never: { vi: 'KHÔNG BAO GIỜ', en: 'NEVER', bg: 'var(--wash-red)', ink: 'var(--ink-bad)' },
  always: { vi: 'LUÔN', en: 'ALWAYS', bg: 'var(--wash-blue)', ink: 'var(--ink-link)' },
  answer: { vi: 'CÂU TRẢ LỜI ĐÚNG', en: 'RIGHT ANSWER', bg: 'transparent', ink: 'var(--ink-good)' },
};
const SOURCE: Record<string, { vi: string; en: string }> = {
  thread: { vi: 'tạo từ một cuộc trò chuyện', en: 'from a conversation' },
  call: { vi: 'tạo từ một cuộc gọi', en: 'from a call' },
  session: { vi: 'tạo từ nhật ký AI', en: 'from the AI log' },
  gap: { vi: 'từ câu AI chưa biết', en: 'from a question the AI could not answer' },
  manual: { vi: 'thêm tay', en: 'added by hand' },
};

export function AiInstructionsTab({ token, vi }: { token: string | null; vi: boolean }) {
  const [data, setData] = useState<{ items: InstructionRow[]; canEdit: boolean; stats: { total: number; on: number; used: number; blocked: number } } | null>(null);
  const [gaps, setGaps] = useState<Gap[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [panel, setPanel] = useState<{ editing: InstructionRow | null } | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [gapText, setGapText] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setData(await apiFetch('/ai-brain/instructions', { token }));
      setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error'); }
    apiFetch<{ open: Gap[] }>('/messenger/knowledge-gaps', { token }).then((g) => setGaps(g.open)).catch(() => setGaps([]));
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const items = data?.items ?? [];
    const needle = q.trim().toLowerCase();
    return items.filter((i) => (filter === 'all' ? true : filter === 'off' ? !i.on : i.kind === filter))
      .filter((i) => !needle || [i.text, ...i.triggers].some((t) => t.toLowerCase().includes(needle)));
  }, [data, q, filter]);

  async function toggle(i: InstructionRow) {
    if (!token) return;
    setBusyId(i.id);
    try { await apiFetch(`/ai-brain/instructions/${i.id}`, { method: 'PATCH', token, body: { on: !i.on } }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Error'); }
    finally { setBusyId(null); }
  }
  async function remove(id: string) {
    if (!token) return;
    setBusyId(id);
    try { await apiFetch(`/ai-brain/instructions/${id}`, { method: 'DELETE', token }); setConfirmDel(null); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Error'); }
    finally { setBusyId(null); }
  }
  async function answerGap(g: Gap) {
    const text = (gapText[g.id] ?? g.suggestedAnswer ?? '').trim();
    if (!token || !text) return;
    setBusyId(g.id);
    try { await apiFetch(`/messenger/knowledge-gaps/${g.id}/answer`, { method: 'POST', token, body: { answer: text } }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Error'); }
    finally { setBusyId(null); }
  }

  const canEdit = !!data?.canEdit;
  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: L(vi, 'Tất cả', 'All') }, { id: 'answer', label: L(vi, 'Câu trả lời', 'Answers') },
    { id: 'always', label: L(vi, 'Luôn', 'Always') }, { id: 'never', label: L(vi, 'Không bao giờ', 'Never') }, { id: 'off', label: L(vi, 'Đang tắt', 'Off') },
  ];
  const tile = (n: string | number, label: string, tone?: 'warn') => (
    <div style={{ ...ui.card, padding: 14, display: 'flex', flexDirection: 'column', gap: 4, borderColor: tone ? 'var(--ink-warn)' : undefined }}>
      <span style={{ fontSize: 26, fontWeight: 800, color: tone ? 'var(--ink-warn)' : 'var(--ce2e8f0)' }}>{n}</span>
      <span style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{label}</span>
    </div>
  );
  const chans = (i: InstructionRow) => (!i.channels.length ? L(vi, 'Mọi kênh', 'Every channel') : i.channels.map((c) => { const x = INS_CHANNELS.find((y) => y.id === c); return x ? L(vi, x.vi, x.en) : c; }).join(' · '));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ borderRadius: 12, background: 'var(--wash-blue)', border: '1px solid #6366f1', padding: '12px 14px', fontSize: 13.5, lineHeight: 1.55, color: 'var(--ce2e8f0)' }}>
        <b>{L(vi, 'AI phải làm theo các lời dặn này trước mọi thứ khác', 'The AI follows these before anything else')}</b>
        {L(vi, ' — kể cả khi kiến thức, khuyến mãi hay kịch bản nói khác. Thêm ở đây, hoặc bấm “Sửa” trên câu AI trả lời trong Hộp thư, Cuộc gọi hay Nhật ký AI. Câu trả lời vi phạm bị chặn và viết lại trước khi tới khách.',
          ' — even when notes, promotions or scripts say otherwise. Add them here, or press “Fix” on any AI reply in the Inbox, a call or the AI log. A reply that breaks one is stopped and rewritten before the customer sees it.')}
      </div>

      {err && <div role="alert" style={{ ...ui.banner, margin: 0 }}>{err}</div>}
      {!data && !err && <div style={{ color: 'var(--c94a3b8)' }}>{L(vi, 'Đang tải…', 'Loading…')}</div>}

      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            {tile(`${data.stats.on} / ${data.stats.total}`, L(vi, 'lời dặn đang bật', 'instructions on'))}
            {tile(data.stats.used, L(vi, 'lần AI đã dùng lời dặn', 'times the AI used one'))}
            {tile(data.stats.blocked, L(vi, 'lần AI định nói sai — đã chặn', 'wrong replies stopped'), data.stats.blocked ? 'warn' : undefined)}
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <label htmlFor="ins-find" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{L(vi, 'Tìm lời dặn', 'Find')}</label>
            <input id="ins-find" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L(vi, 'Tìm lời dặn…', 'Find an instruction…')} style={{ ...ui.input, flex: '1 1 220px', minWidth: 0, minHeight: 42 }} />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {filters.map((f) => (
                <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}
                  style={filter === f.id
                    ? { minHeight: 36, padding: '0 12px', borderRadius: 999, border: '1px solid #4f46e5', background: '#4f46e5', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }
                    : { minHeight: 36, padding: '0 12px', borderRadius: 999, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ccbd5e1)', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>{f.label}</button>
              ))}
            </div>
            {canEdit && <button type="button" onClick={() => setPanel({ editing: null })} style={{ ...ui.primaryBtn, minHeight: 42, fontSize: 14, background: '#4f46e5' }}>+ {L(vi, 'Thêm lời dặn', 'Add instruction')}</button>}
          </div>

          {!canEdit && <div style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{L(vi, 'Chỉ chủ tiệm hoặc quản lý được thêm và sửa lời dặn. Bạn đang xem.', 'Only the owner or a manager can add or change instructions. You are viewing.')}</div>}

          {!data.items.length && (
            <div style={{ ...ui.card, fontSize: 13.5, color: 'var(--c94a3b8)', lineHeight: 1.6 }}>
              {L(vi, 'Chưa có lời dặn nào. Khi thấy AI trả lời sai trong Hộp thư hoặc cuộc gọi, bấm “Sửa” ngay dưới câu đó — hoặc bấm “+ Thêm lời dặn”.', 'No instructions yet. When the AI gets something wrong in the Inbox or a call, press “Fix” under that reply — or “+ Add instruction”.')}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {shown.map((i) => {
              const b = KIND_BADGE[i.kind];
              return (
                <article key={i.id} style={{ ...ui.card, padding: '14px 16px', display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap', opacity: i.on ? 1 : 0.7, borderStyle: i.on ? 'solid' : 'dashed' }}>
                  <div style={{ flex: '1 1 380px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11.5, fontWeight: 800, color: b.ink, background: b.bg, border: `1px solid ${b.ink}`, borderRadius: 6, padding: '2px 8px' }}>{L(vi, b.vi, b.en)}</span>
                      <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{i.kind === 'answer' ? `${i.mode === 'verbatim' ? L(vi, 'Nguyên văn', 'Word for word') : L(vi, 'Theo ý', 'Meaning')} · ` : ''}{chans(i)}</span>
                      {!i.on && <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ccbd5e1)' }}>{L(vi, 'Đang tắt', 'Off')}</span>}
                    </div>
                    {i.triggers.length > 0 && (
                      <span style={{ fontSize: 13, color: 'var(--c94a3b8)', lineHeight: 1.5 }}>{i.kind === 'answer' ? L(vi, 'Khi khách hỏi: ', 'When asked: ') : L(vi, 'Khi khách nói về: ', 'When about: ')}<span style={{ color: 'var(--ce2e8f0)' }}>{i.triggers.map((t) => `“${t}”`).join(' · ')}</span></span>
                    )}
                    <span style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.5, overflowWrap: 'anywhere' }}>{i.text}</span>
                    <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>
                      {L(vi, `Dùng ${i.usedCount} lần`, `Used ${i.usedCount}×`)}
                      {i.blockedCount ? <span style={{ color: 'var(--ink-warn)' }}>{L(vi, ` · chặn ${i.blockedCount} lần`, ` · stopped ${i.blockedCount}×`)}</span> : null}
                      {' · '}{L(vi, (SOURCE[i.sourceKind ?? 'manual'] ?? SOURCE.manual).vi, (SOURCE[i.sourceKind ?? 'manual'] ?? SOURCE.manual).en)}
                      {i.createdAt ? `, ${new Date(i.createdAt).toLocaleDateString(vi ? 'vi-VN' : 'en-US')}` : ''}
                    </span>
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button type="button" role="switch" aria-checked={i.on} aria-label={L(vi, 'Bật lời dặn', 'Instruction on')} disabled={busyId === i.id} onClick={() => void toggle(i)}
                        style={{ width: 48, height: 28, borderRadius: 999, border: 0, background: i.on ? '#4f46e5' : 'var(--ink-faint)', position: 'relative', padding: 0, cursor: 'pointer' }}>
                        <span style={{ position: 'absolute', top: 3, left: i.on ? 23 : 3, width: 22, height: 22, borderRadius: 999, background: '#fff' }} />
                      </button>
                      <button type="button" onClick={() => setPanel({ editing: i })} style={{ minHeight: 36, padding: '0 12px', borderRadius: 8, border: '1px solid var(--c475569)', background: 'transparent', color: 'var(--ce2e8f0)', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>{L(vi, 'Sửa / Thử', 'Edit / Try')}</button>
                      {confirmDel === i.id ? (
                        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <span style={{ fontSize: 13 }}>{L(vi, 'Xoá?', 'Delete?')}</span>
                          <button type="button" disabled={busyId === i.id} onClick={() => void remove(i.id)} style={{ ...ui.dangerBtn, minHeight: 36 }}>{L(vi, 'Xoá', 'Delete')}</button>
                          <button type="button" onClick={() => setConfirmDel(null)} style={{ minHeight: 36, padding: '0 10px', borderRadius: 8, border: '1px solid var(--c475569)', background: 'transparent', color: 'var(--ce2e8f0)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>{L(vi, 'Không', 'No')}</button>
                        </span>
                      ) : (
                        <button type="button" onClick={() => setConfirmDel(i.id)} style={{ ...ui.dangerBtn, minHeight: 36 }}>{L(vi, 'Xoá', 'Delete')}</button>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
            {data.items.length > 0 && !shown.length && <div style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{L(vi, 'Không có lời dặn nào khớp.', 'Nothing matches.')}</div>}
          </div>

          {canEdit && !!gaps?.length && (
            <section style={{ ...ui.card, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>{L(vi, `Câu AI chưa biết trả lời · ${gaps.length}`, `Questions the AI could not answer · ${gaps.length}`)}</h2>
                <span style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{L(vi, 'Khách đã hỏi mà AI phải nói “để em hỏi lại tiệm”. Trả lời một lần — thành lời dặn cho mọi kênh.', 'Customers asked and the AI had to say “let me check”. Answer once — it becomes an instruction on every channel.')}</span>
              </div>
              {gaps.slice(0, 20).map((g) => (
                <div key={g.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--c334155)', paddingTop: 10 }}>
                  <span style={{ fontSize: 14 }}>“{g.question}” <span style={{ color: 'var(--c94a3b8)', fontSize: 12.5 }}>· {L(vi, `hỏi ${g.count} lần`, `asked ${g.count}×`)}</span></span>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <label htmlFor={`gap-${g.id}`} style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{L(vi, 'Câu trả lời', 'Answer')}</label>
                    <input id={`gap-${g.id}`} value={gapText[g.id] ?? g.suggestedAnswer ?? ''} maxLength={1000} onChange={(e) => setGapText({ ...gapText, [g.id]: e.target.value })}
                      placeholder={L(vi, 'Câu trả lời đúng…', 'The right answer…')} style={{ ...ui.input, flex: '1 1 260px', minWidth: 0 }} />
                    <button type="button" disabled={busyId === g.id || !(gapText[g.id] ?? g.suggestedAnswer ?? '').trim()} onClick={() => void answerGap(g)}
                      style={{ minHeight: 40, padding: '0 14px', borderRadius: 8, border: '1px solid #818cf8', background: 'transparent', color: 'var(--ink-link)', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>{L(vi, 'Lưu câu trả lời', 'Save answer')}</button>
                  </div>
                </div>
              ))}
            </section>
          )}
        </>
      )}

      {panel && (
        <TeachAiPanel token={token} vi={vi} editing={panel.editing} channel={panel.editing?.channels[0] ?? 'messenger'}
          question={panel.editing?.sourceQuestion ?? undefined} source={{ kind: 'manual', id: null }}
          onClose={() => setPanel(null)} onSaved={() => void load()} />
      )}
    </div>
  );
}
