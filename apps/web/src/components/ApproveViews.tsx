'use client';

import type { CSSProperties } from 'react';
import { ind } from '../lib/ui-industry';
import { PostThumb, type ReviewPost } from './PostReview';

/**
 * THE PIECES THE APPROVAL SCREEN IS DRAWN WITH.
 *
 * One status word, always in the same pill. The month, the photo grid, the
 * list, the round-done summary and the legend all say "where does this post
 * stand" — before this file each of them said it in its own colour and its
 * own words, and an owner had to learn four vocabularies for one idea.
 *
 * The pills are themed (light by day, dark at night) except the one that asks
 * for something: "waiting for you" is a solid purple button-coloured pill in
 * both themes, because it is the only state that needs her finger.
 */

export type Tone = 'wait' | 'fix' | 'done' | 'sched' | 'plan' | 'held';

const PILL_BASE: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', flexShrink: 0,
  fontSize: 11, fontWeight: 800, lineHeight: 1, padding: '4px 8px', borderRadius: 999,
};
const PILL: Record<Tone, CSSProperties> = {
  wait: { ...PILL_BASE, background: '#7c3aed', color: '#fff' },
  fix: { ...PILL_BASE, background: '#7c3aed', color: '#fff' },
  held: { ...PILL_BASE, background: 'var(--c451a03)', color: 'var(--cfcd34d)' },
  sched: { ...PILL_BASE, background: 'var(--c172554)', color: 'var(--ink-sky)' },
  done: { ...PILL_BASE, background: 'var(--c14532d)', color: 'var(--c86efac)' },
  plan: { ...PILL_BASE, background: 'var(--c334155)', color: 'var(--ccbd5e1)' },
};

/** The pill's word for a tone, short enough for a calendar cell. */
export function pillWord(tone: Tone, vi: boolean): string {
  const T = (v: string, e: string) => ind(vi ? v : e);
  switch (tone) {
    case 'wait': return `● ${T('Chờ chị duyệt', 'Needs your OK')}`;
    case 'fix': return `🔄 ${T('Đã sửa · xem lại', 'Revised · look again')}`;
    case 'held': return T('Đang sửa', 'Being revised');
    case 'sched': return T('Đã duyệt', 'Approved');
    case 'done': return `✓ ${T('Đã đăng', 'Posted')}`;
    default: return T('Lumio đang làm', 'Lumio is on it');
  }
}

export function StatusPill({ tone, vi, text }: { tone: Tone; vi: boolean; text?: string }) {
  return <span style={PILL[tone]}>{text ?? pillWord(tone, vi)}</span>;
}

/** Which filter chip a tone answers to: "waiting" covers the revised ones too — both want her yes. */
export type Filter = 'all' | 'wait' | 'sched' | 'done' | 'fix';
export const filterOf = (t: Tone): Filter | 'plan' => (t === 'wait' || t === 'fix' ? 'wait' : t === 'held' ? 'fix' : t);

/** One row of the summary at the end of a round. */
export interface RoundRow {
  id: string;
  media: ReviewPost['media'];
  title: string;
  when: string;
  result: 'approved' | 'fixed' | null;
  tag?: string;
}

/**
 * THE END OF A ROUND.
 *
 * She went through the waiting posts one by one; the last tap lands here, not
 * back on a month that looks exactly as it did. What she approved and when it
 * goes out, what she sent back and what she asked for, and the one thing still
 * on her side — so "done" is something she can see, not something she infers.
 */
export function RoundDone({ vi, mobile, rows, todo, onSend, onClose }: {
  vi: boolean;
  mobile: boolean;
  rows: RoundRow[];
  /** The first thing the shop still has to shoot, if anything. */
  todo: string | null;
  onSend: () => void;
  onClose: () => void;
}) {
  const T = (v: string, e: string) => ind(vi ? v : e);
  const ok = rows.filter((r) => r.result === 'approved').length;
  const fixed = rows.filter((r) => r.result === 'fixed').length;
  const open = rows.length - ok - fixed;
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 219, background: 'rgba(2,6,23,.55)' }} />
      <div role="dialog" aria-modal="true" style={{
        position: 'fixed', zIndex: 220,
        ...(mobile
          ? { left: 0, right: 0, bottom: 0, maxHeight: '92vh', borderRadius: '20px 20px 0 0', padding: '22px 16px calc(16px + env(safe-area-inset-bottom, 0px))' }
          : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 'min(520px, calc(100vw - 32px))', maxHeight: '88vh', borderRadius: 20, padding: 24 }),
        background: 'var(--c0f172a)', border: '1px solid var(--c334155)', boxShadow: '0 30px 80px rgba(0,0,0,.5)',
        display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textAlign: 'center' }}>
          <span style={{ width: 64, height: 64, borderRadius: 999, background: 'var(--c14532d)', color: 'var(--c86efac)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, fontWeight: 800 }}>✓</span>
          <div style={{ fontSize: 21, fontWeight: 800, color: 'var(--ce2e8f0)' }}>
            {open === 0 ? T('Xong rồi chị ơi!', 'All done!') : T(`Xong ${ok + fixed}/${rows.length} bài`, `${ok + fixed} of ${rows.length} done`)}
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--c94a3b8)' }}>
            {[
              ok ? T(`${ok} bài đã duyệt`, `${ok} approved`) : '',
              fixed ? T(`${fixed} bài gửi Lumio sửa`, `${fixed} sent back to Lumio`) : '',
              open ? T(`${open} bài chưa duyệt`, `${open} still waiting`) : '',
            ].filter(Boolean).join(' · ')}
          </div>
        </div>

        <div style={{ background: 'var(--c1e293b)', border: '1px solid var(--c334155)', borderRadius: 16, padding: '4px 12px' }}>
          {rows.map((r, i) => (
            <div key={r.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 0', borderTop: i ? '1px solid var(--c334155)' : 'none' }}>
              <PostThumb media={r.media} w={44} h={44} radius={10} vi={vi} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, lineHeight: 1.35 }}>
                <b style={{ display: 'block', color: 'var(--ce2e8f0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title || T('(bài chỉ có ảnh)', '(media only)')}</b>
                {r.result === 'fixed'
                  ? <span style={{ color: 'var(--ink-warn)', fontWeight: 700 }}>{T('Góp ý', 'Note')}: {r.tag}</span>
                  : <span style={{ color: r.result === 'approved' ? 'var(--ink-sky)' : 'var(--c94a3b8)', fontWeight: 700 }}>{T('Đăng', 'Goes out')} {r.when}</span>}
              </span>
              <StatusPill tone={r.result === 'approved' ? 'sched' : r.result === 'fixed' ? 'held' : 'wait'} vi={vi} text={r.result ? undefined : T('Chưa duyệt', 'Not yet')} />
            </div>
          ))}
        </div>

        {todo && (
          <div style={{ background: 'var(--c1e293b)', border: '1px solid #f59e0b', borderRadius: 16, padding: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, lineHeight: 1.4 }}>
              <b style={{ display: 'block', color: 'var(--ce2e8f0)' }}>{T('Còn 1 việc của tiệm', 'One thing left for you')}</b>
              <span style={{ color: 'var(--c94a3b8)' }}>{todo}</span>
            </span>
            <button onClick={onSend} style={{ flexShrink: 0, minHeight: 44, padding: '0 14px', borderRadius: 12, border: 'none', background: '#c2410c', color: '#fff', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>📷 {T('Gửi ảnh/clip', 'Send')}</button>
          </div>
        )}

        <button onClick={onClose} style={{ minHeight: 52, borderRadius: 14, border: 'none', background: '#4f46e5', color: '#fff', fontFamily: 'inherit', fontSize: 15, fontWeight: 800, cursor: 'pointer' }}>
          {T('Xem lịch đăng tháng này', 'Back to the month')}
        </button>
        <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--c64748b)' }}>{T('Có bài mới, Lumio sẽ báo chị qua thông báo.', 'When there is a new post, Lumio will notify you.')}</div>
      </div>
    </>
  );
}
