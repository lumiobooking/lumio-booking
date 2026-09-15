'use client';

import { useMemo, useState } from 'react';
import type { Job } from './WeekPlanBoard';
import { instantToWall, dayKeyInTz } from '../lib/datetime';
import { useIsMobile } from '../lib/responsive';
import { layoutGrid, mondayIndex, KIND_ICON, CH_DOT, WD_VI, WD_EN, MONTH_VI, MONTH_EN, type AheadBlock, type GridPost, type GridDay } from './plan-grid';
export type { AheadBlock, GridPost, GridDay } from './plan-grid';

/**
 * THE NEXT THIRTY DAYS ON ONE SCREEN.
 *
 * WHAT THIS REPLACES
 *
 * The plan was one week, shown a day at a time behind chips, and the posts
 * were somewhere else entirely — a month calendar on another tab. A person
 * scheduling content had to read a job on the plan, remember it, switch
 * tabs, open the composer, and type the date back in. Four screens for one
 * decision, and the date was retyped by hand every time.
 *
 * WHAT THIS IS
 *
 * A calendar of days, five weeks deep, Monday-aligned, where every day
 * shows both halves of the truth: what the plan says should happen (jobs,
 * with whether they are done) and what is actually on the schedule (posts,
 * with their time and state). A job is one tap from becoming a scheduled
 * post ON THAT DAY; a post is one tap from its detail; an empty day is one
 * tap from a new post. Nothing is retyped.
 *
 * Dates are the salon's calendar days, not the viewer's: an owner reading
 * from Vietnam sees the Austin Tuesday under Tuesday. Times on post chips are
 * salon time for the same reason.
 */

const STATUS_TONE: Record<string, { bg: string; ink: string }> = {
  posted: { bg: 'rgba(34,197,94,.14)', ink: 'var(--ink-good)' },
  failed: { bg: 'rgba(239,68,68,.14)', ink: 'var(--ink-bad)' },
  publishing: { bg: 'rgba(56,189,248,.14)', ink: 'var(--ink-sky)' },
  scheduled: { bg: 'rgba(99,102,241,.14)', ink: 'var(--ink-link)' },
  draft: { bg: 'var(--c1e293b)', ink: 'var(--c94a3b8)' },
};

export function PlanGrid({
  blocks, posts, tz, vi, onSchedule, onOpenPost, onNewPost, onOpenJob,
}: {
  blocks: AheadBlock[];
  posts: GridPost[];
  tz: string;
  vi: boolean;
  /** Turn a plan job into a post on that day. */
  onSchedule: (job: Job, dayKey: string) => void;
  onOpenPost: (id: string) => void;
  onNewPost: (dayKey: string) => void;
  /** Read the job's working sheet (opens the week view on that day). */
  onOpenJob?: (job: Job, weekKey: string) => void;
}) {
  const T = (a: string, b: string) => (vi ? a : b);
  const mobile = useIsMobile(720);
  const todayKey = dayKeyInTz(new Date(), tz);
  const days = useMemo(() => layoutGrid(blocks, posts, todayKey, tz), [blocks, posts, todayKey, tz]);
  const [open, setOpen] = useState<string | null>(null);

  const jobsTotal = days.filter((d) => d.inWindow).reduce((n, d) => n + d.jobs.length, 0);
  const jobsDone = days.filter((d) => d.inWindow).reduce((n, d) => n + d.jobs.filter((j) => j.done).length, 0);
  const scheduled = days.filter((d) => d.inWindow).reduce((n, d) => n + d.posts.filter((p) => p.status === 'scheduled' || p.status === 'posted').length, 0);
  const empty = days.filter((d) => d.inWindow && !d.past && d.jobs.length === 0 && d.posts.length === 0).length;

  const label = (key: string) => {
    const [, m, d] = key.split('-').map(Number);
    return `${d} ${vi ? MONTH_VI[m - 1] : MONTH_EN[m - 1]}`;
  };

  const cell = (d: GridDay) => {
    const dim = d.past || !d.inWindow;
    const isOpen = open === d.key;
    return (
      <div
        key={d.key}
        style={{
          minHeight: mobile ? 0 : 128, borderRadius: 10, padding: '7px 8px 8px',
          background: d.today ? 'rgba(99,102,241,.08)' : 'var(--c0f172a)',
          border: `1px solid ${d.today ? '#6366f1' : 'var(--c334155)'}`,
          opacity: dim ? 0.55 : 1,
          display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: mobile ? 13.5 : 14, fontWeight: 800, color: d.today ? 'var(--ink-link)' : 'var(--cf1f5f9)', fontVariantNumeric: 'tabular-nums' }}>
            {mobile ? `${vi ? WD_VI[mondayIndex(d.key)] : WD_EN[mondayIndex(d.key)]} ${label(d.key)}` : label(d.key)}
          </span>
          {d.today && <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: .4, color: 'var(--ink-link)', textTransform: 'uppercase' }}>{T('hôm nay', 'today')}</span>}
          {!d.past && d.inWindow && (
            <button
              type="button"
              onClick={() => onNewPost(d.key)}
              title={T('Lên lịch một bài mới vào ngày này', 'Schedule a new post on this day')}
              style={{
                marginLeft: 'auto', width: 22, height: 22, borderRadius: 6, border: '1px solid var(--c334155)', background: 'transparent',
                color: 'var(--c94a3b8)', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: 0, fontFamily: 'inherit',
              }}
            >+</button>
          )}
        </div>

        {d.jobs.map((j, i) => (
          <button
            key={`j${i}`}
            type="button"
            onClick={() => (d.past ? onOpenJob?.(j.job, j.weekKey) : setOpen(isOpen && open === d.key ? null : d.key))}
            title={j.job.text}
            style={{
              textAlign: 'left', display: 'flex', alignItems: 'flex-start', gap: 5, padding: '4px 6px', borderRadius: 7,
              border: '1px dashed var(--c334155)', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', minWidth: 0,
              color: j.done ? 'var(--ink-faint)' : 'var(--ccbd5e1)', textDecoration: j.done ? 'line-through' : 'none',
            }}
          >
            <span style={{ fontSize: 12, flex: '0 0 auto' }}>{j.done ? '✅' : (KIND_ICON[j.job.kind] ?? '•')}</span>
            <span style={{ fontSize: 11.5, lineHeight: 1.35, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
              {j.job.text}
            </span>
            {j.who === 'salon' && <span style={{ fontSize: 9.5, fontWeight: 800, color: 'var(--ink-warn)', flex: '0 0 auto' }}>{T('tiệm', 'shop')}</span>}
          </button>
        ))}

        {d.posts.map((p) => {
          const tone = STATUS_TONE[p.status] ?? STATUS_TONE.draft;
          const hm = instantToWall(p.scheduledAt, tz).slice(11, 16);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onOpenPost(p.id)}
              title={p.message}
              style={{
                textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6, padding: '4px 7px', borderRadius: 7, border: 'none',
                background: tone.bg, color: tone.ink, cursor: 'pointer', fontFamily: 'inherit', minWidth: 0,
              }}
            >
              <span style={{ display: 'inline-flex', gap: 2, flex: '0 0 auto' }}>
                {p.channels.map((c) => <i key={c} style={{ width: 7, height: 7, borderRadius: '50%', background: CH_DOT[c] ?? '#94a3b8', display: 'inline-block' }} />)}
              </span>
              <span style={{ fontSize: 11, fontWeight: 800, fontVariantNumeric: 'tabular-nums', flex: '0 0 auto' }}>{hm}</span>
              <span style={{ fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{p.message.replace(/\s+/g, ' ')}</span>
              {p.held ? <span style={{ fontSize: 10, flex: '0 0 auto' }}>🔴</span> : null}
            </button>
          );
        })}

        {/* The one tap: a job on this day becomes a post on this day. Shown
            when a job chip is selected, so the grid stays quiet until asked. */}
        {isOpen && d.jobs.length > 0 && !d.past && (
          <div style={{ marginTop: 2, display: 'grid', gap: 4 }}>
            {d.jobs.filter((j) => !j.done).map((j, i) => (
              <button
                key={`s${i}`}
                type="button"
                onClick={() => { setOpen(null); onSchedule(j.job, d.key); }}
                style={{
                  textAlign: 'left', padding: '6px 8px', borderRadius: 7, border: '1px solid #6366f1', background: 'rgba(99,102,241,.14)',
                  color: 'var(--ink-link)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                🗓️ {T('Lên lịch đăng', 'Schedule')}: {(KIND_ICON[j.job.kind] ?? '')} {j.job.text.slice(0, 40)}{j.job.text.length > 40 ? '…' : ''}
              </button>
            ))}
            {onOpenJob && (
              <button
                type="button"
                onClick={() => { setOpen(null); onOpenJob(d.jobs[0].job, d.jobs[0].weekKey); }}
                style={{ textAlign: 'left', padding: '5px 8px', borderRadius: 7, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--c94a3b8)', fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                📋 {T('Xem phiếu việc của ngày này', 'Open this day’s working sheet')}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      {/* Four numbers, because the grid is scanned before it is read: how much
          of the month is planned, done, actually on the schedule, and empty. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 12 }}>
        {[
          [String(jobsTotal), T('việc trong 30 ngày', 'jobs in 30 days'), 'var(--cf1f5f9)'],
          [String(jobsDone), T('đã xong', 'done'), 'var(--ink-good)'],
          [String(scheduled), T('bài đã lên lịch', 'posts scheduled'), 'var(--ink-link)'],
          [String(empty), T('ngày còn trống', 'empty days'), empty > 10 ? 'var(--ink-warn)' : 'var(--c94a3b8)'],
        ].map(([n, l, c], i) => (
          <div key={i} style={{ background: 'var(--c0f172a)', border: '1px solid var(--c334155)', borderRadius: 10, padding: '8px 12px' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: c, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{n}</div>
            <div style={{ fontSize: 11, color: 'var(--c94a3b8)', marginTop: 2 }}>{l}</div>
          </div>
        ))}
      </div>

      {mobile ? (
        <div style={{ display: 'grid', gap: 6 }}>
          {days.filter((d) => d.inWindow).map(cell)}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 760 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 6, marginBottom: 6 }}>
              {(vi ? WD_VI : WD_EN).map((w, i) => (
                <div key={w} style={{ fontSize: 11, fontWeight: 800, letterSpacing: .5, textTransform: 'uppercase', color: i >= 5 ? 'var(--ink-warn)' : 'var(--c94a3b8)', padding: '0 4px' }}>{w}</div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 6 }}>
              {days.map(cell)}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10, fontSize: 11.5, color: 'var(--c64748b)' }}>
        <span>▢ {T('viền đứt: việc trong plan', 'dashed: a plan job')}</span>
        <span>▮ {T('nền màu: bài trên lịch đăng', 'filled: a post on the schedule')}</span>
        <span>{T('Giờ hiển thị theo giờ tiệm', 'Times shown in salon time')}{tz ? ` (${tz})` : ''}</span>
      </div>
    </div>
  );
}
