'use client';

import { useMemo, useState } from 'react';
import type { Job } from './WeekPlanBoard';
import { dayKeyInTz } from '../lib/datetime';
import { layoutGrid, KIND_ICON, WD_VI, WD_EN, MONTH_VI, MONTH_EN, mondayIndex, daysBetween, type AheadBlock } from './plan-grid';

/**
 * WHAT THE SYSTEM SUGGESTS FOR THE NEXT THIRTY DAYS — as ideas, not orders.
 *
 * The generated plan used to BE the plan: it sat on the calendar and the
 * team worked around it. The agency's decision is that the calendar is the
 * team's, filled by hand, and the generator's output is raw material — read
 * next to the trends, picked from, and turned into a scheduled post with one
 * tap.
 *
 * LAID OUT AS A LIST, NOT AS CARDS
 *
 * The first version drew one card per day in a grid: twenty-odd boxes of
 * different heights, each with its own header, chips and button. A person
 * called it "quá rối" and was right — twenty cards is twenty places for the
 * eye to start. A list has one place: the top. One row per idea, the date in
 * a narrow left column so it reads like a diary, a week heading so a month
 * has shape, and one button per row. The first two weeks open; the rest fold.
 */

const KIND_LABEL: Record<string, { vi: string; en: string }> = {
  film: { vi: 'Quay clip', en: 'Film' }, photo: { vi: 'Chụp ảnh', en: 'Photos' }, post: { vi: 'Bài đăng', en: 'Post' },
  story: { vi: 'Story', en: 'Story' }, offer: { vi: 'Ưu đãi', en: 'Offer' }, winback: { vi: 'Kéo khách cũ', en: 'Win back' },
  engage: { vi: 'Tương tác', en: 'Engage' }, gbp: { vi: 'Google Maps', en: 'Google profile' }, event: { vi: 'Sự kiện', en: 'Event' },
};

export function PlanIdeas({
  blocks, tz, vi, onPlan, onOpenSheet,
}: {
  blocks: AheadBlock[];
  tz: string;
  vi: boolean;
  /** Put the idea on the plan for that day — edited there, scheduled from there. */
  onPlan: (job: Job, dayKey: string) => void;
  onOpenSheet?: () => void;
}) {
  const T = (a: string, b: string) => (vi ? a : b);
  const todayKey = dayKeyInTz(new Date(), tz);
  const days = useMemo(() => layoutGrid(blocks, [], todayKey, tz).filter((d) => d.inWindow && d.jobs.length > 0), [blocks, todayKey, tz]);
  const [kind, setKind] = useState<string>('all');
  const [all, setAll] = useState(false);
  /**
   * The day a row will actually land on, when a person has chosen one.
   *
   * The generator picks the day from the shop's quiet hours, and that guess is
   * right often enough to keep as the one-tap default — the point of this
   * screen is triaging twenty ideas quickly, and asking for a date on every
   * one of them would cost more than it saves. But the guess is only a guess:
   * the team knows the shop is closed that Tuesday, or wants the offer out two
   * days sooner. So the date is a chip under the button, and touching it is
   * the only thing that overrides the default.
   */
  const [dayFor, setDayFor] = useState<Record<string, string>>({});
  const [picking, setPicking] = useState<string | null>(null);
  const kinds = useMemo(() => Array.from(new Set(days.flatMap((d) => d.jobs.map((j) => j.job.kind)))), [days]);
  const rows = days
    .map((d) => ({ ...d, jobs: d.jobs.filter((j) => kind === 'all' || j.job.kind === kind) }))
    .filter((d) => d.jobs.length);
  const total = days.reduce((n, d) => n + d.jobs.length, 0);
  const todo = days.reduce((n, d) => n + d.jobs.filter((j) => !j.done && j.who !== 'salon').length, 0);

  // Weeks, counted from today: 0 = this week (the next 7 days), 1 = the next…
  const weekOf = (key: string) => Math.floor(daysBetween(todayKey, key) / 7);
  const weeks = Array.from(new Set(rows.map((d) => weekOf(d.key)))).sort((a, b) => a - b);
  const visibleWeeks = all ? weeks : weeks.slice(0, 2);
  const hidden = rows.filter((d) => !visibleWeeks.includes(weekOf(d.key))).reduce((n, d) => n + d.jobs.length, 0);

  /** "T4 16/9" — for the chip that shows where an idea is about to land. */
  const shortDay = (key: string) => {
    const [, m, d] = key.split('-').map(Number);
    return `${(vi ? WD_VI : WD_EN)[mondayIndex(key)]} ${d}/${m}`;
  };
  const dayLabel = (key: string) => {
    const [, m, d] = key.split('-').map(Number);
    return { wd: (vi ? WD_VI : WD_EN)[mondayIndex(key)], d: String(d), m: vi ? MONTH_VI[m - 1] : MONTH_EN[m - 1] };
  };
  const weekTitle = (w: number) => (w === 0 ? T('7 ngày tới', 'Next 7 days') : w === 1 ? T('Tuần sau', 'Next week') : T(`${w + 1} tuần nữa`, `${w + 1} weeks out`));

  return (
    <div>
      {/* One line of context, one row of controls. Nothing else above the list. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--cf1f5f9)' }}>💡 {T('Gợi ý theo ngày', 'Suggested by day')}</div>
          <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginTop: 2 }}>
            {T(`${todo} gợi ý có thể đưa vào Plan · ngày lấy từ giờ vắng của tiệm · sửa lại trên Plan rồi mới lên lịch`, `${todo} ideas to put on the plan · days from the shop’s quiet hours · edit on the plan, schedule from there`)}
          </div>
        </div>
        {onOpenSheet && (
          <button type="button" onClick={onOpenSheet} style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--ink-link)', background: 'none', border: '1px solid var(--c334155)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
            📋 {T('Phiếu việc tuần', 'Weekly sheet')}
          </button>
        )}
      </div>

      {kinds.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {['all', ...kinds].map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} style={{ padding: '4px 11px', borderRadius: 999, fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', border: `1px solid ${kind === k ? '#6366f1' : 'var(--c334155)'}`, background: kind === k ? 'rgba(99,102,241,.16)' : 'transparent', color: kind === k ? 'var(--ink-link)' : 'var(--c94a3b8)' }}>
              {k === 'all' ? `${T('Tất cả', 'All')} · ${total}` : `${KIND_ICON[k] ?? ''} ${vi ? KIND_LABEL[k]?.vi ?? k : KIND_LABEL[k]?.en ?? k}`}
            </button>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--c94a3b8)', padding: '10px 0' }}>{T('Chưa có gợi ý nào — hệ thống cần vài tuần lịch hẹn để biết tiệm vắng ngày nào.', 'No suggestions yet — the system needs a few weeks of bookings to know the quiet days.')}</div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {visibleWeeks.map((w) => (
            <div key={w}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: .6, textTransform: 'uppercase', color: 'var(--c64748b)', padding: '0 0 6px 2px', borderBottom: '1px solid var(--line)', marginBottom: 4 }}>
                {weekTitle(w)}
              </div>
              {rows.filter((d) => weekOf(d.key) === w).map((d) => {
                const L = dayLabel(d.key);
                return d.jobs.map((j, i) => (
                  <div
                    key={`${d.key}-${i}`}
                    style={{
                      display: 'grid', gridTemplateColumns: '52px 1fr auto', gap: 10, alignItems: 'center',
                      padding: '9px 6px', borderBottom: '1px solid var(--line)',
                      background: d.today && i === 0 ? 'rgba(99,102,241,.06)' : 'transparent', borderRadius: 8,
                    }}
                  >
                    {/* the date, once per day — blank on the second job of a day so the eye groups them */}
                    <div style={{ textAlign: 'center', lineHeight: 1.05, visibility: i === 0 ? 'visible' : 'hidden' }}>
                      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: .4, color: d.today ? 'var(--ink-link)' : 'var(--c94a3b8)' }}>{L.wd}</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: d.today ? 'var(--ink-link)' : 'var(--cf1f5f9)', fontVariantNumeric: 'tabular-nums' }}>{L.d}</div>
                      <div style={{ fontSize: 10, color: 'var(--c64748b)' }}>{L.m}</div>
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: j.done ? 'var(--ink-faint)' : 'var(--cf1f5f9)', lineHeight: 1.4, textDecoration: j.done ? 'line-through' : 'none' }}>
                          {j.done ? '✅ ' : `${KIND_ICON[j.job.kind] ?? '•'} `}{j.job.text}
                        </span>
                        {j.who === 'salon' && <span style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--ink-warn)' }}>{T('tiệm làm', 'shop does')}</span>}
                      </div>
                      {(j.job.why || j.job.when) && (
                        <div style={{ fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.45, marginTop: 2, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                          {j.job.when ? `⏰ ${j.job.when} · ` : ''}{j.job.why}
                        </div>
                      )}
                    </div>
                    <div>
                      {!j.done && j.who !== 'salon' ? (() => {
                        const rowId = `${d.key}-${i}`;
                        const target = dayFor[rowId] ?? d.key;   // the guess, until someone changes it
                        return (
                          <div style={{ display: 'grid', gap: 4, justifyItems: 'stretch' }}>
                            <button
                              type="button"
                              onClick={() => onPlan(j.job, target)}
                              title={T(`Đưa ý này vào Plan ngày ${shortDay(target)} — sửa lại trên Plan, xong mới lên lịch đăng`, `Put this on the plan for ${shortDay(target)} — edit it there, schedule from there`)}
                              style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #6366f1', background: 'rgba(99,102,241,.14)', color: 'var(--ink-link)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                            >
                              {T('→ Đưa vào Plan', '→ To plan')}
                            </button>
                            {/* The date, spelled out under the button so nobody has to
                                infer it from the column on the left — and editable,
                                because the generator's day is a suggestion. Native
                                date input: it is the one control every phone already
                                knows how to open. */}
                            {picking === rowId ? (
                              <input
                                type="date"
                                autoFocus
                                value={target}
                                min={todayKey}
                                onChange={(ev) => {
                                  const v = ev.target.value;
                                  if (v) setDayFor((m) => ({ ...m, [rowId]: v }));
                                }}
                                onBlur={() => setPicking(null)}
                                onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === 'Escape') setPicking(null); }}
                                style={{
                                  width: '100%', padding: '4px 6px', borderRadius: 7,
                                  border: '1px solid var(--c475569)', background: 'var(--c0f172a)',
                                  color: 'var(--cf1f5f9)', fontSize: 11.5, fontFamily: 'inherit',
                                }}
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => setPicking(rowId)}
                                title={T('Đổi ngày đưa vào Plan', 'Change the day this goes on the plan')}
                                style={{
                                  padding: '3px 6px', borderRadius: 7, border: '1px dashed var(--c475569)',
                                  background: 'none', cursor: 'pointer', fontFamily: 'inherit',
                                  fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
                                  color: dayFor[rowId] ? 'var(--ink-link)' : 'var(--c94a3b8)',
                                }}
                              >
                                📅 {shortDay(target)}{dayFor[rowId] ? ' ✎' : ''}
                              </button>
                            )}
                          </div>
                        );
                      })() : <span style={{ display: 'inline-block', width: 96 }} />}
                    </div>
                  </div>
                ));
              })}
            </div>
          ))}
          {hidden > 0 && (
            <button type="button" onClick={() => setAll(true)} style={{ justifySelf: 'start', fontSize: 12.5, color: 'var(--ink-link)', background: 'none', border: '1px solid var(--c334155)', borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
              {T(`Xem thêm ${hidden} ý tưởng các tuần sau`, `Show ${hidden} more from later weeks`)} ↓
            </button>
          )}
          {all && weeks.length > 2 && (
            <button type="button" onClick={() => setAll(false)} style={{ justifySelf: 'start', fontSize: 12.5, color: 'var(--c94a3b8)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}>
              {T('Thu gọn về 2 tuần', 'Back to 2 weeks')} ↑
            </button>
          )}
        </div>
      )}
    </div>
  );
}
