'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { instantToWall } from '../lib/datetime';
import { WD_VI, WD_EN, MONTH_VI, MONTH_EN, mondayIndex } from './plan-grid';
import {
  PILLARS, FORMATS, AIR, pillarOf, formatOf, emptyEntry, entryHasContent, entryReady, sheetWeeks, sheetProgress,
  type PlanEntry, type PlanPatch, type Air, type SheetDay,
} from './plan-sheet';

/**
 * THE PLAN SHEET — the agency's Google Sheet, on the salon's own screen.
 *
 * WHAT IT COPIES, AND WHY
 *
 * The team planned every client in a spreadsheet: one band per week, one
 * column per day, and under each day the same six rows — Pillar, Topic,
 * Detail, Link pic, Air, Format. It worked because the whole month is
 * visible at once and every cell is typed straight into; there is no form
 * to open and no dialog to close. This keeps that: the same bands, the same
 * rows, the same colours for the pillar and format chips, typed in place and
 * saved as you leave the cell.
 *
 * WHAT IT ADDS
 *
 * The sheet ended at "Format". Here a filled slot has one more row: a button
 * that turns it into a scheduled post on that day, with the caption, the
 * networks and the date already filled — and once it has, the row shows the
 * post's state instead (scheduled / posted / failed), so the sheet is also
 * the record of what happened to the plan.
 *
 * ON A PHONE
 *
 * Seven columns do not fit a phone. The same slots stack as cards, one per
 * day, in the same order, with the same rows — nothing is hidden on mobile,
 * it is only laid out one day at a time.
 */

export interface SheetPost { id: string; status: string; scheduledAt: string; stage?: string | null }

const STATUS_TONE: Record<string, { bg: string; ink: string; vi: string; en: string }> = {
  posted: { bg: 'rgba(34,197,94,.14)', ink: 'var(--ink-good)', vi: 'Đã đăng', en: 'Posted' },
  failed: { bg: 'rgba(239,68,68,.14)', ink: 'var(--ink-bad)', vi: 'Lỗi đăng', en: 'Failed' },
  publishing: { bg: 'rgba(56,189,248,.14)', ink: 'var(--ink-sky)', vi: 'Đang đăng', en: 'Publishing' },
  scheduled: { bg: 'rgba(99,102,241,.14)', ink: 'var(--ink-link)', vi: 'Đã lên lịch', en: 'Scheduled' },
  draft: { bg: 'rgba(148,163,184,.14)', ink: 'var(--c94a3b8)', vi: 'Bài nháp', en: 'Draft' },
};

const ROW_LABELS: { key: 'pillar' | 'topic' | 'detail' | 'mediaUrl' | 'air' | 'format' | 'status'; vi: string; en: string }[] = [
  { key: 'pillar', vi: 'Pillar', en: 'Pillar' },
  { key: 'topic', vi: 'Chủ đề', en: 'Topic' },
  { key: 'detail', vi: 'Nội dung', en: 'Detail' },
  { key: 'mediaUrl', vi: 'Link ảnh', en: 'Link pic' },
  { key: 'air', vi: 'Kênh', en: 'Air' },
  { key: 'format', vi: 'Định dạng', en: 'Format' },
  { key: 'status', vi: 'Đăng', en: 'Post' },
];

const field: CSSProperties = {
  width: '100%', boxSizing: 'border-box', minHeight: 32, padding: '6px 8px', borderRadius: 7, fontSize: 12.5, fontFamily: 'inherit',
  border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--cf1f5f9)', outline: 'none',
};

export function PlanSheet({
  from, today, tz, entries, posts, vi, canEdit, isMobile, onSave, onSchedule, onOpenPost, connected,
}: {
  /** The Monday the bands start on, salon-local. */
  from: string;
  today: string;
  tz: string;
  entries: Record<string, PlanEntry>;
  posts: SheetPost[];
  vi: boolean;
  canEdit: boolean;
  isMobile: boolean;
  onSave: (day: string, patch: PlanPatch) => Promise<void>;
  /** Turn the slot into a post on that day. */
  onSchedule: (entry: PlanEntry) => void;
  onOpenPost: (id: string) => void;
  connected: Record<Air, boolean>;
}) {
  const T = (a: string, b: string) => (vi ? a : b);
  const weeks = useMemo(() => sheetWeeks(from, today), [from, today]);
  const postById = useMemo(() => new Map(posts.map((p) => [p.id, p])), [posts]);

  // The cells are typed into directly; what is typed lives here until the
  // cell is left, then goes to the server. A save that fails keeps the text
  // on screen and marks the day, so nothing typed is lost to a bad connection.
  const [local, setLocal] = useState<Record<string, PlanEntry>>(entries);
  // The day a person is typing in right now. A save's reply for THAT day must
  // not land on top of the cell they moved to: the topic's save returns while
  // the detail is half-typed, and the server's copy of the detail is empty.
  const activeRef = useRef<string | null>(null);
  useEffect(() => {
    setLocal((cur) => {
      const next = { ...cur };
      for (const [day, e] of Object.entries(entries)) if (day !== activeRef.current) next[day] = e;
      return next;
    });
  }, [entries]);
  const focusOn = (day: string) => { activeRef.current = day; };
  const focusOff = (day: string) => { if (activeRef.current === day) activeRef.current = null; };
  const [busy, setBusy] = useState<Record<string, 'saving' | 'saved' | 'error'>>({});
  const [focusDetail, setFocusDetail] = useState<string | null>(null);

  const get = (day: string): PlanEntry => local[day] ?? entries[day] ?? emptyEntry(day);
  const set = (day: string, patch: PlanPatch) => setLocal((cur) => ({ ...cur, [day]: { ...(cur[day] ?? entries[day] ?? emptyEntry(day)), ...patch } }));
  const commit = async (day: string, patch: PlanPatch) => {
    if (!canEdit) return;
    // Nothing changed against what the server has: no round trip.
    const base = entries[day] ?? emptyEntry(day);
    const changed = (Object.keys(patch) as (keyof PlanPatch)[]).some((k) => JSON.stringify(patch[k]) !== JSON.stringify(base[k]));
    if (!changed) return;
    setBusy((b) => ({ ...b, [day]: 'saving' }));
    try {
      await onSave(day, patch);
      setBusy((b) => ({ ...b, [day]: 'saved' }));
      setTimeout(() => setBusy((b) => { if (b[day] !== 'saved') return b; const n = { ...b }; delete n[day]; return n; }), 1500);
    } catch {
      setBusy((b) => ({ ...b, [day]: 'error' }));
    }
  };
  const change = (day: string, patch: PlanPatch) => { set(day, patch); void commit(day, patch); };

  const progress = sheetProgress(weeks, entries);
  const dateLabel = (key: string) => {
    const [, m, d] = key.split('-').map(Number);
    return { wd: (vi ? WD_VI : WD_EN)[mondayIndex(key)], d, m: (vi ? MONTH_VI : MONTH_EN)[m - 1] };
  };

  // ---- one cell per row ------------------------------------------------------

  const pillarCell = (day: string, e: PlanEntry, dim: boolean) => {
    const p = pillarOf(e.pillar);
    return (
      <select
        value={e.pillar}
        disabled={!canEdit}
        onFocus={() => focusOn(day)}
        onBlur={() => focusOff(day)}
        onChange={(ev) => change(day, { pillar: ev.target.value as PlanEntry['pillar'] })}
        style={{ ...field, fontWeight: 700, background: p ? p.bg : 'var(--c0f172a)', color: p ? p.ink : 'var(--c94a3b8)', borderColor: p ? p.bg : 'var(--c334155)', opacity: dim ? .6 : 1, cursor: canEdit ? 'pointer' : 'default' }}
      >
        <option value="">{T('— chọn —', '— pick —')}</option>
        {PILLARS.map((x) => <option key={x.id} value={x.id}>{vi ? x.vi : x.en}</option>)}
      </select>
    );
  };

  const topicCell = (day: string, e: PlanEntry) => (
    <input
      value={e.topic}
      readOnly={!canEdit}
      placeholder={T('Chủ đề bài…', 'Topic…')}
      onFocus={() => focusOn(day)}
      onChange={(ev) => set(day, { topic: ev.target.value })}
      onBlur={() => { focusOff(day); void commit(day, { topic: get(day).topic }); }}
      style={{ ...field, fontWeight: 700 }}
    />
  );

  const detailCell = (day: string, e: PlanEntry) => (
    <textarea
      value={e.detail}
      readOnly={!canEdit}
      rows={focusDetail === day ? 12 : isMobile ? 4 : 6}
      placeholder={T('Caption / nội dung chi tiết…', 'Caption / detail…')}
      onFocus={() => { focusOn(day); setFocusDetail(day); }}
      onChange={(ev) => set(day, { detail: ev.target.value })}
      onBlur={() => { focusOff(day); setFocusDetail(null); void commit(day, { detail: get(day).detail }); }}
      style={{ ...field, resize: 'vertical', lineHeight: 1.45, fontSize: 12, transition: 'height .1s' }}
    />
  );

  const mediaCell = (day: string, e: PlanEntry) => {
    const isUrl = /^https?:\/\//i.test(e.mediaUrl);
    return (
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <input
          value={e.mediaUrl}
          readOnly={!canEdit}
          placeholder={T('Dán link ảnh / Drive…', 'Paste a picture / Drive link…')}
          onFocus={() => focusOn(day)}
          onChange={(ev) => set(day, { mediaUrl: ev.target.value })}
          onBlur={() => { focusOff(day); void commit(day, { mediaUrl: get(day).mediaUrl }); }}
          style={{ ...field, fontSize: 12, minWidth: 0 }}
        />
        {isUrl && (
          <a href={e.mediaUrl} target="_blank" rel="noreferrer" title={T('Mở link', 'Open link')} style={{ flex: '0 0 auto', width: 30, height: 32, borderRadius: 7, border: '1px solid var(--c334155)', display: 'grid', placeItems: 'center', color: 'var(--ink-link)', textDecoration: 'none', fontSize: 14 }}>🔗</a>
        )}
      </div>
    );
  };

  const airCell = (day: string, e: PlanEntry) => (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', minHeight: 32, alignItems: 'center' }}>
      {AIR.map((a) => {
        const on = e.air.includes(a.id);
        const off = !connected[a.id];
        return (
          <button
            key={a.id}
            type="button"
            disabled={!canEdit}
            title={off ? T(`${a.short}: tiệm chưa kết nối`, `${a.short}: not connected`) : a.id}
            onClick={() => change(day, { air: on ? e.air.filter((x) => x !== a.id) : [...e.air, a.id] })}
            style={{
              padding: '3px 8px', borderRadius: 999, fontSize: 11, fontWeight: 800, fontFamily: 'inherit', cursor: canEdit ? 'pointer' : 'default', lineHeight: 1.4,
              border: `1px solid ${on ? a.bg : 'var(--c334155)'}`, background: on ? a.bg : 'transparent', color: on ? '#fff' : 'var(--c64748b)',
              textDecoration: off && on ? 'line-through' : 'none', opacity: off && !on ? .55 : 1,
            }}
          >{a.short}</button>
        );
      })}
    </div>
  );

  const formatCell = (day: string, e: PlanEntry) => {
    const f = formatOf(e.format);
    return (
      <select
        value={e.format}
        disabled={!canEdit}
        onFocus={() => focusOn(day)}
        onBlur={() => focusOff(day)}
        onChange={(ev) => change(day, { format: ev.target.value as PlanEntry['format'] })}
        style={{ ...field, fontWeight: 700, background: f ? f.bg : 'var(--c0f172a)', color: f ? f.ink : 'var(--c94a3b8)', borderColor: f ? f.bg : 'var(--c334155)', cursor: canEdit ? 'pointer' : 'default' }}
      >
        <option value="">{T('— định dạng —', '— format —')}</option>
        {FORMATS.map((x) => <option key={x.id} value={x.id}>{vi ? x.vi : x.en}</option>)}
      </select>
    );
  };

  const statusCell = (d: SheetDay, e: PlanEntry) => {
    const post = e.postId ? postById.get(e.postId) : null;
    if (post) {
      const tone = STATUS_TONE[post.status] ?? STATUS_TONE.draft;
      const hm = instantToWall(post.scheduledAt, tz).slice(11, 16);
      return (
        <button
          type="button"
          onClick={() => onOpenPost(post.id)}
          title={T('Xem bài', 'Open the post')}
          style={{ width: '100%', minHeight: 32, borderRadius: 7, border: `1px solid ${tone.ink}`, background: tone.bg, color: tone.ink, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
        >
          <span>{post.status === 'posted' ? '✅' : post.status === 'failed' ? '⚠️' : '🗓️'}</span>
          <span>{vi ? tone.vi : tone.en} · {hm}</span>
        </button>
      );
    }
    if (!canEdit || d.past) {
      return <div style={{ minHeight: 32, display: 'flex', alignItems: 'center', fontSize: 11.5, color: 'var(--c64748b)' }}>{e.postId ? T('Bài đã xoá', 'Post deleted') : d.past ? '' : T('Chưa lên lịch', 'Not scheduled')}</div>;
    }
    const ready = entryReady(e);
    return (
      <button
        type="button"
        disabled={!ready}
        onClick={() => onSchedule(e)}
        title={ready ? T('Mở khung soạn với nội dung và ngày này', 'Open the composer with this content and day') : T('Cần chủ đề hoặc nội dung, và ít nhất một kênh', 'Needs a topic or detail, and at least one network')}
        style={{
          width: '100%', minHeight: 32, borderRadius: 7, fontSize: 12, fontWeight: 800, fontFamily: 'inherit', cursor: ready ? 'pointer' : 'default',
          border: `1px solid ${ready ? '#6366f1' : 'var(--c334155)'}`, background: ready ? 'rgba(99,102,241,.16)' : 'transparent', color: ready ? 'var(--ink-link)' : 'var(--c64748b)',
        }}
      >
        {e.postId ? T('↻ Lên lịch lại', '↻ Schedule again') : ready ? T('→ Lên lịch đăng', '→ Schedule') : T('Chưa đủ để đăng', 'Not enough yet')}
      </button>
    );
  };

  const cellFor = (key: typeof ROW_LABELS[number]['key'], d: SheetDay, e: PlanEntry) => {
    switch (key) {
      case 'pillar': return pillarCell(d.key, e, d.past);
      case 'topic': return topicCell(d.key, e);
      case 'detail': return detailCell(d.key, e);
      case 'mediaUrl': return mediaCell(d.key, e);
      case 'air': return airCell(d.key, e);
      case 'format': return formatCell(d.key, e);
      default: return statusCell(d, e);
    }
  };

  const dayHead = (d: SheetDay, wide: boolean) => {
    const L = dateLabel(d.key);
    const b = busy[d.key];
    return (
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: wide ? '6px 8px' : 0, borderRadius: 8, background: d.today ? 'rgba(99,102,241,.14)' : wide ? 'var(--c1e293b)' : 'transparent', minWidth: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: .5, textTransform: 'uppercase', color: d.today ? 'var(--ink-link)' : 'var(--c94a3b8)' }}>{L.wd}</span>
        <span style={{ fontSize: 15, fontWeight: 800, color: d.today ? 'var(--ink-link)' : 'var(--cf1f5f9)', fontVariantNumeric: 'tabular-nums' }}>{L.d}</span>
        <span style={{ fontSize: 10.5, color: 'var(--c64748b)' }}>{L.m}</span>
        {d.today && <span style={{ fontSize: 9.5, fontWeight: 800, color: 'var(--ink-link)', textTransform: 'uppercase', letterSpacing: .4 }}>{T('hôm nay', 'today')}</span>}
        <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 700, color: b === 'error' ? 'var(--ink-bad)' : b === 'saved' ? 'var(--ink-good)' : 'var(--c64748b)' }}>
          {b === 'saving' ? '…' : b === 'saved' ? '✓' : b === 'error' ? T('lỗi lưu', 'not saved') : ''}
        </span>
      </div>
    );
  };

  // ---- the bands -------------------------------------------------------------

  const weekTitle = (row: SheetDay[]) => {
    const a = dateLabel(row[0].key), z = dateLabel(row[6].key);
    return `${a.d} ${a.m} – ${z.d} ${z.m}`;
  };

  const wide = !isMobile;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--cf1f5f9)' }}>🗓️ {T('Plan 30 ngày', '30-day plan')}</div>
        <div style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>
          {T(`${progress.filled}/${progress.days} ngày đã có nội dung · ${progress.scheduled} đã lên lịch`, `${progress.filled}/${progress.days} days planned · ${progress.scheduled} scheduled`)}
        </div>
        {canEdit && (
          <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginLeft: 'auto' }}>
            {T('Gõ thẳng vào ô · tự lưu khi rời ô · xong thì bấm "Lên lịch đăng"', 'Type into the cells · saved as you leave · then press "Schedule"')}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gap: 16 }}>
        {weeks.map((row, wi) => {
          const inWindow = row.filter((d) => d.inWindow);
          if (!inWindow.length) return null;
          return (
            <div key={wi} style={{ borderRadius: 12, border: '1px solid var(--c334155)', background: 'var(--c111827)', overflow: 'hidden' }}>
              <div style={{ padding: '7px 12px', fontSize: 11.5, fontWeight: 800, letterSpacing: .5, textTransform: 'uppercase', color: 'var(--c94a3b8)', borderBottom: '1px solid var(--line)', background: 'var(--c0f172a)' }}>
                {T(`Tuần ${wi + 1}`, `Week ${wi + 1}`)} · {weekTitle(row)}
              </div>

              {wide ? (
                <div style={{ overflowX: 'auto' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '68px repeat(7, minmax(150px, 1fr))', gap: 0, minWidth: 1120 }}>
                    <div style={{ padding: 6, borderBottom: '1px solid var(--line)' }} />
                    {row.map((d) => (
                      <div key={d.key} style={{ padding: 6, borderBottom: '1px solid var(--line)', borderLeft: '1px solid var(--line)', opacity: d.inWindow ? 1 : .45 }}>{dayHead(d, true)}</div>
                    ))}
                    {ROW_LABELS.map((r) => (
                      <div key={r.key} style={{ display: 'contents' }}>
                        <div style={{ padding: '8px 8px', fontSize: 11, fontWeight: 800, color: 'var(--c64748b)', textTransform: 'uppercase', letterSpacing: .4, borderBottom: '1px solid var(--line)', display: 'flex', alignItems: r.key === 'detail' ? 'flex-start' : 'center' }}>
                          {vi ? r.vi : r.en}
                        </div>
                        {row.map((d) => (
                          <div key={d.key} style={{ padding: 5, borderBottom: '1px solid var(--line)', borderLeft: '1px solid var(--line)', background: d.today ? 'rgba(99,102,241,.05)' : 'transparent', opacity: d.inWindow ? 1 : .45, minWidth: 0 }}>
                            {d.inWindow || entryHasContent(get(d.key)) ? cellFor(r.key, d, get(d.key)) : null}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 10, padding: 10 }}>
                  {inWindow.map((d) => {
                    const e = get(d.key);
                    return (
                      <div key={d.key} style={{ borderRadius: 10, border: `1px solid ${d.today ? '#6366f1' : 'var(--c334155)'}`, background: 'var(--c0f172a)', padding: 10, display: 'grid', gap: 7 }}>
                        {dayHead(d, false)}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                          {pillarCell(d.key, e, d.past)}
                          {formatCell(d.key, e)}
                        </div>
                        {topicCell(d.key, e)}
                        {detailCell(d.key, e)}
                        {mediaCell(d.key, e)}
                        {airCell(d.key, e)}
                        {statusCell(d, e)}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
