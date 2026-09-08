'use client';

import { useState } from 'react';
import { apiFetch } from '../lib/api';
import { Inline } from './WeekPlanBoard';
import { ItemComments } from './ContentChat';

/**
 * The shop's week, in the order the owner actually asks her questions.
 *
 * WHAT WAS WRONG WITH THE FIRST VERSION
 *
 * It opened on a list of chores — four or five rows marked TIỆM LÀM, each
 * with a six-step technical shot list — and the agency's own work sat in the
 * same list at the same weight. A salon that hires an agency is buying the
 * right not to think about marketing; what it got was homework, and no sign
 * of what it was paying for.
 *
 * THE ORDER, AND WHY IT IS THIS ORDER
 *
 *   1. WHAT YOU GOT. Last week's real numbers — posts published, new
 *      reviews, new customers — with the change against the week before.
 *      This is the answer to the only question an owner opens the app to
 *      ask, so it goes first, not last.
 *   2. WHAT WE ARE DOING. The week's work with Lumio's name on it, in full,
 *      so the service is visible rather than implied. Editable, because the
 *      shop may still move or reword anything on its own plan.
 *   3. WHAT WE NEED FROM YOU. Exactly one ask (see weekly-ask on the server),
 *      one deadline, one button. Everything technical is folded away behind
 *      "mẹo quay đẹp" and framed as optional, because a shop that cannot
 *      shoot is not a shop that is failing — it is a shop that hired us.
 */

export interface ShopJob {
  id?: string; dayIndex: number; day: string; kind: string; by?: 'shop' | 'lumio';
  text: string; steps?: string[]; done?: number[]; how: string | null;
}
/**
 * `days`, and every job's `id` and `by`, arrive from an API that knows about
 * shop-side editing. Both are optional here on purpose: the web deploys before
 * the API does, and a browser that got the new page against yesterday's server
 * must show a readable week, not a blank screen. Missing them means read-only.
 */
export interface ShopWeekData {
  focus: string; jobs: ShopJob[]; prep: { label: string; detail: string }[]; days?: string[];
  /** The one thing asked of the shop this week. Absent on an older API. */
  ask?: { jobIds: string[]; what: string; by: string; byDayIndex: number } | null;
  /** Counter habits — shown as a soft line, never as a task. */
  counterIds?: string[];
}
export interface LastWeek {
  label: string; posted: number; reviews: number; newCustomers: number; bookings: number;
  delta: { reviews: number | null; newCustomers: number | null; bookings: number | null };
}
export interface HolidayIdea {
  key: string; name: string; date: string; daysAway: number; spanDays: number; idea: string; window: string;
  offer: { kind: 'percent' | 'amount' | 'gift'; value: number; gift: string; slot: string; expires: string; terms: string };
}

const ICON: Record<string, string> = {
  film: '🎬', photo: '📷', engage: '💚', post: '📣', story: '📱', offer: '🎁', winback: '💌', gbp: '📍', event: '📅',
};

const SHOP_KINDS = ['film', 'photo', 'engage'] as const;

/** Day labels rebuilt from the jobs themselves, for an API that sends no `days`. */
function dayLabelsFrom(jobs: ShopJob[]): string[] {
  const out: string[] = [];
  for (const j of jobs) {
    const i = Number(j.dayIndex);
    if (Number.isInteger(i) && i >= 0 && i < 14 && !out[i]) out[i] = j.day;
  }
  return Array.from({ length: out.length }, (_, i) => out[i] ?? '');
}

export function ShopWeek({ token, vi, week, weekKey, unread, lastWeek, onSend, onChanged, onError }: {
  token: string | null; vi: boolean; week: ShopWeekData; weekKey: string | null; unread?: number;
  lastWeek?: LastWeek | null;
  /** Open the file picker on the send box above — the ask's one button. */
  onSend?: () => void;
  onChanged: () => Promise<void> | void; onError: (m: string | null) => void;
}) {
  const T = (v: string, e: string) => (vi ? v : e);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<{ dayIndex: number; kind: typeof SHOP_KINDS[number]; text: string } | null>(null);
  // Editing needs a week to address and an id per job. An older API sends
  // neither, and the week still reads perfectly without them.
  const canEdit = Boolean(token && weekKey && week.jobs.every((j) => j.id));

  async function patch(body: { jobs?: unknown[]; add?: unknown[] }) {
    if (!token) return;
    setBusy(true); onError(null);
    try {
      await apiFetch('/content/my-week', { method: 'PATCH', token, body: { lang: vi ? 'vi' : 'en', ...body } });
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : T('Chưa lưu được, thử lại giúp em', 'Could not save — please try again'));
    } finally { setBusy(false); }
  }

  async function tick(job: ShopJob, step: number, done: boolean) {
    if (!token || !weekKey) return;
    try {
      await apiFetch(`/content/weeks/${encodeURIComponent(weekKey)}/tick`, { method: 'POST', token, body: { jobId: job.id, step, done } });
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'error');
    }
  }

  // The seven labels, or — against an older API — the labels the jobs carry.
  const labels = week.days?.length ? week.days : dayLabelsFrom(week.jobs);
  // The three groups the screen is built from. An older API sends no `ask`,
  // in which case the shop's own jobs stay in the list where they used to be.
  const askIds = new Set(week.ask?.jobIds ?? []);
  const counterIds = new Set(week.counterIds ?? []);
  const askJobs = week.jobs.filter((j) => j.id && askIds.has(j.id));
  const counterJobs = week.jobs.filter((j) => j.id && counterIds.has(j.id));
  const lumioJobs = week.jobs.filter((j) => !(j.id && (askIds.has(j.id) || counterIds.has(j.id))));
  const byDay = labels.map((label, di) => ({ label, di, jobs: lumioJobs.filter((j) => j.dayIndex === di) }));

  return (
    <section style={{ marginBottom: 18 }}>
      {/* ---- 1. what the shop GOT ----
             First, because it is the question the owner opened the app to ask.
             Every figure is her own row count; nothing here claims a booking
             came from a post. */}
      {lastWeek && (
        <div style={{ ...card, marginBottom: 12, background: 'var(--c0f172a)', borderColor: 'var(--c334155)' }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.6px', color: 'var(--c64748b)', marginBottom: 9 }}>
            {T(`TUẦN RỒI TIỆM NHẬN ĐƯỢC · ${lastWeek.label}`, `WHAT YOU GOT LAST WEEK · ${lastWeek.label}`)}
          </div>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))' }}>
            <Stat n={lastWeek.posted} label={T('bài đã đăng', 'posts published')} />
            <Stat n={lastWeek.reviews} label={T('đánh giá mới', 'new reviews')} delta={lastWeek.delta.reviews} />
            <Stat n={lastWeek.newCustomers} label={T('khách mới', 'new customers')} delta={lastWeek.delta.newCustomers} />
            <Stat n={lastWeek.bookings} label={T('lượt đặt lịch', 'bookings')} delta={lastWeek.delta.bookings} />
          </div>
        </div>
      )}

      {/* ---- 2. what LUMIO is doing ----
             The service, visible. Named, dated and in full — a client who
             cannot see the work assumes there is none. */}
      <h2 style={h2}>{T('Tuần này bên em làm cho tiệm', 'What we are doing for you this week')}</h2>
      <p style={lede}>{week.focus}</p>

      <div style={card}>
        {byDay.map(({ label, di, jobs }) => (
          <div key={di} style={{ padding: '9px 0', borderTop: di === 0 ? 'none' : '1px solid var(--c1e293b)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 11.5, color: di === 0 ? '#a5b4fc' : 'var(--c64748b)', fontWeight: 800, letterSpacing: '.4px' }}>
                {di === 0 ? T('HÔM NAY', 'TODAY') : label.toUpperCase()}
              </div>
              {canEdit && (
                <button
                  onClick={() => setAdding({ dayIndex: di, kind: 'film', text: '' })}
                  style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--c64748b)', fontSize: 12, cursor: 'pointer', padding: '2px 4px' }}
                >＋ {T('thêm việc', 'add')}</button>
              )}
            </div>
            {!jobs.length && !(adding?.dayIndex === di) && (
              <div style={{ fontSize: 12.5, color: 'var(--c475569)', padding: '4px 0' }}>{T('Nghỉ', 'Rest')}</div>
            )}
            {jobs.map((j) => (
              <JobLine key={j.id ?? `${di}:${j.text}`} j={j} vi={vi} canEdit={canEdit} busy={busy} days={labels}
                onText={(text) => patch({ jobs: [{ id: j.id, text }] })}
                onSteps={(steps) => patch({ jobs: [{ id: j.id, steps }] })}
                onMove={(dayIndex) => patch({ jobs: [{ id: j.id, dayIndex }] })}
                onRemove={() => { if (window.confirm(T('Bỏ việc này khỏi tuần?', 'Drop this job from the week?'))) void patch({ jobs: [{ id: j.id, remove: true }] }); }}
                onTick={(step, done) => tick(j, step, done)}
              />
            ))}
            {adding?.dayIndex === di && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
                <select value={adding.kind} onChange={(e) => setAdding({ ...adding, kind: e.target.value as typeof SHOP_KINDS[number] })} style={select}>
                  <option value="film">🎬 {T('Quay', 'Film')}</option>
                  <option value="photo">📷 {T('Chụp', 'Photos')}</option>
                  <option value="engage">💚 {T('Tại quầy', 'At the counter')}</option>
                </select>
                <input
                  autoFocus value={adding.text} onChange={(e) => setAdding({ ...adding, text: e.target.value })}
                  placeholder={T('Việc gì? ví dụ: quay bộ móng cô dâu', 'What? e.g. film the bridal set')}
                  onKeyDown={(e) => { if (e.key === 'Enter' && adding.text.trim()) { void patch({ add: [adding] }); setAdding(null); } if (e.key === 'Escape') setAdding(null); }}
                  style={{ ...input, flex: '1 1 200px' }}
                />
                <button disabled={!adding.text.trim() || busy} onClick={() => { void patch({ add: [adding] }); setAdding(null); }} style={smallPrimary}>{T('Thêm', 'Add')}</button>
                <button onClick={() => setAdding(null)} style={smallGhost}>✕</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ---- 3. the ONE thing asked of the shop ----
             One ask, one deadline, one button. The shot list is folded away
             and called a tip, not a step: a shop that cannot shoot well is
             not failing its plan, it is the reason it hired us. */}
      {week.ask && askJobs.length > 0 && (
        <div style={{
          ...card, marginTop: 14, borderColor: '#22c55e',
          background: 'linear-gradient(135deg, rgba(34,197,94,.14), rgba(34,197,94,.04))',
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15.5, fontWeight: 800, color: 'var(--cf1f5f9)' }}>
              {T('Bên em cần tiệm giúp 1 việc', 'One thing we need from you')}
            </span>
            <span style={{
              fontSize: 12, fontWeight: 800, padding: '2px 9px', borderRadius: 999,
              background: week.ask.byDayIndex <= 1 ? 'rgba(245,158,11,.18)' : 'rgba(148,163,184,.14)',
              color: week.ask.byDayIndex <= 1 ? '#fbbf24' : 'var(--c94a3b8)',
            }}>{week.ask.by}</span>
          </div>
          <div style={{ fontSize: 14, color: 'var(--ce2e8f0)', lineHeight: 1.6, marginTop: 5 }}>{week.ask.what}</div>

          {onSend && (
            <button onClick={onSend} style={{ ...smallPrimary, minHeight: 46, fontSize: 15, marginTop: 11, width: '100%' }}>
              📷 {T('Chụp/quay xong rồi — gửi cho Lumio', 'Shot it — send to Lumio')}
            </button>
          )}

          {/* The habit at the counter. One line, no steps, nothing to tick —
              it is worth money and it is not a chore. */}
          {counterJobs.map((j) => (
            <div key={j.id} style={{ fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.55, marginTop: 9, display: 'flex', gap: 7 }}>
              <span style={{ flex: '0 0 auto' }}>🌟</span>
              <span><b style={{ color: 'var(--ccbd5e1)' }}>{T('Tiện thì:', 'When it is easy:')}</b> {j.text}</span>
            </div>
          ))}

          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: '#86efac', listStyle: 'none' }}>
              {T('Mẹo quay cho đẹp (không bắt buộc) →', 'Tips for a good shot (optional) →')}
            </summary>
            <div style={{ marginTop: 7, paddingLeft: 10, borderLeft: '2px solid rgba(34,197,94,.35)' }}>
              <div style={{ fontSize: 12, color: 'var(--c64748b)', lineHeight: 1.55, marginBottom: 7 }}>
                {T('Quay được bao nhiêu gửi bấy nhiêu — thiếu hay xấu bên em vẫn dựng được. Đây chỉ là mẹo cho nhanh và đẹp hơn.',
                   'Send whatever you get — we can work with less, and with rough. These are only tips to make it quicker and better.')}
              </div>
              {askJobs.map((j) => (
                <AskDetail key={j.id} j={j} vi={vi} canEdit={canEdit} days={labels}
                  onText={(text) => patch({ jobs: [{ id: j.id, text }] })}
                  onSteps={(steps) => patch({ jobs: [{ id: j.id, steps }] })}
                  onMove={(dayIndex) => patch({ jobs: [{ id: j.id, dayIndex }] })}
                />
              ))}
            </div>
          </details>
        </div>
      )}

      {/* An older API sends no `ask`; the shop's own jobs then stay where they
          have always been rather than vanishing from the screen. */}
      {!week.ask && (askJobs.length > 0 || counterJobs.length > 0) && null}

      {!!week.prep.length && (
        <div style={{ ...card, background: 'var(--c0f172a)', marginTop: 10 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.6px', color: 'var(--c64748b)', marginBottom: 7 }}>
            {T('BÊN EM CHUẨN BỊ SẴN CHO TIỆM', 'WHAT WE HAVE READY FOR YOU')}
          </div>
          {week.prep.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: 9, padding: '4px 0' }}>
              <span style={{ color: 'var(--c475569)', flex: '0 0 auto' }}>▢</span>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ce2e8f0)', lineHeight: 1.45 }}>{l.label}</div>
                <div style={{ fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.5 }}>{l.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* The thread under the week. Same address the team's board uses
          (week:KEY), so a remark made here is read there, and the week in
          October still carries what was said about it in October. */}
      {weekKey && (
        <ItemComments
          token={token} subject={`week:${weekKey}`} unread={unread ?? 0} vi={vi}
          labelVi={vi ? 'Trao đổi với Lumio về tuần này' : 'Discuss this week with Lumio'}
        />
      )}
    </section>
  );
}

/** One number from last week, with the change against the week before. */
function Stat({ n, label, delta }: { n: number; label: string; delta?: number | null }) {
  const up = typeof delta === 'number' && delta > 0;
  const down = typeof delta === 'number' && delta < 0;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
        <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--cf1f5f9)', lineHeight: 1.1 }}>{n}</span>
        {(up || down) && (
          <span style={{ fontSize: 11.5, fontWeight: 800, color: up ? '#86efac' : '#fca5a5' }}>
            {up ? '▲' : '▼'}{Math.abs(delta as number)}
          </span>
        )}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--c94a3b8)', marginTop: 2, lineHeight: 1.35 }}>{label}</div>
    </div>
  );
}

/**
 * One of the shop's own jobs, inside the tips fold: the instruction, the shot
 * list, and the day — all editable, because the shop may still rewrite its own
 * plan. Deliberately without checkboxes: ticking six shots is bookkeeping the
 * shop is not being paid to do, and an untouched 0/6 reads as a failure that
 * never happened.
 */
function AskDetail({ j, vi, canEdit, days, onText, onSteps, onMove }: {
  j: ShopJob; vi: boolean; canEdit: boolean; days: string[];
  onText: (t: string) => void; onSteps: (s: string[]) => void; onMove: (d: number) => void;
}) {
  const T = (v: string, e: string) => (vi ? v : e);
  const steps = j.steps ?? [];
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 13, color: 'var(--ce2e8f0)', lineHeight: 1.5, fontWeight: 600 }}>
        <Inline value={j.text} canEdit={canEdit} onCommit={onText} multiline />
      </div>
      {!!steps.length && (
        <ul style={{ margin: '5px 0 0', paddingLeft: 17, color: 'var(--c94a3b8)', fontSize: 12.5, lineHeight: 1.6 }}>
          {steps.map((st, k) => (
            <li key={k} style={{ marginBottom: 2 }}>
              <Inline value={st} canEdit={canEdit} onCommit={(v) => { const next = [...steps]; next[k] = v; onSteps(next.filter(Boolean)); }} multiline />
            </li>
          ))}
        </ul>
      )}
      {j.how && <div style={{ fontSize: 12, color: 'var(--c64748b)', lineHeight: 1.55, marginTop: 5 }}>{j.how}</div>}
      {canEdit && (
        <div style={{ marginTop: 5 }}>
          <select value={j.dayIndex} onChange={(e) => onMove(Number(e.target.value))} style={{ ...select, fontSize: 11.5, padding: '2px 6px' }}>
            {days.map((d, i) => <option key={i} value={i}>{i === 0 ? T('Hôm nay', 'Today') : d}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

function JobLine({ j, vi, canEdit, busy, days, onText, onSteps, onMove, onRemove, onTick }: {
  j: ShopJob; vi: boolean; canEdit: boolean; busy: boolean; days: string[];
  onText: (t: string) => void; onSteps: (s: string[]) => void; onMove: (d: number) => void; onRemove: () => void;
  onTick: (step: number, done: boolean) => void;
}) {
  const T = (v: string, e: string) => (vi ? v : e);
  const steps = j.steps ?? [];
  const done = new Set(j.done ?? []);
  const by = j.by ?? (SHOP_KINDS.includes(j.kind as typeof SHOP_KINDS[number]) ? 'shop' : 'lumio');
  const [open, setOpen] = useState(false);
  const allDone = steps.length > 0 && steps.every((_, i) => done.has(i));
  return (
    <div style={{ display: 'flex', gap: 10, padding: '7px 0', opacity: busy ? 0.7 : 1 }}>
      <span style={{ fontSize: 17, lineHeight: 1.3, flex: '0 0 auto' }}>{ICON[j.kind] ?? '•'}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 10.5, fontWeight: 800, letterSpacing: '.4px', padding: '1px 6px', borderRadius: 6,
            background: by === 'shop' ? 'rgba(34,197,94,.15)' : 'rgba(99,102,241,.15)', color: by === 'shop' ? '#86efac' : '#a5b4fc',
          }}>{by === 'shop' ? T('TIỆM LÀM', 'YOU') : 'LUMIO'}</span>
          {allDone && <span style={{ fontSize: 11, color: '#86efac', fontWeight: 700 }}>✓ {T('xong', 'done')}</span>}
        </div>
        <div style={{ fontSize: 14, color: 'var(--ce2e8f0)', lineHeight: 1.5, marginTop: 2, textDecoration: allDone ? 'line-through' : undefined }}>
          <Inline value={j.text} canEdit={canEdit} onCommit={onText} multiline />
        </div>
        {(steps.length > 0 || j.how) && (
          <button onClick={() => setOpen((o) => !o)} style={{ background: 'transparent', border: 'none', padding: '3px 0', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: 'var(--ca5b4fc)' }}>
            {steps.length
              ? T(`Từng bước (${done.size}/${steps.length}) ${open ? '↑' : '→'}`, `Step by step (${done.size}/${steps.length}) ${open ? '↑' : '→'}`)
              : T('Làm thế nào cho đẹp →', 'How to do it well →')}
          </button>
        )}
        {open && (
          <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.6, marginTop: 3, paddingLeft: 10, borderLeft: '2px solid var(--c334155)' }}>
            {steps.map((st, k) => (
              <label key={k} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '3px 0', color: 'var(--ce2e8f0)' }}>
                <input type="checkbox" checked={done.has(k)} onChange={(e) => onTick(k, e.target.checked)} style={{ marginTop: 3 }} />
                <span style={{ flex: 1, textDecoration: done.has(k) ? 'line-through' : undefined, opacity: done.has(k) ? 0.6 : 1 }}>
                  <Inline value={st} canEdit={canEdit} onCommit={(v) => { const next = [...steps]; next[k] = v; onSteps(next.filter(Boolean)); }} multiline />
                </span>
                {canEdit && (
                  <button title={T('Bỏ bước', 'Remove step')} onClick={() => onSteps(steps.filter((_, i) => i !== k))} style={{ background: 'transparent', border: 'none', color: 'var(--c64748b)', cursor: 'pointer', padding: 0 }}>✕</button>
                )}
              </label>
            ))}
            {canEdit && steps.length < 12 && (
              <button onClick={() => onSteps([...steps, vi ? 'Bước mới' : 'New step'])} style={{ background: 'transparent', border: 'none', color: 'var(--c64748b)', fontSize: 12, cursor: 'pointer', padding: '2px 0' }}>＋ {T('thêm bước', 'add step')}</button>
            )}
            {j.how && <div style={{ marginTop: 5 }}>{j.how}</div>}
          </div>
        )}
        {canEdit && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
            <select value={j.dayIndex} onChange={(e) => onMove(Number(e.target.value))} style={{ ...select, fontSize: 11.5, padding: '2px 6px' }} title={T('Đổi ngày', 'Move to another day')}>
              {days.map((d, i) => <option key={i} value={i}>{i === 0 ? T('Hôm nay', 'Today') : d}</option>)}
            </select>
            <button onClick={onRemove} style={{ background: 'transparent', border: 'none', color: 'var(--c64748b)', fontSize: 11.5, cursor: 'pointer', padding: '2px 4px' }}>✕ {T('bỏ việc này', 'drop')}</button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The holidays ahead, each with one programme the shop can say yes to.
 * "Run this" files a request in the team's inbox; the team checks the
 * arithmetic on the offer form and runs it. Nothing runs from this screen.
 */
export function HolidayOffers({ token, vi, ideas, onError }: {
  token: string | null; vi: boolean; ideas: HolidayIdea[]; onError: (m: string | null) => void;
}) {
  const T = (v: string, e: string) => (vi ? v : e);
  const [sent, setSent] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [own, setOwn] = useState('');

  async function request(body: { key?: string; text?: string }, mark: string) {
    if (!token) return;
    setBusy(mark); onError(null);
    try {
      await apiFetch('/content/my-holidays/request', { method: 'POST', token, body });
      setSent((s) => ({ ...s, [mark]: true }));
      if (mark === 'own') setOwn('');
    } catch (e) {
      onError(e instanceof Error ? e.message : T('Chưa gửi được, thử lại giúp em', 'Could not send — please try again'));
    } finally { setBusy(null); }
  }

  if (!ideas.length && !token) return null;
  return (
    <section style={{ marginBottom: 18 }}>
      <h2 style={h2}>🎉 {T('Ngày lễ sắp tới & chương trình gợi ý', 'Holidays ahead & suggested programmes')}</h2>
      <p style={lede}>
        {T('Mỗi ngày lễ một chương trình đã tính sẵn mức giảm an toàn cho tiệm. Bấm "Chạy chương trình này" là bên em dựng bài và lên lịch — tiệm chỉ cần duyệt.',
           'One programme per holiday, with a discount already kept inside what the shop can afford. Press "Run this" and the team builds and schedules it — you only approve.')}
      </p>
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        {ideas.map((i) => (
          <div key={i.key} style={{ ...card, padding: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--cf1f5f9)' }}>{i.name}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: i.daysAway <= 7 ? '#fbbf24' : 'var(--c64748b)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                {i.daysAway === 0 ? T('hôm nay', 'today') : T(`còn ${i.daysAway} ngày`, `in ${i.daysAway} days`)}
              </span>
            </div>
            <div style={{ fontSize: 13.5, color: 'var(--ce2e8f0)', lineHeight: 1.5 }}>{i.idea}</div>
            <div style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{i.window}{i.offer.terms ? ` · ${i.offer.terms}` : ''}</div>
            <button
              disabled={busy === i.key || sent[i.key]}
              onClick={() => request({ key: i.key }, i.key)}
              style={{ ...smallPrimary, marginTop: 'auto', background: sent[i.key] ? 'rgba(34,197,94,.18)' : '#6366f1', color: sent[i.key] ? '#86efac' : '#fff' }}
            >
              {sent[i.key] ? T('✓ Đã gửi cho Lumio', '✓ Sent to Lumio') : busy === i.key ? '…' : T('Chạy chương trình này →', 'Run this →')}
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <input
          value={own} onChange={(e) => setOwn(e.target.value)}
          placeholder={T('Hoặc tiệm muốn chạy chương trình khác: giảm 20% gel thứ 3-5, tặng…', 'Or a programme of your own: 20% off gel Tue–Thu, free…')}
          style={{ ...input, flex: '1 1 260px', minHeight: 42 }}
          onKeyDown={(e) => { if (e.key === 'Enter' && own.trim()) void request({ text: own.trim() }, 'own'); }}
        />
        <button disabled={!own.trim() || busy === 'own'} onClick={() => request({ text: own.trim() }, 'own')} style={{ ...smallPrimary, minHeight: 42 }}>
          {sent.own && !own ? T('✓ Đã gửi', '✓ Sent') : T('Gửi Lumio', 'Send to Lumio')}
        </button>
      </div>
    </section>
  );
}

const card: React.CSSProperties = { background: 'var(--c1e293b)', border: '1px solid var(--c334155)', borderRadius: 14, padding: 15 };
const h2: React.CSSProperties = { fontSize: 17, margin: '0 0 3px', color: 'var(--cf1f5f9)', display: 'flex', alignItems: 'center', gap: 8 };
const lede: React.CSSProperties = { fontSize: 13, color: 'var(--c94a3b8)', lineHeight: 1.6, margin: '0 0 11px' };
const input: React.CSSProperties = {
  boxSizing: 'border-box', background: 'var(--c0f172a)', border: '1px solid var(--c475569)', color: 'var(--ce2e8f0)',
  borderRadius: 9, padding: '8px 10px', fontSize: 13.5, fontFamily: 'inherit', minWidth: 0,
};
const select: React.CSSProperties = { ...input, padding: '6px 8px', fontSize: 13 };
const smallPrimary: React.CSSProperties = { minHeight: 36, padding: '7px 12px', borderRadius: 9, border: 'none', background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' };
const smallGhost: React.CSSProperties = { minHeight: 36, padding: '7px 10px', borderRadius: 9, border: '1px solid var(--c475569)', background: 'transparent', color: 'var(--c94a3b8)', fontSize: 13, cursor: 'pointer' };
