'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { instantToWall } from '../lib/datetime';
import { WD_VI, WD_EN, MONTH_VI, MONTH_EN, mondayIndex, addDays } from './plan-grid';
import {
  AIR, TAG_COLORS, pillarOf, formatOf, emptyEntry, entryHasContent, entryReady, monthWeeks, monthTitle, sheetProgress, tagsOr, tagViews,
  type PlanEntry, type PlanPatch, type Air, type SheetDay, type PlanTag, type PlanTags, type TagView,
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
/** A salon's own format has no icon of its own; a dot keeps the chip's rhythm. */
const iconOf = (id: string) => FORMAT_ICON[id] ?? '◆';

export function PlanSheet({
  month, months, onMonth, today, tz, entries, posts, vi, canEdit, isMobile, onSave, onClear, onSchedule, onOpenPost, connected, postsKnown, focusDay, tags, onSaveTags, onMoveDay,
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
  /** This salon's pillar and format chips; missing → the built-in set. */
  tags?: PlanTags | null;
  /** With canEdit, the team may reword, recolour, hide and add chips. Resolves with what the server kept. */
  onSaveTags?: (tags: PlanTags) => Promise<void>;
  /** With canEdit: move a day's slot to another day (an occupied day trades places). Drag on desktop, "Dời sang" in the panel everywhere. */
  onMoveDay?: (from: string, to: string) => Promise<void>;
}) {
  const T = (a: string, b: string) => (vi ? a : b);
  const tagSet = useMemo(() => tagsOr(tags), [tags]);
  const pillars = useMemo(() => tagViews(tagSet.pillars), [tagSet]);
  const formats = useMemo(() => tagViews(tagSet.formats), [tagSet]);
  /** Which list is open in the chip editor. */
  const [editing, setEditing] = useState<'pillars' | 'formats' | null>(null);
  const canEditTags = canEdit && Boolean(onSaveTags);
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

  // ---- moving a slot ----------------------------------------------------------
  // A slot whose post is already scheduled (or out) stays put: the post has
  // its own date, and a plan that says the 14th while the post goes out on
  // the 12th is worse than a plan that will not move. A draft post may move.
  const canMove = canEdit && Boolean(onMoveDay);
  const pinned = (e: PlanEntry | undefined) => { const p = postOf(e); return Boolean(p && p.status !== 'draft') || Boolean(e?.postId && !knowsPosts); };
  const [dragFrom, setDragFrom] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [moveErr, setMoveErr] = useState('');
  const moveDay = async (from: string, to: string) => {
    if (!onMoveDay || from === to || pinned(entries[from]) || pinned(entries[to])) return;
    setMoving(true); setMoveErr('');
    try { await onMoveDay(from, to); if (open === from) setOpen(to); }
    catch { setMoveErr(T('Chưa dời được — thử lại.', 'Could not move — try again.')); }
    finally { setMoving(false); }
  };
  const moveTargets = useMemo(() => weeks.flat().filter((d) => d.inWindow).map((d) => d.key), [weeks]);

  // How wide one day is. The shop reads the plan in a 1000px column and
  // the team in a full-width tab; the same seven cells are 130px in one and
  // 180px in the other. Under ~128px a card goes COMPACT: the pillar chip
  // and the caption preview go (the coloured edge and the panel still carry
  // them), the format is its icon, and the day number never wraps — "16"
  // broke into two lines in the shop's column before this.
  const gridRef = useRef<HTMLDivElement>(null);
  const [cellW, setCellW] = useState(160);
  useEffect(() => {
    const el = gridRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w) setCellW((w - 6 * 6) / 7);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isMobile]);
  const compact = !isMobile && cellW < 128;
  const gap = compact ? 6 : 8;

  // ---- the card -------------------------------------------------------------

  const card = (d: SheetDay) => {
    const e = entries[d.key];
    const has = entryHasContent(e);
    const p = pillarOf(e?.pillar ?? '', pillars);
    const post = postOf(e);
    const L = label(d.key);
    const selected = open === d.key;
    const clickable = canEdit ? (d.inWindow || has) : has;
    const st = post ? STATUS[post.status] ?? STATUS.draft : null;
    const hm = post ? instantToWall(post.scheduledAt, tz).slice(11, 16) : '';
    const draggable = canMove && !isMobile && has && !pinned(e) && !moving;
    const dropOk = Boolean(dragFrom && dragFrom !== d.key && !pinned(e));
    const over = dragOver === d.key && dropOk;

    return (
      <div
        key={d.key}
        draggable={draggable}
        onDragStart={draggable ? (ev) => { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', d.key); setDragFrom(d.key); } : undefined}
        onDragEnd={() => { setDragFrom(null); setDragOver(null); }}
        onDragOver={dragFrom ? (ev) => { if (!dropOk) return; ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; if (dragOver !== d.key) setDragOver(d.key); } : undefined}
        onDragLeave={dragFrom ? () => setDragOver((k) => (k === d.key ? null : k)) : undefined}
        onDrop={dragFrom ? (ev) => { ev.preventDefault(); const from = dragFrom; setDragFrom(null); setDragOver(null); if (from && dropOk) void moveDay(from, d.key); } : undefined}
        title={draggable ? T('Kéo sang ngày khác để dời', 'Drag to another day to move it') : undefined}
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : -1}
        onClick={() => clickable && setOpen(d.key)}
        onKeyDown={(ev) => { if (clickable && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); setOpen(d.key); } }}
        style={{
          position: 'relative', minHeight: isMobile ? 0 : compact ? 108 : 132, borderRadius: compact ? 10 : 12, padding: compact ? '7px 7px 7px 10px' : '9px 10px 9px 12px',
          background: has ? 'var(--c0f172a)' : 'transparent',
          border: `1px ${has || over ? 'solid' : 'dashed'} ${over || selected ? '#6366f1' : d.today && !has ? 'rgba(99,102,241,.6)' : 'var(--c334155)'}`,
          boxShadow: over ? '0 0 0 3px rgba(99,102,241,.45)' : selected ? '0 0 0 2px rgba(99,102,241,.35)' : 'none',
          ...(over ? { background: 'rgba(99,102,241,.12)' } : {}),
          opacity: dragFrom === d.key ? .35 : d.past && !has ? .4 : d.past ? .75 : 1,
          cursor: draggable ? 'grab' : clickable ? 'pointer' : 'default',
          display: 'flex', flexDirection: 'column', gap: compact ? 4 : 6, minWidth: 0, outline: 'none',
          transition: 'border-color .12s, box-shadow .12s',
        }}
      >
        {/* the pillar, as a coloured edge — the one signal the sheet's colours carried */}
        {p && <span style={{ position: 'absolute', left: 0, top: 10, bottom: 10, width: 4, borderRadius: 4, background: p.bg }} />}

        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, whiteSpace: 'nowrap' }}>
          {isMobile && <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: .5, textTransform: 'uppercase', color: d.today ? 'var(--ink-link)' : 'var(--c64748b)', flexShrink: 0 }}>{L.wd}</span>}
          {/* today: the number in a filled ring, which needs no word and cannot wrap */}
          <span style={{
            flexShrink: 0, fontSize: compact ? 14 : 16, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1,
            color: d.today ? '#ffffff' : has ? 'var(--cf1f5f9)' : 'var(--c94a3b8)',
            ...(d.today ? { background: '#6366f1', borderRadius: 999, minWidth: compact ? 24 : 26, height: compact ? 24 : 26, display: 'inline-grid', placeItems: 'center', padding: '0 5px', marginLeft: -3 } : {}),
          }} title={d.today ? T('Hôm nay', 'Today') : undefined}>{L.d}</span>
          {d.today && !compact && <span style={{ fontSize: 9.5, fontWeight: 800, color: 'var(--ink-link)', textTransform: 'uppercase', letterSpacing: .4, flexShrink: 0 }}>{T('hôm nay', 'today')}</span>}
          {p && !compact && <span style={{ marginLeft: 'auto', fontSize: 9.5, fontWeight: 800, letterSpacing: .4, textTransform: 'uppercase', padding: '2px 6px', borderRadius: 4, background: p.bg, color: p.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{vi ? p.vi : p.en}</span>}
          {p && compact && <span title={vi ? p.vi : p.en} style={{ marginLeft: 'auto', width: 10, height: 10, borderRadius: 3, background: p.bg, flexShrink: 0 }} />}
        </div>

        {has ? (
          <>
            <div style={{ fontSize: compact ? 12 : 13, fontWeight: 700, color: 'var(--cf1f5f9)', lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: compact ? 3 : 2, WebkitBoxOrient: 'vertical', overflowWrap: 'anywhere' }}>
              {e.topic || <span style={{ color: 'var(--c94a3b8)', fontWeight: 500 }}>{T('(chưa có chủ đề)', '(no topic yet)')}</span>}
            </div>
            {e.detail && !isMobile && !compact && (
              <div style={{ fontSize: 11.5, color: 'var(--c94a3b8)', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflowWrap: 'anywhere' }}>{e.detail}</div>
            )}
            <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: compact ? 4 : 5, flexWrap: 'wrap', minWidth: 0 }}>
              {e.format && <span title={formatOf(e.format, formats)?.[vi ? 'vi' : 'en']} style={{ fontSize: 11, color: 'var(--c94a3b8)', fontWeight: 700, whiteSpace: 'nowrap' }}>{iconOf(e.format)}{compact ? '' : ` ${formatOf(e.format, formats)?.[vi ? 'vi' : 'en'] ?? ''}`}</span>}
              <span style={{ display: 'inline-flex', gap: 3 }}>
                {AIR.filter((a) => e.air.includes(a.id)).map((a) => <span key={a.id} title={a.id} style={{ width: 9, height: 9, borderRadius: 5, background: a.bg, display: 'inline-block', border: '1px solid rgba(255,255,255,.25)' }} />)}
              </span>
              {e.mediaUrl && <span title={T('Có link ảnh', 'Has a media link')} style={{ fontSize: 11 }}>🔗</span>}
              {st ? (
                <span style={{ marginLeft: 'auto', fontSize: compact ? 10 : 10.5, fontWeight: 800, padding: compact ? '1px 6px' : '2px 7px', borderRadius: 999, background: st.bg, color: st.ink, whiteSpace: 'nowrap' }}>{st.icon} {post!.status === 'scheduled' || post!.status === 'posted' ? hm : (vi ? st.vi : st.en)}</span>
              ) : e.postId && postsKnown === false ? (
                <span style={{ marginLeft: 'auto', fontSize: compact ? 10 : 10.5, fontWeight: 800, padding: compact ? '1px 6px' : '2px 7px', borderRadius: 999, background: STATUS.scheduled.bg, color: STATUS.scheduled.ink, whiteSpace: 'nowrap' }}>🗓️ {compact ? T('lên lịch', 'set') : T('đã lên lịch', 'scheduled')}</span>
              ) : e.postId ? (
                <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--c64748b)' }}>{T('bài đã xoá', 'post deleted')}</span>
              ) : entryReady(e) ? (
                <span style={{ marginLeft: 'auto', fontSize: compact ? 10 : 10.5, fontWeight: 700, color: 'var(--ink-warn)', whiteSpace: 'nowrap' }}>● {compact ? T('chờ lịch', 'to set') : T('chờ lên lịch', 'to schedule')}</span>
              ) : (
                <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--c64748b)', whiteSpace: 'nowrap' }}>○ {T('đang soạn', 'drafting')}</span>
              )}
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: isMobile ? 20 : compact ? 40 : 56 }}>
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
                {/* the year only when it differs from the month on screen: in
                    December the chips read "Tháng 11 · Tháng 12 · Tháng 1 2027",
                    so next January is never mistaken for last January */}
                {m.slice(0, 4) === month.slice(0, 4) ? monthTitle(m, vi).split(' · ')[0] : monthTitle(m, vi).replace(' · ', ' ')}
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
            {pillars.filter((p) => !p.hidden || Object.values(entries).some((e) => e.pillar === p.id)).map((p) => (
              <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: 'var(--c94a3b8)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: p.bg, display: 'inline-block' }} />{vi ? p.vi : p.en}
              </span>
            ))}
          </div>
        )}
      </div>
      {canEdit && (
        <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginBottom: 10 }}>
          {T('Bấm vào ngày để soạn · kéo thả để dời ngày · tự lưu · xong thì "Lên lịch đăng"', 'Tap a day to write · drag to move it · saves itself · then "Schedule"')}
          {moving && <span style={{ marginLeft: 8, color: 'var(--ink-link)' }}>{T('Đang dời…', 'Moving…')}</span>}
          {moveErr && <span style={{ marginLeft: 8, color: 'var(--ink-bad)' }}>{moveErr}</span>}
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
        <div ref={gridRef} style={{ borderRadius: 14, border: '1px solid var(--c334155)', background: 'var(--c111827)', padding: compact ? 8 : 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap, marginBottom: 6 }}>
            {WD.map((w, i) => (
              <div key={w} style={{ textAlign: 'center', fontSize: 11, fontWeight: 800, letterSpacing: .6, textTransform: 'uppercase', color: i >= 5 ? 'var(--ink-warn)' : 'var(--c64748b)' }}>{w}</div>
            ))}
          </div>
          <div style={{ display: 'grid', gap }}>
            {weeks.map((row, wi) => (
              <div key={wi} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap }}>
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
          pillars={pillars}
          formats={formats}
          onEditTags={canEditTags ? setEditing : undefined}
          moveTargets={canMove && !pinned(entries[open]) && entryHasContent(entries[open]) ? moveTargets.filter((k) => k !== open && !pinned(entries[k])) : undefined}
          filledDays={entries}
          onMoveTo={(to) => moveDay(open, to)}
          onSave={onSave}
          onClear={async (d) => { await onClear(d); setOpen(null); }}
          onSchedule={onSchedule}
          onOpenPost={onOpenPost}
          onClose={() => setOpen(null)}
          onMove={(n) => { const k = addDays(open, n); if (dayOf(k)?.inWindow || entryHasContent(entries[k])) setOpen(k); }}
        />
      )}
      {editing && onSaveTags && (
        <TagEditor
          kind={editing}
          list={tagSet[editing]}
          vi={vi}
          isMobile={isMobile}
          onClose={() => setEditing(null)}
          onSave={async (list) => { await onSaveTags({ ...tagSet, [editing]: list }); setEditing(null); }}
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
const editLink: CSSProperties = { marginLeft: 'auto', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 700, textTransform: 'none', letterSpacing: 0, color: 'var(--ink-link)' };

function DayPanel({
  day, entry, post, tz, vi, canEdit, isMobile, connected, pillars, formats, onEditTags, moveTargets, filledDays, onMoveTo, onSave, onClear, onSchedule, onOpenPost, onClose, onMove,
}: {
  day: SheetDay; entry: PlanEntry; post: SheetPost | null; tz: string; vi: boolean; canEdit: boolean; isMobile: boolean;
  connected: Record<Air, boolean>;
  pillars: TagView[];
  formats: TagView[];
  /** Present when this person may edit the chip lists. */
  onEditTags?: (kind: 'pillars' | 'formats') => void;
  /** Days this slot may move to; absent when it may not move. */
  moveTargets?: string[];
  filledDays: Record<string, PlanEntry>;
  onMoveTo: (to: string) => Promise<void>;
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
      key={label}
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
            <div style={{ ...labelStyle, display: 'flex', alignItems: 'center' }}>
              <span>{T('Pillar · bài này để làm gì', 'Pillar · what this post is for')}</span>
              {onEditTags && <button type="button" onClick={() => onEditTags('pillars')} style={editLink}>✎ {T('Sửa / thêm', 'Edit / add')}</button>}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {pillars.filter((p) => !p.hidden || local.pillar === p.id).map((p) => chip(local.pillar === p.id, p.bg, p.ink, vi ? p.vi : p.en, canEdit ? () => change({ pillar: local.pillar === p.id ? '' : p.id }) : undefined))}
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
              <div style={{ ...labelStyle, display: 'flex', alignItems: 'center' }}>
                <span>{T('Định dạng', 'Format')}</span>
                {onEditTags && <button type="button" onClick={() => onEditTags('formats')} style={editLink}>✎ {T('Sửa / thêm', 'Edit / add')}</button>}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {formats.filter((f) => !f.hidden || local.format === f.id).map((f) => chip(local.format === f.id, f.bg, f.ink, `${iconOf(f.id)} ${vi ? f.vi : f.en}`, canEdit ? () => change({ format: local.format === f.id ? '' : f.id }) : undefined))}
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
              {moveTargets && moveTargets.length > 0 && (
                <select
                  value=""
                  onChange={(ev) => { const to = ev.target.value; if (to) { flush(); void onMoveTo(to); } }}
                  title={T('Dời nội dung sang ngày khác (ngày đã có bài thì đổi chỗ)', 'Move to another day (a planned day trades places)')}
                  style={{ minHeight: 32, maxWidth: 170, padding: '0 8px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--cf1f5f9)', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer' }}
                >
                  <option value="">↔ {T('Dời sang ngày…', 'Move to…')}</option>
                  {moveTargets.map((k) => {
                    const [, m, d] = k.split('-').map(Number);
                    const taken = entryHasContent(filledDays[k]);
                    return <option key={k} value={k}>{(vi ? WD_VI : WD_EN)[mondayIndex(k)]} {d}/{m}{taken ? T(' · đổi chỗ', ' · swap') : ''}</option>;
                  })}
                </select>
              )}
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

// ---------------------------------------------------------------------------
// The chip editor: this salon's pillars or formats
// ---------------------------------------------------------------------------

/**
 * Reword, recolour, hide or add a chip. There is no delete: a chip in use on
 * last month's plan would lose its label. "Ẩn" takes it off the choices for
 * new days and keeps it drawn where it was used (the server enforces the
 * same rule — a row left out comes back hidden).
 */
function TagEditor({ kind, list, vi, isMobile, onClose, onSave }: {
  kind: 'pillars' | 'formats';
  list: PlanTag[];
  vi: boolean;
  isMobile: boolean;
  onClose: () => void;
  onSave: (list: PlanTag[]) => Promise<void>;
}) {
  const T = (a: string, b: string) => (vi ? a : b);
  const [rows, setRows] = useState<(PlanTag & { key: string })[]>(() => list.map((t, i) => ({ ...t, key: t.id || `n${i}` })));
  const [palette, setPalette] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const edit = (key: string, patch: Partial<PlanTag>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const add = () => {
    const used = new Set(rows.map((r) => r.color));
    const color = TAG_COLORS.findIndex((_, i) => !used.has(i));
    const key = `n${Date.now()}`;
    setRows((rs) => [...rs, { id: '', vi: '', en: '', color: color < 0 ? rs.length % TAG_COLORS.length : color, key }]);
  };
  const save = async () => {
    const out = rows
      .map(({ key: _k, ...t }) => ({ ...t, vi: t.vi.trim(), en: t.en.trim() }))
      .filter((t) => t.vi || t.en || t.id);
    if (out.some((t) => !t.vi && !t.en)) { setErr(T('Chip nào cũng cần một tên.', 'Every chip needs a name.')); return; }
    setBusy(true); setErr('');
    try { await onSave(out); } catch { setErr(T('Chưa lưu được — thử lại.', 'Not saved — try again.')); } finally { setBusy(false); }
  };
  const title = kind === 'pillars' ? T('Pillar của tiệm', "This shop's pillars") : T('Định dạng của tiệm', "This shop's formats");
  const box: CSSProperties = isMobile
    ? { position: 'fixed', left: 0, right: 0, bottom: 0, top: 'max(48px, 8vh)', borderRadius: '16px 16px 0 0' }
    : { position: 'fixed', top: '8vh', left: '50%', transform: 'translateX(-50%)', width: 'min(520px, 94vw)', maxHeight: '84vh', borderRadius: 14 };
  const small: CSSProperties = { ...field, minHeight: 34, padding: '6px 9px', fontSize: 13 };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(2,6,23,.55)' }} />
      <div style={{ ...box, zIndex: 81, background: 'var(--c111827)', border: '1px solid var(--c334155)', boxShadow: '0 20px 50px rgba(0,0,0,.4)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--line)', background: 'var(--c0f172a)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--cf1f5f9)' }}>{title}</div>
            <div style={{ fontSize: 11, color: 'var(--c64748b)' }}>{T('Chỉ áp dụng cho tiệm này · đổi tên thì các ngày cũ đổi theo', 'This shop only · renaming updates past days too')}</div>
          </div>
          <button type="button" onClick={onClose} title="Esc" style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--c64748b)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14 }}>✕</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'grid', gap: 8, alignContent: 'start' }}>
          {rows.map((r) => {
            const c = TAG_COLORS[r.color] ?? TAG_COLORS[12];
            return (
              <div key={r.key} style={{ display: 'grid', gap: 6, opacity: r.hidden ? .55 : 1 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button type="button" onClick={() => setPalette(palette === r.key ? null : r.key)} title={T('Đổi màu', 'Colour')} style={{ flex: '0 0 auto', width: 34, height: 34, borderRadius: 8, border: '1px solid var(--c334155)', background: c.bg, color: c.ink, cursor: 'pointer', fontWeight: 800, fontFamily: 'inherit' }}>{kind === 'formats' ? iconOf(r.id) : 'A'}</button>
                  <input value={r.vi} maxLength={30} placeholder={T('Tên tiếng Việt', 'Vietnamese name')} onChange={(e) => edit(r.key, { vi: e.target.value })} style={{ ...small, flex: 1, minWidth: 0 }} />
                  <input value={r.en} maxLength={30} placeholder={T('Tên tiếng Anh', 'English name')} onChange={(e) => edit(r.key, { en: e.target.value })} style={{ ...small, flex: 1, minWidth: 0 }} />
                  <button type="button" onClick={() => edit(r.key, { hidden: !r.hidden })} title={r.hidden ? T('Hiện lại', 'Show again') : T('Ẩn khỏi lựa chọn (ngày cũ vẫn giữ)', 'Hide from choices (past days keep it)')} style={{ flex: '0 0 auto', minWidth: 52, height: 34, borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: r.hidden ? 'var(--ink-link)' : 'var(--c94a3b8)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700 }}>{r.hidden ? T('Hiện', 'Show') : T('Ẩn', 'Hide')}</button>
                </div>
                {palette === r.key && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingLeft: 40 }}>
                    {TAG_COLORS.map((pc, i) => (
                      <button key={i} type="button" onClick={() => { edit(r.key, { color: i }); setPalette(null); }} style={{ width: 24, height: 24, borderRadius: 6, background: pc.bg, cursor: 'pointer', border: i === r.color ? '2px solid var(--cf1f5f9)' : '1px solid var(--c334155)' }} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <button type="button" onClick={add} disabled={rows.length >= 24} style={{ justifySelf: 'start', marginTop: 4, minHeight: 34, padding: '0 12px', borderRadius: 8, border: '1px dashed var(--c334155)', background: 'transparent', color: 'var(--ink-link)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700 }}>+ {T('Thêm', 'Add')}</button>
        </div>
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--line)', background: 'var(--c0f172a)', display: 'flex', alignItems: 'center', gap: 8 }}>
          {err && <span style={{ fontSize: 12, color: 'var(--ink-bad)' }}>{err}</span>}
          <button type="button" onClick={onClose} style={{ marginLeft: 'auto', minHeight: 36, padding: '0 14px', borderRadius: 9, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--cf1f5f9)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>{T('Huỷ', 'Cancel')}</button>
          <button type="button" disabled={busy} onClick={() => void save()} style={{ minHeight: 36, padding: '0 14px', borderRadius: 9, border: '1px solid #6366f1', background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 800, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit' }}>{busy ? T('Đang lưu…', 'Saving…') : T('Lưu', 'Save')}</button>
        </div>
      </div>
    </>
  );
}
