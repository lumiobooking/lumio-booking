'use client';

/**
 * THE SALON'S OWN RULES FOR EVERY ASSISTANT — one box, read by all of them.
 *
 * "Ask gel or dip for a full set." "No kids under 8." "Kim only does
 * pedicures." The owner used to type a rule into the hotline's note, forget
 * the Messenger one, and the two assistants disagreed. This box is shared:
 * the hotline, Messenger, Instagram, the website chat and Zalo all read it,
 * ahead of their own channel-specific notes. Saved on blur, like the rest of
 * the AI settings; the server caps it at 4000 characters.
 */
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { ui } from '../lib/ui';
import { ind } from '../lib/ui-industry';

export function AiNotesBox({ token, vi }: { token: string | null; vi: boolean }) {
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const L = (v: string, e: string) => ind(vi ? v : e);

  useEffect(() => {
    if (!token) return;
    apiFetch<{ text: string }>('/settings/ai-notes', { token })
      .then((r) => { setText(r?.text ?? ''); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, [token]);

  async function save() {
    if (!token || !loaded) return;
    setState('saving');
    try { await apiFetch('/settings/ai-notes', { method: 'PATCH', token, body: { text } }); setState('saved'); window.setTimeout(() => setState('idle'), 1800); }
    catch { setState('error'); }
  }

  const examples = vi
    ? 'vd:\n- Khách nói "full set" thì hỏi gel hay dip.\n- Không nhận bé dưới 8 tuổi.\n- Kim chỉ làm pedicure.\n- Thứ 7 rất đông, gợi ý khách đặt trước 11 giờ.'
    : 'e.g.\n- "Full set" → ask gel or dip.\n- No children under 8.\n- Kim only does pedicures.\n- Saturdays are busy — suggest before 11 AM.';

  return (
    <div style={{ ...ui.card, borderColor: 'rgba(99,102,241,0.45)', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--cf1f5f9)' }}>🧠 {L('Ghi chú chung cho AI của tiệm', "Your salon's notes for every AI")}</div>
        <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: 'rgba(99,102,241,0.18)', color: 'var(--cc7d2fe)' }}>
          {L('Hotline · Messenger · Instagram · Web chat · Zalo', 'Hotline · Messenger · Instagram · Web chat · Zalo')}
        </span>
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--c94a3b8)', margin: '0 0 10px', lineHeight: 1.5 }}>
        {L('Đặc thù riêng của tiệm, viết như dặn một lễ tân mới. Mọi trợ lý AI đều đọc trước khi trả lời khách. Ghi chú riêng từng kênh ở bên dưới chỉ áp dụng cho kênh đó.',
          "What makes this salon different, written as you would brief a new receptionist. Every AI assistant reads it before replying. The per-channel notes below apply to that channel only.")}
      </p>
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value.slice(0, 4000)); setState('idle'); }}
        onBlur={save}
        placeholder={examples}
        rows={5}
        disabled={!loaded}
        style={{ ...ui.input, resize: 'vertical', lineHeight: 1.5 }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 6, fontSize: 12, color: 'var(--c94a3b8)' }}>
        <span>{text.length} / 4000</span>
        <span style={{ color: state === 'error' ? 'var(--ink-bad)' : state === 'saved' ? 'var(--ink-good)' : 'var(--c94a3b8)' }}>
          {state === 'saving' ? L('Đang lưu…', 'Saving…') : state === 'saved' ? L('Đã lưu', 'Saved') : state === 'error' ? L('Không lưu được', 'Could not save') : L('Tự lưu khi rời ô', 'Saves when you leave the box')}
        </span>
      </div>
    </div>
  );
}
