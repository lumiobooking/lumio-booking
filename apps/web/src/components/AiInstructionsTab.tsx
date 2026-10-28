'use client';

/**
 * /salon/ai › "Lời dặn của chủ tiệm" — two pages, each a short list:
 *   1. Lời dặn — every instruction the owner gave the AI, in the owner's own
 *      words with how the AI understood them underneath ("AI hiểu là: …"),
 *      how often it was followed and how often it stopped a wrong reply.
 *   2. AI chưa biết trả lời — the questions the AI had to defer, answered
 *      once (or skipped) here.
 * Both page instead of scrolling forever. Every row is this salon's (api
 * ai-brain/instructions.service.ts, messenger/knowledge-gaps.service.ts).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api';
import { usePaged } from './ListFilter';
import { INS_CHANNELS, TeachAiPanel, type InsKind, type InstructionRow } from './TeachAiPanel';
import { Empty, L, PageBar, Search, SubTabs, Switch, ghostBtn, primaryBtn, srOnly } from './ai/aiKit';

interface Gap { id: string; question: string; count: number; suggestedAnswer: string | null }
type Filter = 'all' | InsKind | 'off';
type Page = 'rules' | 'gaps';

export const KIND_LOOK: Record<InsKind, { vi: string; en: string; bg: string; ink: string; bar: string }> = {
  never: { vi: 'KHÔNG BAO GIỜ', en: 'NEVER', bg: 'var(--wash-red)', ink: 'var(--ink-bad)', bar: '#ef4444' },
  always: { vi: 'LUÔN', en: 'ALWAYS', bg: 'var(--wash-blue)', ink: 'var(--ink-link)', bar: '#4f46e5' },
  answer: { vi: 'CÂU TRẢ LỜI', en: 'ANSWER', bg: 'transparent', ink: 'var(--ink-good)', bar: '#16a34a' },
};
const SOURCE: Record<string, { vi: string; en: string }> = {
  thread: { vi: 'từ một cuộc trò chuyện', en: 'from a conversation' },
  call: { vi: 'từ một cuộc gọi', en: 'from a call' },
  session: { vi: 'từ nhật ký AI', en: 'from the AI log' },
  gap: { vi: 'từ câu AI chưa biết', en: 'from an unanswered question' },
  manual: { vi: 'thêm tay', en: 'added by hand' },
};
const PER_PAGE = 8;
const GAPS_PER_PAGE = 6;

export function AiInstructionsTab({ token, vi }: { token: string | null; vi: boolean }) {
  const [data, setData] = useState<{ items: InstructionRow[]; canEdit: boolean; stats: { total: number; on: number; used: number; blocked: number } } | null>(null);
  const [gaps, setGaps] = useState<Gap[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [page, setPage] = useState<Page>('rules');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [panel, setPanel] = useState<{ editing: InstructionRow | null; question?: string } | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [gapText, setGapText] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setData(await apiFetch('/ai-brain/instructions', { token }));
      setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error'); }
    apiFetch<{ open: Gap[] }>('/messenger/knowledge-gaps', { token }).then((g) => setGaps(g.open)).catch(() => setGaps([]));
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!toast) return; const t = window.setTimeout(() => setToast(null), 2600); return () => window.clearTimeout(t); }, [toast]);

  const shown = useMemo(() => {
    const items = data?.items ?? [];
    const needle = q.trim().toLowerCase();
    return items.filter((i) => (filter === 'all' ? true : filter === 'off' ? !i.on : i.kind === filter))
      .filter((i) => !needle || [i.text, i.meaningNote ?? '', ...i.triggers].some((t) => t.toLowerCase().includes(needle)));
  }, [data, q, filter]);
  const pg = usePaged(shown, PER_PAGE);
  const gp = usePaged(gaps ?? [], GAPS_PER_PAGE);

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
    const text = (gapText[g.id] ?? '').trim();
    if (!token || !text) return;
    setBusyId(g.id);
    try {
      await apiFetch(`/messenger/knowledge-gaps/${g.id}/answer`, { method: 'POST', token, body: { answer: text } });
      setToast(L(vi, '✓ Đã lưu — AI trả lời câu này cho mọi khách', '✓ Saved — the AI answers this for everyone'));
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error'); }
    finally { setBusyId(null); }
  }
  async function dismissGap(g: Gap) {
    if (!token) return;
    setBusyId(g.id);
    try { await apiFetch(`/messenger/knowledge-gaps/${g.id}/dismiss`, { method: 'POST', token }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Error'); }
    finally { setBusyId(null); }
  }

  const canEdit = !!data?.canEdit;
  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: L(vi, 'Tất cả', 'All') }, { id: 'always', label: L(vi, 'Luôn', 'Always') }, { id: 'never', label: L(vi, 'Không bao giờ', 'Never') },
    { id: 'answer', label: L(vi, 'Câu trả lời', 'Answers') }, { id: 'off', label: L(vi, 'Đang tắt', 'Off') },
  ];
  const chans = (i: InstructionRow) => (!i.channels.length ? L(vi, 'Mọi kênh', 'Every channel') : i.channels.map((c) => { const x = INS_CHANNELS.find((y) => y.id === c); return x ? L(vi, x.vi, x.en) : c; }).join(' · '));
  const filterBtn = (on: boolean) => ({
    minHeight: 34, padding: '0 12px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, whiteSpace: 'nowrap' as const,
    border: on ? '1px solid #4f46e5' : '1px solid var(--line-strong)', background: on ? 'var(--wash-blue)' : 'transparent', color: on ? 'var(--ink-link)' : 'var(--ccbd5e1)', fontWeight: on ? 700 : 600,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <p style={{ flex: '1 1 320px', margin: 0, fontSize: 13.5, lineHeight: 1.55, color: 'var(--c94a3b8)' }}>
          {L(vi, 'Dặn ngắn thôi — AI hiểu ý bạn, áp dụng cho mọi khách, mọi kênh, trước mọi thứ khác. Câu trả lời trái lời dặn bị chặn và viết lại trước khi tới khách.',
            'Keep it short — the AI works out what you mean and applies it to every customer and channel, before anything else. A reply that breaks one is stopped and rewritten before it is sent.')}
        </p>
        {canEdit && <button type="button" onClick={() => setPanel({ editing: null })} style={primaryBtn}>+ {L(vi, 'Thêm lời dặn', 'Add instruction')}</button>}
      </div>

      <SubTabs label={L(vi, 'Các trang lời dặn', 'Instruction pages')} value={page} onChange={setPage}
        tabs={[
          { id: 'rules', label: L(vi, 'Lời dặn', 'Instructions'), count: data?.items.length },
          { id: 'gaps', label: L(vi, 'AI chưa biết trả lời', 'Unanswered questions'), count: gaps?.length, tone: 'warn' },
        ]} />

      {err && <div role="alert" style={{ borderRadius: 10, padding: '10px 12px', background: 'var(--wash-red)', color: 'var(--ink-bad)', fontSize: 13.5 }}>{err}</div>}
      {!data && !err && <div style={{ color: 'var(--c94a3b8)' }}>{L(vi, 'Đang tải…', 'Loading…')}</div>}

      {data && page === 'rules' && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              [`${data.stats.on}/${data.stats.total}`, L(vi, 'đang bật', 'on'), ''],
              [String(data.stats.used), L(vi, 'lần AI đã làm theo', 'times followed'), ''],
              [String(data.stats.blocked), L(vi, 'câu sai đã chặn', 'wrong replies stopped'), data.stats.blocked ? 'warn' : ''],
            ].map(([n, t, tone]) => (
              <span key={t} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, padding: '8px 14px', borderRadius: 10, background: tone ? 'var(--wash-amber)' : 'var(--raised)', border: '1px solid var(--line)' }}>
                <b style={{ fontSize: 17, color: tone ? 'var(--ink-warn)' : 'var(--ce2e8f0)' }}>{n}</b>
                <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{t}</span>
              </span>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <Search id="ins-find" value={q} onChange={setQ} label={L(vi, 'Tìm lời dặn', 'Find')} placeholder={L(vi, 'Tìm lời dặn…', 'Find an instruction…')} />
            <div role="group" aria-label={L(vi, 'Lọc', 'Filter')} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {filters.map((f) => <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} style={filterBtn(filter === f.id)}>{f.label}</button>)}
            </div>
          </div>

          {!canEdit && <div style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{L(vi, 'Chỉ chủ tiệm hoặc quản lý được thêm và sửa lời dặn. Bạn đang xem.', 'Only the owner or a manager can add or change instructions. You are viewing.')}</div>}

          {!data.items.length ? (
            <Empty>{L(vi, 'Chưa có lời dặn nào. Thấy AI trả lời sai trong Hộp thư hay cuộc gọi, bấm “Sửa” ngay dưới câu đó — hoặc “+ Thêm lời dặn”.', 'No instructions yet. When the AI gets something wrong in the Inbox or a call, press “Fix” under that reply — or “+ Add instruction”.')}</Empty>
          ) : !shown.length ? (
            <Empty>{L(vi, 'Không có lời dặn nào khớp.', 'Nothing matches.')}</Empty>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {pg.paged.map((i) => <InstructionCard key={i.id} i={i} vi={vi} canEdit={canEdit} chans={chans(i)} busy={busyId === i.id}
                confirming={confirmDel === i.id} onToggle={() => void toggle(i)} onEdit={() => setPanel({ editing: i })}
                onAskDelete={() => setConfirmDel(i.id)} onCancelDelete={() => setConfirmDel(null)} onDelete={() => void remove(i.id)} />)}
            </div>
          )}
          <PageBar page={pg.page} pages={pg.totalPages} setPage={(p) => { pg.setPage(p); setConfirmDel(null); }} start={pg.start} end={pg.end} total={pg.total} vi={vi} />
        </>
      )}

      {data && page === 'gaps' && (
        <>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: 'var(--c94a3b8)' }}>
            {L(vi, 'Khách đã hỏi mà AI phải nói “để em hỏi lại”. Trả lời một lần — AI dùng cho mọi khách sau. Câu không cần trả lời thì bấm “Bỏ qua”.',
              'Customers asked and the AI had to say “let me check”. Answer once — the AI uses it for everyone after. Press “Skip” for questions that need no answer.')}
          </p>
          {!gaps?.length ? (
            <Empty>{L(vi, '🎉 Không còn câu nào AI chưa biết trả lời.', '🎉 Nothing left unanswered.')}</Empty>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {gp.paged.map((g) => {
                const text = gapText[g.id] ?? '';
                return (
                  <article key={g.id} style={{ background: 'var(--c1e293b)', border: '1px solid var(--line)', borderRadius: 14, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <span aria-hidden style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 999, background: 'var(--wash-amber-3)', color: 'var(--ink-warn)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>?</span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: 600, lineHeight: 1.5, color: 'var(--ce2e8f0)', overflowWrap: 'anywhere', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }} title={g.question}>“{g.question}”</span>
                      <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, color: 'var(--c94a3b8)', background: 'var(--raised)', border: '1px solid var(--line)', borderRadius: 999, padding: '3px 9px' }}>{L(vi, `hỏi ${g.count} lần`, `asked ${g.count}×`)}</span>
                    </div>
                    {g.suggestedAnswer && !text && canEdit && (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginLeft: 40, fontSize: 13, color: 'var(--c94a3b8)' }}>
                        <span style={{ flex: '1 1 240px', minWidth: 0 }}>{L(vi, 'Nhân viên đã trả lời: ', 'Staff replied: ')}<i style={{ color: 'var(--ccbd5e1)' }}>“{g.suggestedAnswer}”</i></span>
                        <button type="button" onClick={() => setGapText({ ...gapText, [g.id]: g.suggestedAnswer ?? '' })} style={{ ...ghostBtn, minHeight: 32, fontSize: 12.5, padding: '0 10px' }}>{L(vi, 'Dùng câu này', 'Use it')}</button>
                      </div>
                    )}
                    {canEdit && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginLeft: 40 }}>
                        <label htmlFor={`gap-${g.id}`} style={srOnly}>{L(vi, 'Câu trả lời', 'Answer')}</label>
                        <input id={`gap-${g.id}`} value={text} maxLength={1000} onChange={(e) => setGapText({ ...gapText, [g.id]: e.target.value })}
                          onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) void answerGap(g); }}
                          placeholder={L(vi, 'Câu trả lời đúng, viết ngắn cũng được…', 'The right answer — short is fine…')}
                          style={{ flex: '1 1 260px', minWidth: 0, minHeight: 40, boxSizing: 'border-box', padding: '0 12px', borderRadius: 9, border: '1px solid var(--line-strong)', background: 'var(--c0f172a)', color: 'var(--ce2e8f0)', fontSize: 14, fontFamily: 'inherit' }} />
                        <button type="button" disabled={busyId === g.id || !text.trim()} onClick={() => void answerGap(g)} style={{ ...primaryBtn, minHeight: 40, opacity: busyId === g.id || !text.trim() ? 0.5 : 1 }}>{L(vi, 'Lưu', 'Save')}</button>
                        <button type="button" disabled={busyId === g.id} onClick={() => setPanel({ editing: null, question: g.question })} style={{ ...ghostBtn, minHeight: 40 }}>{L(vi, 'Dạy chi tiết', 'Teach in full')}</button>
                        <button type="button" disabled={busyId === g.id} onClick={() => void dismissGap(g)} style={{ ...ghostBtn, minHeight: 40, color: 'var(--c94a3b8)' }}>{L(vi, 'Bỏ qua', 'Skip')}</button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
          <PageBar page={gp.page} pages={gp.totalPages} setPage={gp.setPage} start={gp.start} end={gp.end} total={gp.total} vi={vi} />
        </>
      )}

      {toast && <div role="status" style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 900, background: '#166534', color: '#fff', padding: '10px 16px', borderRadius: 10, fontSize: 14, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,.25)' }}>{toast}</div>}

      {panel && (
        <TeachAiPanel token={token} vi={vi} editing={panel.editing} channel={panel.editing?.channels[0] ?? 'messenger'}
          question={panel.editing?.sourceQuestion ?? panel.question ?? undefined} source={{ kind: 'manual', id: null }}
          onClose={() => setPanel(null)} onSaved={() => void load()} />
      )}
    </div>
  );
}

function InstructionCard({ i, vi, canEdit, chans, busy, confirming, onToggle, onEdit, onAskDelete, onCancelDelete, onDelete }: {
  i: InstructionRow; vi: boolean; canEdit: boolean; chans: string; busy: boolean; confirming: boolean;
  onToggle: () => void; onEdit: () => void; onAskDelete: () => void; onCancelDelete: () => void; onDelete: () => void;
}) {
  const k = KIND_LOOK[i.kind];
  const src = SOURCE[i.sourceKind ?? 'manual'] ?? SOURCE.manual;
  const verbatim = i.kind === 'answer' && i.mode === 'verbatim';
  return (
    <article style={{ position: 'relative', background: 'var(--c1e293b)', border: '1px solid var(--line)', borderRadius: 14, padding: '14px 16px 14px 20px', display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap', opacity: i.on ? 1 : 0.62, overflow: 'hidden' }}>
      <span aria-hidden style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: i.on ? k.bar : 'var(--ink-faint)' }} />
      <div style={{ flex: '1 1 380px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.04em', color: k.ink, background: k.bg, border: `1px solid ${k.ink}`, borderRadius: 6, padding: '2px 8px' }}>{L(vi, k.vi, k.en)}</span>
          <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{verbatim ? `${L(vi, 'Nguyên văn', 'Word for word')} · ` : ''}{chans}</span>
          {!i.on && <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--c94a3b8)' }}>· {L(vi, 'Đang tắt', 'Off')}</span>}
        </div>
        {i.triggers.length > 0 && (
          <span style={{ fontSize: 13, color: 'var(--c94a3b8)', lineHeight: 1.5 }}>{i.kind === 'answer' ? L(vi, 'Khi khách hỏi: ', 'When asked: ') : L(vi, 'Khi khách nói về: ', 'When about: ')}<span style={{ color: 'var(--ccbd5e1)' }}>{i.triggers.map((t) => `“${t}”`).join(' · ')}</span></span>
        )}
        <span style={{ fontSize: 15.5, fontWeight: 700, lineHeight: 1.45, color: 'var(--ce2e8f0)', overflowWrap: 'anywhere' }}>{i.text}</span>
        {i.meaningNote ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '9px 12px', borderRadius: 10, background: 'var(--wash-blue)', fontSize: 13.5, lineHeight: 1.5, color: 'var(--ce2e8f0)' }}>
            <span aria-hidden style={{ color: 'var(--ink-link)', fontWeight: 800 }}>✦</span>
            <span><b style={{ color: 'var(--ink-link)' }}>{L(vi, 'AI hiểu là: ', 'The AI reads it as: ')}</b>{i.meaningNote}</span>
          </div>
        ) : !verbatim && i.on ? (
          <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>✦ {L(vi, 'AI đang đọc lời dặn này — mở “Sửa / Thử” để xem AI hiểu thế nào.', 'The AI is reading this one — open “Edit / Try” to see how it understood it.')}</span>
        ) : null}
        <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>
          {L(vi, `Đã làm theo ${i.usedCount} lần`, `Followed ${i.usedCount}×`)}
          {i.blockedCount ? <b style={{ color: 'var(--ink-warn)' }}>{L(vi, ` · chặn ${i.blockedCount} câu sai`, ` · stopped ${i.blockedCount} wrong`)}</b> : null}
          {' · '}{L(vi, src.vi, src.en)}{i.createdAt ? `, ${new Date(i.createdAt).toLocaleDateString(vi ? 'vi-VN' : 'en-US')}` : ''}
        </span>
      </div>
      {canEdit && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Switch on={i.on} disabled={busy} onChange={onToggle} label={L(vi, 'Bật lời dặn', 'Instruction on')} />
          <button type="button" onClick={onEdit} style={ghostBtn}>{L(vi, 'Sửa / Thử', 'Edit / Try')}</button>
          {confirming ? (
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button type="button" disabled={busy} onClick={onDelete} style={{ ...ghostBtn, borderColor: '#ef4444', color: 'var(--ink-bad)', fontWeight: 700 }}>{L(vi, 'Xoá hẳn', 'Delete')}</button>
              <button type="button" onClick={onCancelDelete} style={ghostBtn}>{L(vi, 'Không', 'No')}</button>
            </span>
          ) : (
            <button type="button" aria-label={L(vi, 'Xoá lời dặn', 'Delete instruction')} onClick={onAskDelete} style={{ ...ghostBtn, color: 'var(--ink-bad)' }}>{L(vi, 'Xoá', 'Delete')}</button>
          )}
        </div>
      )}
    </article>
  );
}
