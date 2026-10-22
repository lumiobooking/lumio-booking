'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import { fresh, useLive } from '../lib/live';
import { useIsMobile } from '../lib/responsive';
import { ind } from '../lib/ui-industry';
import { PostReviewDetail, PostThumb, type ReviewApi, type ReviewFeed, type ReviewPost, type ReviewQueue } from './PostReview';
import { RoundDone, StatusPill, compact, filterOf, pillWord, type Filter, type RoundRow, type Tone } from './ApproveViews';
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

/** A round of approvals: the waiting posts in order, and what she did with each. */
interface Round {
  ids: string[];
  result: Record<string, 'approved' | 'fixed'>;
  /** What she asked to change, in her words (the tapped reason, plus her line). */
  tags: Record<string, string>;
}
const VIEW_KEY = 'lumio_plan_view';

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
function standing(post: ReviewPost | null, vi: boolean, fmtTime: (iso: string) => string): { text: string; color: string; tone: Tone } {
  const T = (v: string, e: string) => ind(vi ? v : e);
  if (!post) return { text: '', color: 'var(--c64748b)', tone: 'plan' };
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
  /** One slice of the old tabs, opened beside the calendar. */
  const [panel, setPanel] = useState<null | 'work' | 'money' | 'holidays'>(null);
  const [holidays, setHolidays] = useState<{ key: string; name: string; daysAway: number }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const sendRef = useRef<(() => void) | null>(null);
  /** How the month is drawn: the calendar, the photo grid (the page as it will look), or a list. */
  const [view, setView] = useState<'cal' | 'grid' | 'list'>('cal');
  const [filter, setFilter] = useState<Filter>('all');
  const [round, setRound] = useState<Round | null>(null);
  const [roundDone, setRoundDone] = useState<Round | null>(null);
  useEffect(() => {
    try { const v = window.localStorage.getItem(VIEW_KEY); if (v === 'cal' || v === 'grid' || v === 'list') setView(v); } catch { /* the default is fine */ }
  }, []);
  const pickView = (v: 'cal' | 'grid' | 'list') => { setView(v); try { window.localStorage.setItem(VIEW_KEY, v); } catch { /* this visit only */ } };
  // The phone has no seven-column month: its "by day" list is the agenda.
  const shownView = isMobile ? (view === 'grid' ? 'grid' : 'list') : view;

  const load = useCallback(async () => {
    if (!token) return;
    const [f, w, s, h] = await Promise.all([
      api.feed().then((r) => { setFeedErr(null); return r; }).catch((e: unknown) => { setFeedErr(e instanceof Error ? e.message : 'error'); return null; }),
      apiFetch<MyWeek>(fresh(`/content/my-week?lang=${vi ? 'vi' : 'en'}`), { token }).catch(() => null),
      apiFetch<SuggFeed>(fresh('/content/suggestions'), { token }).catch(() => null),
      apiFetch<{ ideas: { key: string; name: string; daysAway: number }[] }>(fresh(`/content/my-holidays?lang=${vi ? 'vi' : 'en'}`), { token }).catch(() => null),
    ]);
    if (f) { setFeed(f); onWaiting?.(f.waiting ?? 0); }
    if (w) {
      setWeek(w.week ?? null); setLastWeek(w.lastWeek ?? null);
      // Keep the month the owner turned to; only the first answer picks one.
      setPlan((prev) => (prev && w.planSheet && prev.month !== w.planSheet.month ? prev : (w.planSheet ?? prev)));
    }
    if (s) setSugg(s);
    if (h) setHolidays(h.ideas ?? []);
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

  /**
   * A post still "scheduled" hours after its time is one the queue gave up on
   * (unfinished, or failed every attempt). The API already drops it from the
   * feed; this is the same rule for a browser that got the new page against
   * yesterday's server. The day keeps the plan's words and asks for nothing.
   */
  const livePosts = useMemo(() => {
    const cutoff = Date.now() - 6 * 60 * 60 * 1000;
    return (feed?.posts ?? []).filter((p) => p.clientStatus === 'posted' || new Date(p.scheduledAt).getTime() >= cutoff);
  }, [feed]);

  /** Posts by salon day; a day may carry more than one, the cell shows the first that needs her. */
  const postsByDay = useMemo(() => {
    const m = new Map<string, ReviewPost[]>();
    for (const p of livePosts) {
      const k = dayKeyOf(p.scheduledAt);
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    const rank: Record<ReviewPost['clientStatus'], number> = { wait: 0, held: 1, approved: 2, posted: 3 };
    for (const [k, list] of m) m.set(k, [...list].sort((a, b) => rank[a.clientStatus] - rank[b.clientStatus]));
    return m;
  }, [livePosts, dayKeyOf]);

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

  const waiting = useMemo(() => livePosts.filter((p) => p.clientStatus === 'wait' || (p.clientStatus === 'held' && p.reviewRequestedAt))
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)), [livePosts]);
  const counts = useMemo(() => {
    const inMonth = Object.entries(plan?.entries ?? {}).filter(([k, e]) => k.startsWith(month) && (e.topic || e.pillar));
    const posted = livePosts.filter((p) => p.clientStatus === 'posted' && dayKeyOf(p.scheduledAt).startsWith(month)).length;
    return { planned: inMonth.length, posted };
  }, [plan, livePosts, month, dayKeyOf]);
  const daysInMonth = useMemo(() => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); }, [month]);

  const openPost = livePosts.find((p) => p.id === openId) ?? null;
  const openEntry = openDay ? cellOf(openDay) : null;
  const toFilm = (sugg?.open ?? []).filter((s) => !s.fromShop && s.status === 'sent');
  const shopJobs = (week?.jobs ?? []).filter((j) => j.by === 'shop');
  const ask = week?.ask ?? null;

  // ---- a round: the waiting posts, one after another, then "done" ----
  const nextOpen = (r: Round, fromId: string) => {
    const i = r.ids.indexOf(fromId);
    return [...r.ids.slice(i + 1), ...r.ids.slice(0, Math.max(i, 0))].find((id) => !r.result[id]) ?? null;
  };
  const prevOpen = (r: Round, fromId: string) => {
    const i = r.ids.indexOf(fromId);
    return [...r.ids.slice(0, Math.max(i, 0)).reverse(), ...r.ids.slice(i + 1).reverse()].find((id) => !r.result[id]) ?? null;
  };
  /** Every post that waits on her, soonest first, starting from the one she tapped. */
  const startReview = (firstId?: string) => {
    const ids = waiting.map((p) => p.id);
    if (!ids.length) return;
    setRound({ ids, result: {}, tags: {} });
    setOpenDay(null);
    setOpenId(firstId && ids.includes(firstId) ? firstId : ids[0]);
  };
  /** A waiting post opens as a round; anything else opens on its own. */
  const openOne = (p: ReviewPost) => {
    if (waiting.some((w) => w.id === p.id)) { startReview(p.id); return; }
    setRound(null); setOpenDay(null); setOpenId(p.id);
  };
  const closeDetail = () => { setOpenId(null); setRound(null); };
  const settle = (id: string, res: 'approved' | 'fixed', tag?: string) => {
    if (!round) return;
    const r: Round = { ...round, result: { ...round.result, [id]: res }, tags: tag ? { ...round.tags, [id]: tag } : round.tags };
    const next = nextOpen(r, id);
    if (next) { setRound(r); setOpenId(next); return; }
    setRound(null); setOpenId(null); setRoundDone(r);
  };
  const approveAll = async () => {
    if (!round) return;
    const r: Round = { ...round, result: { ...round.result } };
    for (const id of r.ids) {
      if (r.result[id]) continue;
      try { await api.approve(id); r.result[id] = 'approved'; } catch { /* left open; the summary says so */ }
    }
    setRound(null); setOpenId(null); setRoundDone(r);
    load();
  };
  const openSend = () => { setSendOpen(true); setTimeout(() => sendRef.current?.(), 150); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const shortDay = (iso: string) => new Date(iso).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'numeric', ...(tz ? { timeZone: tz } : {}) });
  const firstLine = (p: ReviewPost) => p.message.split('\n').find((l) => l.trim())?.trim() ?? '';
  /** The plan's topic when the team linked the post to its day, else the post's first line. */
  const titleOf = (p: ReviewPost) => { const e = plan?.entries?.[dayKeyOf(p.scheduledAt)]; return (e && e.postId === p.id && e.topic) || firstLine(p); };
  const roundRows = (r: Round): RoundRow[] => r.ids.map((id) => {
    const p = livePosts.find((x) => x.id === id) ?? feed?.posts.find((x) => x.id === id) ?? null;
    return { id, media: p?.media ?? [], title: p ? titleOf(p) : '', when: p ? `${shortDay(p.scheduledAt)} · ${fmtTime(p.scheduledAt)}` : '', result: r.result[id] ?? null, tag: r.tags[id] };
  });
  const queue: ReviewQueue | undefined = round && openPost && round.ids.includes(openPost.id) ? (() => {
    const r = round;
    const id = openPost.id;
    const next = nextOpen(r, id);
    const prev = prevOpen(r, id);
    return {
      index: r.ids.indexOf(id),
      total: r.ids.length,
      remaining: r.ids.filter((x) => !r.result[x]).length,
      items: roundRows(r).map((row) => ({ id: row.id, media: row.media, when: row.when, title: row.title, result: row.result })),
      onJump: (x: string) => setOpenId(x),
      onSkip: next ? () => setOpenId(next) : null,
      onPrev: prev ? () => setOpenId(prev) : null,
      onApproved: () => settle(id, 'approved'),
      onFixed: (what: string) => settle(id, 'fixed', what),
      onApproveAll: api.needsName ? undefined : approveAll,
    };
  })() : undefined;

  // A push or a link can name one post (?post=…): open it — as a round when
  // it waits on her — so the tap on the phone lands on the post, not the month.
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || !feed) return;
    deepLinked.current = true;
    let id: string | null = null;
    try { id = new URLSearchParams(window.location.search).get('post'); } catch { id = null; }
    if (!id) return;
    const p = livePosts.find((x) => x.id === id);
    if (p) openOne(p);
    try { const u = new URL(window.location.href); u.searchParams.delete('post'); window.history.replaceState(null, '', u.toString()); } catch { /* harmless if it stays */ }
  }, [feed, livePosts]); // eslint-disable-line react-hooks/exhaustive-deps

  const tone = (c: DayCell) => standing(c.post, vi, fmtTime);
  const cellBg = (t: ReturnType<typeof standing>['tone'], outside: boolean) =>
    t === 'wait' ? 'var(--c1e1b4b)' : t === 'fix' ? 'var(--c451a03)' : outside ? 'var(--c0f172a)' : 'var(--c1e293b)';
  const cellRing = (t: ReturnType<typeof standing>['tone'], key: string) =>
    t === 'wait' ? 'inset 0 0 0 2px #7c3aed' : t === 'fix' ? 'inset 0 0 0 2px #f59e0b' : key === today ? 'inset 0 0 0 1.5px #6366f1' : 'none';

  // ---------------------------------------------------------------- pieces
  const pillarChip = (id: string) => {
    const p = pillarOf(id);
    if (!p) return null;
    // A dot and a word. Six bright chips across a month read as noise; a
    // dot still says which pillar at a glance and the legend names them.
    return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--c94a3b8)' }}><i style={{ width: 8, height: 8, borderRadius: 999, background: p.bg, border: `1px solid ${p.ink}`, display: 'inline-block', boxSizing: 'border-box' }} />{vi ? p.vi : p.en}</span>;
  };
  const formatName = (id: string) => { const f = formatOf(id); return f ? (vi ? f.vi : f.en) : ''; };
  const topicOf = (c: DayCell) => c.entry?.topic || (c.post ? (c.post.message.split('\n').find((l) => l.trim()) ?? '') : '');
  const channelsOf = (c: DayCell) => c.post?.channels ?? c.entry?.air ?? [];
  const openCell = (c: DayCell) => { if (c.post) openOne(c.post); else if (c.entry) { setOpenDay(c.key); } };
  const cellWord = (t: Tone) => {
    switch (t) {
      case 'wait': return `● ${T('Chờ duyệt', 'To approve')}`;
      case 'fix': return `🔄 ${T('Đã sửa', 'Revised')}`;
      case 'plan': return T('Đang làm', 'In progress');
      default: return pillWord(t, vi);
    }
  };
  const viewsOf = (p: ReviewPost | null) => (typeof p?.stats?.views === 'number' ? `👁 ${compact(p.stats.views)}` : '');
  const cellFoot = (c: DayCell, t: Tone) => (t === 'sched' && c.post ? `⏰ ${T('Đăng lúc', 'Goes out at')} ${fmtTime(c.post.scheduledAt)}`
    : t === 'held' ? T('Lumio đang sửa theo góp ý', 'Lumio is fixing it')
      : t === 'done' && viewsOf(c.post) ? `${viewsOf(c.post)} ${T('lượt xem', 'views')}` : '');
  const gridWord = (t: Tone, key: string, p: ReviewPost | null) => {
    const d = Number(key.slice(8, 10));
    switch (t) {
      case 'wait': return `${T('Duyệt', 'Approve')} · ${d}`;
      case 'fix': return `${T('Đã sửa', 'Revised')} · ${d}`;
      case 'held': return `${T('Đang sửa', 'Fixing')} · ${d}`;
      case 'sched': return `${p ? fmtTime(p.scheduledAt) : ''} · ${d}`;
      case 'done': return `✓ ${d}`;
      default: return `${d} · ${T('Đang làm', 'In progress')}`;
    }
  };

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
      <button onClick={() => { setSendOpen((v) => !v); setTimeout(() => sendRef.current?.(), 150); }} style={{ ...navBtn, minHeight: 40, background: '#6366f1', borderColor: '#6366f1', color: '#fff', fontWeight: 700 }}>
        📷 {T('Gửi ảnh/clip', 'Send photos/clips')}
      </button>
    </div>
  );

  const legend = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 12, color: 'var(--c94a3b8)', flexWrap: 'wrap' }}>
      {([
        ['wait', T('cần chị bấm', 'needs your tap')],
        ['sched', T('tự đăng đúng giờ', 'posts itself on time')],
        ['done', T('đã lên trang', 'live on your page')],
        ['held', T('Lumio sửa theo góp ý', 'Lumio is fixing it')],
        ['plan', T('chưa cần chị', 'nothing for you yet')],
      ] as [Tone, string][]).map(([t, words]) => (
        <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><StatusPill tone={t} vi={vi} />{words}</span>
      ))}
      {!isMobile && (
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
          {pillars.filter((p) => !p.hidden).map((p) => <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--c94a3b8)', marginRight: 6 }}><i style={{ width: 9, height: 9, borderRadius: 999, background: p.bg, border: `1px solid ${p.ink}`, display: 'inline-block', boxSizing: 'border-box' }} />{vi ? p.vi : p.en}</span>)}
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
              minHeight: 136, padding: '8px 10px 10px', boxSizing: 'border-box',
              display: 'flex', flexDirection: 'column', gap: 5, cursor: has ? 'pointer' : 'default',
              // Yesterday and before, and the other months' days, step back; the
              // weeks ahead are what she is here to read.
              opacity: filter !== 'all' && !(has && filterOf(st.tone) === filter) ? 0.28 : outside && !has ? 0.5 : key < today && st.tone !== 'wait' && st.tone !== 'fix' ? 0.72 : 1,
            }}
          >
            {/* ONE voice per cell: the day and where it stands on one line,
                the picture as it will go out, the title as the only strong
                text, then the one thing to do — or when it goes by itself. */}
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, minHeight: 22, fontSize: 12.5, fontWeight: 600, color: outside ? 'var(--c64748b)' : key === today ? 'var(--ce2e8f0)' : 'var(--c94a3b8)' }}>
              {key === today
                ? <span style={{ width: 22, height: 22, borderRadius: 999, background: '#6366f1', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>{dayN}</span>
                : dayN}
              {has && <span style={{ minWidth: 0, overflow: 'hidden', display: 'inline-flex' }}><StatusPill tone={st.tone} vi={vi} text={cellWord(st.tone)} /></span>}
            </span>
            {has && (
              <>
                {c.post && c.post.media.length > 0 && <PostThumb media={c.post.media} h={84} radius={9} badge vi={vi} />}
                {st.tone === 'plan' && <span style={planBox}>{T('Lumio đang chuẩn bị — chưa cần chị làm gì', 'Lumio is preparing it — nothing for you yet')}</span>}
                <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.35, color: st.tone === 'done' ? 'var(--c94a3b8)' : 'var(--ce2e8f0)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: c.post?.media.length ? 2 : 3, WebkitBoxOrient: 'vertical' }}>
                  {topicOf(c) || T('(bài chỉ có ảnh)', '(media only)')}
                </span>
                {(c.entry?.pillar || c.entry?.format) && !c.post?.media.length && (
                  <span style={{ fontSize: 11.5, color: 'var(--c94a3b8)', display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', lineHeight: 1.3 }}>
                    {c.entry?.pillar ? pillarChip(c.entry.pillar) : null}
                    {c.entry?.format ? <span>{c.entry.pillar ? '· ' : ''}{formatName(c.entry.format)}</span> : null}
                  </span>
                )}
                {st.tone === 'wait' || st.tone === 'fix' ? (
                  <span style={reviewCta}>{st.tone === 'fix' ? T('Xem lại & duyệt', 'Look again & approve') : T('Xem & duyệt', 'Review & approve')}</span>
                ) : (
                  <span style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 6, minHeight: 16 }}>
                    {cellFoot(c, st.tone) && <span style={{ fontSize: 11.5, fontWeight: 700, color: st.tone === 'sched' ? 'var(--ink-sky)' : st.tone === 'held' ? 'var(--ink-warn)' : 'var(--c94a3b8)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{cellFoot(c, st.tone)}</span>}
                    <span style={{ marginLeft: 'auto' }}><ChannelDots list={channelsOf(c)} size={14} /></span>
                  </span>
                )}
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
    const upcoming = gridDays.filter((d) => !d.outside && d.key >= addDays(today, -1)).map((d) => cellOf(d.key)).filter((c) => c.entry || c.post)
      .filter((c) => filter === 'all' || filterOf(tone(c).tone) === filter);
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
                <span style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.35, color: st.tone === 'done' ? 'var(--c94a3b8)' : 'var(--ce2e8f0)' }}>{topicOf(c) || T('(bài chỉ có ảnh)', '(media only)')}</span>
                <span style={{ fontSize: 12, color: 'var(--c94a3b8)', display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                  {c.entry?.pillar ? pillarChip(c.entry.pillar) : null}
                  {c.entry?.format ? <span>· {formatName(c.entry.format)}</span> : null}
                  <ChannelDots list={channelsOf(c)} size={14} />
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
                  <StatusPill tone={st.tone} vi={vi} />
                  {st.tone === 'sched' && c.post ? <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-sky)' }}>⏰ {fmtTime(c.post.scheduledAt)}</span> : null}
                </span>
              </div>
              {c.post && c.post.media.length > 0 && <PostThumb media={c.post.media} w={64} h={64} radius={10} vi={vi} />}
            </div>
          );
        })}
      </>
    );
  })();

  /** The month as its feed: every post's picture, what is ahead first (soonest on top), then what went out. */
  const monthItems = (() => {
    const posts = livePosts.filter((p) => dayKeyOf(p.scheduledAt).startsWith(month));
    const ahead = posts.filter((p) => p.clientStatus !== 'posted').map((p) => ({ key: dayKeyOf(p.scheduledAt), post: p as ReviewPost | null, at: p.scheduledAt }));
    const planned = gridDays.filter((d) => !d.outside && d.key >= today).map((d) => cellOf(d.key)).filter((c) => c.entry && !c.post)
      .map((c) => ({ key: c.key, post: null as ReviewPost | null, at: `${c.key}T23:59:00` }));
    const out = posts.filter((p) => p.clientStatus === 'posted').map((p) => ({ key: dayKeyOf(p.scheduledAt), post: p as ReviewPost | null, at: p.scheduledAt }))
      .sort((a, b) => b.at.localeCompare(a.at));
    return [...[...ahead, ...planned].sort((a, b) => a.at.localeCompare(b.at)), ...out]
      .filter((it) => filter === 'all' || filterOf(standing(it.post, vi, fmtTime).tone) === filter);
  })();
  const itemTitle = (key: string, post: ReviewPost | null) => (post ? titleOf(post) : (cellOf(key).entry?.topic ?? ''));
  const itemEntry = (key: string, post: ReviewPost | null) => { const c = cellOf(key); return !post || c.post?.id === post.id ? c.entry : null; };
  const plannedDay = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'numeric' });
  const nothingHere = <div style={{ gridColumn: '1 / -1', padding: '28px 14px', textAlign: 'center', color: 'var(--c64748b)', fontSize: 13.5 }}>{T('Không có bài nào ở mục này trong tháng.', 'Nothing in this group this month.')}</div>;

  /** The photo grid: what the page will look like, the waiting posts ringed in purple. */
  const photoGrid = (
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(3, minmax(0, 1fr))' : 'repeat(auto-fill, minmax(176px, 1fr))', gap: isMobile ? 3 : 14 }}>
      {monthItems.length === 0 && nothingHere}
      {monthItems.map((it) => {
        const st = standing(it.post, vi, fmtTime);
        const ask = st.tone === 'wait' || st.tone === 'fix';
        const title = itemTitle(it.key, it.post);
        const r = isMobile ? 2 : 12;
        const go = () => (it.post ? openOne(it.post) : setOpenDay(it.key));
        return (
          <div key={it.post?.id ?? `d-${it.key}`} role="button" tabIndex={0} onClick={go} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }}
            style={{ display: 'flex', flexDirection: 'column', gap: 6, cursor: 'pointer', minWidth: 0, opacity: st.tone === 'done' && !isMobile ? 0.85 : 1 }}>
            <span style={{ position: 'relative', display: 'block', aspectRatio: '1 / 1', borderRadius: r, overflow: 'hidden' }}>
              {it.post
                ? <span style={{ position: 'absolute', inset: 0 }}><PostThumb media={it.post.media} radius={0} badge={!isMobile} vi={vi} /></span>
                : <span style={{ position: 'absolute', inset: 0, border: '1.5px dashed var(--c475569)', borderRadius: r, display: 'grid', placeItems: 'center', textAlign: 'center', padding: '24px 8px 8px', fontSize: 11.5, lineHeight: 1.35, color: 'var(--c94a3b8)', boxSizing: 'border-box', overflow: 'hidden' }}>{title || T('Lumio đang làm', 'Lumio is on it')}</span>}
              {ask && <span style={{ position: 'absolute', inset: 0, border: '3px solid #7c3aed', borderRadius: r, pointerEvents: 'none' }} />}
              <span style={{ position: 'absolute', left: 5, top: 5, maxWidth: 'calc(100% - 10px)' }}><StatusPill tone={st.tone} vi={vi} text={gridWord(st.tone, it.key, it.post)} /></span>
              {viewsOf(it.post) && <span style={viewsTag}>{viewsOf(it.post)}</span>}
            </span>
            {!isMobile && (
              <>
                <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.35, color: st.tone === 'done' ? 'var(--c94a3b8)' : 'var(--ce2e8f0)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{title || T('(bài chỉ có ảnh)', '(media only)')}</span>
                <span style={{ fontSize: 12, color: 'var(--c94a3b8)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {it.post ? `${shortDay(it.post.scheduledAt)} · ${fmtTime(it.post.scheduledAt)}` : plannedDay(it.key)}
                  <span style={{ marginLeft: 'auto' }}><ChannelDots list={it.post?.channels ?? itemEntry(it.key, null)?.air ?? []} size={14} /></span>
                </span>
                {ask && <span style={{ ...reviewCta, marginTop: 0 }}>{st.tone === 'fix' ? T('Xem lại & duyệt', 'Look again & approve') : T('Xem & duyệt', 'Review & approve')}</span>}
              </>
            )}
          </div>
        );
      })}
    </div>
  );

  /** The list: one row per post, for a laptop that wants to read rather than look. */
  const listView = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {monthItems.length === 0 && nothingHere}
      {monthItems.map((it) => {
        const st = standing(it.post, vi, fmtTime);
        const ask = st.tone === 'wait' || st.tone === 'fix';
        const e = itemEntry(it.key, it.post);
        const go = () => (it.post ? openOne(it.post) : setOpenDay(it.key));
        return (
          <div key={it.post?.id ?? `d-${it.key}`} role="button" tabIndex={0} onClick={go} onKeyDown={(ev) => { if (ev.key === 'Enter') go(); }} style={ask ? listRowAsk : listRow}>
            <div style={{ width: 52, display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: 11, color: 'var(--c64748b)', fontWeight: 600 }}>{new Date(`${it.key}T12:00:00`).toLocaleDateString(locale, { weekday: 'short' })}</span>
              <span style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.1, color: it.key === today ? 'var(--ca5b4fc)' : 'var(--ce2e8f0)' }}>{Number(it.key.slice(8, 10))}</span>
            </div>
            {it.post
              ? <PostThumb media={it.post.media} w={64} h={64} radius={10} vi={vi} />
              : <span style={{ width: 64, height: 64, borderRadius: 10, border: '1.5px dashed var(--c475569)', boxSizing: 'border-box', flexShrink: 0 }} />}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: st.tone === 'done' ? 'var(--c94a3b8)' : 'var(--ce2e8f0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{itemTitle(it.key, it.post) || T('(bài chỉ có ảnh)', '(media only)')}</span>
              <span style={{ fontSize: 12, color: 'var(--c94a3b8)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {it.post ? fmtTime(it.post.scheduledAt) : T('Dự kiến', 'Planned')}
                {viewsOf(it.post) ? <span>· {viewsOf(it.post)} {T('lượt xem', 'views')}</span> : null}
                {e?.pillar ? <>· {pillarChip(e.pillar)}</> : null}
                {e?.format ? <span>· {formatName(e.format)}</span> : null}
                <ChannelDots list={it.post?.channels ?? e?.air ?? []} size={14} />
              </span>
            </div>
            <StatusPill tone={st.tone} vi={vi} />
            {ask && <span style={{ ...reviewCta, marginTop: 0, minHeight: 40, padding: '0 16px', flexShrink: 0 }}>{st.tone === 'fix' ? T('Xem lại & duyệt', 'Look again & approve') : T('Xem & duyệt', 'Review & approve')}</span>}
          </div>
        );
      })}
    </div>
  );

  /** How many of the month's posts sit in each group, for the chips. */
  const groupCounts = (() => {
    const n: Record<'wait' | 'sched' | 'done' | 'fix', number> = { wait: 0, sched: 0, done: 0, fix: 0 };
    for (const p of livePosts) {
      if (!dayKeyOf(p.scheduledAt).startsWith(month)) continue;
      const f = filterOf(standing(p, vi, fmtTime).tone);
      if (f === 'wait' || f === 'sched' || f === 'done' || f === 'fix') n[f] += 1;
    }
    return n;
  })();
  const VIEWS: ['cal' | 'grid' | 'list', string][] = isMobile
    ? [['grid', T('Lưới ảnh', 'Photo grid')], ['list', T('Theo ngày', 'By day')]]
    : [['cal', T('Lịch', 'Calendar')], ['grid', T('Lưới ảnh', 'Photo grid')], ['list', T('Danh sách', 'List')]];
  const viewToggle = (
    <div role="tablist" aria-label={T('Cách xem', 'View')} style={{ display: 'inline-flex', gap: 2, padding: 3, borderRadius: 11, background: 'var(--c1e293b)', border: '1px solid var(--c334155)', flexShrink: 0 }}>
      {VIEWS.map(([id, label]) => (
        <button key={id} role="tab" aria-selected={shownView === id} onClick={() => pickView(id)} style={shownView === id ? segOn : segOff}>{label}</button>
      ))}
    </div>
  );
  const toolbar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: isMobile ? 'nowrap' : 'wrap', overflowX: isMobile ? 'auto' : 'visible', paddingBottom: isMobile ? 2 : 0 }}>
      {([
        ['all', T('Tất cả', 'All'), null],
        ['wait', T('Chờ chị duyệt', 'Needs your OK'), groupCounts.wait],
        ['sched', T('Sắp đăng', 'Coming up'), groupCounts.sched],
        ['done', T('Đã đăng', 'Posted'), groupCounts.done],
        ['fix', T('Đang sửa', 'Being fixed'), groupCounts.fix],
      ] as [Filter, string, number | null][]).map(([id, label, n]) => (
        <button key={id} onClick={() => setFilter(id)} aria-pressed={filter === id} style={filter === id ? chipOn : id === 'wait' && n ? chipWait : chipOff}>
          {label}{n !== null ? ` · ${n}` : ''}
        </button>
      ))}
      {!isMobile && <span style={{ flex: 1 }} />}
      {!isMobile && viewToggle}
    </div>
  );

  /** Lumio's side of the month, in three numbers the owner can check. */
  const lumioNow = useMemo(() => {
    const posts = livePosts.filter((p) => dayKeyOf(p.scheduledAt).startsWith(month));
    return {
      queued: posts.filter((p) => p.clientStatus === 'approved').length,
      written: posts.filter((p) => p.clientStatus === 'wait' || p.clientStatus === 'held').length,
      posted: posts.filter((p) => p.clientStatus === 'posted').length,
    };
  }, [livePosts, month, dayKeyOf]);

  const shopTodo = [
    ...toFilm.map((t) => ({ icon: '🎬', text: t.title, send: true })),
    ...(ask ? [{ icon: '📷', text: ask.what, send: true }] : []),
    ...shopJobs.filter((j) => !ask?.jobIds?.includes(j.id ?? '')).map((j) => ({ icon: '▢', text: j.text, send: false })),
  ];
  const deltaText = (d: number | null) => (d === null || d === 0 ? '' : d > 0 ? `▲ ${d}` : `▼ ${Math.abs(d)}`);
  const cardHead = (icon: string, title: string, action: string, onClick: () => void) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 16 }}>{icon}</span>
      <b style={{ fontSize: 13.5, color: 'var(--ce2e8f0)' }}>{title}</b>
      <button onClick={onClick} style={{ ...linkBtn, marginLeft: 'auto' }}>{action}</button>
    </div>
  );

  /** The top of the screen answers "what do I have to do?" before the month says anything else. */
  const band = (
    <div style={{ display: 'grid', gridTemplateColumns: isMobile || !shopTodo.length ? '1fr' : 'minmax(0, 1.7fr) minmax(0, 1fr)', gap: 12 }}>
      {waiting.length > 0 ? (
        <div style={{ background: '#4f46e5', color: '#fff', borderRadius: 18, padding: isMobile ? 14 : '16px 20px', display: 'flex', gap: 14, alignItems: 'center', flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
          <span style={{ display: 'flex', flexShrink: 0 }}>
            {waiting.slice(0, 3).map((p, i) => (
              <span key={p.id} style={{ marginLeft: i ? -18 : 0, border: '3px solid #4f46e5', borderRadius: 12, display: 'block' }}>
                <PostThumb media={p.media} w={isMobile ? 46 : 56} h={isMobile ? 58 : 70} radius={9} vi={vi} />
              </span>
            ))}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: 0.6, color: 'rgba(255,255,255,.75)' }}>{T('VIỆC CỦA CHỊ', 'YOUR TURN')}</div>
            <div style={{ fontSize: isMobile ? 18 : 21, fontWeight: 800, lineHeight: 1.25 }}>{waiting.length} {T('bài chờ chị duyệt', waiting.length === 1 ? 'post to approve' : 'posts to approve')}</div>
            <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.85)', marginTop: 2 }}>
              {T('Bài gần nhất đăng', 'The next one goes out')} {fmtDay(waiting[0].scheduledAt)} {T('lúc', 'at')} {fmtTime(waiting[0].scheduledAt)} · {T(`mất khoảng ${Math.max(1, Math.ceil(waiting.length / 3))} phút`, `about ${Math.max(1, Math.ceil(waiting.length / 3))} min`)}
            </div>
          </div>
          <button onClick={() => startReview()} style={{ ...startBtn, width: isMobile ? '100%' : undefined }}>{T('Bắt đầu duyệt →', 'Start reviewing →')}</button>
        </div>
      ) : (
        <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px' }}>
          <span style={{ width: 40, height: 40, borderRadius: 999, background: 'var(--c14532d)', color: 'var(--c86efac)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800, flexShrink: 0 }}>✓</span>
          <span style={{ fontSize: 13.5, lineHeight: 1.45 }}>
            <b style={{ display: 'block', color: 'var(--ce2e8f0)' }}>{T('Không có bài nào chờ chị duyệt', 'Nothing waiting for your OK')}</b>
            <span style={{ color: 'var(--c94a3b8)' }}>{T('Lumio sẽ báo chị khi có bài mới.', 'Lumio will let you know when there is a new post.')}</span>
          </span>
        </div>
      )}
      {shopTodo.length > 0 && (
        <div style={{ ...cardStyle, borderColor: '#f59e0b', display: 'flex', flexDirection: 'column', gap: 6, padding: '14px 16px' }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: 0.6, color: 'var(--ink-warn)' }}>{T('CẦN TIỆM QUAY', 'FOR YOU TO SHOOT')} · {shopTodo.length}</div>
          <div style={{ fontSize: 14.5, fontWeight: 700, lineHeight: 1.4, color: 'var(--ce2e8f0)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{shopTodo[0].icon} {shopTodo[0].text}</div>
          {shopTodo.length > 1 && <span style={{ fontSize: 12, color: 'var(--c64748b)' }}>+{shopTodo.length - 1} {T('việc nữa', 'more')}</span>}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 'auto', flexWrap: 'wrap' }}>
            <button onClick={openSend} style={{ ...navBtn, minHeight: 40, background: '#c2410c', borderColor: '#c2410c', color: '#fff' }}>📷 {T('Gửi ảnh/clip', 'Send photos/clips')}</button>
            <button onClick={() => setPanel('work')} style={linkBtn}>{T('Chi tiết ›', 'Details ›')}</button>
          </div>
        </div>
      )}
    </div>
  );

  const below = (
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
      {/* 2. what the shop got */}
      <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {cardHead('📈', T('Tuần trước tiệm nhận được', 'Last week you got'), T('Quảng cáo & ngân sách ›', 'Ads & budget ›'), () => setPanel('money'))}
        {lastWeek ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }}>
            {([
              [lastWeek.posted, T('bài đã đăng', 'posts published'), null],
              [lastWeek.reviews, T('đánh giá mới', 'new reviews'), lastWeek.delta.reviews],
              [lastWeek.newCustomers, T('khách mới', 'new customers'), lastWeek.delta.newCustomers],
              [lastWeek.bookings, T('lượt đặt lịch', 'bookings'), lastWeek.delta.bookings],
            ] as [number, string, number | null][]).map(([n, label, d]) => (
              <span key={label} style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <b style={{ fontSize: 22, color: 'var(--ce2e8f0)', letterSpacing: -0.4, lineHeight: 1.1 }}>{n}</b>
                  {deltaText(d) && <span style={{ fontSize: 11.5, fontWeight: 700, color: (d ?? 0) > 0 ? 'var(--ink-good)' : 'var(--ink-bad)' }}>{deltaText(d)}</span>}
                </span>
                <span style={{ fontSize: 11.5, color: 'var(--c64748b)' }}>{label}</span>
              </span>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--c94a3b8)', lineHeight: 1.55 }}>{T('Số liệu tuần trước sẽ hiện ở đây khi có bài đăng đầu tiên.', 'Last week’s numbers show here after the first posts go out.')}</div>
        )}
        {lastWeek && <span style={{ fontSize: 11.5, color: 'var(--c64748b)' }}>{lastWeek.label}</span>}
      </div>

      {/* 3. what Lumio is doing */}
      <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {cardHead('✨', T('Lumio đang làm', 'Lumio is on it'), holidays.length ? `🎉 ${T('Ngày lễ', 'Holidays')} (${holidays.length}) ›` : T('Chi tiết ›', 'Details ›'), () => setPanel(holidays.length ? 'holidays' : 'work'))}
        {([
          [`${counts.planned}/${daysInMonth}`, T('ngày đã lên kế hoạch tháng này', 'days planned this month')],
          [lumioNow.written, T('bài đã viết, chờ chị duyệt', 'posts written, waiting for your OK')],
          [lumioNow.queued, T('bài đã duyệt, sẽ tự đăng', 'approved, will post by themselves')],
          [lumioNow.posted, T('bài đã đăng tháng này', 'posted this month')],
        ] as [number | string, string][]).map(([n, label]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 13, color: 'var(--c94a3b8)' }}>
            <b style={{ fontSize: 15, color: 'var(--ce2e8f0)', minWidth: 42, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{n}</b>
            <span>{label}</span>
          </div>
        ))}
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
      {loaded && band}
      {loaded && isMobile && <div style={{ display: 'flex', justifyContent: 'center' }}>{viewToggle}</div>}
      {loaded && toolbar}
      {loaded && (shownView === 'cal' ? grid : shownView === 'grid' ? photoGrid : isMobile ? agenda : listView)}
      {loaded && legend}
      {loaded && below}

      {/* One slice of the old tabs at a time, beside the calendar: the
          details of the shop's jobs, or the money, or the holidays — never
          all three stacked under the month again. */}
      {panel && (
        <>
          <div onClick={() => setPanel(null)} style={{ position: 'fixed', inset: 0, zIndex: 199, background: 'rgba(2,6,23,.45)' }} />
          <div role="dialog" style={{
            position: 'fixed', top: 0, right: 0, bottom: 0, width: isMobile ? '100vw' : 'min(680px, 100vw)', zIndex: 200,
            background: 'var(--c0f172a)', borderLeft: '1px solid var(--c334155)', boxShadow: '-24px 0 60px rgba(0,0,0,.45)',
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--c334155)', flexShrink: 0 }}>
              <b style={{ fontSize: 15, color: 'var(--ce2e8f0)' }}>
                {panel === 'work' ? `📷 ${T('Việc của tiệm & Lumio đang làm', 'Your part & what Lumio is doing')}`
                  : panel === 'money' ? `📈 ${T('Kết quả, quảng cáo & ngân sách', 'Results, ads & budget')}`
                    : `🎉 ${T('Ngày lễ sắp tới & chương trình gợi ý', 'Holidays ahead & suggested programmes')}`}
              </b>
              <button onClick={() => setPanel(null)} style={{ ...navBtn, marginLeft: 'auto' }}>✕ {T('Đóng', 'Close')}</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
              <SalonWorkspace token={token} vi={vi} hidePlan hideSend only={panel} onSend={() => { setPanel(null); setSendOpen(true); setTimeout(() => sendRef.current?.(), 150); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
            </div>
          </div>
        </>
      )}

      {/* the phone's thumb bar */}
      {isMobile && loaded && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50, padding: '10px 14px calc(12px + env(safe-area-inset-bottom, 0px))', background: 'var(--c111827)', borderTop: '1px solid var(--c334155)', display: 'flex', gap: 8 }}>
          {waiting.length > 0 ? (
            <button onClick={() => startReview()} style={{ flex: 1, minHeight: 48, borderRadius: 12, border: 'none', background: '#22c55e', color: '#052e16', fontSize: 14.5, fontWeight: 700, cursor: 'pointer' }}>✓ {T(`Duyệt ${waiting.length} bài chờ`, `Review ${waiting.length} waiting`)}</button>
          ) : (
            <span style={{ flex: 1, display: 'flex', alignItems: 'center', fontSize: 13, color: 'var(--c94a3b8)' }}>{T('Không có bài nào chờ duyệt.', 'Nothing waiting for your OK.')}</span>
          )}
          <button onClick={() => { setSendOpen(true); setTimeout(() => sendRef.current?.(), 150); window.scrollTo({ top: 0, behavior: 'smooth' }); }} aria-label={T('Gửi ảnh/clip', 'Send photos/clips')} style={{ width: 48, minHeight: 48, borderRadius: 12, border: 'none', background: '#6366f1', color: '#fff', fontSize: 18, cursor: 'pointer' }}>📷</button>
        </div>
      )}

      {/* one post, beside the calendar (a drawer) or over it (the phone) */}
      {openPost && feed && (
        <>
          {!isMobile && <div onClick={closeDetail} style={{ position: 'fixed', inset: 0, zIndex: 199, background: 'rgba(2,6,23,.45)' }} />}
          <PostReviewDetail
            key={openPost.id}
            p={openPost}
            feedMeta={{ pageName: feed.pageName, igUsername: feed.igUsername, salonName: feed.salonName }}
            api={api}
            vi={vi}
            fmtDay={fmtDay}
            fmtTime={fmtTime}
            variant={isMobile ? 'sheet' : 'drawer'}
            queue={queue}
            onClose={closeDetail}
            onChanged={load}
          />
        </>
      )}

      {/* the end of a round: what she approved, what she sent back, what is left */}
      {roundDone && (
        <RoundDone vi={vi} mobile={isMobile} rows={roundRows(roundDone)} todo={shopTodo[0]?.text ?? null}
          onSend={() => { setRoundDone(null); openSend(); }} onClose={() => setRoundDone(null)} />
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

/* Each state of a control is its own literal object, white label on the same
   line as the accent it sits on, so the theme lint can see the pair. */
const CHIP: React.CSSProperties = { minHeight: 38, padding: '0 14px', borderRadius: 999, fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 };
const chipOff: React.CSSProperties = { ...CHIP, border: '1px solid var(--c475569)', background: 'var(--c1e293b)', color: 'var(--ce2e8f0)' };
const chipWait: React.CSSProperties = { ...CHIP, border: '1px solid #7c3aed', background: 'var(--c1e1b4b)', color: 'var(--ca5b4fc)' };
const chipOn: React.CSSProperties = { ...CHIP, border: '1px solid #4f46e5', background: '#4f46e5', color: '#fff' };
const SEG: React.CSSProperties = { minHeight: 34, padding: '0 12px', borderRadius: 9, border: 'none', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' };
const segOff: React.CSSProperties = { ...SEG, background: 'transparent', color: 'var(--ce2e8f0)' };
const segOn: React.CSSProperties = { ...SEG, background: '#4f46e5', color: '#fff' };
const reviewCta: React.CSSProperties = { marginTop: 'auto', minHeight: 34, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12.5, fontWeight: 800, padding: '0 10px', whiteSpace: 'nowrap', background: '#7c3aed', color: '#fff' };
const startBtn: React.CSSProperties = { flexShrink: 0, minHeight: 48, padding: '0 20px', borderRadius: 14, border: 'none', background: '#fff', color: '#3730a3', fontFamily: 'inherit', fontSize: 15, fontWeight: 800, cursor: 'pointer' };
const listRow: React.CSSProperties = { display: 'flex', gap: 14, alignItems: 'center', padding: 10, borderRadius: 14, cursor: 'pointer', background: 'var(--c1e293b)', border: '1px solid var(--c334155)' };
const listRowAsk: React.CSSProperties = { ...listRow, background: 'var(--c1e1b4b)', border: '2px solid #7c3aed' };
const planBox: React.CSSProperties = { minHeight: 52, border: '1.5px dashed var(--c475569)', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '6px 8px', fontSize: 11.5, lineHeight: 1.35, color: 'var(--c94a3b8)', boxSizing: 'border-box' };
const viewsTag: React.CSSProperties = { position: 'absolute', right: 5, bottom: 5, fontSize: 11, fontWeight: 800, padding: '2px 7px', borderRadius: 6, background: 'rgba(2,6,23,.72)', color: '#fff' };
