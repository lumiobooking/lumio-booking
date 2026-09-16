'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { instantToWall } from '../lib/datetime';
import { WD_VI, WD_EN, MONTH_VI, MONTH_EN, mondayIndex, addDays } from './plan-grid';
import {
  PILLARS, FORMATS, AIR, pillarOf, formatOf, emptyEntry, entryHasContent, entryReady, monthWeeks, monthTitle, sheetProgress,
  type PlanEntry, type PlanPatch, type Air, type SheetDay,
} from './plan-sheet';

/**
 * THE PLAN SHEET — a month of posts, one card per day, one editor at a time.
 *
 * WHAT WAS WRONG WITH VERSION ONE
 *
 * It copied the agency's Google Sheet literally: six input rows under each
 * of seven days, five weeks deep — two hundred and ten form fields on one
 * screen, every one bordered and captioned, empty or not. A spreadsheet
 * gets away with this because an empty cell is silent; a bordered input with
 * a placeholder is not. The eye had no way to tell a planned day from a
 * blank one, the caption boxes made each week six hundred pixels tall, and
 * the shop — who reads this to see what its month looks like — was shown a
 * form.
 *
 * WHAT THIS IS INSTEAD
 *
 * Reading and writing are separated. The grid READS: a card per day showing
 * only what has been decided — the pillar as a coloured edge, the topic, the
 * networks, the format, and what happened to it (drafted / scheduled /
 * posted). An empty day is a quiet dashed cell with a plus. Writing happens
 * in a panel that slides in from the right for ONE day, wide enough to write
 * a caption in, with arrows to the day before and after so a week can be
 * planned without touching the grid. The shop sees the same grid with no
 * inputs at all and opens a card to read it.
 *
 * Dates are the salon's calendar days; times on status chips are salon time.
 */

export interface SheetPost { id: string; status: string; scheduledAt: string; stage?: string | null }

const STATUS: Record<string, { bg: string; ink: string; icon: string; vi: string; en: string }> = {
  posted: { bg: 'rgba(34,197,94,.14)', ink: 'var(--ink-good)', icon: '✅', vi: 'Đã đăng', en: 'Posted' },
  failed: { bg: 'rgba(239,68,68,.14)', ink: 'var(--ink-bad)', icon: '⚠️', vi: 'Lỗi đăng', en: 'Failed' },
  publishing: { bg: 'rgba(56,189,248,.14)', ink: 'var(--ink-sky)', icon: '⏫', vi: 'Đang đăng', en: 'Publishing' },
  scheduled: { bg: 'rgba(99,102,241,.14)', ink: 'var(--ink-link)', icon: '🗓️', vi: 'Đã lên lịch', en: 'Scheduled' },
  draft: { bg: 'rgba(148,163,184,.14)', ink: 'var(--c94a3b8)', icon: '📝', vi: 'Bài nháp', en: 'Draft post' },
};
const FORMAT_ICON: Record<string, string> = { poster: '🖼', album: '🎞', video: '▶', story: '📱' };

export function PlanSheet({
  month, months, onMonth, today, tz, entries, posts, vi, canEdit, isMobile, onSave, onClear, onSchedule, onOpenPost, connected, postsKnown, focusDay,
}: {
  /** The calendar month the sheet shows, "YYYY-MM" — the shop's month, next to the month brief. */
  month: string;
  /** Months a person may switch to (this one and the next); with `onMonth`, drawn as chips. */
  months?: string[];
  onMonth?: (month: string) => void;
  today: string;
  tz: string;
  entries: Record<string, PlanEntry>;
  posts: SheetPost[];
  vi: boolean;
  canEdit: boolean;
  isMobile: boolean;
  onSave: (day: string, patch: PlanPatch) => Promise<void>;
  onClear: (day: string) => Promise<void>;
  onSchedule: (entry: PlanEntry) => void;
  onOpenPost: (id: string) => void;
  connected: Record<Air, boolean>;
  /**
   * False on the shop's screen, which gets no post list: a slot with a post
   * id then reads "scheduled" rather than "post deleted", and the panel
   * shows no post card. Default true — the team's screen knows its posts.
   */
  postsKnown?: boolean;
  /** A day the page wants opened in the panel — an idea just landed on it. Changes open it; null does nothing. */
  focusDay?: string | null;
}) {
  const T = (a: string, b: string) => (vi ? a : b);
  const weeks = useMemo(() => monthWeeks(month, today), [month, today]);
  const postById = useMemo(() => new Map(posts.map((p) => [p.id, p])), [posts]);
  const progress = sheetProgress(weeks, entries);
  const posted = Object.values(entries).filter((e) => e.postId && postById.get(e.postId)?.status === 'posted').length;
  const knowsPosts = postsKnown !== false;

  /** The day open in the panel. */
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { if (focusDay) setOpen(focusDay); }, [focusDay]);
  const dayOf = (key: string): SheetDay | null => { for (const w of weeks) for (const d of w) if (d.key === key) return d; return null; };
  const label = (key: string) => {
    const [, m, d] = key.split('-').map(Number);
    return { wd: (vi ? WD_VI : WD_EN)[mondayIndex(key)], d, m: (vi ? MONTH_VI : MONTH_EN)[m - 1] };
  };
  const postOf = (e: PlanEntry | undefined) => (e?.postId ? postById.get(e.postId) ?? null : null);

  // ---- the card -------------------------------------------------------------

  const card = (d: SheetDay) => {
    const e = entries[d.key];
    const has = entryHasContent(e);
    const p = pillarOf(e?.pillar ?? '');
    const post = postOf(e);
    const L = label(d.key);
    const selected = open === d.key;
    const clickable = canEdit ? (d.inWindow || has) : has;
    const st = post ? STATUS[post.status] ?? STATUS.draft : null;
    const hm = post ? instantToWall(post.scheduledAt, tz).slice(11, 16) : '';

    return (
      <div
        key={d.key}
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : -1}
        onClick={() => clickable && setOpen(d.key)}
        onKeyDown={(ev) => { if (clickable && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); setOpen(d.key); } }}
        style={{
          position: 'relative', minHeight: isMobile ? 0 : 132, borderRadius: 12, padding: '9px 10px 9px 12px',
          background: has ? 'var(--c0f172a)' : 'transparent',
          border: `1px ${has ? 'solid' : 'dashed'} ${selected ? '#6366f1' : d.today && !has ? 'rgba(99,102,241,.6)' : 'var(--c334155)'}`,
          boxShadow: selected ? '0 0 0 2px rgba(99,102,241,.35)' : 'none',
          opacity: d.past && !has ? .4 : d.past ? .75 : 1,
          cursor: clickable ? 'pointer' : 'default',
          display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, outline: 'none',
          transition: 'border-color .12s, box-shadow .12s',
        }}
      >
        {/* the pillar, as a coloured edge — the one signal the sheet's colours carried */}
        {p && <span style={{ position: 'absolute', left: 0, top: 10, bottom: 10, width: 4, borderRadius: 4, background: p.bg }} />}

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, minWidth: 0 }}>
          {isMobile && <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: .5, textTransform: 'uppercase', color: d.today ? 'var(--ink-link)' : 'var(--c64748b)' }}>{L.wd}</span>}
          <span style={{ fontSize: 16, fontWeight: 800, color: d.today ? 'var(--ink-link)' : has ? 'var(--cf1f5f9)' : 'var(--c94a3b8)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{L.d}</span>
          {d.today && <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--ink-link)', textTransform: 'uppercase', letterSpacing: .4, marginLeft: 2 }}>{T('hôm nay', 'today')}</span>}
          {p && <span style={{ marginLeft: 'auto', fontSize: 9.5, fontWeight: 800, letterSpacing: .4, textTransform: 'uppercase', padding: '2px 6px', borderRadius: 4, background: p.bg, color: p.ink, whiteSpace: 'nowrap' }}>{vi ? p.vi : p.en}</span>}
        </div>

        {has ? (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--cf1f5f9)', lineHeight: 1.35, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', wordBreak: 'break-word' }}>
              {e.topic || <span style={{ color: 'var(--c94a3b8)', fontWeight: 500 }}>{T('(chưa có chủ đề)', '(no topic yet)')}</span>}
            </div>
            {e.detail && !isMobile && (
              <div style={{ fontSize: 11.5, color: 'var(--c94a3b8)', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', wordBreak: 'break-word' }}>{e.detail}</div>
            )}
            <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', minWidth: 0 }}>
              {e.format && <span title={formatOf(e.format)?.[vi ? 'vi' : 'en']} style={{ fontSize: 11, color: 'var(--c94a3b8)', fontWeight: 700 }}>{FORMAT_ICON[e.format]} {formatOf(e.format)?.[vi ? 'vi' : 'en']}</span>}
              <span style={{ display: 'inline-flex', gap: 3 }}>
                {AIR.filter((a) => e.air.includes(a.id)).map((a) => <span key={a.id} title={a.id} style={{ width: 9, height: 9, borderRadius: 5, background: a.bg, display: 'inline-block', border: '1px solid rgba(255,255,255,.25)' }} />)}
              </span>
              {e.mediaUrl && <span title={T('Có link ảnh', 'Has a media link')} style={{ fontSize: 11 }}>🔗</span>}
              {st ? (
                <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 800, padding: '2px 7px', borderRadius: 999, background: st.bg, color: st.ink, whiteSpace: 'nowrap' }}>{st.icon} {post!.status === 'scheduled' || post!.status === 'posted' ? hm : (vi ? st.vi : st.en)}</span>
              ) : e.postId && postsKnown === false ? (
                <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 800, padding: '2px 7px', borderRadius: 999, background: STATUS.scheduled.bg, color: STATUS.scheduled.ink, whiteSpace: 'nowrap' }}>🗓️ {T('đã lên lịch', 'scheduled')}</span>
              ) : e.postId ? (
                <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--c64748b)' }}>{T('bài đã xoá', 'post deleted')}</span>
              ) : entryReady(e) ? (
                <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 700, color: 'var(--ink-warn)', whiteSpace: 'nowrap' }}>● {T('chờ lên lịch', 'to schedule')}</span>
              ) : (
                <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--c64748b)', whiteSpace: 'nowrap' }}>○ {T('đang soạn', 'drafting')}</span>
              )}
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: isMobile ? 20 : 56 }}>
            {/* an empty future day: a plus for the team, nothing at all for the shop — a blank square reads as "free", a word reads as a gap */}
            {canEdit && d.inWindow && !d.past && (
              <span style={{ width: 26, height: 26, borderRadius: 13, border: '1px dashed var(--c334155)', display: 'grid', placeItems: 'center', color: 'var(--c64748b)', fontSize: 16, lineHeight: 1 }}>+</span>
            )}
          </div>
        )}
      </div>
    );
  };

  // ---- header + bands ----------------------------------------------------------

  const pct = progress.days ? Math.round((progress.filled / progress.days) * 100) : 0;
  const WD = vi ? WD_VI : WD_EN;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--cf1f5f9)', letterSpacing: -.2 }}>🗓️ {T('Plan', 'Plan')} {monthTitle(month, vi)}</div>
        {months && onMonth && months.length > 1 && (
          <div style={{ display: 'flex', gap: 4 }}>
            {months.map((m) => (
              <button key={m} type="button" onClick={() => onMonth(m)} style={{ padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', border: `1px solid ${m === month ? '#6366f1' : 'var(--c334155)'}`, background: m === month ? 'rgba(99,102,241,.16)' : 'transparent', color: m === month ? 'var(--ink-link)' : 'var(--c94a3b8)' }}>
                {monthTitle(m, vi).split(' · ')[0]}
              </button>
            ))}
          </div>
        )}
        {/* one bar says how far the month is planned; three numbers say what happened to it */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <div style={{ width: isMobile ? 90 : 140, height: 6, borderRadius: 3, background: 'var(--c1e293b)', overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: '#6366f1', borderRadius: 3 }} />
          </div>
          <span style={{ fontSize: 12, color: 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>
            <b style={{ color: 'var(--cf1f5f9)' }}>{progress.filled}/{progress.days}</b> {T('ngày có bài', 'days planned')} · <b style={{ color: 'var(--ink-link)' }}>{progress.scheduled}</b> {T('đã lên lịch', 'scheduled')}{knowsPosts ? <> · <b style={{ color: 'var(--ink-good)' }}>{posted}</b> {T('đã đăng', 'posted')}</> : null}
          </span>
        </div>
        {!isMobile && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {PILLARS.map((p) => (
              <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: 'var(--c94a3b8)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: p.bg, display: 'inline-block' }} />{vi ? p.vi : p.en}
              </span>
            ))}
          </div>
        )}
      </div>
      {canEdit && (
        <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginBottom: 10 }}>
          {T('Bấm vào ngày để soạn · ← → chuyển ngày · tự lưu · xong thì "Lên lịch đăng"', 'Tap a day to write · ← → moves days · saves itself · then "Schedule"')}
        </div>
      )}
      {!canEdit && (
        <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginBottom: 10 }}>
          {T('Bấm vào ngày để đọc nội dung dự kiến · ngày có 🗓️ là bài đã lên lịch, tiệm sẽ được hỏi duyệt trước khi đăng', 'Tap a day to read what is planned · 🗓️ means the post is scheduled; you will be asked to approve it before it goes out')}
        </div>
      )}

      {isMobile ? (
        /* a phone reads the month as a list: the days that carry something,
           plus (for the team) the empty days still ahead, so there is
           somewhere to tap */
        <div style={{ display: 'grid', gap: 6 }}>
          {weeks.flat().filter((d) => d.inWindow && (entryHasContent(entries[d.key]) || d.today || (canEdit && !d.past))).map(card)}
        </div>
      ) : (
        /* a real month calendar: one weekday header, then the rows */
        <div style={{ borderRadius: 14, border: '1px solid var(--c334155)', background: 'var(--c111827)', padding: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 8, marginBottom: 6 }}>
            {WD.map((w, i) => (
              <div key={w} style={{ textAlign: 'center', fontSize: 11, fontWeight: 800, letterSpacing: .6, textTransform: 'uppercase', color: i >= 5 ? 'var(--ink-warn)' : 'var(--c64748b)' }}>{w}</div>
            ))}
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {weeks.map((row, wi) => (
              <div key={wi} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 8 }}>
                {row.map((d) => (d.inWindow ? card(d) : <div key={d.key} aria-hidden style={{ minHeight: 0 }} />))}
              </div>
            ))}
          </div>
        </div>
      )}

      {open && dayOf(open) && (
        <DayPanel
          key={open}
          day={dayOf(open)!}
          entry={entries[open] ?? emptyEntry(open)}
          post={postOf(entries[open])}
          tz={tz}
          vi={vi}
          canEdit={canEdit}
          isMobile={isMobile}
          connected={connected}
          onSave={onSave}
          onClear={async (d) => { await onClear(d); setOpen(null); }}
          onSchedule={onSchedule}
          onOpenPost={onOpenPost}
          onClose={() => setOpen(null)}
          onMove={(n) => { const k = addDays(open, n); if (dayOf(k)?.inWindow || entryHasContent(entries[k])) setOpen(k); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The panel: one day, every field, wide enough to write in
// ---------------------------------------------------------------------------

const field: CSSProperties = {
  width: '100%', boxSizing: 'border-box', minHeight: 38, padding: '9px 11px', borderRadius: 9, fontSize: 13.5, fontFamily: 'inherit',
  border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--cf1f5f9)', outline: 'none', lineHeight: 1.5,
};
const labelStyle: CSSProperties = { fontSize: 10.5, fontWeight: 800, letterSpacing: .5, textTransform: 'uppercase', color: 'var(--c94a3b8)', marginBottom: 6 };

function DayPanel({
  day, entry, post, tz, vi, canEdit, isMobile, connected, onSave, onClear, onSchedule, onOpenPost, onClose, onMove,
}: {
  day: SheetDay; entry: PlanEntry; post: SheetPost | null; tz: string; vi: boolean; canEdit: boolean; isMobile: boolean;
  connected: Record<Air, boolean>;
  onSave: (day: string, patch: PlanPatch) => Promise<void>;
  onClear: (day: string) => Promise<void>;
  onSchedule: (entry: PlanEntry) => void;
  onOpenPost: (id: string) => void;
  onClose: () => void;
  onMove: (n: number) => void;
}) {
  const T = (a: string, b: string) => (vi ? a : b);
  const [local, setLocal] = useState<PlanEntry>(entry);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  // What is typed lives here; the server copy arrives as `entry`. A reply
  // for THIS day must not land on a field being typed in.
  const typingRef = useRef(false);
  useEffect(() => { if (!typingRef.current) setLocal(entry); }, [entry]);
  const localRef = useRef(local); localRef.current = local;
  const entryRef = useRef(entry); entryRef.current = entry;

  const commit = async (patch: PlanPatch) => {
    if (!canEdit) return;
    const base = entryRef.current;
    const changed = (Object.keys(patch) as (keyof PlanPatch)[]).some((k) => JSON.stringify(patch[k]) !== JSON.stringify(base[k]));
    if (!changed) return;
    setState('saving');
    try { await onSave(day.key, patch); setState('saved'); setTimeout(() => setState((s) => (s === 'saved' ? 'idle' : s)), 1500); }
    catch { setState('error'); }
  };
  const set = (patch: PlanPatch) => setLocal((c) => ({ ...c, ...patch }));
  const change = (patch: PlanPatch) => { set(patch); void commit(patch); };
  /** Text fields save when left; leaving the panel or the day saves them too. */
  const flush = () => {
    const l = localRef.current;
    void commit({ topic: l.topic, detail: l.detail, mediaUrl: l.mediaUrl });
  };

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') { flush(); onClose(); }
      const tag = (ev.target as HTMLElement | null)?.tagName;
      if ((ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') && tag !== 'INPUT' && tag !== 'TEXTAREA') { flush(); onMove(ev.key === 'ArrowLeft' ? -1 : 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day.key]);

  const L = (() => { const [, m, d] = day.key.split('-').map(Number); return { wd: (vi ? WD_VI : WD_EN)[mondayIndex(day.key)], d, m: (vi ? MONTH_VI : MONTH_EN)[m - 1] }; })();
  const st = post ? STATUS[post.status] ?? STATUS.draft : null;
  const ready = entryReady(local);
  const missing = [!local.topic && !local.detail ? T('chủ đề hoặc nội dung', 'a topic or detail') : '', !local.air.length ? T('ít nhất một kênh', 'at least one network') : ''].filter(Boolean);

  const chip = (on: boolean, bg: string, ink: string, label: string, onClick?: () => void, extra: CSSProperties = {}) => (
    <button
      type="button"
      disabled={!canEdit || !onClick}
      onClick={onClick}
      style={{
        padding: '6px 11px', borderRadius: 999, fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: canEdit && onClick ? 'pointer' : 'default', lineHeight: 1.3,
        border: `1px solid ${on ? bg : 'var(--c334155)'}`, background: on ? bg : 'transparent', color: on ? ink : 'var(--c94a3b8)', ...extra,
      }}
    >{label}</button>
  );

  const panel: CSSProperties = isMobile
    ? { position: 'fixed', left: 0, right: 0, bottom: 0, top: 'max(48px, 8vh)', zIndex: 75, borderRadius: '16px 16px 0 0' }
    : { position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(460px, 92vw)', zIndex: 75, borderLeft: '1px solid var(--c334155)' };

  return (
    <>
      <div onClick={() => { flush(); onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 74, background: 'rgba(2,6,23,.55)', backdropFilter: 'blur(2px)' }} />
      <div style={{ ...panel, background: 'var(--c111827)', boxShadow: '-12px 0 40px rgba(0,0,0,.35)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* header: the day, the arrows, the save state, the way out */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--line)', background: 'var(--c0f172a)' }}>
          <button type="button" onClick={() => { flush(); onMove(-1); }} title={T('Ngày trước (←)', 'Previous day (←)')} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--c94a3b8)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14 }}>‹</button>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: day.today ? 'var(--ink-link)' : 'var(--cf1f5f9)' }}>
              {L.wd} {L.d} {L.m}{day.today ? ` · ${T('hôm nay', 'today')}` : day.past ? ` · ${T('đã qua', 'past')}` : ''}
            </div>
            <div style={{ fontSize: 11, color: state === 'error' ? 'var(--ink-bad)' : state === 'saved' ? 'var(--ink-good)' : 'var(--c64748b)' }}>
              {!canEdit ? T('Kế hoạch của tiệm — chỉ xem', 'Your plan — read only') : state === 'saving' ? T('Đang lưu…', 'Saving…') : state === 'saved' ? T('✓ Đã lưu', '✓ Saved') : state === 'error' ? T('Chưa lưu được — thử lại', 'Not saved — try again') : T('Tự lưu khi rời ô', 'Saves as you leave a field')}
            </div>
          </div>
          <button type="button" onClick={() => { flush(); onMove(1); }} title={T('Ngày sau (→)', 'Next day (→)')} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--c94a3b8)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14 }}>›</button>
          <button type="button" onClick={() => { flush(); onClose(); }} title="Esc" style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--c64748b)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'grid', gap: 14, alignContent: 'start' }}>
          {/* status first: the one thing a reader wants to know */}
          {st && post ? (
            <button type="button" onClick={() => onOpenPost(post.id)} style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: `1px solid ${st.ink}`, background: st.bg, color: st.ink, cursor: 'pointer', fontFamily: 'inherit' }}>
              <span style={{ fontSize: 18 }}>{st.icon}</span>
              <span style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 800 }}>{vi ? st.vi : st.en} · {instantToWall(post.scheduledAt, tz).slice(11, 16)}</div>
                <div style={{ fontSize: 11.5, opacity: .85 }}>{T('Bấm để xem bài, sửa giờ hoặc đăng ngay', 'Tap to open the post, move it or post now')}</div>
              </span>
            </button>
          ) : null}

          <div>
            <div style={labelStyle}>{T('Pillar · bài này để làm gì', 'Pillar · what this post is for')}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {PILLARS.map((p) => chip(local.pillar === p.id, p.bg, p.ink, vi ? p.vi : p.en, canEdit ? () => change({ pillar: local.pillar === p.id ? '' : p.id }) : undefined))}
            </div>
          </div>

          <div>
            <div style={labelStyle}>{T('Chủ đề', 'Topic')}</div>
            {canEdit ? (
              <input value={local.topic} placeholder={T('Một dòng: bài này nói về gì', 'One line: what the post is about')} onFocus={() => { typingRef.current = true; }} onChange={(e) => set({ topic: e.target.value })} onBlur={() => { typingRef.current = false; void commit({ topic: localRef.current.topic }); }} style={{ ...field, fontWeight: 700, fontSize: 14.5 }} />
            ) : <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--cf1f5f9)', lineHeight: 1.4 }}>{local.topic || '—'}</div>}
          </div>

          <div>
            <div style={{ ...labelStyle, display: 'flex' }}>
              <span>{T('Nội dung · caption', 'Detail · caption')}</span>
              {canEdit && <span style={{ marginLeft: 'auto', fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>{local.detail.length}</span>}
            </div>
            {canEdit ? (
              <textarea value={local.detail} rows={isMobile ? 7 : 10} placeholder={T('Caption sẵn sàng để đăng — câu mở, nội dung, kêu gọi hành động', 'A caption ready to post — hook, body, call to action')} onFocus={() => { typingRef.current = true; }} onChange={(e) => set({ detail: e.target.value })} onBlur={() => { typingRef.current = false; void commit({ detail: localRef.current.detail }); }} style={{ ...field, resize: 'vertical', fontSize: 13.5 }} />
            ) : <div style={{ fontSize: 13.5, color: 'var(--ccbd5e1)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{local.detail || '—'}</div>}
          </div>

          <div>
            <div style={labelStyle}>{T('Link ảnh / clip', 'Picture / clip link')}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {canEdit ? (
                <input value={local.mediaUrl} placeholder={T('Dán link Drive, ảnh hoặc clip', 'Paste a Drive, picture or clip link')} onFocus={() => { typingRef.current = true; }} onChange={(e) => set({ mediaUrl: e.target.value })} onBlur={() => { typingRef.current = false; void commit({ mediaUrl: localRef.current.mediaUrl }); }} style={{ ...field, fontSize: 12.5, minWidth: 0 }} />
              ) : <div style={{ fontSize: 13, color: 'var(--c94a3b8)', wordBreak: 'break-all', flex: 1 }}>{local.mediaUrl || '—'}</div>}
              {/^https?:\/\//i.test(local.mediaUrl) && (
                <a href={local.mediaUrl} target="_blank" rel="noreferrer" style={{ flex: '0 0 auto', width: 38, height: 38, borderRadius: 9, border: '1px solid var(--c334155)', display: 'grid', placeItems: 'center', color: 'var(--ink-link)', textDecoration: 'none' }}>↗</a>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
            <div>
              <div style={labelStyle}>{T('Kênh đăng', 'Networks')}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {AIR.map((a) => {
                  const on = local.air.includes(a.id);
                  const off = !connected[a.id];
                  return chip(on, a.bg, '#fff', a.short, canEdit ? () => change({ air: on ? local.air.filter((x) => x !== a.id) : [...local.air, a.id] }) : undefined, { opacity: off && !on ? .5 : 1, textDecoration: off && on ? 'line-through' : 'none' });
                })}
              </div>
              {AIR.some((a) => local.air.includes(a.id) && !connected[a.id]) && (
                <div style={{ fontSize: 11, color: 'var(--ink-warn)', marginTop: 5 }}>{T('Kênh gạch ngang: tiệm chưa kết nối — lúc lên lịch sẽ bỏ qua.', 'Struck-through: not connected — skipped when scheduling.')}</div>
              )}
            </div>
            <div>
              <div style={labelStyle}>{T('Định dạng', 'Format')}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {FORMATS.map((f) => chip(local.format === f.id, f.bg, f.ink, `${FORMAT_ICON[f.id]} ${vi ? f.vi : f.en}`, canEdit ? () => change({ format: local.format === f.id ? '' : f.id }) : undefined))}
              </div>
            </div>
          </div>
        </div>

        {/* the footer: where the two things a person does next live —
            keep it (saved already, but a button that says so is what
            people look for) and turn it into a post */}
        {canEdit && (
          <div style={{ padding: '10px 14px', borderTop: '1px solid var(--line)', background: 'var(--c0f172a)', display: 'grid', gap: 8 }}>
            {!post && !ready && (
              <div style={{ fontSize: 11.5, color: 'var(--ink-warn)' }}>{T(`Để lên lịch cần thêm: ${missing.join(' · ')}`, `To schedule, add: ${missing.join(' · ')}`)}</div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {entryHasContent(entry) && !post && (
                <button type="button" onClick={() => { if (window.confirm(T('Xoá nội dung ngày này?', 'Clear this day?'))) void onClear(day.key); }} style={{ fontSize: 12, color: 'var(--ink-bad)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>{T('Xoá ngày', 'Clear')}</button>
              )}
              <button
                type="button"
                onClick={() => { flush(); onClose(); }}
                style={{ marginLeft: 'auto', minHeight: 38, padding: '0 14px', borderRadius: 9, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--cf1f5f9)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
              >💾 {T('Lưu & đóng', 'Save & close')}</button>
              {post ? (
                <button type="button" onClick={() => onOpenPost(post.id)} style={{ minHeight: 38, padding: '0 14px', borderRadius: 9, border: '1px solid #6366f1', background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {T('Xem bài đã lên lịch', 'Open the scheduled post')} ›
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!ready}
                  onClick={() => { flush(); onSchedule(localRef.current); }}
                  title={ready ? T('Mở khung soạn với nội dung và ngày này', 'Open the composer with this content and day') : T('Cần chủ đề hoặc nội dung, và một kênh', 'Needs a topic or detail, and a network')}
                  style={{ minHeight: 38, padding: '0 14px', borderRadius: 9, fontSize: 13, fontWeight: 800, fontFamily: 'inherit', cursor: ready ? 'pointer' : 'default', border: `1px solid ${ready ? '#6366f1' : 'var(--c334155)'}`, background: ready ? '#6366f1' : 'transparent', color: ready ? '#fff' : 'var(--c64748b)' }}
                >
                  {local.postId ? T('↻ Lên lịch lại', '↻ Schedule again') : T('Lên lịch đăng', 'Schedule')} →
                </button>
              )}
            </div>
            {entry.updatedBy && <div style={{ fontSize: 10.5, color: 'var(--c64748b)' }}>{T('Sửa lần cuối', 'Last edited')}: {entry.updatedBy}</div>}
          </div>
        )}
      </div>
    </>
  );
}
