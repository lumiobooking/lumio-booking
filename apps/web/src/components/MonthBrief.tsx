'use client';

import { useEffect, useState } from 'react';

/**
 * THE MONTH, IN THE OWNER'S WORDS.
 *
 * Two faces of one thing. The team's face is a short form above the 30-day
 * grid: what this month is for, what done looks like, what the posts will be
 * about, and what the shop must supply. The shop's face is the same four
 * parts, read-only, at the top of the shop's own screen and phone — large
 * type, one idea per block, the checklist last because it is the only part
 * the owner acts on.
 *
 * No numbers, no method, no vocabulary. An owner who reads this on a phone
 * between two customers should know in ten seconds what the month is about
 * and what is being asked of them.
 */

export interface MonthBriefData {
  month: string;
  focus: string;
  goals: string;
  direction: string;
  needs: string[];
  updatedAt: string | null;
}

const MONTH_VI = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'];
const MONTH_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function monthLabel(key: string, vi: boolean): string {
  const [y, m] = key.split('-').map(Number);
  return `${vi ? MONTH_VI[m - 1] : MONTH_EN[m - 1]} ${y}`;
}

const PARTS: { k: 'focus' | 'goals' | 'direction'; icon: string; vi: string; en: string; hintVi: string; hintEn: string; rows: number }[] = [
  { k: 'focus', icon: '🎯', vi: 'Trọng tâm tháng này', en: 'This month’s focus', hintVi: 'Một vấn đề duy nhất tháng này giải quyết. Ví dụ: "Tiệm ít review trên Google nên khách mới không dám đặt."', hintEn: 'The one problem this month works on.', rows: 2 },
  { k: 'goals', icon: '🏁', vi: 'Mục tiêu', en: 'Goals', hintVi: 'Cuối tháng đạt được gì thì gọi là xong. Ví dụ: "Thêm 20 review 5 sao, lấp khung chiều thứ Tư."', hintEn: 'What "it worked" looks like by month end.', rows: 3 },
  { k: 'direction', icon: '🧭', vi: 'Định hướng nội dung', en: 'Content direction', hintVi: 'Bài đăng tháng này xoay quanh gì. Ví dụ: "Hậu trường thợ làm, khách quay lại, ưu đãi khung vắng."', hintEn: 'What the posts will be about.', rows: 3 },
];

/* ---------------------------------------------------------------- shop */

export function MonthBriefView({ brief, vi, salonName }: { brief: MonthBriefData; vi: boolean; salonName?: string | null }) {
  const T = (a: string, b: string) => (vi ? a : b);
  const parts = PARTS.filter((p) => brief[p.k]);
  return (
    <div style={{ borderRadius: 14, border: '1px solid #6366f1', background: 'linear-gradient(160deg, rgba(99,102,241,.16), rgba(99,102,241,.04))', padding: '16px 16px 14px', marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: .7, textTransform: 'uppercase', color: 'var(--ink-link)' }}>
        {T('Kế hoạch', 'Plan')} · {monthLabel(brief.month, vi)}
      </div>
      {salonName && <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 2 }}>{salonName}</div>}
      <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
        {parts.map((p) => (
          <div key={p.k}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--c94a3b8)', letterSpacing: .3, marginBottom: 3 }}>{p.icon} {vi ? p.vi : p.en}</div>
            <div style={{ fontSize: p.k === 'focus' ? 17 : 14.5, fontWeight: p.k === 'focus' ? 800 : 500, color: 'var(--cf1f5f9)', lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{brief[p.k]}</div>
          </div>
        ))}
        {brief.needs.length > 0 && (
          <div style={{ marginTop: 2, padding: '11px 12px', borderRadius: 10, background: 'var(--wash-amber)', border: '1px solid var(--line-strong)' }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--ink-warn)', letterSpacing: .3, marginBottom: 6 }}>🤝 {T('Tiệm cần hỗ trợ / cung cấp', 'What we need from you')}</div>
            <div style={{ display: 'grid', gap: 6 }}>
              {brief.needs.map((n, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14, color: 'var(--ce2e8f0)', lineHeight: 1.45 }}>
                  <span style={{ flex: '0 0 auto', width: 20, height: 20, borderRadius: 6, border: '1.5px solid var(--ink-warn)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: 'var(--ink-warn)', marginTop: 1 }}>{i + 1}</span>
                  <span>{n}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- team */

export function MonthBriefEditor({
  brief, months, vi, canEdit, busy, onPickMonth, onSave,
}: {
  brief: MonthBriefData;
  /** Which months may be written: this one and the next. */
  months: string[];
  vi: boolean;
  canEdit: boolean;
  busy?: boolean;
  onPickMonth: (month: string) => void;
  onSave: (draft: { month: string; focus: string; goals: string; direction: string; needs: string[] }) => Promise<void>;
}) {
  const T = (a: string, b: string) => (vi ? a : b);
  const [draft, setDraft] = useState({ focus: brief.focus, goals: brief.goals, direction: brief.direction, needsText: brief.needs.join('\n') });
  const [open, setOpen] = useState(!brief.focus);
  useEffect(() => {
    setDraft({ focus: brief.focus, goals: brief.goals, direction: brief.direction, needsText: brief.needs.join('\n') });
    setOpen(!brief.focus);
  }, [brief.month, brief.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = draft.focus !== brief.focus || draft.goals !== brief.goals || draft.direction !== brief.direction || draft.needsText !== brief.needs.join('\n');
  const filled = Boolean(brief.focus && brief.goals && brief.needs.length);

  const field = { width: '100%', boxSizing: 'border-box' as const, padding: '9px 11px', borderRadius: 9, fontSize: 13.5, fontFamily: 'inherit', lineHeight: 1.5, background: 'var(--c0f172a)', color: 'var(--cf1f5f9)', border: '1px solid var(--c334155)', resize: 'vertical' as const };

  return (
    <div style={{ borderRadius: 14, border: `1px solid ${filled ? 'var(--c334155)' : '#f59e0b'}`, background: 'var(--c0f172a)', padding: '12px 14px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: .7, textTransform: 'uppercase', color: filled ? 'var(--ink-link)' : 'var(--ink-warn)' }}>
          {T('Kế hoạch tháng', 'Month plan')}{!filled && ` · ${T('chưa viết — tiệm chưa thấy gì', 'not written — the shop sees nothing')}`}
        </div>
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          {months.map((m) => (
            <button key={m} type="button" onClick={() => onPickMonth(m)} style={{ padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', border: `1px solid ${m === brief.month ? '#6366f1' : 'var(--c334155)'}`, background: m === brief.month ? 'rgba(99,102,241,.16)' : 'transparent', color: m === brief.month ? 'var(--ink-link)' : 'var(--c94a3b8)' }}>
              {monthLabel(m, vi)}
            </button>
          ))}
          <button type="button" onClick={() => setOpen((o) => !o)} style={{ padding: '4px 10px', borderRadius: 999, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer', border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--c94a3b8)' }}>
            {open ? T('Thu gọn', 'Collapse') : T('Sửa', 'Edit')}
          </button>
        </div>
      </div>

      {!open ? (
        <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
          <div style={{ fontSize: 15.5, fontWeight: 800, color: 'var(--cf1f5f9)', lineHeight: 1.4 }}>{brief.focus || T('(chưa có trọng tâm)', '(no focus yet)')}</div>
          {brief.goals && <div style={{ fontSize: 13, color: 'var(--ccbd5e1)', lineHeight: 1.5 }}>🏁 {brief.goals}</div>}
          {brief.needs.length > 0 && <div style={{ fontSize: 12.5, color: 'var(--ink-warn)' }}>🤝 {T('Tiệm cần cung cấp', 'Shop supplies')}: {brief.needs.join(' · ')}</div>}
        </div>
      ) : (
        <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
          <div style={{ fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.5 }}>
            {T('Viết cho chủ tiệm đọc, bằng lời thường. Bốn phần này hiện nguyên văn ở đầu màn hình của tiệm và trên điện thoại họ.', 'Written for the owner, in plain words. These four parts appear verbatim at the top of the shop’s screen and phone.')}
          </div>
          {PARTS.map((p) => (
            <label key={p.k} style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--ccbd5e1)' }}>{p.icon} {vi ? p.vi : p.en}</span>
              <textarea id={`brief-${p.k}`} rows={p.rows} value={draft[p.k]} disabled={!canEdit} placeholder={vi ? p.hintVi : p.hintEn} onChange={(e) => setDraft({ ...draft, [p.k]: e.target.value })} style={field} />
            </label>
          ))}
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--ink-warn)' }}>🤝 {T('Tiệm cần hỗ trợ / cung cấp', 'What the shop must supply')} <span style={{ fontWeight: 500, color: 'var(--c94a3b8)' }}>· {T('mỗi dòng một việc', 'one per line')}</span></span>
            <textarea id="brief-needs" rows={4} value={draft.needsText} disabled={!canEdit} placeholder={T('Gửi 3 clip quay tay mỗi tuần\nChụp 5 ảnh mặt tiền, quầy, ghế\nIn mã QR review dán quầy', 'Send 3 phone clips a week\nPhotograph the front, counter, chairs\nPrint the review QR for the counter')} onChange={(e) => setDraft({ ...draft, needsText: e.target.value })} style={field} />
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {canEdit && (
              <button
                type="button"
                disabled={!dirty || busy}
                onClick={() => onSave({ month: brief.month, focus: draft.focus, goals: draft.goals, direction: draft.direction, needs: draft.needsText.split('\n').map((s) => s.trim()).filter(Boolean) })}
                style={{ minHeight: 38, padding: '0 16px', borderRadius: 9, border: 'none', background: dirty ? '#6366f1' : 'var(--c334155)', color: dirty ? '#fff' : 'var(--c94a3b8)', fontWeight: 700, fontSize: 13, cursor: dirty ? 'pointer' : 'default', fontFamily: 'inherit' }}
              >
                {busy ? T('Đang lưu…', 'Saving…') : T('Lưu · tiệm thấy ngay', 'Save · shop sees it now')}
              </button>
            )}
            {brief.updatedAt && <span style={{ fontSize: 11.5, color: 'var(--c64748b)' }}>{T('Cập nhật', 'Updated')} {new Date(brief.updatedAt).toLocaleDateString(vi ? 'vi-VN' : 'en-US')}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
