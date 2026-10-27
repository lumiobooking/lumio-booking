'use client';

/**
 * "Dạy AI câu này" — the owner corrects a reply the AI got wrong, and the
 * correction becomes an instruction every assistant of THIS salon must obey
 * (api ai-brain/instructions.ts). Opened from a bot reply in the Inbox, an AI
 * line in a hotline call, a conversation in the AI log, or the "Lời dặn" tab.
 * Mockup: artifact "AI — Chủ tiệm dạy AI".
 */
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api';
import { ui } from '../lib/ui';
import { useIsMobile } from '../lib/responsive';

export type InsKind = 'answer' | 'always' | 'never';
export type InsMode = 'meaning' | 'verbatim';
export type InsChannel = 'voice' | 'messenger' | 'instagram' | 'zalo' | 'web';
export const INS_CHANNELS: { id: InsChannel; vi: string; en: string }[] = [
  { id: 'messenger', vi: 'Messenger', en: 'Messenger' },
  { id: 'instagram', vi: 'Instagram', en: 'Instagram' },
  { id: 'zalo', vi: 'Zalo', en: 'Zalo' },
  { id: 'web', vi: 'Chat web', en: 'Web chat' },
  { id: 'voice', vi: 'Hotline', en: 'Hotline' },
];

export interface InstructionRow {
  id: string; kind: InsKind; text: string; triggers: string[]; mode: InsMode; channels: InsChannel[]; on: boolean;
  reason: string | null; sourceKind: string | null; sourceId: string | null; sourceQuestion: string | null; sourceReply: string | null;
  usedCount: number; blockedCount: number; lastUsedAt: string | null; createdBy: string | null; updatedBy: string | null; createdAt: string; updatedAt: string | null;
}

const REASONS: { id: string; vi: string; en: string }[] = [
  { id: 'wrong_info', vi: 'Sai thông tin', en: 'Wrong information' },
  { id: 'promised', vi: 'Hứa điều tiệm không có', en: 'Promised something we don’t offer' },
  { id: 'tone', vi: 'Giọng điệu chưa đúng', en: 'Wrong tone' },
  { id: 'handoff', vi: 'Lẽ ra phải chuyển nhân viên', en: 'Should have handed to staff' },
];

const L = (vi: boolean, v: string, e: string) => (vi ? v : e);

interface Props {
  token: string | null;
  vi: boolean;
  onClose: () => void;
  onSaved?: (row: InstructionRow) => void;
  /** The customer's words the AI answered (prefills the example questions). */
  question?: string;
  /** What the AI said. */
  reply?: string;
  /** The channel the reply was on; decides the try-out's channel. */
  channel?: InsChannel;
  source?: { kind: 'thread' | 'call' | 'session' | 'manual'; id: string | null };
  /** The conversation before the question, for a truer try-out. */
  context?: { role: 'user' | 'assistant'; content: string }[];
  /** Editing an existing instruction from the "Lời dặn" tab. */
  editing?: InstructionRow | null;
  /** Inbox: send the customer a correction (a normal staff message). */
  onSendCorrection?: (text: string) => Promise<void>;
  customerName?: string | null;
  /** Hotline: offer a "call this customer back" task. */
  callback?: { phone: string | null; name: string | null } | null;
}

export function TeachAiPanel(p: Props) {
  const { vi } = p;
  const mobile = useIsMobile();
  const ed = p.editing ?? null;
  const [reason, setReason] = useState<string | null>(ed?.reason ?? null);
  const [kind, setKind] = useState<InsKind>(ed?.kind ?? 'answer');
  const [text, setText] = useState(ed?.text ?? '');
  const [mode, setMode] = useState<InsMode>(ed?.mode ?? 'meaning');
  const firstQ = (p.question ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const [answerTrig, setAnswerTrig] = useState<string[]>(ed ? (ed.kind === 'answer' ? ed.triggers : []) : firstQ ? [firstQ] : []);
  const [ruleTrig, setRuleTrig] = useState<string[]>(ed && ed.kind !== 'answer' ? ed.triggers : []);
  const [newTrig, setNewTrig] = useState('');
  const [chans, setChans] = useState<Set<InsChannel>>(new Set(ed && ed.channels.length ? ed.channels : INS_CHANNELS.map((c) => c.id)));
  const [tryQ, setTryQ] = useState(firstQ || (ed?.triggers[0] ?? ''));
  const [trial, setTrial] = useState<{ busy: boolean; reply?: string; followed?: boolean; corrected?: boolean; error?: string } | null>(null);
  const [fix, setFix] = useState<{ on: boolean; text: string }>({ on: false, text: '' });
  const [cb, setCb] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const triggers = kind === 'answer' ? answerTrig : ruleTrig;
  const setTriggers = kind === 'answer' ? setAnswerTrig : setRuleTrig;
  const allCh = chans.size === INS_CHANNELS.length;
  const body = useMemo(() => ({
    kind, text: text.trim(), triggers, mode: kind === 'answer' ? mode : 'meaning',
    channels: allCh ? [] : [...chans], reason,
  }), [kind, text, triggers, mode, allCh, chans, reason]);
  const canSave = text.trim().length >= 3 && (kind !== 'answer' || triggers.length > 0) && chans.size > 0 && !busy && !done
    && (!fix.on || fix.text.trim().length > 0);

  const { onClose } = p;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const addTrig = () => {
    const t = newTrig.replace(/\s+/g, ' ').trim().slice(0, 200);
    if (t.length >= 2 && !triggers.some((x) => x.toLowerCase() === t.toLowerCase()) && triggers.length < 12) setTriggers([...triggers, t]);
    setNewTrig('');
  };
  const toggleCh = (c: InsChannel) => { const n = new Set(chans); if (n.has(c)) n.delete(c); else n.add(c); setChans(n); };

  async function runTry() {
    if (!p.token || !tryQ.trim() || text.trim().length < 3) return;
    setTrial({ busy: true });
    try {
      const r = await apiFetch<{ reply: string; followed: boolean; corrected: boolean }>('/ai-brain/instructions/try', {
        method: 'POST', token: p.token,
        body: { ...body, triggers: kind === 'answer' && !triggers.length ? [tryQ.trim().slice(0, 200)] : triggers, question: tryQ.trim(), channel: p.channel ?? 'messenger', context: p.context ?? [], editingId: ed?.id ?? null },
      });
      setTrial({ busy: false, reply: r.reply, followed: r.followed, corrected: r.corrected });
      if (p.onSendCorrection && !fix.text.trim() && r.reply) setFix((f) => ({ ...f, text: r.reply }));
    } catch (e) {
      setTrial({ busy: false, error: e instanceof Error ? e.message : L(vi, 'Không thử được', 'Could not try it') });
    }
  }

  async function save() {
    if (!p.token || !canSave) return;
    setBusy(true); setErr(null);
    try {
      const row = ed
        ? await apiFetch<InstructionRow>(`/ai-brain/instructions/${ed.id}`, { method: 'PATCH', token: p.token, body })
        : await apiFetch<InstructionRow>('/ai-brain/instructions', {
          method: 'POST', token: p.token,
          body: { ...body, sourceKind: p.source?.kind ?? 'manual', sourceId: p.source?.id ?? null, sourceQuestion: p.question ?? null, sourceReply: p.reply ?? null },
        });
      const after: string[] = [];
      if (fix.on && p.onSendCorrection) {
        try { await p.onSendCorrection(fix.text.trim()); } catch (e) { after.push(L(vi, `Chưa gửi được tin đính chính: ${e instanceof Error ? e.message : ''}`, `The correction was not sent: ${e instanceof Error ? e.message : ''}`)); }
      }
      if (cb && p.callback) {
        await apiFetch('/ai-brain/callbacks', { method: 'POST', token: p.token, body: { channel: 'voice', phone: p.callback.phone, name: p.callback.name, summary: L(vi, `Gọi lại báo đúng thông tin: ${text.trim()}`, `Call back with the right information: ${text.trim()}`) } })
          .catch(() => after.push(L(vi, 'Chưa tạo được việc gọi lại.', 'The callback task was not created.')));
      }
      setDone(true);
      p.onSaved?.(row);
      if (after.length) setErr(after.join(' '));
      else setTimeout(() => p.onClose(), 1100);
    } catch (e) {
      setErr(e instanceof Error ? e.message : L(vi, 'Không lưu được', 'Could not save'));
    } finally { setBusy(false); }
  }

  const sectionLabel = { fontSize: 12, fontWeight: 700, color: 'var(--c94a3b8)', letterSpacing: '.02em' } as const;
  const chip = (on: boolean) => ({
    minHeight: 34, padding: '0 11px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5,
    border: on ? '1px solid #4f46e5' : '1px solid var(--c475569)', background: on ? '#4f46e5' : 'transparent',
    color: on ? '#fff' : 'var(--ccbd5e1)', fontWeight: on ? 700 : 600,
  }) as const;
  const seg = (on: boolean, first: boolean) => ({
    minHeight: 42, border: 0, borderLeft: first ? 0 : '1px solid var(--c475569)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
    background: on ? '#4f46e5' : 'transparent', color: on ? '#fff' : 'var(--ccbd5e1)', fontWeight: on ? 700 : 600,
  }) as const;

  return (
    <div role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(2,6,23,.55)', display: 'flex', justifyContent: mobile ? 'stretch' : 'flex-end', alignItems: mobile ? 'flex-end' : 'stretch' }}>
      <aside role="dialog" aria-modal="true" aria-label={L(vi, 'Dạy AI câu này', 'Teach the AI')}
        style={{
          width: mobile ? '100%' : 460, maxWidth: '100%', maxHeight: mobile ? '92vh' : '100vh', boxSizing: 'border-box',
          background: 'var(--c1e293b)', borderLeft: mobile ? 0 : '1px solid #6366f1', borderTop: mobile ? '1px solid var(--c475569)' : 0,
          borderRadius: mobile ? '18px 18px 0 0' : 0, display: 'flex', flexDirection: 'column', color: 'var(--ce2e8f0)',
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--c334155)' }}>
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 16, fontWeight: 800 }}>{ed ? L(vi, 'Sửa lời dặn', 'Edit instruction') : L(vi, 'Dạy AI câu này', 'Teach the AI')}</span>
            <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{L(vi, 'Chỉ áp dụng cho tiệm của bạn · AI phải làm theo', 'Your salon only · the AI must follow it')}</span>
          </span>
          <button type="button" aria-label={L(vi, 'Đóng', 'Close')} onClick={p.onClose}
            style={{ width: 40, height: 40, borderRadius: 8, border: '1px solid var(--c475569)', background: 'transparent', color: 'var(--ccbd5e1)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', flex: 1 }}>
          {(p.question || p.reply) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {p.question && <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={sectionLabel}>{L(vi, 'KHÁCH HỎI', 'CUSTOMER ASKED')}</span><span style={{ fontSize: 13.5, lineHeight: 1.5 }}>“{p.question}”</span></div>}
              {p.reply && <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={sectionLabel}>{L(vi, 'AI ĐÃ TRẢ LỜI', 'THE AI SAID')}</span><span style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink-bad)', textDecoration: 'line-through' }}>“{p.reply}”</span></div>}
            </div>
          )}

          {!ed && p.reply && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ccbd5e1)' }}>{L(vi, 'Sai ở đâu?', 'What was wrong?')} <span style={{ fontWeight: 500, color: 'var(--c94a3b8)' }}>{L(vi, '(không bắt buộc)', '(optional)')}</span></span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {REASONS.map((r) => (
                  <button key={r.id} type="button" aria-pressed={reason === r.id} onClick={() => setReason(reason === r.id ? null : r.id)} style={chip(reason === r.id)}>{L(vi, r.vi, r.en)}</button>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ccbd5e1)' }}>{L(vi, 'Chủ tiệm dặn', 'Your instruction')}</span>
            <div role="radiogroup" aria-label={L(vi, 'Kiểu lời dặn', 'Kind')} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', border: '1px solid var(--c475569)', borderRadius: 10, overflow: 'hidden' }}>
              <button type="button" role="radio" aria-checked={kind === 'answer'} onClick={() => setKind('answer')} style={seg(kind === 'answer', true)}>{L(vi, 'Câu trả lời đúng', 'Right answer')}</button>
              <button type="button" role="radio" aria-checked={kind === 'always'} onClick={() => setKind('always')} style={seg(kind === 'always', false)}>{L(vi, 'Luôn làm…', 'Always…')}</button>
              <button type="button" role="radio" aria-checked={kind === 'never'} onClick={() => setKind('never')} style={seg(kind === 'never', false)}>{L(vi, 'Không bao giờ…', 'Never…')}</button>
            </div>
            <label htmlFor="teach-text" style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>
              {kind === 'answer' ? L(vi, 'Lần sau gặp câu hỏi này, AI phải trả lời:', 'Next time, the AI must answer:')
                : kind === 'always' ? L(vi, 'AI luôn phải:', 'The AI must always:')
                  : L(vi, 'AI không bao giờ được:', 'The AI must never:')}
            </label>
            <textarea id="teach-text" rows={4} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)}
              placeholder={kind === 'answer' ? L(vi, 'VD: Hiện tiệm không có giảm giá cho khách lần đầu…', 'e.g. We don’t have a first-visit discount right now…')
                : kind === 'always' ? L(vi, 'VD: Hỏi khách có đau lưng hay đang mang thai không trước khi đặt Deep Tissue', 'e.g. Ask about back pain or pregnancy before booking Deep Tissue')
                  : L(vi, 'VD: Hứa giảm giá không có trong bảng khuyến mãi', 'e.g. Promise a discount that is not on the promo list')}
              style={{ ...ui.input, minHeight: 96, lineHeight: 1.55, resize: 'vertical', fontFamily: 'inherit', borderColor: '#6366f1' }} />
            <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{L(vi, 'Bạn viết tiếng Việt — AI trả lời khách bằng tiếng của khách.', 'Write in your language — the AI answers in the customer’s.')}</span>
          </div>

          {kind === 'answer' && (
            <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <legend style={{ fontSize: 13, fontWeight: 700, color: 'var(--ccbd5e1)', marginBottom: 8 }}>{L(vi, 'AI dùng lời dặn thế nào', 'How the AI uses it')}</legend>
              {([['meaning', L(vi, 'Đúng ý này, AI tự nói cho tự nhiên', 'This meaning, in the AI’s own words'), L(vi, 'Giữ nguyên nội dung, không thêm bớt thông tin.', 'Keeps every fact; adds nothing.')],
                ['verbatim', L(vi, 'Nói đúng nguyên văn câu tôi viết', 'Say exactly what I wrote'), L(vi, 'Gửi đúng câu của bạn. Khách nói tiếng khác thì dịch sát nghĩa.', 'Your words, as written. Translated faithfully for other languages.')]] as const).map(([id, t, d]) => (
                <label key={id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 10, cursor: 'pointer', border: mode === id ? '2px solid #6366f1' : '1px solid var(--c475569)', background: mode === id ? 'rgba(99,102,241,.12)' : 'transparent' }}>
                  <input type="radio" name="teach-mode" checked={mode === id} onChange={() => setMode(id)} style={{ marginTop: 2, width: 17, height: 17, accentColor: '#6366f1', flexShrink: 0 }} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontSize: 13.5, fontWeight: 700 }}>{t}</span><span style={{ fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.45 }}>{d}</span></span>
                </label>
              ))}
            </fieldset>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ccbd5e1)' }}>
              {kind === 'answer' ? L(vi, 'Áp dụng khi khách hỏi những câu như', 'When the customer asks things like')
                : L(vi, 'Chỉ khi khách nói về… (để trống = lúc nào cũng áp dụng)', 'Only when the customer talks about… (empty = always)')}
            </span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {triggers.map((t) => (
                <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, background: 'var(--c334155)', borderRadius: 999, padding: '4px 4px 4px 10px', maxWidth: '100%' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t}</span>
                  <button type="button" aria-label={L(vi, `Bỏ “${t}”`, `Remove “${t}”`)} onClick={() => setTriggers(triggers.filter((x) => x !== t))}
                    style={{ width: 24, height: 24, borderRadius: 999, border: 0, background: 'transparent', color: 'var(--ccbd5e1)', cursor: 'pointer', fontSize: 14 }}>×</button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <label htmlFor="teach-trig" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{L(vi, 'Thêm câu khách hay hỏi', 'Add a question')}</label>
              <input id="teach-trig" value={newTrig} maxLength={200} onChange={(e) => setNewTrig(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTrig(); } }}
                placeholder={L(vi, 'Thêm câu khách hay hỏi…', 'Add another way customers ask…')} style={{ ...ui.input, flex: 1, minWidth: 0 }} />
              <button type="button" onClick={addTrig} disabled={newTrig.trim().length < 2}
                style={{ minHeight: 40, padding: '0 12px', borderRadius: 8, border: '1px solid #818cf8', background: 'transparent', color: 'var(--ink-link)', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: newTrig.trim().length < 2 ? 0.5 : 1 }}>+ {L(vi, 'Thêm', 'Add')}</button>
            </div>
            {kind === 'answer' && !triggers.length && <span style={{ fontSize: 12, color: 'var(--ink-bad)' }}>{L(vi, 'Thêm ít nhất một câu khách hỏi.', 'Add at least one question.')}</span>}
          </div>

          <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
            <legend style={{ fontSize: 13, fontWeight: 700, color: 'var(--ccbd5e1)', marginBottom: 8 }}>{L(vi, 'Kênh', 'Channels')}</legend>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13.5 }}>
              {INS_CHANNELS.map((c) => (
                <label key={c.id} style={{ display: 'flex', gap: 6, alignItems: 'center', minHeight: 32, cursor: 'pointer' }}>
                  <input type="checkbox" checked={chans.has(c.id)} onChange={() => toggleCh(c.id)} style={{ width: 17, height: 17, accentColor: '#6366f1' }} />{L(vi, c.vi, c.en)}
                </label>
              ))}
            </div>
            {!chans.size && <span style={{ fontSize: 12, color: 'var(--ink-bad)' }}>{L(vi, 'Chọn ít nhất một kênh.', 'Pick at least one channel.')}</span>}
          </fieldset>

          <div style={{ borderRadius: 10, background: 'var(--c0f172a)', border: '1px solid var(--c334155)', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={sectionLabel}>{L(vi, 'THỬ LẠI — AI SẼ TRẢ LỜI', 'TRY IT — THE AI WOULD SAY')}</span>
            {!firstQ && (
              <>
                <label htmlFor="teach-try" style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{L(vi, 'Câu khách hỏi để thử', 'A customer message to try')}</label>
                <input id="teach-try" value={tryQ} maxLength={500} onChange={(e) => setTryQ(e.target.value)} style={ui.input} />
              </>
            )}
            {trial?.busy && <span style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{L(vi, 'AI đang trả lời thử…', 'The AI is answering…')}</span>}
            {trial?.error && <span role="alert" style={{ fontSize: 13, color: 'var(--ink-bad)' }}>{trial.error}</span>}
            {trial?.reply && (
              <>
                <span style={{ fontSize: 12, fontWeight: 700, color: trial.followed ? 'var(--ink-good)' : 'var(--ink-bad)' }}>
                  {trial.followed ? (trial.corrected ? L(vi, '✓ Đúng lời dặn (AI đã tự sửa lại)', '✓ Follows it (the AI corrected itself)') : L(vi, '✓ Đúng lời dặn', '✓ Follows the instruction')) : L(vi, 'AI chưa làm đúng — hãy viết lời dặn rõ hơn', 'Not followed yet — make the instruction clearer')}
                </span>
                <span style={{ fontSize: 13.5, lineHeight: 1.55 }}>“{trial.reply}”</span>
              </>
            )}
            {!trial && <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{L(vi, 'Bấm “Thử lại” để xem AI trả lời câu này thế nào với lời dặn mới. Không gửi gì cho khách.', 'Press “Try” to see how the AI answers with this instruction. Nothing is sent.')}</span>}
          </div>

          {p.onSendCorrection && !ed && (
            <div style={{ borderRadius: 10, border: '1px solid var(--c334155)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>
                <input type="checkbox" checked={fix.on} onChange={(e) => setFix({ ...fix, on: e.target.checked })} style={{ marginTop: 2, width: 17, height: 17, accentColor: '#6366f1', flexShrink: 0 }} />
                {L(vi, `Nhắn đính chính cho ${p.customerName || 'khách'}`, `Send ${p.customerName || 'the customer'} a correction`)}
              </label>
              {fix.on && (
                <>
                  <label htmlFor="teach-fix" style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{L(vi, 'Tin nhắn gửi khách (bằng tiếng của khách):', 'Message to the customer (in their language):')}</label>
                  <textarea id="teach-fix" rows={3} maxLength={1000} value={fix.text} onChange={(e) => setFix({ ...fix, text: e.target.value })}
                    placeholder={L(vi, 'Bấm “Thử lại” để có sẵn câu trả lời đúng, hoặc tự viết.', 'Press “Try” to fill in the right answer, or write it.')}
                    style={{ ...ui.input, lineHeight: 1.5, resize: 'vertical', fontFamily: 'inherit' }} />
                  <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{L(vi, 'Chỉ gửi khi bạn bấm Lưu.', 'Sent only when you press Save.')}</span>
                </>
              )}
            </div>
          )}

          {p.callback && !ed && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', borderRadius: 10, border: '1px solid var(--c334155)', padding: '10px 12px' }}>
              <input type="checkbox" checked={cb} onChange={(e) => setCb(e.target.checked)} style={{ marginTop: 2, width: 17, height: 17, accentColor: '#6366f1', flexShrink: 0 }} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span>{L(vi, `Tạo việc gọi lại cho ${p.callback.name || p.callback.phone || 'khách'}`, `Create a callback task for ${p.callback.name || p.callback.phone || 'the caller'}`)}</span>
                <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--c94a3b8)' }}>{L(vi, 'Quầy nhận việc kèm thông tin đúng để báo khách.', 'The desk gets the task with the right information.')}</span>
              </span>
            </label>
          )}

          {err && <div role="alert" style={{ fontSize: 13, color: 'var(--ink-bad)', lineHeight: 1.5 }}>{err}</div>}
          {done && <div role="status" style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink-good)' }}>{L(vi, '✓ Đã lưu — AI áp dụng ngay từ tin nhắn / cuộc gọi tiếp theo.', '✓ Saved — the AI uses it from the next message or call.')}</div>}
        </div>

        <div style={{ borderTop: '1px solid var(--c334155)', padding: '12px 16px', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => void runTry()} disabled={!!trial?.busy || text.trim().length < 3 || !tryQ.trim()}
            style={{ flex: '1 1 120px', minHeight: 44, borderRadius: 8, border: '1px solid var(--c475569)', background: 'transparent', color: 'var(--ce2e8f0)', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', opacity: trial?.busy || text.trim().length < 3 || !tryQ.trim() ? 0.55 : 1 }}>
            {L(vi, 'Thử lại', 'Try')}
          </button>
          <button type="button" onClick={() => void save()} disabled={!canSave}
            style={{ ...ui.primaryBtn, flex: '2 1 200px', minHeight: 44, fontSize: 14, fontWeight: 700, background: '#4f46e5', opacity: canSave ? 1 : 0.55 }}>
            {busy ? L(vi, 'Đang lưu…', 'Saving…') : ed ? L(vi, 'Lưu thay đổi', 'Save changes') : L(vi, 'Lưu lời dặn — áp dụng ngay', 'Save — use it now')}
          </button>
        </div>
      </aside>
    </div>
  );
}

/** Who may teach the AI: the owner, a manager, Lumio support. Others just don't see the button. */
export function canTeachAi(user: { role?: string | null; staffRole?: string | null } | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'SALON_ADMIN' || user.role === 'SUPER_ADMIN') return true;
  return user.role === 'STAFF' && user.staffRole === 'MANAGER';
}
