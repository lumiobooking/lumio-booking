'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { dayKeyInTz } from '../lib/datetime';

/**
 * One week of a salon's marketing work, as a document a person can hand over
 * and a person can rewrite — in place.
 *
 * WHAT WAS WRONG WITH THE OLD SCREEN
 *
 * It carried the right facts in the wrong shape. A focus sentence, an italic
 * line about where the days came from, a chip with last week's number, a large
 * blue box for the stage, and then the actual week — the part somebody has to
 * DO — as thin rows separated by hairlines, at 55% opacity, under a 76-pixel
 * day column. Five type treatments, no hierarchy, and the work itself was the
 * quietest thing on the page. It read as a feed of advice. Staff covering eight
 * salons open this every morning; what they needed was a plan.
 *
 * So: a masthead that says which week and which dates, the reasoning as a short
 * labelled block, the stage compressed to one line with its bar, and then the
 * week as a real schedule — dated rows, numbered jobs, a count per day, today
 * marked by an accent rather than by orange text, and rest days collapsed to a
 * single muted line instead of a paragraph at half opacity.
 *
 * WHY EDITING IS CLICK-ON-THE-LINE
 *
 * The first editor was a mode: press "Edit plan", the week turns into a form,
 * press "Save". Nobody found the button, and the person who did had to rewrite
 * a whole week to fix one word. Now the line you are reading is the line you
 * change — click it, type, click away, saved. Move a job with the arrows, send
 * it to another day from the little day picker, add or delete with one press.
 * The old form is gone; there is nothing to enter and nothing to leave.
 *
 * WHY EACH JOB HAS A SHEET
 *
 * "Film 3 clips" is a line on a plan, not a thing somebody can do with a phone
 * in one hand. Under each job sits its working sheet — the shots in order, a
 * caption to paste, the tags, where it goes — with a tick per line. The sheet
 * is generated with the job (see the API's job-brief) and editable the same
 * way the job is.
 */

export interface JobBrief {
  steps: string[];
  caption?: string;
  hashtags?: string[];
  channel?: string;
}
export interface Job {
  kind: string; text: string; why: string; when?: string; from?: string;
  id?: string;
  brief?: JobBrief | null;
}
export interface DayPlan { weekday: number; label: string; jobs: Job[] }
export interface Stage {
  key: string; step: number; title: string; goal: string; why: string; exitWhen: string;
  progress: { done: number; need: number; label: string } | null;
}
export interface ContentSourceRow { label: string; when: string; why: string }
export interface PrepLine { label: string; detail: string }
export interface WeekTargetRow { label: string; target: number; unit: string }

export interface WeekView {
  days: DayPlan[];
  focus: string;
  basis: string;
  report?: string | null;
  daily: Job[];
  sources: ContentSourceRow[];
  trade: string;
  week: number;
  stage: Stage | null;
  teamNote?: string;
  prep?: PrepLine[];
  targets?: WeekTargetRow[];
}

export interface WeekMeta {
  weekKey: string;
  label: string;
  startDate?: string | null;
  edited: boolean;
  editedByName: string | null;
  canEdit: boolean;
  approvedAt: string | null;
  approvedByName: string | null;
  /** { [jobId]: [stepIndex, …] } — what has been ticked on the sheets. */
  ticks?: Record<string, number[]>;
}

export interface WeekSavePatch {
  focus?: string;
  note?: string;
  days?: DayPlan[];
  lang?: 'vi' | 'en';
  reset?: boolean;
}

/** The offer form — mirrors the API's WeekOffer. */
export interface OfferForm {
  mode: 'auto' | 'custom' | 'off';
  kind: 'percent' | 'amount' | 'gift';
  value: number;
  services: string;
  gift: string;
  days: number[];
  slot: 'morning' | 'afternoon' | 'evening' | 'all';
  expires: string;
  terms: string;
  postDay: number | null;
  postAt: string;
  updatedAt?: string;
  updatedBy?: string | null;
}

const KINDS: { id: string; icon: string; vi: string; en: string }[] = [
  { id: 'film', icon: '🎬', vi: 'Quay clip', en: 'Film' },
  { id: 'photo', icon: '📷', vi: 'Chụp ảnh', en: 'Photos' },
  { id: 'post', icon: '📤', vi: 'Đăng', en: 'Post' },
  { id: 'story', icon: '📸', vi: 'Story', en: 'Story' },
  { id: 'offer', icon: '🏷️', vi: 'Ưu đãi', en: 'Offer' },
  { id: 'winback', icon: '💬', vi: 'Kéo khách cũ', en: 'Win back' },
  { id: 'engage', icon: '💚', vi: 'Tương tác', en: 'Engage' },
  { id: 'gbp', icon: '📍', vi: 'Google Maps', en: 'Google profile' },
  { id: 'event', icon: '🎪', vi: 'Sự kiện · hợp tác', en: 'Event · partner' },
  { id: 'rest', icon: '·', vi: 'Nghỉ', en: 'Rest' },
];
const ICON = (k: string) => KINDS.find((x) => x.id === k)?.icon ?? '•';

/** Kinds whose end product is something the public sees. */
const POSTABLE = new Set(['film', 'photo', 'post', 'story', 'offer', 'gbp', 'event']);
const WD_VI = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const WD_EN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/** 'YYYY-MM-DD' plus n days, done on the digits so no timezone can shift it. */
function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
const dm = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;

/** Every job remembers where it was — that is how a move keeps its other language. */
function withAddresses(days: DayPlan[]): DayPlan[] {
  return days.map((d, di) => ({ ...d, jobs: d.jobs.map((j, ji) => ({ ...j, from: j.from ?? `${di}:${ji}` })) }));
}

export function WeekPlanBoard({
  week, meta, isPast, vi, salonName, salonCity, onSave, onApprove, approving,
  onOpenToday, hasTodayDraft, stageAction, onTick, offer, onSaveOffer, currencySign,
}: {
  week: WeekView;
  meta: WeekMeta | null;
  isPast: boolean;
  vi: boolean;
  salonName?: string | null;
  salonCity?: string | null;
  onSave: (patch: WeekSavePatch) => Promise<void>;
  onApprove?: (() => void) | null;
  approving?: boolean;
  onOpenToday?: () => void;
  hasTodayDraft?: boolean;
  stageAction?: { label: string; onGo: () => void } | null;
  onTick?: (jobId: string, step: number, done: boolean) => Promise<void>;
  offer?: OfferForm | null;
  onSaveOffer?: (o: OfferForm) => Promise<void>;
  currencySign?: string;
}) {
  const T = (v: string, e: string) => (vi ? v : e);
  const canEdit = Boolean(meta?.canEdit) && !isPast;
  const lang: 'vi' | 'en' = vi ? 'vi' : 'en';
  const [saving, setSaving] = useState(false);
  const [days, setDays] = useState<DayPlan[]>(() => withAddresses(week.days));
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // The two blocks that used to sit above the week. They are still here, still
  // editable, still one click away — they are just no longer the first thing a
  // person has to read before finding Monday.
  /**
   * Which day is on screen. -1 means the whole week at once, which is what
   * somebody rewriting the plan wants; a number is one day, which is what
   * somebody DOING the plan wants. It opens on today, because the person who
   * opens this at 7am is the second kind.
   */
  const [dayTab, setDayTab] = useState<number>(0);
  const [openPrep, setOpenPrep] = useState(false);
  const [openWhy, setOpenWhy] = useState(false);
  // Local ticks so a tap answers before the server does.
  const [ticks, setTicks] = useState<Record<string, number[]>>(meta?.ticks ?? {});
  useEffect(() => { setDays(withAddresses(week.days)); }, [week.days]);
  // A different week can be shorter. Land back on its first day rather than on
  // a day that is not there, which would render an empty screen with no clue.
  useEffect(() => {
    setDayTab((d) => (d === -1 || d < week.days.length ? d : 0));
  }, [week.days.length]);
  useEffect(() => { setTicks(meta?.ticks ?? {}); }, [meta?.ticks]);

  const dates = useMemo(() => {
    const start = dayKeyInTz(new Date());
    return week.days.map((_, i) => addDays(start, i));
  }, [week.days]);

  const jobCount = days.reduce((n, d) => n + d.jobs.filter((j) => j.kind !== 'rest').length, 0);

  /**
   * A job counts as done when every line on its sheet is ticked. A job with no
   * sheet is never counted done — there is nothing to have finished — so the
   * bar can only move because somebody actually ticked something.
   */
  const isJobDone = (j: Job) => {
    const st = j.brief?.steps ?? [];
    if (!st.length || !j.id) return false;
    const t = ticks[j.id] ?? [];
    return st.every((_, i) => t.includes(i));
  };
  /**
   * The one job whose sheet opens by itself: the first unfinished job on the
   * first working day. "Film 3 clips" collapsed behind a toggle is the reason
   * a new member of staff could not tell what to do — the how was one click
   * away and nobody made that click. One sheet open costs a screenful; not
   * opening it cost the whole point of the sheet. Anything else stays folded,
   * and a person can close this one like any other.
   */
  const nextKey = useMemo(() => {
    if (isPast) return null;
    for (let di = 0; di < days.length; di += 1) {
      const real = days[di].jobs.filter((j) => j.kind !== 'rest');
      const j = real.find((x) => !isJobDone(x) && !!(x.brief?.steps?.length));
      if (j) return j.id ?? `${di}:${real.indexOf(j)}`;
      if (real.length) return null; // today has jobs and they are all done
    }
    return null;
  }, [days, isPast, ticks]);

  const doneJobs = days.reduce(
    (n, d) => n + d.jobs.filter((j) => j.kind !== 'rest' && isJobDone(j)).length, 0);
  const leftJobs = Math.max(0, jobCount - doneJobs);

  /** Every change to the week goes out at once. Small, frequent, reversible. */
  async function commit(next: DayPlan[]) {
    setDays(next);
    setSaving(true);
    try { await onSave({ days: next, lang }); } finally { setSaving(false); }
  }
  const mutate = (di: number, fn: (jobs: Job[]) => Job[]) =>
    commit(days.map((d, i) => (i === di ? { ...d, jobs: fn(d.jobs) } : d)));

  const patchJob = (di: number, ji: number, patch: Partial<Job>) =>
    mutate(di, (jobs) => jobs.map((x, k) => (k === ji ? { ...x, ...patch } : x)));

  const moveWithin = (di: number, ji: number, by: number) => mutate(di, (jobs) => {
    const to = ji + by;
    if (to < 0 || to >= jobs.length) return jobs;
    const next = [...jobs];
    [next[ji], next[to]] = [next[to], next[ji]];
    return next;
  });

  const moveToDay = (di: number, ji: number, target: number) => {
    if (target === di) return;
    const job = days[di].jobs[ji];
    commit(days.map((d, i) => {
      if (i === di) return { ...d, jobs: d.jobs.filter((_, k) => k !== ji) };
      if (i === target) return { ...d, jobs: [...d.jobs.filter((j) => j.kind !== 'rest'), job] };
      return d;
    }));
  };

  const addJob = (di: number) => {
    const key = `new-${di}-${Date.now()}`;
    setOpen((o) => ({ ...o, [key]: true }));
    // Not committed until it has words: a job with no instruction is not a job
    // and the server drops it. Kept local under a temporary id.
    setDays((prev) => prev.map((d, i) => (i === di
      ? { ...d, jobs: [...d.jobs.filter((j) => j.kind !== 'rest'), { kind: 'post', text: '', why: '', id: key }] }
      : d)));
  };

  async function tick(job: Job, step: number, done: boolean) {
    if (!job.id || !onTick) return;
    setTicks((t) => {
      const set = new Set(t[job.id!] ?? []);
      if (done) set.add(step); else set.delete(step);
      return { ...t, [job.id!]: Array.from(set).sort((a, b) => a - b) };
    });
    try { await onTick(job.id, step, done); } catch { /* the next load corrects it */ }
  }

  return (
    <div style={card}>
      {/* ---- masthead ---- */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={label}>{T('KẾ HOẠCH TUẦN', 'WEEKLY PLAN')}</div>
          <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--cf1f5f9)', lineHeight: 1.3 }}>
            {meta?.label ?? T('Tuần này', 'This week')}
            {dates.length > 1 && (
              <span style={{ fontWeight: 500, color: 'var(--c64748b)', fontSize: 15 }}>
                {'  ·  '}{dm(dates[0])} – {dm(dates[dates.length - 1])}
              </span>
            )}
          </div>
          {/* A salon whose "name" is a paragraph of services turned this into
              three lines of blurb at the top of the plan, cut off mid-word.
              One line, clipped, with the whole of it on hover. */}
          <div
            title={[salonName, salonCity, week.trade].filter(Boolean).join(' · ')}
            style={{
              fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 2,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            {[salonName, salonCity].filter(Boolean).join(' · ')}
            {week.trade ? ` · ${week.trade}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
          {saving && <span style={{ ...pill, borderColor: 'var(--c475569)', color: 'var(--c94a3b8)' }}>{T('Đang lưu…', 'Saving…')}</span>}
          {meta?.approvedAt && (
            <span style={{ ...pill, borderColor: '#22c55e', color: '#22c55e' }}>
              ✓ {T('Tiệm đã duyệt', 'Approved')}{meta.approvedByName ? ` — ${meta.approvedByName}` : ''}
            </span>
          )}
          {meta?.edited && (
            <span style={{ ...pill, borderColor: 'var(--c475569)', color: 'var(--ca5b4fc)' }}>
              ✎ {T('Team đã chỉnh', 'Edited')}{meta.editedByName ? ` — ${meta.editedByName}` : ''}
            </span>
          )}
          {!isPast && onApprove && (
            <button onClick={onApprove} disabled={approving} style={{ ...btn, background: '#22c55e', color: '#052e16', border: 'none', fontWeight: 700 }}>
              {approving ? T('Đang lưu…', 'Saving…') : T('✓ Duyệt kế hoạch', '✓ Approve')}
            </button>
          )}
        </div>
      </div>

      {canEdit && dayTab === -1 && (
        <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginTop: 8, lineHeight: 1.5 }}>
          ✎ {T('Bấm vào chữ để sửa ngay tại chỗ — tự lưu khi bấm ra ngoài.',
               'Click any line to edit it in place — saved when you click away.')}
        </div>
      )}


      {/* ---- the week at a glance ----
          Seven days, one strip, before any prose. A person opening this on a
          Tuesday wants to know what is left, not what the thinking was. The
          bar counts jobs, not opinions, and today is marked with the accent
          rather than with orange text, so the eye lands on it first. */}
      <div style={{
        marginTop: 14, borderTop: '1px solid var(--c334155)', paddingTop: 12,
        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
      }}>
        <div style={{ flex: '0 0 auto' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--cf1f5f9)' }}>
            {doneJobs}/{jobCount} {T('việc xong', jobCount === 1 ? 'job done' : 'jobs done')}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginTop: 2 }}>
            {leftJobs === 0
              ? T('Xong hết tuần này', 'Nothing left this week')
              : `${T('Còn', 'Still to do')} ${leftJobs} ${T('việc', leftJobs === 1 ? 'job' : 'jobs')}`}
          </div>
        </div>
        <div style={{ flex: '1 1 160px', minWidth: 120, height: 8, borderRadius: 20, background: 'var(--c0f172a)', overflow: 'hidden' }}>
          <div style={{ width: `${jobCount ? Math.round((doneJobs / jobCount) * 100) : 0}%`, height: '100%', background: '#22c55e' }} />
        </div>
      </div>

      {/* ---- the numbers this week is aiming at ----
          They were squeezed into the end of the progress row as tiny all-caps
          labels, which is how "GHẾ LẤP THÊM Ở THỨ 2 BUỔI SÁNG" ends up
          unreadable. Given their own line and normal sentence case, they read
          like what they are: three promises with numbers on them. */}
      {!!week.targets?.length && (
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', marginTop: 10 }}>
          {week.targets.slice(0, 3).map((t, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'baseline', gap: 8,
              background: 'var(--c0f172a)', border: '1px solid var(--line)',
              borderRadius: 10, padding: '10px 12px', minWidth: 0,
            }}>
              <span style={{ fontSize: 19, fontWeight: 800, color: 'var(--ca5b4fc)', lineHeight: 1.1, flex: '0 0 auto' }}>{t.target}</span>
              <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.4, minWidth: 0 }}>
                {t.unit ? `${t.unit} — ` : ''}{t.label}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ---- pick a day ----
          These used to be seven boxes that only reported. A person's first
          instinct on seeing a week laid out in columns is to press the day they
          want, and pressing did nothing. Now the day IS the control: press it
          and the rest of the screen becomes that day. "Cả tuần" is at the end
          for the person rewriting the plan rather than working it. */}
      <div style={{ display: 'flex', gap: 6, marginTop: 12, overflowX: 'auto', paddingBottom: 2, WebkitOverflowScrolling: 'touch' as const }}>
        {days.map((d, di) => {
          const real = d.jobs.filter((j) => j.kind !== 'rest');
          const isToday = di === 0 && !isPast;
          const on = dayTab === di;
          const dayDone = real.filter((j) => isJobDone(j)).length;
          const allDone = real.length > 0 && dayDone === real.length;
          return (
            <button
              key={`g-${d.weekday}-${di}`}
              onClick={() => setDayTab(di)}
              aria-pressed={on}
              style={{
                flex: '1 1 0', minWidth: 96, textAlign: 'left', cursor: 'pointer', font: 'inherit',
                border: `1px solid ${on ? '#6366f1' : isToday ? 'var(--c475569)' : 'var(--line)'}`,
                background: on ? 'var(--c312e81)' : 'var(--c0f172a)',
                borderRadius: 10, padding: '9px 10px',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: on ? '#ffffff' : 'var(--ce2e8f0)' }}>{d.label}</div>
              <div style={{ fontSize: 11.5, color: on ? 'var(--cc7d2fe)' : 'var(--c64748b)', marginTop: 1 }}>
                {dates[di] ? dm(dates[di]) : ''}{isToday ? ` · ${T('hôm nay', 'today')}` : ''}
              </div>
              {/* "0/2" is a score, not an instruction. A person who has never
                  seen this screen reads words. */}
              <div style={{
                fontSize: 12, fontWeight: 600, marginTop: 5,
                color: real.length === 0 ? 'var(--c64748b)' : allDone ? '#22c55e' : on ? '#ffffff' : 'var(--c94a3b8)',
              }}>
                {real.length === 0
                  ? T('Nghỉ', 'Rest')
                  : allDone
                    ? T('✓ Xong', '✓ Done')
                    : `${real.length - dayDone} ${T('việc', real.length - dayDone === 1 ? 'job' : 'jobs')}`}
              </div>
            </button>
          );
        })}
        <button
          onClick={() => setDayTab(-1)}
          aria-pressed={dayTab === -1}
          style={{
            flex: '0 0 auto', cursor: 'pointer', font: 'inherit', alignSelf: 'stretch',
            border: `1px solid ${dayTab === -1 ? '#6366f1' : 'var(--line)'}`,
            background: dayTab === -1 ? 'var(--c312e81)' : 'transparent',
            color: dayTab === -1 ? '#ffffff' : 'var(--c94a3b8)',
            borderRadius: 10, padding: '9px 12px', fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap',
          }}
        >
          {T('Cả tuần', 'Whole week')}
        </button>
      </div>

      {/* ---- the work ---- */}
      <div style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--cf1f5f9)' }}>
            {dayTab === -1
              ? T('Cả tuần', 'The whole week')
              : dayTab === 0 && !isPast
                ? T('Hôm nay phải làm', 'What to do today')
                : `${T('Việc', 'Jobs for')} ${days[dayTab]?.label ?? ''}`}
          </div>
          <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--c64748b)' }}>
            {(dayTab === -1 ? days : [days[dayTab]].filter(Boolean))
              .reduce((n, d) => n + d.jobs.filter((j) => j.kind !== 'rest').length, 0)}{' '}
            {T('việc', 'jobs')}
          </div>
        </div>

        {/* ---- how to work this screen, in one sentence ----
            Somebody sitting down for the first time needs three facts: start at
            number 1, the steps are already written under each job, tick as you
            go. Everything else on this page is for somebody who already knows. */}
        {dayTab !== -1 && (days[dayTab]?.jobs.filter((j) => j.kind !== 'rest').length ?? 0) > 0 && (
          <div style={{
            display: 'flex', gap: 10, alignItems: 'flex-start',
            background: 'var(--c1e1b4b)', border: '1px solid var(--c312e81)',
            borderRadius: 10, padding: '11px 14px', marginBottom: 12,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ca5b4fc)" strokeWidth="1.8" strokeLinecap="round" style={{ flex: '0 0 auto', marginTop: 1 }}>
              <circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" />
            </svg>
            <div style={{ fontSize: 12.5, color: 'var(--cc7d2fe)', lineHeight: 1.6 }}>
              {T('Làm lần lượt từ việc số 1. Mỗi việc đã có sẵn các bước ở ngay bên dưới — làm xong bước nào thì tích ô vuông của bước đó.',
                 'Work down from job 1. Each job already has its steps written underneath — tick each box as you finish that step.')}
            </div>
          </div>
        )}

        {days.map((d, di) => {
          // One day at a time unless somebody asked for the lot. Hiding rather
          // than not rendering keeps every index, id and handler below exactly
          // as it was — the editing paths are untouched by the filter.
          if (dayTab !== -1 && dayTab !== di) return null;
          const real = d.jobs.filter((j) => j.kind !== 'rest');
          const isToday = di === 0 && !isPast;
          const resting = real.length === 0;
          return (
            <div
              key={`${d.weekday}-${di}`}
              style={{
                display: 'flex', gap: 12, padding: dayTab === -1 ? '10px 0 10px 11px' : 0,
                borderTop: dayTab === -1 && di !== 0 ? '1px solid var(--line)' : 'none',
                borderLeft: dayTab === -1 && isToday ? '2px solid #6366f1' : '2px solid transparent',
                marginLeft: dayTab === -1 ? -11 : 0,
              }}
            >
              {/* On one day the picker above already says which day it is. */}
              {dayTab === -1 && (
                <div style={{ flex: '0 0 74px' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: isToday ? 'var(--ca5b4fc)' : 'var(--ce2e8f0)' }}>{d.label}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--c64748b)' }}>{dates[di] ? dm(dates[di]) : ''}</div>
                  {isToday && <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ca5b4fc)', letterSpacing: '.4px' }}>{T('HÔM NAY', 'TODAY')}</div>}
                </div>
              )}

              <div style={{ flex: 1, minWidth: 0 }}>
                {resting && (
                  <div style={{
                    fontSize: 13, color: 'var(--c94a3b8)', lineHeight: 1.6,
                    background: 'var(--c0f172a)', border: '1px solid var(--line)',
                    borderRadius: 10, padding: '14px 16px',
                  }}>
                    {T('Ngày nghỉ — không giao việc nào. Chỉ cần trả lời tin nhắn khách như mọi ngày.',
                       'A rest day — nothing assigned. Just answer customer messages as usual.')}
                  </div>
                )}

                {real.map((j, ji) => {
                  const key = j.id ?? `${di}:${ji}`;
                  const isNew = !j.text && j.id?.startsWith('new-');
                  return (
                    <JobRow
                      key={key}
                      job={j}
                      index={ji}
                      total={real.length}
                      days={days}
                      dayIndex={di}
                      vi={vi}
                      canEdit={canEdit}
                      open={key in open ? Boolean(open[key]) : (dayTab !== -1 || key === nextKey)}
                      onToggle={() => setOpen((o) => ({ ...o, [key]: !(key in o ? o[key] : (dayTab !== -1 || key === nextKey)) }))}
                      ticked={ticks[j.id ?? ''] ?? []}
                      onTick={onTick && j.id && !isNew ? (s, done) => tick(j, s, done) : undefined}
                      onPatch={(patch) => {
                        const jobIndex = d.jobs.indexOf(j);
                        if (isNew) {
                          // First words: now it is a job. Commit the whole day.
                          if (!String(patch.text ?? '').trim()) return;
                          const { id: _tmp, ...rest } = j;
                          mutate(di, (jobs) => jobs.map((x, k) => (k === jobIndex ? { ...rest, ...patch } : x)));
                          return;
                        }
                        patchJob(di, jobIndex, patch);
                      }}
                      onRemove={() => {
                        const jobIndex = d.jobs.indexOf(j);
                        if (isNew) { setDays((prev) => prev.map((x, i) => (i === di ? { ...x, jobs: x.jobs.filter((_, k) => k !== jobIndex) } : x))); return; }
                        mutate(di, (jobs) => jobs.filter((_, k) => k !== jobIndex));
                      }}
                      onMove={(by) => moveWithin(di, d.jobs.indexOf(j), by)}
                      onMoveDay={(t) => moveToDay(di, d.jobs.indexOf(j), t)}
                    />
                  );
                })}

                {canEdit && (
                  <button onClick={() => addJob(di)} style={{ ...btn, marginTop: 7, fontSize: 12, padding: '5px 10px', color: 'var(--c94a3b8)' }}>
                    + {T('Thêm việc', 'Add a job')}
                  </button>
                )}

                {isToday && !resting && hasTodayDraft && onOpenToday && (
                  <button onClick={onOpenToday} style={{ ...btn, marginTop: 9, borderColor: 'var(--c475569)', color: 'var(--ca5b4fc)' }}>
                    {T('Mở bài viết đã soạn cho hôm nay', 'Open today’s drafted post')} →
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!!week.daily?.length && (
        <Section title={T('3 THÓI QUEN HẰNG NGÀY', 'THE 3 DAILY HABITS')}
          hint={T('Không nằm trong lịch vì ngày nào cũng làm', 'Not on the schedule because they happen every day')}>
          {week.daily.map((j, k) => (
            <div key={k} style={{ display: 'flex', gap: 8, padding: '4px 0' }}>
              <span style={{ flex: '0 0 auto' }}>{ICON(j.kind)}</span>
              <div>
                <div style={{ fontSize: 13, color: 'var(--ce2e8f0)' }}>
                  {j.text}{j.when && <span style={{ color: 'var(--c64748b)' }}> · {j.when}</span>}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--c64748b)', lineHeight: 1.45 }}>{j.why}</div>
              </div>
            </div>
          ))}
        </Section>
      )}
      {canEdit && meta?.edited && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--c334155)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            disabled={saving}
            onClick={() => { if (window.confirm(T('Bỏ mọi chỉnh sửa của team, dùng lại bản hệ thống tự viết?', 'Discard the team’s edits and use the system’s week?'))) onSave({ reset: true }); }}
            style={{ ...btn, borderColor: 'var(--c475569)', color: 'var(--cf87171)' }}
          >
            ↺ {T('Bỏ bản sửa, dùng lại bản hệ thống', 'Discard edits, use the system’s week')}
          </button>
          <span style={{ fontSize: 11.5, color: 'var(--c64748b)', lineHeight: 1.5 }}>
            {T('Chữ bạn gõ hiện y như vậy ở cả bản tiếng Anh; câu bạn không đụng tới giữ nguyên cả hai thứ tiếng.',
               'Text you type reads the same on both sides; lines you leave alone keep both languages.')}
          </span>
        </div>
      )}

      {(!!week.prep?.length || !!week.targets?.length) && (
      <Fold
        label={T('Tuần này cần chuẩn bị gì', 'What this week needs')}
        hint={T('Đồ nghề và số mục tiêu', 'Kit and the numbers')}
        open={openPrep} onToggle={() => setOpenPrep((v) => !v)}
      >
        {/* ---- what to carry in, and what it is for ---- */}
        {(!!week.prep?.length || !!week.targets?.length) && (
          <div style={{
            marginTop: 2,
            display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          }}>
            {!!week.prep?.length && (
              <div>
                <div style={label}>{T('TUẦN NÀY CẦN CHUẨN BỊ', 'WHAT THIS WEEK NEEDS')}</div>
                <div style={{ marginTop: 6 }}>
                  {week.prep.map((l, i) => (
                    <div key={i} style={{ display: 'flex', gap: 9, padding: '4px 0' }}>
                      <span style={{ flex: '0 0 auto', color: 'var(--c475569)', paddingTop: 1 }}>▢</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ce2e8f0)', lineHeight: 1.45 }}>{l.label}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--c94a3b8)', lineHeight: 1.5 }}>{l.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!!week.targets?.length && (
              <div>
                <div style={label}>{T('MỤC TIÊU TUẦN NÀY', 'THIS WEEK’S TARGETS')}</div>
                <div style={{ fontSize: 11.5, color: 'var(--c64748b)', margin: '2px 0 7px', lineHeight: 1.5 }}>
                  {T('Chỉ những con số đếm được — tuần sau đối chiếu lại ở phần "Các tuần đã qua".',
                     'Countable only — next week’s archive checks them against what happened.')}
                </div>
                {week.targets.map((t, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'baseline', gap: 9, padding: '6px 0',
                    borderTop: i === 0 ? 'none' : '1px solid var(--line)',
                  }}>
                    <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--ca5b4fc)', lineHeight: 1, minWidth: 26 }}>{t.target}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--c64748b)', minWidth: 44 }}>{t.unit}</span>
                    <span style={{ fontSize: 12.5, color: 'var(--ce2e8f0)', lineHeight: 1.4 }}>{t.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </Fold>
      )}

      <Fold
        label={T('Vì sao tuần này làm vậy', 'Why this week looks like this')}
        hint={week.stage ? `${T('Giai đoạn', 'Stage')} ${week.stage.step}/5` : undefined}
        open={openWhy} onToggle={() => setOpenWhy((v) => !v)}
      >
        {/* ---- the reasoning ---- */}
        <div style={{ marginTop: 2 }}>
          <Field label={T('TRỌNG TÂM', 'FOCUS')}>
            <Inline
              value={week.focus} canEdit={canEdit} strong
              onCommit={(v) => onSave({ focus: v })}
            />
          </Field>
          <Field label={T('CƠ SỞ', 'BASIS')}>
            <span style={{ color: 'var(--c94a3b8)' }}>{week.basis}</span>
          </Field>
          {week.report && (
            <Field label={T('TUẦN TRƯỚC', 'LAST WEEK')}>
              <span style={{ color: 'var(--ccbd5e1)' }}>{week.report}</span>
            </Field>
          )}
          {week.stage && (
            <Field label={`${T('GIAI ĐOẠN', 'STAGE')} ${week.stage.step}/5`}>
              <div>
                <div style={{ color: 'var(--ce2e8f0)', fontWeight: 600 }}>
                  {week.stage.title}
                  <span style={{ color: 'var(--c64748b)', fontWeight: 500 }}>
                    {'  ·  '}{T('Tuần', 'Week')} {week.week + 1}
                  </span>
                </div>
                <div style={{ color: 'var(--c94a3b8)', marginTop: 2 }}>{week.stage.goal}</div>
                {week.stage.progress && week.stage.progress.need > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 6 }}>
                    <div style={{ flex: 1, maxWidth: 260, height: 6, borderRadius: 20, background: 'var(--c0f172a)', overflow: 'hidden' }}>
                      <div style={{
                        width: `${Math.min(100, Math.round((week.stage.progress.done / week.stage.progress.need) * 100))}%`,
                        height: '100%', background: '#6366f1',
                      }} />
                    </div>
                    <span style={{ fontSize: 11.5, color: 'var(--c94a3b8)' }}>
                      {week.stage.progress.done}/{week.stage.progress.need} {week.stage.progress.label}
                    </span>
                  </div>
                )}
                <div style={{ color: 'var(--c64748b)', marginTop: 5, fontSize: 12 }}>
                  <b style={{ color: 'var(--c94a3b8)' }}>{T('Xong khi', 'Done when')}:</b> {week.stage.exitWhen}
                </div>
                {stageAction && (
                  <button onClick={stageAction.onGo} style={{ ...btn, marginTop: 8, borderColor: '#6366f1', color: 'var(--ca5b4fc)' }}>
                    {stageAction.label} →
                  </button>
                )}
              </div>
            </Field>
          )}
          {(week.teamNote || canEdit) && (
            <Field label={T('LUMIO NHẮN', 'FROM LUMIO')}>
              <Inline
                value={week.teamNote ?? ''} canEdit={canEdit} multiline
                placeholder={T('Lời nhắn cho tiệm tuần này (không bắt buộc)', 'A note to the salon this week (optional)')}
                onCommit={(v) => onSave({ note: v })}
              />
            </Field>
          )}
        </div>

        {/* ---- the offer, as a form ---- */}
        {canEdit && offer && onSaveOffer && (
          <OfferCard offer={offer} vi={vi} currencySign={currencySign ?? '$'} onSave={onSaveOffer} />
        )}

        {!!week.sources?.length && (
          <Section title={T('QUAY TỪ ĐÂU', 'WHAT TO FILM')}
            hint={T(`Nguồn có sẵn của ${week.trade} — không cần dựng cảnh`, 'Already in front of you — nothing to stage')}>
            {week.sources.map((s, k) => (
              <div key={k} style={{ padding: '4px 0' }}>
                <div style={{ fontSize: 13, color: 'var(--ce2e8f0)' }}>
                  • {s.label} <span style={{ color: '#f59e0b', fontSize: 12 }}>· {s.when}</span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--c64748b)', lineHeight: 1.45 }}>{s.why}</div>
              </div>
            ))}
          </Section>
        )}
      </Fold>

    </div>
  );
}

// ---- one job -------------------------------------------------------------------

function JobRow({
  job, index, total, days, dayIndex, vi, canEdit, open, onToggle, ticked, onTick, onPatch, onRemove, onMove, onMoveDay,
}: {
  job: Job; index: number; total: number; days: DayPlan[]; dayIndex: number; vi: boolean; canEdit: boolean;
  open: boolean; onToggle: () => void;
  ticked: number[];
  onTick?: (step: number, done: boolean) => void;
  onPatch: (patch: Partial<Job>) => void;
  onRemove: () => void;
  onMove: (by: number) => void;
  onMoveDay: (target: number) => void;
}) {
  const T = (v: string, e: string) => (vi ? v : e);
  const brief = job.brief ?? null;
  const steps = brief?.steps ?? [];
  const done = steps.length ? steps.filter((_, i) => ticked.includes(i)).length : 0;
  const isNew = !job.text && job.id?.startsWith('new-');

  const patchBrief = (b: Partial<JobBrief>) => onPatch({ brief: { steps: [], ...(brief ?? {}), ...b } });

  return (
    <div style={{ display: 'flex', gap: 9, marginBottom: index < total - 1 ? 9 : 0 }}>
      <span style={{ flex: '0 0 16px', fontSize: 11.5, color: 'var(--c475569)', paddingTop: 3, textAlign: 'right' }}>{index + 1}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        {/* the line */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          {canEdit ? (
            <select
              value={job.kind} onChange={(e) => onPatch({ kind: e.target.value })}
              title={T('Loại việc', 'Kind')}
              style={{ ...kindSelect }}
            >
              {KINDS.filter((k) => k.id !== 'rest').map((k) => <option key={k.id} value={k.id}>{k.icon} {vi ? k.vi : k.en}</option>)}
            </select>
          ) : (
            <span style={{ flex: '0 0 auto', paddingTop: 1 }}>{ICON(job.kind)}</span>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13.5, color: 'var(--ce2e8f0)', lineHeight: 1.5, fontWeight: 500, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'baseline' }}>
              <Inline
                value={job.text} canEdit={canEdit} strong autoFocus={isNew}
                placeholder={T('Việc cần làm — ngắn, đọc được trên điện thoại lúc 7 giờ sáng', 'The job — short, readable on a phone at 7am')}
                onCommit={(v) => onPatch({ text: v })}
              />
              {(job.when || canEdit) && (
                <span style={{ color: 'var(--c64748b)', fontSize: 12, fontWeight: 400 }}>
                  ·{' '}
                  <Inline
                    value={job.when ?? ''} canEdit={canEdit} small
                    placeholder={T('giờ', 'time')}
                    onCommit={(v) => onPatch({ when: v })}
                  />
                </span>
              )}
            </div>
            {(job.why || canEdit) && (
              <div style={{ fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.5, marginTop: 1, display: 'flex', gap: 5 }}>
                <span style={{ color: 'var(--c475569)' }}>↳</span>
                <Inline
                  value={job.why} canEdit={canEdit} multiline muted
                  placeholder={T('Vì sao việc này nằm ở ngày này', 'Why it sits on this day')}
                  onCommit={(v) => onPatch({ why: v })}
                />
              </div>
            )}
          </div>
          {canEdit && (
            <div style={{ display: 'flex', gap: 3, alignItems: 'center', flex: '0 0 auto' }}>
              <button onClick={() => onMove(-1)} disabled={index === 0} title={T('Lên trên', 'Move up')} style={mini}>↑</button>
              <button onClick={() => onMove(1)} disabled={index === total - 1} title={T('Xuống dưới', 'Move down')} style={mini}>↓</button>
              <select
                value={dayIndex} onChange={(e) => onMoveDay(Number(e.target.value))}
                title={T('Chuyển sang ngày khác', 'Move to another day')} style={{ ...mini, width: 'auto', padding: '0 4px', fontSize: 11 }}
              >
                {days.map((d, i) => <option key={i} value={i}>{i === 0 ? T('Hôm nay', 'Today') : d.label}</option>)}
              </select>
              <button onClick={onRemove} title={T('Xoá việc này', 'Delete')} style={{ ...mini, color: 'var(--cf87171)' }}>✕</button>
            </div>
          )}
        </div>

        {/* the sheet */}
        {!isNew && (brief || canEdit) && (
          <div style={{ marginTop: 5 }}>
            <button onClick={onToggle} style={{ ...sheetToggle, color: open ? 'var(--ca5b4fc)' : 'var(--c94a3b8)' }}>
              {open ? '▾' : '▸'} {T('Bản làm việc', 'Working sheet')}
              {steps.length > 0 && (
                <span style={{ marginLeft: 6, fontSize: 11, color: done === steps.length ? '#22c55e' : 'var(--c64748b)' }}>
                  {done}/{steps.length}
                </span>
              )}
            </button>
            {open && (
              <div style={sheet}>
                {/* steps */}
                {steps.map((st, i) => {
                  const on = ticked.includes(i);
                  return (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '3px 0' }}>
                      <button
                        onClick={() => onTick?.(i, !on)} disabled={!onTick}
                        title={on ? T('Bỏ tích', 'Untick') : T('Đã làm', 'Done')}
                        style={{ ...tickBox, background: on ? '#22c55e' : 'transparent', borderColor: on ? '#22c55e' : 'var(--c475569)', color: on ? '#052e16' : 'transparent' }}
                      >✓</button>
                      <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.5, color: on ? 'var(--c64748b)' : 'var(--ce2e8f0)', textDecoration: on ? 'line-through' : 'none' }}>
                        <Inline
                          value={st} canEdit={canEdit} multiline
                          onCommit={(v) => patchBrief({ steps: steps.map((x, k) => (k === i ? v : x)).filter((x) => x.trim()) })}
                        />
                      </div>
                      {canEdit && (
                        <button onClick={() => patchBrief({ steps: steps.filter((_, k) => k !== i) })} title={T('Xoá bước', 'Remove step')} style={{ ...mini, width: 22, height: 22, fontSize: 11, color: 'var(--c64748b)' }}>✕</button>
                      )}
                    </div>
                  );
                })}
                {canEdit && (
                  <button
                    onClick={() => patchBrief({ steps: [...steps, T('Bước mới — bấm để sửa', 'New step — click to edit')] })}
                    style={{ ...btn, fontSize: 11.5, padding: '3px 8px', color: 'var(--c94a3b8)', marginTop: 3 }}
                  >+ {T('Thêm bước', 'Add a step')}</button>
                )}

                {/* caption */}
                {(brief?.caption || canEdit) && (
                  <SheetBlock label={T('CAPTION', 'CAPTION')} copy={brief?.caption} vi={vi}>
                    <Inline
                      value={brief?.caption ?? ''} canEdit={canEdit} multiline
                      placeholder={T('Caption soạn sẵn (không bắt buộc)', 'A ready caption (optional)')}
                      onCommit={(v) => patchBrief({ caption: v })}
                    />
                  </SheetBlock>
                )}
                {/* hashtags */}
                {(brief?.hashtags?.length || canEdit) ? (
                  <SheetBlock label="HASHTAG" copy={brief?.hashtags?.length ? brief.hashtags.map((h) => `#${h}`).join(' ') : undefined} vi={vi}>
                    <Inline
                      value={(brief?.hashtags ?? []).map((h) => `#${h}`).join(' ')} canEdit={canEdit} small
                      placeholder={T('#nails #gelnails …', '#nails #gelnails …')}
                      onCommit={(v) => patchBrief({ hashtags: v.split(/[\s,]+/).map((h) => h.replace(/^#/, '')).filter(Boolean) })}
                    />
                  </SheetBlock>
                ) : null}
                {/* channel */}
                {(brief?.channel || canEdit) && (
                  <SheetBlock label={T('ĐĂNG Ở', 'WHERE')} vi={vi}>
                    <Inline
                      value={brief?.channel ?? ''} canEdit={canEdit} small
                      placeholder={T('Instagram Reels · TikTok · Facebook', 'Instagram Reels · TikTok · Facebook')}
                      onCommit={(v) => patchBrief({ channel: v })}
                    />
                  </SheetBlock>
                )}
                {/* ---- the quality bar ----
                    Four things, the same four every time, that separate a clip
                    a salon is glad to have from one it quietly deletes. They
                    are deliberately not per-job and not generated: a checklist
                    that changes every day is a checklist nobody learns. */}
                {POSTABLE.has(job.kind) && (
                  <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
                    <div style={{ ...label, fontSize: 10, color: 'var(--cfcd34d)' }}>
                      {T('TRƯỚC KHI BẤM ĐĂNG — KIỂM 4 Ý NÀY', 'BEFORE YOU POST — CHECK THESE 4')}
                    </div>
                    <div style={{ marginTop: 7, display: 'grid', gap: 5, gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
                      {[
                        T('Clip dọc, không lọt tay người quay vào khung', 'Shot vertical, no camera hand in frame'),
                        T('Tên tiệm hiện trong 3 giây đầu', 'The salon’s name shows in the first 3 seconds'),
                        T('Có câu mời đặt lịch ở cuối caption', 'The caption ends with an invitation to book'),
                        T('Đã trả lời hết bình luận bài hôm trước', 'Yesterday’s comments are all answered'),
                      ].map((line, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                          <span style={{
                            flex: '0 0 auto', width: 14, height: 14, marginTop: 2, borderRadius: 4,
                            border: '1.5px solid var(--c475569)',
                          }} />
                          <span style={{ fontSize: 12.5, color: 'var(--ccbd5e1)', lineHeight: 1.45 }}>{line}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {canEdit && (
                  <button
                    onClick={() => { if (window.confirm(T('Viết lại bản làm việc theo việc này?', 'Regenerate the sheet for this job?'))) onPatch({ brief: null }); }}
                    style={{ ...btn, fontSize: 11, padding: '3px 8px', color: 'var(--c64748b)', marginTop: 8 }}
                  >↺ {T('Viết lại bản làm việc', 'Regenerate the sheet')}</button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SheetBlock({ label: l, copy, vi, children }: { label: string; copy?: string; vi: boolean; children: React.ReactNode }) {
  const [ok, setOk] = useState(false);
  return (
    <div style={{ marginTop: 9 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ ...label, fontSize: 10 }}>{l}</div>
        {copy && (
          <button
            onClick={() => { navigator.clipboard?.writeText(copy).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); }).catch(() => undefined); }}
            style={{ ...btn, fontSize: 10.5, padding: '1px 7px', color: ok ? '#22c55e' : 'var(--c94a3b8)' }}
          >{ok ? (vi ? '✓ Đã chép' : '✓ Copied') : (vi ? 'Sao chép' : 'Copy')}</button>
        )}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--ce2e8f0)', lineHeight: 1.55, whiteSpace: 'pre-wrap', marginTop: 2 }}>{children}</div>
    </div>
  );
}

// ---- click-to-edit --------------------------------------------------------------

/**
 * A line that is text until you click it. Commits on blur or Enter (Escape
 * cancels); a multiline field commits on blur or Ctrl/Cmd+Enter. Only calls
 * back when the value actually changed, so a stray click costs no request.
 */
export function Inline({
  value, canEdit, onCommit, placeholder, multiline, strong, small, muted, autoFocus,
}: {
  value: string; canEdit: boolean; onCommit: (v: string) => void;
  placeholder?: string; multiline?: boolean; strong?: boolean; small?: boolean; muted?: boolean; autoFocus?: boolean;
}) {
  const [editing, setEditing] = useState(Boolean(autoFocus));
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

  const finish = (save: boolean) => {
    setEditing(false);
    const v = draft.replace(/\s+$/, '');
    if (save && v !== value) onCommit(v); else setDraft(value);
  };

  if (!canEdit) {
    if (!value) return null;
    return <span style={{ fontWeight: strong ? 600 : undefined, whiteSpace: multiline ? 'pre-wrap' : undefined }}>{value}</span>;
  }
  if (!editing) {
    return (
      <span
        role="button" tabIndex={0}
        onClick={() => setEditing(true)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditing(true); } }}
        title="✎"
        style={{
          cursor: 'text', borderBottom: '1px dashed var(--c475569)', whiteSpace: multiline ? 'pre-wrap' : undefined,
          fontWeight: strong ? 600 : undefined, fontSize: small ? 12 : undefined,
          color: value ? (muted ? 'var(--c94a3b8)' : undefined) : 'var(--c64748b)', fontStyle: value ? undefined : 'italic',
        }}
      >{value || placeholder || '…'}</span>
    );
  }
  const common = {
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: () => finish(true),
    placeholder,
    style: { ...input, fontSize: small ? 12 : 13, fontWeight: strong ? 600 : undefined, padding: '4px 7px' },
  };
  return multiline ? (
    <textarea
      {...common} rows={Math.min(8, Math.max(2, draft.split('\n').length))}
      ref={(el) => { ref.current = el; }}
      onKeyDown={(e) => { if (e.key === 'Escape') finish(false); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) finish(true); }}
      style={{ ...common.style, resize: 'vertical' }}
    />
  ) : (
    <input
      {...common}
      ref={(el) => { ref.current = el; }}
      onKeyDown={(e) => { if (e.key === 'Escape') finish(false); if (e.key === 'Enter') finish(true); }}
      style={{ ...common.style, width: small ? 120 : '100%' }}
    />
  );
}

// ---- the offer form ---------------------------------------------------------------

function OfferCard({ offer, vi, currencySign, onSave }: {
  offer: OfferForm; vi: boolean; currencySign: string; onSave: (o: OfferForm) => Promise<void>;
}) {
  const T = (v: string, e: string) => (vi ? v : e);
  const [o, setO] = useState<OfferForm>(offer);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [openForm, setOpenForm] = useState(offer.mode === 'custom');
  useEffect(() => { setO(offer); }, [offer]);
  const dirty = JSON.stringify(o) !== JSON.stringify(offer);

  async function save(next: OfferForm) {
    setBusy(true);
    try { await onSave(next); setSaved(true); setTimeout(() => setSaved(false), 1500); } finally { setBusy(false); }
  }
  const setMode = (mode: OfferForm['mode']) => {
    const next = { ...o, mode };
    setO(next);
    if (mode !== 'custom') { void save(next); setOpenForm(false); } else setOpenForm(true);
  };
  const toggleDay = (d: number) => setO({ ...o, days: o.days.includes(d) ? o.days.filter((x) => x !== d) : [...o.days, d].sort() });

  const modeBtn = (m: OfferForm['mode'], text: string) => (
    <button onClick={() => setMode(m)} disabled={busy} style={{ ...btn, fontSize: 12, padding: '5px 11px', ...(o.mode === m ? { background: '#6366f1', borderColor: '#6366f1', color: '#fff' } : {}) }}>{text}</button>
  );

  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--c334155)', paddingTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={label}>🏷️ {T('ƯU ĐÃI TUẦN NÀY', 'THIS WEEK’S OFFER')}</div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {modeBtn('auto', T('Hệ thống đề xuất', 'System’s proposal'))}
          {modeBtn('custom', T('Team tự đặt', 'Set by the team'))}
          {modeBtn('off', T('Không chạy ưu đãi', 'No offer'))}
        </div>
        {saved && <span style={{ fontSize: 11.5, color: '#22c55e' }}>✓ {T('Đã lưu', 'Saved')}</span>}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginTop: 5, lineHeight: 1.5 }}>
        {o.mode === 'auto' && T('Con số và khung giờ lấy từ sổ đặt lịch của tiệm — khung trống nhất, giảm vừa đủ theo biên lợi nhuận.',
          'Number and slot come from the salon’s book — the emptiest block, discounted only as far as the margin allows.')}
        {o.mode === 'off' && T('Tuần này không có việc ưu đãi trong lịch; story đếm ngược cũng bỏ.',
          'No offer job on this week’s plan; the countdown story goes with it.')}
        {o.mode === 'custom' && T('Việc trong lịch, caption và story đếm ngược đều lấy từ form này. Đổi một chỗ, cả tuần đổi theo.',
          'The job on the plan, the caption and the countdown story all read this form. Change it once and the week follows.')}
      </div>

      {o.mode === 'custom' && openForm && (
        <div style={{ marginTop: 10, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <FormField label={T('Giảm gì', 'What')}>
            <div style={{ display: 'flex', gap: 6 }}>
              <select value={o.kind} onChange={(e) => setO({ ...o, kind: e.target.value as OfferForm['kind'] })} style={{ ...input, width: 'auto' }}>
                <option value="percent">%</option>
                <option value="amount">{currencySign}</option>
                <option value="gift">{T('Tặng', 'Gift')}</option>
              </select>
              {o.kind === 'gift' ? (
                <input value={o.gift} onChange={(e) => setO({ ...o, gift: e.target.value })} placeholder={T('vẽ 2 ngón / dưỡng tay', 'nail art on 2 nails')} style={input} />
              ) : (
                <input type="number" min={0} value={o.value || ''} onChange={(e) => setO({ ...o, value: Number(e.target.value) || 0 })} placeholder={o.kind === 'percent' ? '12' : '10'} style={{ ...input, width: 90 }} />
              )}
            </div>
          </FormField>
          <FormField label={T('Áp cho dịch vụ', 'Services')}>
            <input value={o.services} onChange={(e) => setO({ ...o, services: e.target.value })} placeholder={T('để trống = mọi dịch vụ', 'blank = everything')} style={input} />
          </FormField>
          <FormField label={T('Ngày áp dụng', 'Valid days')}>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <button key={d} onClick={() => toggleDay(d)} style={{ ...mini, width: 34, fontSize: 11, ...(o.days.includes(d) ? { background: '#6366f1', borderColor: '#6366f1', color: '#fff' } : {}) }}>
                  {vi ? WD_VI[d] : WD_EN[d]}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--c64748b)', marginTop: 3 }}>{o.days.length ? '' : T('Không chọn = mọi ngày', 'None picked = every day')}</div>
          </FormField>
          <FormField label={T('Khung giờ', 'Time of day')}>
            <select value={o.slot} onChange={(e) => setO({ ...o, slot: e.target.value as OfferForm['slot'] })} style={input}>
              <option value="all">{T('Cả ngày', 'All day')}</option>
              <option value="morning">{T('Buổi sáng', 'Morning')}</option>
              <option value="afternoon">{T('Buổi chiều', 'Afternoon')}</option>
              <option value="evening">{T('Buổi tối', 'Evening')}</option>
            </select>
          </FormField>
          <FormField label={T('Hết hạn', 'Ends')}>
            <input type="date" value={o.expires} onChange={(e) => setO({ ...o, expires: e.target.value })} style={input} />
          </FormField>
          <FormField label={T('Đăng lúc', 'Post on')}>
            <div style={{ display: 'flex', gap: 6 }}>
              <select value={o.postDay ?? ''} onChange={(e) => setO({ ...o, postDay: e.target.value === '' ? null : Number(e.target.value) })} style={{ ...input, width: 'auto' }}>
                <option value="">{T('Tự chọn (trước 2 ngày)', 'Auto (2 days ahead)')}</option>
                {[1, 2, 3, 4, 5, 6, 0].map((d) => <option key={d} value={d}>{vi ? ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'][d] : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d]}</option>)}
              </select>
              <input value={o.postAt} onChange={(e) => setO({ ...o, postAt: e.target.value })} placeholder="19:00" style={{ ...input, width: 80 }} />
            </div>
          </FormField>
          <FormField label={T('Điều kiện', 'Small print')}>
            <input value={o.terms} onChange={(e) => setO({ ...o, terms: e.target.value })} placeholder={T('khách mới / đặt trước / không gộp', 'new clients / booked ahead')} style={input} />
          </FormField>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => save(o)} disabled={busy || !dirty} style={{ ...btn, background: '#6366f1', border: 'none', color: '#fff', fontWeight: 700, opacity: busy || !dirty ? 0.6 : 1 }}>
              {busy ? T('Đang lưu…', 'Saving…') : T('Lưu ưu đãi — cập nhật lịch', 'Save the offer — update the plan')}
            </button>
            {offer.updatedBy && <span style={{ fontSize: 11, color: 'var(--c64748b)' }}>{T('Lần cuối', 'Last')}: {offer.updatedBy}{offer.updatedAt ? ` · ${offer.updatedAt.slice(0, 10)}` : ''}</span>}
          </div>
        </div>
      )}
      {o.mode === 'custom' && !openForm && (
        <button onClick={() => setOpenForm(true)} style={{ ...btn, marginTop: 8, fontSize: 12 }}>{T('Sửa ưu đãi', 'Edit the offer')}</button>
      )}
    </div>
  );
}

function FormField({ label: l, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ ...label, fontSize: 10, marginBottom: 4 }}>{l}</div>
      {children}
    </div>
  );
}

function Field({ label: l, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 8 }}>
      <div style={{ ...label, flex: '0 0 84px', paddingTop: 2 }}>{l}</div>
      <div style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.55 }}>{children}</div>
    </div>
  );
}

/**
 * A block that is a single line until somebody wants it. Used for the two
 * things this screen used to open with — the reasoning and the prep — which
 * are worth having and are not worth reading before the work.
 */
function Fold({ label: l, hint, open, onToggle, children }: {
  label: string; hint?: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: 12, border: '1px solid var(--line)', borderRadius: 10, background: 'var(--c0f172a)' }}>
      <button
        onClick={onToggle}
        aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
          background: 'transparent', border: 'none', padding: '12px 16px', cursor: 'pointer',
          font: 'inherit', color: 'var(--ccbd5e1)', fontSize: 13, fontWeight: 600,
        }}
      >
        <span style={{ color: 'var(--c64748b)', fontSize: 11 }}>{open ? '\u25be' : '\u25b8'}</span>
        {l}
        {hint && <span style={{ fontWeight: 500, color: 'var(--c64748b)', fontSize: 12 }}>{'  \u00b7  '}{hint}</span>}
      </button>
      {open && <div style={{ padding: '0 16px 14px' }}>{children}</div>}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 16, borderTop: '1px solid var(--c334155)', paddingTop: 12 }}>
      <div style={label}>{title}</div>
      {hint && <div style={{ fontSize: 11.5, color: 'var(--c64748b)', margin: '2px 0 6px' }}>{hint}</div>}
      <div style={{ marginTop: 4 }}>{children}</div>
    </div>
  );
}

const card: React.CSSProperties = {
  background: 'var(--c1e293b)', border: '1px solid var(--c334155)',
  borderRadius: 12, padding: 18, marginBottom: 14,
};
const label: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 700, letterSpacing: '.7px',
  textTransform: 'uppercase', color: 'var(--c64748b)',
};
const pill: React.CSSProperties = {
  fontSize: 11.5, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
  border: '1px solid', whiteSpace: 'nowrap',
};
const btn: React.CSSProperties = {
  padding: '7px 13px', borderRadius: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
  border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ce2e8f0)',
};
const mini: React.CSSProperties = {
  width: 26, height: 26, borderRadius: 7, cursor: 'pointer', fontSize: 12,
  border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--c94a3b8)',
};
const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'var(--c0f172a)',
  border: '1px solid var(--c475569)', color: 'var(--ce2e8f0)',
  borderRadius: 7, padding: '7px 9px', fontSize: 13, fontFamily: 'inherit',
};
const kindSelect: React.CSSProperties = {
  ...input, width: 'auto', padding: '2px 4px', fontSize: 12, flex: '0 0 auto', maxWidth: 130,
};
const sheetToggle: React.CSSProperties = {
  background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11.5, fontWeight: 600,
};
const sheet: React.CSSProperties = {
  marginTop: 6, padding: '8px 10px', borderRadius: 9, background: 'var(--c0f172a)', border: '1px solid var(--line)',
};
const tickBox: React.CSSProperties = {
  width: 18, height: 18, borderRadius: 5, border: '1.5px solid', cursor: 'pointer', flex: '0 0 auto', marginTop: 1,
  fontSize: 11, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0,
};
