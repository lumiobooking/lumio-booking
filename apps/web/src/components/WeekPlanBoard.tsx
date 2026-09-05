'use client';

import { useMemo, useState } from 'react';
import { dayKeyInTz } from '../lib/datetime';

/**
 * One week of a salon's marketing work, as a document a person can hand over
 * and a person can rewrite.
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
 * WHY THE EDITOR IS THE SAME LAYOUT
 *
 * Editing happens in place. A separate edit form would mean writing a plan in
 * one shape and reading it in another, and the version that gets checked is
 * always the one being read. Here the row you are looking at is the row you
 * change.
 */

export interface Job { kind: string; text: string; why: string; when?: string; from?: string }
export interface DayPlan { weekday: number; label: string; jobs: Job[] }
export interface Stage {
  key: string; step: number; title: string; goal: string; why: string; exitWhen: string;
  progress: { done: number; need: number; label: string } | null;
}
export interface ContentSourceRow { label: string; when: string; why: string }

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
}

export interface WeekSavePatch {
  focus?: string;
  note?: string;
  days?: DayPlan[];
  lang?: 'vi' | 'en';
  reset?: boolean;
}

const KINDS: { id: string; icon: string; vi: string; en: string }[] = [
  { id: 'film', icon: '🎬', vi: 'Quay', en: 'Film' },
  { id: 'post', icon: '📤', vi: 'Đăng', en: 'Post' },
  { id: 'story', icon: '📸', vi: 'Story', en: 'Story' },
  { id: 'offer', icon: '🏷️', vi: 'Ưu đãi', en: 'Offer' },
  { id: 'winback', icon: '💬', vi: 'Kéo khách cũ', en: 'Win back' },
  { id: 'engage', icon: '💚', vi: 'Tương tác', en: 'Engage' },
  { id: 'rest', icon: '·', vi: 'Nghỉ', en: 'Rest' },
];
const ICON = (k: string) => KINDS.find((x) => x.id === k)?.icon ?? '•';

/** 'YYYY-MM-DD' plus n days, done on the digits so no timezone can shift it. */
function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
const dm = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;

export function WeekPlanBoard({
  week, meta, isPast, vi, salonName, salonCity, onSave, onApprove, approving,
  onOpenToday, hasTodayDraft, stageAction,
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
}) {
  const T = (v: string, e: string) => (vi ? v : e);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [focus, setFocus] = useState(week.focus);
  const [note, setNote] = useState(week.teamNote ?? '');
  const [days, setDays] = useState<DayPlan[]>(week.days);

  // Dates for the seven rows. The plan starts at TODAY, not Monday, so the
  // dates are counted from today's salon date rather than from the week's
  // Monday — and counted on the digits, so a viewer in another timezone reads
  // the same dates as the salon does.
  const dates = useMemo(() => {
    const start = dayKeyInTz(new Date());
    return week.days.map((_, i) => addDays(start, i));
  }, [week.days]);

  const jobCount = week.days.reduce(
    (n, d) => n + d.jobs.filter((j) => j.kind !== 'rest').length, 0,
  );

  function open() {
    setFocus(week.focus);
    setNote(week.teamNote ?? '');
    // Each job remembers where it came from, so moving it to another day
    // carries its English phrasing with it instead of flattening the week to
    // one language on the first save.
    setDays(week.days.map((d, di) => ({
      ...d,
      jobs: d.jobs.map((j, ji) => ({ ...j, from: `${di}:${ji}` })),
    })));
    setEditing(true);
  }

  async function save(patch: WeekSavePatch) {
    setSaving(true);
    try { await onSave(patch); setEditing(false); } finally { setSaving(false); }
  }

  const mutate = (di: number, fn: (jobs: Job[]) => Job[]) =>
    setDays((prev) => prev.map((d, i) => (i === di ? { ...d, jobs: fn(d.jobs) } : d)));

  const moveWithin = (di: number, ji: number, by: number) => mutate(di, (jobs) => {
    const to = ji + by;
    if (to < 0 || to >= jobs.length) return jobs;
    const next = [...jobs];
    [next[ji], next[to]] = [next[to], next[ji]];
    return next;
  });

  const moveToDay = (di: number, ji: number, target: number) => setDays((prev) => {
    if (target === di) return prev;
    const job = prev[di].jobs[ji];
    return prev.map((d, i) => {
      if (i === di) return { ...d, jobs: d.jobs.filter((_, k) => k !== ji) };
      if (i === target) return { ...d, jobs: [...d.jobs.filter((j) => j.kind !== 'rest'), job] };
      return d;
    });
  });

  const rows = editing ? days : week.days;

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
          <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 2 }}>
            {[salonName, salonCity].filter(Boolean).join(' · ')}
            {week.trade ? ` · ${week.trade}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
          {meta?.approvedAt && (
            <span style={{ ...pill, borderColor: '#22c55e', color: '#22c55e' }}>
              ✓ {T('Tiệm đã duyệt', 'Approved')}{meta.approvedByName ? ` — ${meta.approvedByName}` : ''}
            </span>
          )}
          {meta?.edited && !editing && (
            <span style={{ ...pill, borderColor: 'var(--c475569)', color: 'var(--ca5b4fc)' }}>
              ✎ {T('Team đã chỉnh', 'Edited')}{meta.editedByName ? ` — ${meta.editedByName}` : ''}
            </span>
          )}
          {!isPast && onApprove && (
            <button onClick={onApprove} disabled={approving} style={{ ...btn, background: '#22c55e', color: '#052e16', border: 'none', fontWeight: 700 }}>
              {approving ? T('Đang lưu…', 'Saving…') : T('✓ Duyệt kế hoạch', '✓ Approve')}
            </button>
          )}
          {!isPast && meta?.canEdit && !editing && (
            <button onClick={open} style={{ ...btn, borderColor: '#6366f1', color: 'var(--ca5b4fc)' }}>
              ✎ {T('Sửa kế hoạch', 'Edit plan')}
            </button>
          )}
        </div>
      </div>

      {/* ---- the reasoning, as a short labelled block rather than four
              different type treatments stacked on top of each other ---- */}
      <div style={{ marginTop: 14, borderTop: '1px solid var(--c334155)', paddingTop: 12 }}>
        <Field label={T('TRỌNG TÂM', 'FOCUS')}>
          {editing ? (
            <input value={focus} onChange={(e) => setFocus(e.target.value)} style={input} />
          ) : (
            <span style={{ color: 'var(--ce2e8f0)', fontWeight: 600 }}>{week.focus}</span>
          )}
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
              {stageAction && !editing && (
                <button onClick={stageAction.onGo} style={{ ...btn, marginTop: 8, borderColor: '#6366f1', color: 'var(--ca5b4fc)' }}>
                  {stageAction.label} →
                </button>
              )}
            </div>
          </Field>
        )}
        {(week.teamNote || editing) && (
          <Field label={T('LUMIO NHẮN', 'FROM LUMIO')}>
            {editing ? (
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} style={{ ...input, resize: 'vertical' }} />
            ) : (
              <span style={{ color: 'var(--ce2e8f0)' }}>{week.teamNote}</span>
            )}
          </Field>
        )}
      </div>

      {/* ---- the week itself ---- */}
      <div style={{ marginTop: 16, borderTop: '1px solid var(--c334155)', paddingTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
          <div style={label}>{T('LỊCH TUẦN', 'THE WEEK')}</div>
          <div style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--c64748b)' }}>
            {jobCount} {T('việc', jobCount === 1 ? 'job' : 'jobs')}
          </div>
        </div>

        {rows.map((d, di) => {
          const real = d.jobs.filter((j) => j.kind !== 'rest');
          const isToday = di === 0 && !isPast;
          const resting = real.length === 0;
          return (
            <div
              key={`${d.weekday}-${di}`}
              style={{
                display: 'flex', gap: 12, padding: '10px 0 10px 11px',
                borderTop: di === 0 ? 'none' : '1px solid var(--c1e293b)',
                borderLeft: `2px solid ${isToday ? '#f59e0b' : 'transparent'}`,
                marginLeft: -11,
              }}
            >
              {/* the date column — a plan says which day, not "in three days" */}
              <div style={{ flex: '0 0 74px' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: isToday ? '#fbbf24' : 'var(--ce2e8f0)' }}>
                  {d.label}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--c64748b)' }}>{dates[di] ? dm(dates[di]) : ''}</div>
                {isToday && <div style={{ fontSize: 10.5, fontWeight: 700, color: '#f59e0b', letterSpacing: '.4px' }}>{T('HÔM NAY', 'TODAY')}</div>}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                {resting && !editing && (
                  <div style={{ fontSize: 12.5, color: 'var(--c475569)', paddingTop: 2 }}>
                    {T('Nghỉ — không có việc nào', 'Rest — nothing scheduled')}
                  </div>
                )}

                {(editing ? d.jobs.filter((j) => j.kind !== 'rest') : real).map((j, ji) => (
                  editing ? (
                    <JobEditor
                      key={ji}
                      job={j}
                      index={ji}
                      total={real.length}
                      days={days}
                      dayIndex={di}
                      vi={vi}
                      onChange={(patch) => mutate(di, (jobs) => jobs.map((x, k) => (k === ji ? { ...x, ...patch } : x)))}
                      onRemove={() => mutate(di, (jobs) => jobs.filter((_, k) => k !== ji))}
                      onMove={(by) => moveWithin(di, ji, by)}
                      onMoveDay={(t) => moveToDay(di, ji, t)}
                    />
                  ) : (
                    <div key={ji} style={{ display: 'flex', gap: 9, marginBottom: ji < real.length - 1 ? 9 : 0 }}>
                      <span style={{ flex: '0 0 16px', fontSize: 11.5, color: 'var(--c475569)', paddingTop: 2, textAlign: 'right' }}>{ji + 1}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, color: 'var(--ce2e8f0)', lineHeight: 1.5, fontWeight: 500 }}>
                          <span style={{ marginRight: 6 }}>{ICON(j.kind)}</span>{j.text}
                          {j.when && <span style={{ color: 'var(--c64748b)', fontSize: 12, fontWeight: 400 }}> · {j.when}</span>}
                        </div>
                        {j.why && (
                          <div style={{ fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.5, marginTop: 1 }}>
                            <span style={{ color: 'var(--c475569)', marginRight: 5 }}>↳</span>{j.why}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                ))}

                {editing && (
                  <button
                    onClick={() => mutate(di, (jobs) => [
                      ...jobs.filter((j) => j.kind !== 'rest'),
                      { kind: 'post', text: '', why: '' },
                    ])}
                    style={{ ...btn, marginTop: 7, fontSize: 12, padding: '5px 10px', color: 'var(--c94a3b8)' }}
                  >
                    + {T('Thêm việc', 'Add a job')}
                  </button>
                )}

                {isToday && !resting && !editing && hasTodayDraft && onOpenToday && (
                  <button onClick={onOpenToday} style={{ ...btn, marginTop: 9, borderColor: 'var(--c475569)', color: 'var(--ca5b4fc)' }}>
                    {T('Mở bài viết đã soạn cho hôm nay', 'Open today’s drafted post')} →
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {editing && (
        <div style={{
          marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--c334155)',
          display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <button
            disabled={saving}
            onClick={() => save({ focus, note, days, lang: vi ? 'vi' : 'en' })}
            style={{ ...btn, background: '#6366f1', border: 'none', color: '#fff', fontWeight: 700, opacity: saving ? 0.6 : 1 }}
          >
            {saving ? T('Đang lưu…', 'Saving…') : T('Lưu cho tiệm', 'Save for the salon')}
          </button>
          <button onClick={() => setEditing(false)} disabled={saving} style={btn}>
            {T('Huỷ', 'Cancel')}
          </button>
          {meta?.edited && (
            <button
              disabled={saving}
              onClick={() => save({ reset: true })}
              style={{ ...btn, marginLeft: 'auto', borderColor: 'var(--c475569)', color: 'var(--cf87171)' }}
            >
              ↺ {T('Bỏ bản sửa, dùng lại bản hệ thống', 'Discard edits, use the system’s week')}
            </button>
          )}
          <div style={{ flexBasis: '100%', fontSize: 11.5, color: 'var(--c64748b)', lineHeight: 1.55 }}>
            {T('Bản hệ thống tự viết vẫn được giữ nguyên bên dưới — sau này còn so được sửa gì và có tốt hơn không. Chữ bạn tự gõ sẽ hiện y như vậy ở cả bản tiếng Anh; những câu bạn không đụng tới thì giữ nguyên cả hai thứ tiếng.',
               'The system’s own week is kept underneath, so what changed stays answerable. Text you type is stored in one language and reads the same on both sides; phrases you leave alone keep both.')}
          </div>
        </div>
      )}

      {/* ---- the two supporting sections ---- */}
      {!!week.sources?.length && !editing && (
        <Section title={T('QUAY TỪ ĐÂU', 'WHAT TO FILM')}
          hint={T(`Nguồn có sẵn của ${week.trade} — không cần dựng cảnh`, 'Already in front of you — nothing to stage')}>
          {week.sources.map((s, k) => (
            <div key={k} style={{ padding: '4px 0' }}>
              <div style={{ fontSize: 13, color: 'var(--ce2e8f0)' }}>
                • {s.label} <span style={{ color: '#f59e0b', fontSize: 12 }}>· {s.when}</span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--c64748b)', lineHeight: 1.45, paddingLeft: 11 }}>{s.why}</div>
            </div>
          ))}
        </Section>
      )}

      {!!week.daily?.length && !editing && (
        <Section title={T('MỖI NGÀY, DÙ BẬN CỠ NÀO', 'EVERY DAY, HOWEVER BUSY')}>
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
    </div>
  );
}

/** One job, open for rewriting. Same row, same order, now with handles. */
function JobEditor({
  job, index, total, days, dayIndex, vi, onChange, onRemove, onMove, onMoveDay,
}: {
  job: Job; index: number; total: number; days: DayPlan[]; dayIndex: number; vi: boolean;
  onChange: (patch: Partial<Job>) => void;
  onRemove: () => void;
  onMove: (by: number) => void;
  onMoveDay: (target: number) => void;
}) {
  const T = (v: string, e: string) => (vi ? v : e);
  return (
    <div style={{
      border: '1px solid var(--c334155)', borderRadius: 9, padding: 9, marginBottom: 8,
      background: 'var(--c0f172a)',
    }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
        <select value={job.kind} onChange={(e) => onChange({ kind: e.target.value })} style={{ ...input, width: 'auto', padding: '5px 8px' }}>
          {KINDS.map((k) => <option key={k.id} value={k.id}>{k.icon} {vi ? k.vi : k.en}</option>)}
        </select>
        <input
          value={job.when ?? ''}
          onChange={(e) => onChange({ when: e.target.value })}
          placeholder={T('giờ (không bắt buộc)', 'time (optional)')}
          style={{ ...input, width: 150, padding: '5px 8px' }}
        />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          <button onClick={() => onMove(-1)} disabled={index === 0} title={T('Lên trên', 'Move up')} style={mini}>↑</button>
          <button onClick={() => onMove(1)} disabled={index === total - 1} title={T('Xuống dưới', 'Move down')} style={mini}>↓</button>
          <select
            value={dayIndex}
            onChange={(e) => onMoveDay(Number(e.target.value))}
            title={T('Chuyển sang ngày khác', 'Move to another day')}
            style={{ ...input, width: 'auto', padding: '5px 8px', fontSize: 12 }}
          >
            {days.map((d, i) => <option key={i} value={i}>{i === 0 ? T('Hôm nay', 'Today') : d.label}</option>)}
          </select>
          <button onClick={onRemove} title={T('Xoá việc này', 'Delete')} style={{ ...mini, color: 'var(--cf87171)' }}>✕</button>
        </div>
      </div>
      <input
        value={job.text}
        onChange={(e) => onChange({ text: e.target.value })}
        placeholder={T('Việc cần làm — ngắn, đọc được trên điện thoại lúc 7 giờ sáng', 'The job itself — short')}
        style={{ ...input, marginBottom: 6, fontWeight: 600 }}
      />
      <textarea
        value={job.why}
        onChange={(e) => onChange({ why: e.target.value })}
        rows={2}
        placeholder={T('Vì sao việc này nằm ở ngày này — phần khiến tiệm tin và làm theo', 'Why it sits on this day')}
        style={{ ...input, resize: 'vertical', fontSize: 12.5 }}
      />
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
  width: 28, height: 28, borderRadius: 7, cursor: 'pointer', fontSize: 13,
  border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--c94a3b8)',
};
const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'var(--c1e293b)',
  border: '1px solid var(--c475569)', color: 'var(--ce2e8f0)',
  borderRadius: 7, padding: '7px 9px', fontSize: 13, fontFamily: 'inherit',
};
