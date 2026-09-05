'use client';

import { useState } from 'react';

/**
 * Writing the one line a shop will read, before it is sent.
 *
 * WHAT THIS REPLACES
 *
 * A `window.prompt` pre-filled with the trend's own title. What arrived at the
 * salon was the original creator's caption — "🎀👡👯✨ my clients whimsy
 * birthday set !" — an English caption full of emoji that told a nail shop in
 * Texas nothing about what to point a camera at. A one-line browser prompt
 * makes rewriting feel optional, and anything that feels optional at 9am is
 * skipped.
 *
 * So: a real sheet with the title on its own, a note, a look at the reference
 * being attached, and two starting points to write from. The staff member
 * cannot send without having read the sentence the shop will read.
 *
 * THE TICK BOX IS THE POINT
 *
 * One clip a person picked is a BRIEF and belongs with the instruction — an
 * instruction with no reference is a shop guessing at a style from a sentence.
 * The hashtag feed it came off is METHOD and never travels. Which side a given
 * reference falls on is a judgement about that card, so the person making it
 * decides, per card, with the thing itself on screen.
 */

export interface SuggestionDraft {
  title: string;
  note: string;
  refUrl?: string;
  refThumbUrl?: string;
  sourceUrl?: string;
  sourceLabel?: string;
}

export function SendSuggestion({
  vi, seedTitle, refUrl, refThumbUrl, sourceUrl, sourceLabel, busy, onSend, onClose,
}: {
  vi: boolean;
  /** The trend's own title, offered as raw material — never as the answer. */
  seedTitle: string;
  refUrl?: string | null;
  refThumbUrl?: string | null;
  sourceUrl?: string | null;
  sourceLabel?: string | null;
  busy?: boolean;
  onSend: (d: SuggestionDraft) => void;
  onClose: () => void;
}) {
  const T = (v: string, e: string) => (vi ? v : e);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [attach, setAttach] = useState(true);

  const templates = vi
    ? [
      'Quay 1 clip mẫu này — xoay tay dưới đèn, 15-20 giây',
      'Chụp 3 ảnh mẫu này: cận móng · góc từ trên · khách khoe tay',
      'Quay 1 clip quy trình làm mẫu này, tua nhanh',
    ]
    : [
      'Film one clip of this set — hand turning under the light, 15-20 seconds',
      'Photograph this set three ways: close-up · from above · in her hands',
      'Film the process for this set, sped up',
    ];

  const ok = title.trim().length > 3;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(2,6,23,.72)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 12,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--c1e293b)', border: '1px solid var(--c475569)', borderRadius: 16,
          padding: 16, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto',
          // Sits at the bottom on a phone (thumb reach) and centres itself on a
          // laptop, without measuring anything.
          marginBottom: 'auto', marginTop: 'auto',
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--cf1f5f9)', marginBottom: 3 }}>
          📨 {T('Gửi cho tiệm quay', 'Send to the shop')}
        </div>
        <div style={{ fontSize: 12, color: 'var(--c64748b)', lineHeight: 1.55, marginBottom: 12 }}>
          {T('Tiệm sẽ đọc đúng câu bạn viết ở đây. Viết như dặn việc, không dán caption gốc.',
             'The shop reads exactly what you type here. Write it as an instruction, not as the original caption.')}
        </div>

        {(refThumbUrl || refUrl) && (
          <div style={{
            display: 'flex', gap: 10, alignItems: 'center', padding: 9, marginBottom: 12,
            background: 'var(--c0f172a)', border: '1px solid var(--c334155)', borderRadius: 10,
          }}>
            {refThumbUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={refThumbUrl} alt="" style={{ width: 54, height: 54, objectFit: 'cover', borderRadius: 8, flex: '0 0 auto' }} />
            )}
            <div style={{ minWidth: 0, flex: 1 }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={attach}
                  onChange={(e) => setAttach(e.target.checked)}
                  style={{ width: 17, height: 17, accentColor: '#6366f1', marginTop: 1, flex: '0 0 auto' }}
                />
                <span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ce2e8f0)' }}>
                    {T('Gửi kèm mẫu này cho tiệm xem', 'Send this reference to the shop')}
                  </span>
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--c64748b)', lineHeight: 1.5, marginTop: 2 }}>
                    {T('Tiệm thấy đúng một clip này. Feed hashtag mình đang theo dõi thì không bao giờ gửi.',
                       'The shop sees this one clip. The hashtag feed it came off never travels.')}
                  </span>
                </span>
              </label>
            </div>
          </div>
        )}

        <label style={lab}>{T('Tiệm cần làm gì', 'What the shop should do')}</label>
        <input
          value={title}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
          placeholder={T('Ví dụ: Quay 1 clip mẫu móng mắt mèo, xoay tay dưới đèn', 'e.g. Film one clip of a cat-eye set, hand turning under the light')}
          style={inp}
        />

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0 12px' }}>
          {templates.map((t) => (
            <button key={t} onClick={() => setTitle(t)} style={chip}>{t}</button>
          ))}
        </div>

        <label style={lab}>{T('Ghi chú thêm (không bắt buộc)', 'Note (optional)')}</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder={T('Ví dụ: mẫu này khách hay hỏi, quay trước thứ 6 giúp em', 'e.g. customers keep asking for this — before Friday if you can')}
          style={{ ...inp, resize: 'vertical' }}
        />

        {seedTitle && (
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--c64748b)' }}>
              {T('Xem caption gốc của clip', 'Show the original caption')}
            </summary>
            <div style={{ fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.5, marginTop: 5, wordBreak: 'break-word' }}>
              {seedTitle}
            </div>
          </details>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button
            disabled={!ok || busy}
            onClick={() => onSend({
              title: title.trim(),
              note: note.trim(),
              ...(attach ? { refUrl: refUrl ?? undefined, refThumbUrl: refThumbUrl ?? undefined } : {}),
              // Always stored, never sent onward — the team's own note of where
              // this came from (see the API's client-view).
              sourceUrl: sourceUrl ?? undefined,
              sourceLabel: sourceLabel ?? undefined,
            })}
            style={{
              flex: 1, minHeight: 46, borderRadius: 11, border: 'none',
              background: ok && !busy ? '#22c55e' : 'var(--c334155)',
              color: ok && !busy ? '#052e16' : 'var(--c64748b)',
              fontSize: 14.5, fontWeight: 700, cursor: ok && !busy ? 'pointer' : 'not-allowed',
            }}
          >
            {busy ? T('Đang gửi…', 'Sending…') : T('Gửi cho tiệm', 'Send')}
          </button>
          <button onClick={onClose} style={{
            minHeight: 46, padding: '0 18px', borderRadius: 11, cursor: 'pointer',
            border: '1px solid var(--c475569)', background: 'transparent',
            color: 'var(--c94a3b8)', fontSize: 14, fontWeight: 600,
          }}>
            {T('Huỷ', 'Cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

const lab: React.CSSProperties = {
  display: 'block', fontSize: 12, color: 'var(--c94a3b8)', marginBottom: 5, fontWeight: 600,
};
const inp: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'var(--c0f172a)',
  border: '1px solid var(--c475569)', color: 'var(--ce2e8f0)',
  borderRadius: 9, padding: '11px 12px', fontSize: 14.5, fontFamily: 'inherit',
};
const chip: React.CSSProperties = {
  padding: '6px 10px', borderRadius: 20, cursor: 'pointer', fontSize: 11.5,
  border: '1px solid var(--c334155)', background: 'transparent',
  color: 'var(--c94a3b8)', textAlign: 'left', lineHeight: 1.4,
};
