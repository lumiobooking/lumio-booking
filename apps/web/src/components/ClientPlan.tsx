'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import { fresh, useLive } from '../lib/live';
import { useIsMobile } from '../lib/responsive';
import { ind } from '../lib/ui-industry';
import { PostReviewDetail, type ReviewApi, type ReviewFeed, type ReviewPost } from './PostReview';
import { SalonWorkspace, SendAnything } from './SalonWorkspace';
import type { LastWeek, ShopPlanSheet, ShopWeekData } from './ShopWeek';
import { DEFAULT_TAGS, monthTitle, shiftMonth, tagViews, type PlanTags } from './plan-sheet';
import { addDays, mondayIndex } from './plan-grid';

/**
 * THE SHOP'S SCREEN IS THE MONTH.
 *
 * The first version of /salon/approve-posts was two tabs over a long scroll:
 * a send box, three counters, Lumio's suggestions, the week's chores, the
 * month plan squeezed into a card, last week's numbers, the ad receipt, the
 * holidays — and the posts waiting for a yes on the OTHER tab. An owner
 * between two customers opened it to answer one question ("what is going out,
 * and what do I have to do?") and got a dashboard.
 *
 * Now the month calendar is the page, as wide as the window allows, and each
 * day says in plain words what is planned or scheduled there: the topic, the
 * pillar, the kind of post, the network, and where it stands. The posts
 * waiting for approval are not a separate list — they are the purple days.
 * Tap one and the post opens beside the calendar (a drawer on a laptop, the
 * full screen on a phone) with the same preview and approve bar the review
 * link uses. Everything else — the suggestions with their reference clips,
 * the week's chores, the numbers, the ad plan, the holidays — still exists,
 * folded under the calendar behind one toggle.
 *
 * The data is the same three payloads the old tabs read (the review feed,
 * my-week, the suggestions); this screen merges the plan's entries with the
 * feed's real posts by day, in the SALON's calendar.
 */

type SuggestionLite = { id: string; title: string; refUrl: string | null; status: string; fromShop?: boolean };
type SuggFeed = { open: SuggestionLite[]; past: SuggestionLite[]; waiting: number };
type MyWeek = { week: ShopWeekData | null; weekKey: string | null; lastWeek: LastWeek | null; planSheet: ShopPlanSheet | null };

type Entry = ShopPlanSheet['entries'][string];

/** One day on the grid: the plan's words plus the real post, when there is one. */
interface DayCell {
  key: string;
  entry: Entry | null;
  post: ReviewPost | null;
}

const CHANNEL_ICON: Record<string, { text: string; bg: string; fg: string }> = {
  facebook: { text: 'f', bg: '#1877f2', fg: '#fff' },
  instagram: { text: '◎', bg: 'linear-gradient(135deg,#f58529,#dd2a7b 55%,#8134af)', fg: '#fff' },
  google: { text: 'G', bg: '#fff', fg: '#1a73e8' },
  tiktok: { text: '♪', bg: '#111', fg: '#fff' },
};

function ChannelDots({ list, size = 18 }: { list: string[]; size?: number }) {
  return (
    <span style={{ display: 'inline-flex', gap: 3, flexShrink: 0 }}>
      {list.map((c) => {
        const ic = CHANNEL_ICON[c];
        if (!ic) return null;
        return (
          <span key={c} aria-label={c} style={{
            width: size, height: size, borderRadius: 999, background: ic.bg, color: ic.fg,
            fontSize: Math.round(size * 0.58), fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            border: c === 'google' ? '1px solid var(--c334155)' : 'none', boxSizing: 'border-box',
          }}>{ic.text}</span>
        );
      })}
    </span>
  );
}

/**
 * Where a post stands, in the owner's words. The colour of the day follows
 * this: purple = waiting on her, orange = waiting on her again after a note,
 * green tick = out, clock = approved and will go by itself.
 */
function standing(post: ReviewPost | null, vi: boolean, fmtTime: (iso: string) => string): { text: string; color: string; tone: 'wait' | 'fix' | 'done' | 'sched' | 'plan' | 'held' } {
  const T = (v: string, e: string) => ind(vi ? v : e);
  if (!post) return { text: T('Dự kiến', 'Planned'), color: 'var(--c64748b)', tone: 'plan' };
  switch (post.clientStatus) {
    case 'posted': return { text: `✓ ${T('Đã đăng', 'Posted')}`, color: 'var(--ink-good)', tone: 'done' };
    case 'approved': return { text: `⏰ ${fmtTime(post.scheduledAt)} · ${T('đã duyệt, tự đăng', 'approved, posts itself')}`, color: 'var(--ca5b4fc)', tone: 'sched' };
    case 'held':
      return post.reviewRequestedAt
        ? { text: `🔄 ${T('Team đã sửa · duyệt lại', 'Revised · review again')}`, color: 'var(--ink-warn)', tone: 'fix' }
        : { text: `⏸ ${T('Đang sửa theo góp ý', 'Being revised')}`, color: 'var(--ink-warn)', tone: 'held' };
    default: return { text: T('Chờ chị duyệt', 'Awaiting your OK'), color: 'var(--ca5b4fc)', tone: 'wait' };
  }
}

export function ClientPlan({ token, vi, api, onWaiting }: {
  token: string | null;
  vi: boolean;
  /** The review feed's fetchers — the same object the review link uses. */
  api: ReviewApi;
  /** How many posts wait on the owner, for anything outside this screen that wants the number. */
  onWaiting?: (n: number) => void;
}) {
  const T = (v: string, e: string) => ind(vi ? v : e);
  const isMobile = useIsMobile(900);

  const [feed, setFeed] = useState<ReviewFeed | null>(null);
  const [feedErr, setFeedErr] = useState<string | null>(null);
  const [plan, setPlan] = useState<ShopPlanSheet | null>(null);
  const [week, setWeek] = useState<ShopWeekData | null>(null);
  const [lastWeek, setLastWeek] = useState<LastWeek | null>(null);
  const [sugg, setSugg] = useState<SuggFeed | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  /** A planned day with no real post yet: its words, in a small sheet. */
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const sendRef = useRef<(() => void) | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const [f, w, s] = await Promise.all([
      api.feed().then((r) => { setFeedErr(null); return r; }).catch((e: unknown) => { setFeedErr(e instanceof Error ? e.message : 'error'); return null; }),
      apiFetch<MyWeek>(fresh(`/content/my-week?lang=${vi ? 'vi' : 'en'}`), { token }).catch(() => null),
      apiFetch<SuggFeed>(fresh('/content/suggestions'), { token }).catch(() => null),
    ]);
    if (f) { setFeed(f); onWaiting?.(f.waiting ?? 0); }
    if (w) {
      setWeek(w.week ?? null); setLastWeek(w.lastWeek ?? null);
      // Keep the month the owner turned to; only the first answer picks one.
      setPlan((prev) => (prev && w.planSheet && prev.month !== w.planSheet.month ? prev : (w.planSheet ?? prev)));
    }
    if (s) setSugg(s);
    setLoaded(true);
  }, [token, vi, api, onWaiting]);
  useEffect(() => { load(); }, [load]);
  useLive(load, 120_000, Boolean(token));

  const pickMonth = useCallback(async (month: string) => {
    if (!token) return;
    const r = await apiFetch<{ planSheet: ShopPlanSheet | null }>(fresh(`/content/my-month?month=${encodeURIComponent(month)}`), { token }).catch(() => null);
    if (r?.planSheet) setPlan(r.planSheet);
  }, [token]);

  // ---- the calendar's arithmetic, in the salon's own zone ----
  const tz = feed?.timezone || plan?.tz || undefined;
  const locale = vi ? 'vi-VN' : 'en-US';
  const dayKeyOf = useCallback((iso: string) => new Date(iso).toLocaleDateString('en-CA', tz ? { timeZone: tz } : {}), [tz]);
  const fmtTime = useCallback((iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) }), [locale, tz]);
  const fmtDay = useCallback((iso: string) => new Date(iso).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'numeric', ...(tz ? { timeZone: tz } : {}) }), [locale, tz]);
  const today = plan?.today ?? new Date().toLocaleDateString('en-CA', tz ? { timeZone: tz } : {});
  const month = plan?.month ?? today.slice(0, 7);

  const tags: PlanTags = plan?.tags ?? DEFAULT_TAGS;
  const pillars = useMemo(() => tagViews(tags.pillars), [tags]);
  const formats = useMemo(() => tagViews(tags.formats), [tags]);
  const pillarOf = (id: string) => pillars.find((p) => p.id === id) ?? null;
  const formatOf = (id: string) => formats.find((p) => p.id === id) ?? null;

  /** Posts by salon day; a day may carry more than one, the cell shows the first that needs her. */
  const postsByDay = useMemo(() => {
    const m = new Map<string, ReviewPost[]>();
    for (const p of feed?.posts ?? []) {
      const k = dayKeyOf(p.scheduledAt);
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    const rank: Record<ReviewPost['clientStatus'], number> = { wait: 0, held: 1, approved: 2, posted: 3 };
    for (const [k, list] of m) m.set(k, [...list].sort((a, b) => rank[a.clientStatus] - rank[b.clientStatus]));
    return m;
  }, [feed, dayKeyOf]);

  const cellOf = useCallback((key: string): DayCell => {
    const entry = plan?.entries?.[key] ?? null;
    const list = postsByDay.get(key) ?? [];
    // The plan's own post first (the row the team linked), else whatever is on the day.
    const post = (entry?.postId && list.find((p) => p.id === entry.postId)) || list[0] || null;
    return { key, entry: entry && (entry.topic || entry.pillar || entry.format) ? entry : null, post };
  }, [plan, postsByDay]);

  /** Six weeks at most, Monday first, around the shown month. */
  const gridDays = useMemo(() => {
    const first = `${month}-01`;
    const start = addDays(first, -mondayIndex(first));
    const [y, m] = month.split('-').map(Number);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const end = `${month}-${String(lastDay).padStart(2, '0')}`;
    const rows = Math.ceil((mondayIndex(first) + lastDay) / 7);
    return Array.from({ length: rows * 7 }, (_, i) => addDays(start, i)).map((k) => ({ key: k, outside: k < first || k > end }));
  }, [month]);

  const waiting = useMemo(() => (feed?.posts ?? []).filter((p) => p.clientStatus === 'wait' || (p.clientStatus === 'held' && p.reviewRequestedAt)), [feed]);
  const counts = useMemo(() => {
    const inMonth = Object.entries(plan?.entries ?? {}).filter(([k, e]) => k.startsWith(month) && (e.topic || e.pillar));
    const posted = (feed?.posts ?? []).filter((p) => p.clientStatus === 'posted' && dayKeyOf(p.scheduledAt).startsWith(month)).length;
    return { planned: inMonth.length, posted };
  }, [plan, feed, month, dayKeyOf]);
  const daysInMonth = useMemo(() => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); }, [month]);

  const openPost = feed?.posts.find((p) => p.id === openId) ?? null;
  const openEntry = openDay ? cellOf(openDay) : null;
  const toFilm = (sugg?.open ?? []).filter((s) => !s.fromShop && s.status === 'sent');
  const shopJobs = (week?.jobs ?? []).filter((j) => j.by === 'shop');
  const ask = week?.ask ?? null;

  /** Open the first post that waits on her, then the next with "Bài sau". */
  const nextWaiting = (afterId: string | null) => {
    const i = afterId ? waiting.findIndex((p) => p.id === afterId) : -1;
    return waiting[i + 1] ?? null;
  };

  const tone = (c: DayCell) => standing(c.post, vi, fmtTime);
  const cellBg = (t: ReturnType<typeof standing>['tone'], outside: boolean) =>
    t === 'wait' ? 'var(--c1e1b4b)' : t === 'fix' ? 'var(--c451a03)' : outside ? 'var(--c0f172a)' : 'var(--c1e293b)';
  const cellRing = (t: ReturnType<typeof standing>['tone'], key: string) =>
    t === 'wait' ? 'inset 0 0 0 2px #7c3aed' : t === 'fix' ? 'inset 0 0 0 2px #f59e0b' : key === today ? 'inset 0 0 0 1.5px #6366f1' : 'none';

  // ---------------------------------------------------------------- pieces
  const pillarChip = (id: string) => {
    const p = pillarOf(id);
    if (!p) return null;
    return <span style={{ display: 'inline-flex', alignItems: 'center', height: 20, padding: '0 7px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: p.bg, color: p.ink }}>{vi ? p.vi : p.en}</span>;
  };
  const formatName = (id: string) => { const f = formatOf(id); return f ? (vi ? f.vi : f.en) : ''; };
  const topicOf = (c: DayCell) => c.entry?.topic || (c.post ? (c.post.message.split('\n').find((l) => l.trim()) ?? '') : '');
  const channelsOf = (c: DayCell) => c.post?.channels ?? c.entry?.air ?? [];
  const openCell = (c: DayCell) => { if (c.post) { setOpenId(c.post.id); setOpenDay(null); } else if (c.entry) { setOpenDay(c.key); } };

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginRight: 4 }}>
        <h1 style={{ fontSize: isMobile ? 19 : 23, margin: 0, color: 'var(--ce2e8f0)' }}>{T('Kế hoạch', 'Plan')} {monthTitle(month, vi).toLowerCase()}</h1>
        <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>
          {loaded
            ? `${T('Lumio lên', 'Lumio planned')} ${counts.planned}/${daysInMonth} ${T('ngày', 'days')} · ${counts.posted} ${T('đã đăng', 'posted')} · ${waiting.length} ${T('chờ chị duyệt', 'awaiting your OK')}${toFilm.length || ask ? ` · ${toFilm.length || 1} ${T('cần tiệm quay', 'to film')}` : ''}`
            : T('Đang tải…', 'Loading…')}
        </span>
      </div>
      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        <button onClick={() => pickMonth(shiftMonth(month, -1))} aria-label={T('Tháng trước', 'Previous month')} style={{ ...navBtn, width: 34, padding: 0 }}>‹</button>
        <button onClick={() => pickMonth(today.slice(0, 7))} style={navBtn}>{T('Hôm nay', 'Today')}</button>
        <button onClick={() => pickMonth(shiftMonth(month, 1))} aria-label={T('Tháng sau', 'Next month')} style={{ ...navBtn, width: 34, padding: 0 }}>›</button>
      </span>
      <span style={{ flex: 1 }} />
      {waiting.length > 0 && !isMobile && (
        <button onClick={() => setOpenId(waiting[0].id)} style={{ ...navBtn, minHeight: 40, background: 'var(--c1e1b4b)', borderColor: '#7c3aed', color: 'var(--ca5b4fc)', fontWeight: 700 }}>
          🟣 {waiting.length} {T('bài chờ duyệt', 'to approve')} <span style={{ fontWeight: 500, opacity: .8 }}>· {T('bấm vào ô tím', 'the purple days')}</span>
        </button>
      )}
      <button onClick={() => { setSendOpen((v) => !v); setTimeout(() => sendRef.current?.(), 150); }} style={{ ...navBtn, minHeight: 40, background: '#6366f1', borderColor: '#6366f1', color: '#fff', fontWeight: 700 }}>
        📷 {T('Gửi ảnh/clip', 'Send photos/clips')}
      </button>
    </div>
  );

  const legend = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 12, color: 'var(--c94a3b8)', flexWrap: 'wrap' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 13, height: 13, borderRadius: 4, background: 'var(--c1e1b4b)', boxShadow: 'inset 0 0 0 2px #7c3aed', display: 'inline-block' }} />{T('Chờ chị duyệt — bấm vào để xem & duyệt', 'Awaiting your OK — tap to review')}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 13, height: 13, borderRadius: 4, background: 'var(--c451a03)', boxShadow: 'inset 0 0 0 2px #f59e0b', display: 'inline-block' }} />{T('Team đã sửa theo góp ý', 'Revised after your note')}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ color: 'var(--ink-good)', fontWeight: 700 }}>✓</span>{T('Đã đăng', 'Posted')}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ color: 'var(--ca5b4fc)', fontWeight: 700 }}>⏰</span>{T('Đã duyệt, tự đăng đúng giờ', 'Approved, posts itself')}</span>
      {!isMobile && (
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
          {pillars.filter((p) => !p.hidden).map((p) => <span key={p.id} style={{ height: 20, padding: '0 7px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: p.bg, color: p.ink, display: 'inline-flex', alignItems: 'center' }}>{vi ? p.vi : p.en}</span>)}
        </span>
      )}
    </div>
  );

  const grid = (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 1, background: 'var(--c334155)', border: '1px solid var(--c334155)', borderRadius: 14, overflow: 'hidden' }}>
      {(vi ? ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'CN'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']).map((d, i) => (
        <div key={d} style={{ background: 'var(--c0f172a)', height: 34, display: 'flex', alignItems: 'center', padding: '0 12px', fontSize: 11.5, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: i === 6 ? 'var(--ink-warn)' : 'var(--c64748b)' }}>{d}</div>
      ))}
      {gridDays.map(({ key, outside }) => {
        const c = cellOf(key);
        const st = tone(c);
        const has = Boolean(c.entry || c.post);
        const dayN = Number(key.slice(8, 10));
        return (
          <div
            key={key}
            role={has ? 'button' : undefined}
            tabIndex={has ? 0 : undefined}
            onClick={() => openCell(c)}
            onKeyDown={(e) => { if (has && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openCell(c); } }}
            style={{
              background: cellBg(st.tone, outside), boxShadow: cellRing(st.tone, key),
              minHeight: 148, padding: '10px 10px 12px', boxSizing: 'border-box',
              display: 'flex', flexDirection: 'column', gap: 6, cursor: has ? 'pointer' : 'default', opacity: outside && !has ? 0.55 : 1,
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, height: 24, fontSize: 14, fontWeight: 700, color: outside ? 'var(--c64748b)' : 'var(--ce2e8f0)' }}>
              {key === today
                ? <span style={{ width: 26, height: 26, borderRadius: 999, background: '#6366f1', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{dayN}</span>
                : dayN}
              <span style={{ marginLeft: 'auto' }}><ChannelDots list={channelsOf(c)} /></span>
            </span>
            {has && (
              <>
                <span style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.4, color: st.tone === 'done' ? 'var(--ink-good)' : 'var(--ce2e8f0)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
                  {topicOf(c) || T('(bài chỉ có ảnh)', '(media only)')}
                </span>
                {(c.entry?.pillar || c.entry?.format) && (
                  <span style={{ fontSize: 12, color: 'var(--c94a3b8)', display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                    {c.entry?.pillar ? pillarChip(c.entry.pillar) : null}
                    {c.entry?.format ? <span>{c.entry.pillar ? '· ' : ''}{formatName(c.entry.format)}</span> : null}
                  </span>
                )}
                <span style={{ marginTop: 'auto', fontSize: 12.5, fontWeight: st.tone === 'plan' ? 500 : 700, color: st.color }}>{st.text}</span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );

  /** The phone: a week strip, then the days as rows — a 7-column grid is unreadable at 390px. */
  const agenda = (() => {
    const from = addDays(today, -mondayIndex(today));
    const strip = Array.from({ length: 7 }, (_, i) => addDays(from, i));
    const upcoming = gridDays.filter((d) => !d.outside && d.key >= addDays(today, -1)).map((d) => cellOf(d.key)).filter((c) => c.entry || c.post);
    return (
      <>
        <div style={{ display: 'flex', gap: 4, padding: '8px 0 2px' }}>
          {strip.map((k) => {
            const c = cellOf(k); const st = tone(c); const on = k === today;
            const dot = st.tone === 'wait' ? '#a78bfa' : st.tone === 'fix' ? '#f59e0b' : st.tone === 'done' ? '#22c55e' : (c.entry || c.post) ? 'var(--c64748b)' : 'transparent';
            return (
              <div key={k} onClick={() => openCell(c)} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '6px 0', borderRadius: 10, background: on ? '#6366f1' : 'transparent', color: on ? '#fff' : 'var(--ce2e8f0)' }}>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: on ? 'rgba(255,255,255,.85)' : 'var(--c64748b)' }}>{new Date(`${k}T12:00:00`).toLocaleDateString(locale, { weekday: 'short' })}</span>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{Number(k.slice(8, 10))}</span>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: on && dot !== 'transparent' ? '#fff' : dot }} />
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 12, color: 'var(--c64748b)', padding: '4px 2px 0' }}>{T('Từ hôm nay · bấm vào bài tím để duyệt', 'From today · tap a purple post to review')}</div>
        {upcoming.length === 0 && <div style={{ padding: '26px 14px', textAlign: 'center', color: 'var(--c64748b)', fontSize: 13.5, lineHeight: 1.6 }}>{T('Chưa có bài nào từ hôm nay đến cuối tháng — team sẽ báo khi có.', 'Nothing planned from today to month end — the team will let you know.')}</div>}
        {upcoming.map((c) => {
          const st = tone(c);
          return (
            <div key={c.key} role="button" tabIndex={0} onClick={() => openCell(c)} onKeyDown={(e) => { if (e.key === 'Enter') openCell(c); }} style={{
              display: 'flex', gap: 12, padding: 12, borderRadius: 12, cursor: 'pointer',
              background: cellBg(st.tone, false), boxShadow: cellRing(st.tone, c.key), border: '1px solid var(--c334155)',
            }}>
              <div style={{ width: 44, display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: 'var(--c64748b)', fontWeight: 600 }}>{new Date(`${c.key}T12:00:00`).toLocaleDateString(locale, { weekday: 'short' })}</span>
                <span style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.1, color: c.key === today ? 'var(--ca5b4fc)' : 'var(--ce2e8f0)' }}>{Number(c.key.slice(8, 10))}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.35, color: 'var(--ce2e8f0)' }}>{topicOf(c) || T('(bài chỉ có ảnh)', '(media only)')}</span>
                <span style={{ fontSize: 12, color: 'var(--c94a3b8)', display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                  {c.entry?.pillar ? pillarChip(c.entry.pillar) : null}
                  {c.entry?.format ? <span>· {formatName(c.entry.format)}</span> : null}
                  <ChannelDots list={channelsOf(c)} size={16} />
                </span>
                <span style={{ fontSize: 12.5, fontWeight: st.tone === 'plan' ? 500 : 700, color: st.color, marginTop: 2 }}>{st.text}</span>
              </div>
            </div>
          );
        })}
      </>
    );
  })();

  const below = (
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
      {/* what the shop has to go and do */}
      <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 12, ...(toFilm.length || ask ? { borderColor: '#f59e0b', background: 'var(--c451a03)' } : {}) }}>
        <span style={{ fontSize: 22 }}>📷</span>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <b style={{ fontSize: 14, color: toFilm.length || ask ? 'var(--cfde68a)' : 'var(--ce2e8f0)' }}>
            {toFilm.length
              ? `${T('Lumio nhờ tiệm quay/chụp', 'Lumio asks you to film')} · ${toFilm.length}`
              : ask ? T('Tuần này tiệm làm 1 việc', 'One thing from you this week')
                : T('Tuần này tiệm không phải làm gì thêm', 'Nothing needed from you this week')}
          </b>
          <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {toFilm[0]?.title ?? ask?.what ?? (shopJobs[0]?.text ?? T('Quay/chụp được gì cứ gửi, bên em dựng bài.', 'Anything you shoot, send it — we make the post.'))}
          </span>
        </div>
        <button onClick={() => setMoreOpen(true)} style={navBtn}>{toFilm.length || ask ? T('Xem', 'Open') : T('Chi tiết', 'Details')}</button>
      </div>
      {/* what the shop got */}
      <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        {lastWeek ? (
          <>
            {[
              [lastWeek.posted, T('bài đã đăng', 'posts')],
              [lastWeek.reviews, T('đánh giá mới', 'new reviews')],
              [lastWeek.newCustomers, T('khách mới', 'new customers')],
              [lastWeek.bookings, T('lượt đặt lịch', 'bookings')],
            ].map(([n, label]) => (
              <span key={String(label)} style={{ display: 'flex', flexDirection: 'column' }}>
                <b style={{ fontSize: 19, color: 'var(--ce2e8f0)', letterSpacing: -0.3 }}>{n}</b>
                <span style={{ fontSize: 11.5, color: 'var(--c64748b)' }}>{label}</span>
              </span>
            ))}
            <span style={{ flex: 1, textAlign: 'right', fontSize: 12.5, color: 'var(--c94a3b8)' }}>
              {T('Tuần trước', 'Last week')} · <button onClick={() => setMoreOpen(true)} style={linkBtn}>{T('Kết quả & quảng cáo ›', 'Results & ads ›')}</button>
            </span>
          </>
        ) : (
          <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{T('Số liệu tuần trước sẽ hiện ở đây.', 'Last week’s numbers will show here.')} <button onClick={() => setMoreOpen(true)} style={linkBtn}>{T('Chi tiết ›', 'Details ›')}</button></span>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: isMobile ? 90 : 0 }}>
      {header}
      {(err || feedErr) && (
        <div style={{ background: 'var(--c450a0a)', border: '1px solid #ef4444', color: 'var(--cfecaca)', borderRadius: 12, padding: '11px 14px', fontSize: 13.5, lineHeight: 1.55 }}>{err || feedErr}</div>
      )}
      {sendOpen && (
        <div>
          <SendAnything token={token} vi={vi} onDone={load} onError={setErr} openRef={sendRef} />
        </div>
      )}
      {!loaded && <div style={{ padding: 40, textAlign: 'center', color: 'var(--c64748b)' }}>{T('Đang tải…', 'Loading…')}</div>}
      {loaded && (isMobile ? agenda : grid)}
      {loaded && legend}
      {loaded && below}

      {/* everything the old tabs held, folded under one toggle */}
      <div>
        <button onClick={() => setMoreOpen((v) => !v)} style={{ ...navBtn, width: '100%', justifyContent: 'flex-start', minHeight: 44, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'inline-block', transform: moreOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s', fontSize: 11 }}>▶</span>
          {T('Chi tiết: việc của tiệm · Lumio đang làm gì · kết quả & quảng cáo · ngày lễ', 'Details: your jobs · what Lumio is doing · results & ads · holidays')}
        </button>
        {moreOpen && (
          <div style={{ marginTop: 12 }}>
            <SalonWorkspace token={token} vi={vi} hidePlan hideSend onSend={() => { setSendOpen(true); setTimeout(() => sendRef.current?.(), 150); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
          </div>
        )}
      </div>

      {/* the phone's thumb bar */}
      {isMobile && loaded && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50, padding: '10px 14px calc(12px + env(safe-area-inset-bottom, 0px))', background: 'var(--c111827)', borderTop: '1px solid var(--c334155)', display: 'flex', gap: 8 }}>
          {waiting.length > 0 ? (
            <button onClick={() => setOpenId(waiting[0].id)} style={{ flex: 1, minHeight: 48, borderRadius: 12, border: 'none', background: '#22c55e', color: '#052e16', fontSize: 14.5, fontWeight: 700, cursor: 'pointer' }}>✓ {T(`Duyệt ${waiting.length} bài chờ`, `Review ${waiting.length} waiting`)}</button>
          ) : (
            <span style={{ flex: 1, display: 'flex', alignItems: 'center', fontSize: 13, color: 'var(--c94a3b8)' }}>{T('Không có bài nào chờ duyệt.', 'Nothing waiting for your OK.')}</span>
          )}
          <button onClick={() => { setSendOpen(true); setTimeout(() => sendRef.current?.(), 150); window.scrollTo({ top: 0, behavior: 'smooth' }); }} aria-label={T('Gửi ảnh/clip', 'Send photos/clips')} style={{ width: 48, minHeight: 48, borderRadius: 12, border: 'none', background: '#6366f1', color: '#fff', fontSize: 18, cursor: 'pointer' }}>📷</button>
        </div>
      )}

      {/* one post, beside the calendar (a drawer) or over it (the phone) */}
      {openPost && feed && (
        <>
          {!isMobile && <div onClick={() => setOpenId(null)} style={{ position: 'fixed', inset: 0, zIndex: 199, background: 'rgba(2,6,23,.45)' }} />}
          <PostReviewDetail
            key={openPost.id}
            p={openPost}
            feedMeta={{ pageName: feed.pageName, igUsername: feed.igUsername, salonName: feed.salonName }}
            api={api}
            vi={vi}
            fmtDay={fmtDay}
            fmtTime={fmtTime}
            variant={isMobile ? 'sheet' : 'drawer'}
            onClose={() => setOpenId(null)}
            onChanged={load}
          />
          {!isMobile && nextWaiting(openPost.id) && (
            <button onClick={() => setOpenId(nextWaiting(openPost.id)!.id)} style={{ position: 'fixed', right: 536, bottom: 24, zIndex: 201, ...navBtn, minHeight: 42, background: 'var(--c111827)', boxShadow: '0 10px 30px rgba(0,0,0,.4)' }}>
              {T('Bài chờ tiếp theo ›', 'Next waiting ›')}
            </button>
          )}
        </>
      )}

      {/* a planned day with no post yet: the team's words for it */}
      {openEntry?.entry && !openEntry.post && (
        <>
          <div onClick={() => setOpenDay(null)} style={{ position: 'fixed', inset: 0, zIndex: 199, background: 'rgba(2,6,23,.45)' }} />
          <div role="dialog" style={{ position: 'fixed', zIndex: 200, ...(isMobile ? { left: 0, right: 0, bottom: 0, borderRadius: '16px 16px 0 0' } : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 'min(520px, calc(100vw - 32px))', borderRadius: 16 }), background: 'var(--c0f172a)', border: '1px solid var(--c334155)', padding: 18, display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 30px 80px rgba(0,0,0,.5)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <b style={{ fontSize: 15, color: 'var(--ce2e8f0)' }}>{new Date(`${openEntry.key}T12:00:00`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'numeric' })}</b>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--c64748b)' }}>{T('Dự kiến — Lumio đang làm', 'Planned — Lumio is on it')}</span>
              <button onClick={() => setOpenDay(null)} aria-label={T('Đóng', 'Close')} style={{ ...navBtn, width: 32, minHeight: 32, padding: 0 }}>✕</button>
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ce2e8f0)', lineHeight: 1.4 }}>{openEntry.entry.topic || T('(chưa đặt tên)', '(untitled)')}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--c94a3b8)' }}>
              {openEntry.entry.pillar ? pillarChip(openEntry.entry.pillar) : null}
              {openEntry.entry.format ? <span>· {formatName(openEntry.entry.format)}</span> : null}
              <ChannelDots list={openEntry.entry.air} />
            </div>
            {openEntry.entry.detail && <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--ccbd5e1)', whiteSpace: 'pre-line' }}>{openEntry.entry.detail}</div>}
            <div style={{ fontSize: 12.5, color: 'var(--c64748b)', lineHeight: 1.5 }}>{T('Khi bài được viết xong, ô này chuyển sang màu tím để chị duyệt.', 'When the post is written, this day turns purple for your OK.')}</div>
          </div>
        </>
      )}
    </div>
  );
}

const navBtn: React.CSSProperties = {
  minHeight: 34, padding: '0 12px', borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit',
  border: '1px solid var(--c475569)', background: 'var(--c1e293b)', color: 'var(--ce2e8f0)', fontSize: 13, fontWeight: 600,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
};
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', padding: 0, font: 'inherit', fontSize: 12.5, fontWeight: 600, color: 'var(--ca5b4fc)', cursor: 'pointer' };
const cardStyle: React.CSSProperties = { background: 'var(--c1e293b)', border: '1px solid var(--c334155)', borderRadius: 14, padding: '12px 14px' };
