'use client';

/**
 * The client's approval screen — one component behind two doors.
 *
 * The logged-in page (/salon/approve-posts) and the group-chat link
 * (/review/[token]) render exactly this, fed by different fetchers. Keeping
 * one component is what guarantees the owner sees the same thing on both
 * paths, and that neither path ever grows an agency-only control by accident:
 * nothing in this file knows the AI, the drafts, or the team tools exist.
 *
 * PHONE-FIRST, BY DECISION
 *
 * The people approving these posts run nail salons from their phones between
 * customers. So: an agenda list instead of a month grid (a grid at 390px is
 * unreadable), a full-screen detail sheet instead of a modal, the approve
 * button pinned to the bottom of the screen where a thumb already rests, and
 * every tap target at least 44px. Desktop gets the same layout centered in a
 * readable column — a bigger phone, not a different app.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linkified } from './Linkified';
import { ind } from '../lib/ui-industry';

export interface ReviewPost {
  id: string;
  channels: string[];
  message: string;
  media: { url: string; kind: 'image' | 'video' }[];
  scheduledAt: string;
  postedAt: string | null;
  clientStatus: 'held' | 'wait' | 'approved' | 'posted';
  /** Set when the team changed the post after a note and wants a fresh yes. */
  reviewRequestedAt?: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  links: { channel: string; url: string | null }[];
}
export interface ReviewFeed {
  salonName: string;
  timezone: string;
  pageName: string;
  igUsername: string | null;
  posts: ReviewPost[];
  waiting: number;
}
export interface ReviewMsg { id: string; side: string; authorName: string; body: string; createdAt: string }

export interface ReviewApi {
  feed(): Promise<ReviewFeed>;
  approve(postId: string, name?: string): Promise<unknown>;
  comments(postId: string): Promise<{ messages: ReviewMsg[] }>;
  comment(postId: string, body: string, name?: string): Promise<unknown>;
  /** The public door has no account, so it asks who is approving — once. */
  needsName: boolean;
}

const NAME_KEY = 'lumio_review_name';

const STATUS: Record<ReviewPost['clientStatus'], { dot: string; vi: string; en: string; bg: string; bd: string; fg: string }> = {
  wait: { dot: '🟡', vi: 'Chờ duyệt', en: 'Awaiting review', bg: '#33210b', bd: '#92400e', fg: '#fde68a' },
  approved: { dot: '🟢', vi: 'Đã duyệt', en: 'Approved', bg: '#0d2a1a', bd: '#166534', fg: '#86efac' },
  posted: { dot: '🔵', vi: 'Đã đăng', en: 'Posted', bg: '#0b2534', bd: '#155e75', fg: '#7dd3fc' },
  held: { dot: '⏸', vi: 'Đang sửa theo góp ý', en: 'Being revised', bg: '#341505', bd: '#9a3412', fg: '#fdba74' },
};

export function PostReview({ api, vi, onCount }: {
  api: ReviewApi;
  vi: boolean;
  /**
   * How many posts are waiting on the owner, reported up as soon as it is
   * known. The tab bar above needs the number and this component is the only
   * thing that fetches it — the alternative is a second request for a figure
   * already on the page.
   */
  onCount?: (waiting: number) => void;
}) {
  const T = (v: string, e: string) => ind(vi ? v : e);
  const [feed, setFeed] = useState<ReviewFeed | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const f = await api.feed();
      setFeed(f);
      onCount?.(f?.waiting ?? 0);
      setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : 'error'); }
  }, [api, onCount]);
  useEffect(() => { load(); }, [load]);

  const tz = feed?.timezone;
  const locale = vi ? 'vi-VN' : 'en-US';
  const fmtDay = (iso: string) => new Date(iso).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'numeric', ...(tz ? { timeZone: tz } : {}) });
  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) });
  const dayKeyOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', tz ? { timeZone: tz } : {});

  // Upcoming first (soonest at the top — that is what needs the owner), then
  // what already went out, newest first, folded behind a toggle.
  const upcoming = useMemo(() => (feed?.posts ?? []).filter((p) => p.clientStatus !== 'posted'), [feed]);
  const posted = useMemo(() => (feed?.posts ?? []).filter((p) => p.clientStatus === 'posted').reverse(), [feed]);
  const [showPosted, setShowPosted] = useState(false);

  const groups = useMemo(() => {
    const m = new Map<string, ReviewPost[]>();
    for (const p of upcoming) {
      const k = dayKeyOf(p.scheduledAt);
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return [...m.entries()];
  }, [upcoming, tz]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = feed?.posts.find((p) => p.id === openId) ?? null;

  if (err) {
    return (
      <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--c94a3b8)' }}>
        <div style={{ fontSize: 34, marginBottom: 10 }}>🔒</div>
        <div style={{ fontSize: 15, lineHeight: 1.6, maxWidth: 420, margin: '0 auto' }}>{err}</div>
      </div>
    );
  }
  if (!feed) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--c64748b)' }}>{T('Đang tải…', 'Loading…')}</div>;

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '0 0 40px' }}>
      {/* header: the one number that matters, first */}
      <div style={{ padding: '4px 2px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 19, margin: 0 }}>📋 {T('Bài sắp đăng', 'Upcoming posts')}</h1>
          {feed.waiting > 0 && (
            <span style={{ background: '#451a03', border: '1px solid #92400e', color: '#fcd34d', fontSize: 12.5, fontWeight: 600, padding: '3px 10px', borderRadius: 20 }}>
              {T(`${feed.waiting} bài chờ bạn duyệt`, `${feed.waiting} awaiting your review`)}
            </span>
          )}
        </div>
        <p style={{ fontSize: 13, color: 'var(--c94a3b8)', margin: '6px 0 0', lineHeight: 1.55 }}>
          {T('Bấm vào bài để xem trước đúng như khi lên Facebook / Instagram. Bài không có ý kiến sẽ tự đăng đúng giờ hẹn.',
             'Tap a post to preview it exactly as it will appear. Posts with no feedback publish on schedule automatically.')}
        </p>
      </div>

      {/* agenda */}
      {groups.length === 0 && (
        <div style={{ padding: '36px 16px', textAlign: 'center', color: 'var(--c64748b)', background: 'var(--c151f38)', border: '1px solid var(--c334155)', borderRadius: 12 }}>
          {T('Chưa có bài nào chờ đăng — team sẽ báo khi có bài mới.', 'Nothing scheduled yet — the team will let you know.')}
        </div>
      )}
      {groups.map(([day, posts]) => (
        <div key={day} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: day === dayKeyOf(new Date().toISOString()) ? 'var(--ink-warn)' : 'var(--c64748b)', padding: '0 2px 7px' }}>
            {day === dayKeyOf(new Date().toISOString()) ? T('Hôm nay', 'Today') + ' · ' : ''}{fmtDay(posts[0].scheduledAt)}
          </div>
          {posts.map((p) => <Row key={p.id} p={p} onOpen={() => setOpenId(p.id)} fmtTime={fmtTime} T={T} />)}
        </div>
      ))}

      {/* history, folded */}
      {posted.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <button onClick={() => setShowPosted((s) => !s)} style={{ font: 'inherit', fontSize: 13.5, fontWeight: 600, color: 'var(--c94a3b8)', background: 'none', border: 'none', cursor: 'pointer', padding: '10px 2px', minHeight: 44 }}>
            {showPosted ? '▾' : '▸'} {T(`Đã đăng gần đây (${posted.length})`, `Recently posted (${posted.length})`)}
          </button>
          {showPosted && posted.map((p) => <Row key={p.id} p={p} onOpen={() => setOpenId(p.id)} fmtTime={(iso) => `${fmtDay(iso)} · ${fmtTime(iso)}`} T={T} />)}
        </div>
      )}

      {open && (
        <Detail
          key={open.id}
          p={open}
          feedMeta={{ pageName: feed.pageName, igUsername: feed.igUsername, salonName: feed.salonName }}
          api={api}
          vi={vi}
          fmtDay={fmtDay}
          fmtTime={fmtTime}
          onClose={() => setOpenId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * One clip to approve.
 *
 * The file comes straight off the media host, and a 30-second clip is tens of
 * megabytes: on a slow line the player showed a bare spinner for a minute and
 * the shop concluded the post was broken. So: fetch only the header until
 * someone presses play, SAY that it is loading and how long it has been, and
 * always offer the file itself in a new tab — the browser's own player and
 * the phone's video app both cope better with a big file than an inline one.
 * ------------------------------------------------------------------------- */
function ReviewVideo({ url, square, T }: { url: string; square: boolean; T: (v: string, e: string) => string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (state !== 'loading') return undefined;
    const id = window.setInterval(() => setSecs((x) => x + 1), 1000);
    return () => window.clearInterval(id);
  }, [state]);
  return (
    <div style={{ position: 'relative' }}>
      <video
        src={url}
        controls
        muted
        playsInline
        preload="metadata"
        onPlay={() => setState((s) => (s === 'ready' ? s : 'loading'))}
        onWaiting={() => setState('loading')}
        onCanPlay={() => { setState('ready'); setSecs(0); }}
        onPlaying={() => { setState('ready'); setSecs(0); }}
        onError={() => setState('error')}
        style={{ width: '100%', display: 'block', maxHeight: 460, objectFit: 'contain', aspectRatio: square ? '1/1' : undefined, background: '#000' }}
      />
      {(state === 'loading' || state === 'error') && (
        <div style={{ position: 'absolute', left: 8, right: 8, top: 8, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
          <span style={{ background: 'rgba(0,0,0,.72)', color: '#fff', fontSize: 12.5, padding: '6px 11px', borderRadius: 999, lineHeight: 1.35, textAlign: 'center' }}>
            {state === 'error'
              ? T('Trình duyệt không phát được video này — bấm "Mở video" bên dưới.', 'This browser could not play the clip — use "Open video" below.')
              : T(`Đang tải video… ${secs}s — video dài có thể mất một lúc`, `Loading video… ${secs}s — long clips can take a while`)}
          </span>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '6px 8px', background: '#000' }}>
        <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: '#fff', fontSize: 12.5, fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 2 }}>
          ↗ {T('Mở video', 'Open video')}
        </a>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * All of a post's pictures, one at a time, with a way to reach each.
 * ------------------------------------------------------------------------- */
function MediaGallery({ media, square, T }: {
  media: { url: string; kind: 'image' | 'video' }[];
  square: boolean;
  T: (v: string, e: string) => string;
}) {
  const [i, setI] = useState(0);
  const n = media.length;
  const cur = media[Math.min(i, n - 1)];
  const touch = useRef<number | null>(null);
  const go = (d: number) => setI((x) => (x + d + n) % n);
  // A different post arrives in the same modal: start from its cover again.
  useEffect(() => { setI(0); }, [media]);
  if (!cur) return null;
  return (
    <div>
      <div
        style={{ position: 'relative', background: '#000', userSelect: 'none' }}
        onTouchStart={(e) => { touch.current = e.touches[0]?.clientX ?? null; }}
        onTouchEnd={(e) => {
          const x0 = touch.current; touch.current = null;
          const x1 = e.changedTouches[0]?.clientX;
          if (x0 == null || x1 == null || n < 2) return;
          if (x1 - x0 > 40) go(-1); else if (x0 - x1 > 40) go(1);
        }}
      >
        {cur.kind === 'video'
          ? <ReviewVideo key={cur.url} url={cur.url} square={square} T={T} />
          // eslint-disable-next-line @next/next/no-img-element
          : <img key={cur.url} src={cur.url} alt="" style={{ width: '100%', display: 'block', objectFit: square ? 'cover' : 'contain', aspectRatio: square ? '1/1' : undefined, maxHeight: 460, background: '#000' }} />}
        {n > 1 && (
          <>
            <span style={{ position: 'absolute', top: 8, right: 10, background: 'rgba(0,0,0,.65)', color: '#fff', fontSize: 12, fontWeight: 600, padding: '2px 9px', borderRadius: 12 }}>
              {i + 1}/{n} ▤
            </span>
            <button aria-label={T('Ảnh trước', 'Previous')} onClick={() => go(-1)} style={{ position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, borderRadius: 20, border: 'none', background: 'rgba(255,255,255,.88)', color: '#111', fontSize: 22, fontWeight: 700, cursor: 'pointer', display: 'grid', placeItems: 'center' }}>‹</button>
            <button aria-label={T('Ảnh sau', 'Next')} onClick={() => go(1)} style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, borderRadius: 20, border: 'none', background: 'rgba(255,255,255,.88)', color: '#111', fontSize: 22, fontWeight: 700, cursor: 'pointer', display: 'grid', placeItems: 'center' }}>›</button>
          </>
        )}
      </div>
      {n > 1 && (
        <div style={{ display: 'flex', gap: 6, padding: '8px 10px', overflowX: 'auto', background: '#f0f2f5', borderBottom: '1px solid #e4e6eb' }}>
          {media.map((m, k) => (
            <button key={m.url + k} onClick={() => setI(k)} aria-label={`${k + 1}/${n}`} style={{ flexShrink: 0, width: 56, height: 56, borderRadius: 8, overflow: 'hidden', padding: 0, cursor: 'pointer', border: `2px solid ${k === i ? '#6366f1' : 'transparent'}`, background: '#000', opacity: k === i ? 1 : 0.75 }}>
              {m.kind === 'video'
                ? <span style={{ display: 'grid', placeItems: 'center', width: '100%', height: '100%', color: '#fff', fontSize: 20 }}>▶</span>
                // eslint-disable-next-line @next/next/no-img-element
                : <img src={m.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
            </button>
          ))}
          <span style={{ alignSelf: 'center', fontSize: 12, color: '#65676b', whiteSpace: 'nowrap', paddingLeft: 4 }}>{T('Bấm từng ảnh để xem', 'Tap each to view')}</span>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * One row of the agenda. The whole row is the tap target.
 * ------------------------------------------------------------------------- */
function Row({ p, onOpen, fmtTime, T }: { p: ReviewPost; onOpen: () => void; fmtTime: (iso: string) => string; T: (v: string, e: string) => string }) {
  const st = STATUS[p.clientStatus];
  const first = p.media[0];
  return (
    <button onClick={onOpen} style={{
      display: 'flex', gap: 11, alignItems: 'center', width: '100%', textAlign: 'left', font: 'inherit',
      background: 'var(--c151f38)', border: '1px solid var(--c334155)', borderRadius: 12,
      padding: 11, marginBottom: 8, cursor: 'pointer', color: 'var(--ce2e8f0)', minHeight: 66,
    }}>
      <div style={{ width: 52, height: 52, borderRadius: 9, overflow: 'hidden', flexShrink: 0, background: 'var(--c1e293b)', display: 'grid', placeItems: 'center' }}>
        {first
          // eslint-disable-next-line @next/next/no-img-element
          ? (first.kind === 'video'
            // A clip in a LIST is a play tile, not a <video>: every row that
            // mounted a player opened its own download of the whole file,
            // and on the media host those downloads queued up behind each
            // other — the open post's player then sat spinning.
            ? <span aria-label={T('Video', 'Video')} style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: '#0b1120', color: '#fff', fontSize: 20 }}>▶</span>
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={first.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />)
          : <span style={{ fontSize: 20 }}>📝</span>}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginBottom: 3, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, fontWeight: 700 }}>{fmtTime(p.scheduledAt)}</span>
          <span style={{ fontSize: 11, fontWeight: 600, background: st.bg, border: `1px solid ${st.bd}`, color: st.fg, padding: '1px 8px', borderRadius: 20, whiteSpace: 'nowrap' }}>
            {st.dot} {T(st.vi, st.en)}
          </span>
        </div>
        <div style={{ fontSize: 13.5, color: 'var(--ccbd5e1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {p.message.split('\n')[0] || T('(bài chỉ có ảnh)', '(media only)')}
        </div>
      </div>
      <span style={{ color: 'var(--c64748b)', flexShrink: 0 }}>›</span>
    </button>
  );
}

/* ---------------------------------------------------------------------------
 * A post's picture, small: the calendar cell, the photo grid, the queue strip,
 * the round summary. A clip is a play tile, never a <video> (see Row).
 * ------------------------------------------------------------------------- */
export function PostThumb({ media, w = '100%', h = '100%', radius = 10, badge = false, vi }: {
  media: ReviewPost['media'];
  w?: number | string;
  h?: number | string;
  radius?: number;
  /** "Album 4" / "▶ Video" in the corner, for the bigger tiles. */
  badge?: boolean;
  vi: boolean;
}) {
  const T = (v: string, e: string) => ind(vi ? v : e);
  const first = media[0];
  const label = !first ? null
    : media.length > 1 ? `${first.kind === 'video' ? '▶ ' : ''}${T('Album', 'Album')} ${media.length}`
      : first.kind === 'video' ? `▶ ${T('Video', 'Video')}` : null;
  return (
    <span style={{ position: 'relative', display: 'block', width: w, height: h, borderRadius: radius, overflow: 'hidden', flexShrink: 0, background: 'var(--c334155)' }}>
      {first
        ? (first.kind === 'video'
          ? <span aria-label={T('Video', 'Video')} style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: '#0b1120', color: '#fff', fontSize: 20 }}>▶</span>
          // eslint-disable-next-line @next/next/no-img-element
          : <img src={first.url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />)
        : <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 18 }}>📝</span>}
      {badge && label && <span style={{ position: 'absolute', left: 6, bottom: 6, fontSize: 10.5, fontWeight: 800, padding: '2px 7px', borderRadius: 6, background: 'rgba(2,6,23,.72)', color: '#fff' }}>{label}</span>}
    </span>
  );
}

/**
 * The four things owners actually ask for, as buttons. Typing "đổi ảnh khác"
 * on a phone between two customers is the reason most notes never got sent —
 * and the reason the ones that did were one word long. A tap says what kind
 * of change; the box under it is for the details, and it is optional.
 */
const FIXES = [
  { id: 'photo', icon: '🖼', vi: 'Đổi ảnh khác', en: 'Use another photo' },
  { id: 'text', icon: '✏️', vi: 'Sửa chữ / giá', en: 'Fix the words / price' },
  { id: 'time', icon: '🕒', vi: 'Đổi ngày giờ đăng', en: 'Change the date / time' },
  { id: 'skip', icon: '🚫', vi: 'Không đăng bài này', en: 'Don’t post this' },
] as const;

/**
 * A ROUND: the calendar screen hands the sheet the waiting posts as a queue,
 * so she goes through them one by one — "post 1 of 3", approve, the next one
 * opens by itself — instead of closing, finding the next purple day, opening.
 */
export interface ReviewQueue {
  /** This post's place in the round, from 0. */
  index: number;
  total: number;
  /** Still waiting in the round, this one included. */
  remaining: number;
  items: { id: string; media: ReviewPost['media']; when: string; title: string; result: 'approved' | 'fixed' | null }[];
  onJump: (id: string) => void;
  /** The next one still waiting; null when nothing else is. */
  onSkip: (() => void) | null;
  onPrev: (() => void) | null;
  onApproved: () => void;
  onFixed: (what: string) => void;
  /** Absent on the public link (it has to ask who is approving, per post). */
  onApproveAll?: () => Promise<void>;
}

/* ---------------------------------------------------------------------------
 * The detail sheet: full-screen on the phone, the approve bar under the thumb.
 * ------------------------------------------------------------------------- */
/** The same sheet, for the calendar screen (ClientPlan) to open on its own feed. */
export const PostReviewDetail = Detail;
function Detail(props: {
  p: ReviewPost;
  feedMeta: { pageName: string; igUsername: string | null; salonName: string };
  api: ReviewApi;
  vi: boolean;
  fmtDay: (iso: string) => string;
  fmtTime: (iso: string) => string;
  onClose: () => void;
  onChanged: () => void;
  /**
   * 'sheet' (default): the whole screen, the phone's way. 'drawer': a panel
   * on the right over the calendar, so a laptop keeps the month in view while
   * one post is read and approved (ClientPlan). In a round (queue set) the
   * drawer widens into two columns: the post on the left, the decision on the
   * right, the queue under both.
   */
  variant?: 'sheet' | 'drawer';
  queue?: ReviewQueue;
}) {
  const { p, feedMeta, api, vi, fmtDay, fmtTime, onClose, onChanged, queue } = props;
  const drawer = props.variant === 'drawer';
  const phone = !drawer;
  const wide = drawer && Boolean(queue);
  const T = (v: string, e: string) => ind(vi ? v : e);
  const hasIg = p.channels.includes('instagram');
  const hasFb = p.channels.includes('facebook');
  const [mode, setMode] = useState<'facebook' | 'instagram'>(hasFb ? 'facebook' : 'instagram');
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [justApproved, setJustApproved] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<ReviewMsg[]>([]);
  const [draft, setDraft] = useState('');
  const [fix, setFix] = useState<string | null>(null);
  /** The phone's "Cần sửa" sheet. */
  const [fixOpen, setFixOpen] = useState(false);
  /** "Approve all" asks twice: the first tap arms it, the second does it. */
  const [allArmed, setAllArmed] = useState(false);
  const [allBusy, setAllBusy] = useState(false);
  const [askName, setAskName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const pendingAction = useRef<null | ((name: string) => void)>(null);
  const approveRef = useRef<null | (() => void)>(null);

  useEffect(() => {
    api.comments(p.id).then((r) => setMsgs(r.messages ?? [])).catch(() => {});
  }, [api, p.id]);

  // Body scroll lock while the sheet is up — the page under it must not drift.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // A round on a keyboard: A approves, the arrows walk the queue, Esc goes
  // back to the month. Never while she is typing a note.
  useEffect(() => {
    if (!queue) return undefined;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'a' || e.key === 'A') { if (approveRef.current) { e.preventDefault(); approveRef.current(); } }
      else if (e.key === 'ArrowRight' && queue.onSkip) { e.preventDefault(); queue.onSkip(); }
      else if (e.key === 'ArrowLeft' && queue.onPrev) { e.preventDefault(); queue.onPrev(); }
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [queue, onClose]);

  const storedName = () => { try { return window.localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } };
  const withName = (fn: (name: string) => void) => {
    if (!api.needsName) { fn(''); return; }
    const n = storedName();
    if (n) { fn(n); return; }
    pendingAction.current = fn;
    setAskName(true);
  };
  const submitName = () => {
    const n = nameDraft.trim();
    if (!n) return;
    try { window.localStorage.setItem(NAME_KEY, n); } catch { /* still usable this session */ }
    setAskName(false);
    pendingAction.current?.(n);
    pendingAction.current = null;
  };

  const doApprove = () => withName(async (name) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.approve(p.id, name || undefined);
      onChanged();
      // In a round the next post opens by itself; the progress bar is the receipt.
      if (queue) { queue.onApproved(); return; }
      setJustApproved(name || T('Bạn', 'You'));
    } catch { /* the feed reload will show the truth */ }
    finally { setBusy(false); }
  });

  /** A tapped reason and/or a typed note: one message to the team, and the post is held. */
  const sendFix = () => withName(async (name) => {
    const chip = FIXES.find((f) => f.id === fix) ?? null;
    const note = draft.trim();
    if ((!chip && !note) || busy) return;
    const what = chip ? T(chip.vi, chip.en) : note;
    const body = chip ? `${chip.icon} ${what}${note ? `: ${note}` : ''}` : note;
    setBusy(true);
    try {
      await api.comment(p.id, body, name || undefined);
      setDraft(''); setFix(null); setFixOpen(false);
      onChanged(); // the hold pill just appeared on the day behind us
      if (queue && p.clientStatus !== 'posted') { queue.onFixed(note && chip ? `${what} — ${note}` : what); return; }
      setMsgs((await api.comments(p.id)).messages ?? []);
    } catch { /* keep the draft so nothing typed is lost */ }
    finally { setBusy(false); }
  });

  const approveAll = async () => {
    if (!queue?.onApproveAll || allBusy) return;
    if (!allArmed) { setAllArmed(true); return; }
    setAllBusy(true);
    try { await queue.onApproveAll(); } finally { setAllBusy(false); setAllArmed(false); }
  };

  const st = STATUS[p.clientStatus];
  const fold = mode === 'facebook' ? 250 : 125;
  const showApprove = (p.clientStatus === 'wait' || p.clientStatus === 'held') && !justApproved;
  const canFix = p.clientStatus !== 'posted';
  approveRef.current = showApprove && !busy ? doApprove : null;
  const lines = p.message.split('\n');

  // ---- the post, as it will look over there ----
  const preview = (
    <div>
      {/* channel toggle — only when the post goes to both */}
      {hasFb && hasIg && (
        <div style={{ display: 'flex', background: 'var(--c151f38)', border: '1px solid var(--c334155)', borderRadius: 10, padding: 3, marginBottom: 12 }}>
          {(['facebook', 'instagram'] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} style={{
              flex: 1, font: 'inherit', fontSize: 13.5, fontWeight: 600, minHeight: 40, border: 'none', borderRadius: 8, cursor: 'pointer',
              background: mode === m ? 'var(--c6366f1, #6366f1)' : 'transparent',
              color: mode === m ? '#fff' : 'var(--c94a3b8)',
            }}>
              {m === 'facebook' ? T('Trên Facebook', 'On Facebook') : T('Trên Instagram', 'On Instagram')}
            </button>
          ))}
        </div>
      )}

      {/* the preview — white on purpose: this IS how it looks over there */}
      <div style={{ background: '#f0f2f5', borderRadius: 14, padding: 12 }}>
        <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 2px rgba(0,0,0,.2)', color: '#050505', fontFamily: 'Helvetica, Arial, sans-serif', overflow: 'hidden' }}>
          <div style={{ display: 'flex', gap: 9, alignItems: 'center', padding: mode === 'facebook' ? '12px 13px 0' : '10px 13px' }}>
            <div style={{
              width: mode === 'facebook' ? 40 : 32, height: mode === 'facebook' ? 40 : 32, borderRadius: '50%', flexShrink: 0,
              background: 'linear-gradient(135deg,#6366f1,#a855f7)', color: '#fff', display: 'grid', placeItems: 'center',
              fontWeight: 700, fontSize: mode === 'facebook' ? 17 : 14,
              outline: mode === 'instagram' ? '2px solid #e1306c' : 'none', outlineOffset: 2,
            }}>
              {(feedMeta.pageName || 'L').slice(0, 1).toUpperCase()}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {mode === 'facebook' ? feedMeta.pageName : (feedMeta.igUsername || feedMeta.pageName)}
              </div>
              {mode === 'facebook' && (
                <div style={{ fontSize: 12, color: '#65676b' }}>{fmtDay(p.scheduledAt)} {T('lúc', 'at')} {fmtTime(p.scheduledAt)} · 🌐</div>
              )}
            </div>
          </div>

          {mode === 'facebook' && p.message && (
            <div style={{ padding: '8px 13px 10px', fontSize: 14.5, lineHeight: 1.45, whiteSpace: 'pre-line', wordBreak: 'break-word' }}>
              {expanded || p.message.length <= fold ? p.message : <>{p.message.slice(0, fold).trimEnd()}… <span onClick={() => setExpanded(true)} style={{ color: '#65676b', fontWeight: 600, cursor: 'pointer' }}>{T('Xem thêm', 'See more')}</span></>}
            </div>
          )}

          {/* ---- every picture, not the first one ----
               A carousel post was shown as its cover only, with a "1/10"
               badge the owner could not do anything with — so nine of the
               ten pictures were approved unseen. Arrows, a swipe, and a
               strip of thumbnails; the counter now says which one is up. */}
          {p.media.length > 0 && (
            <MediaGallery media={mode === 'instagram' ? [...p.media].sort((a, b) => (a.kind === 'image' ? 0 : 1) - (b.kind === 'image' ? 0 : 1)) : p.media} square={mode === 'instagram'} T={T} />
          )}

          {mode === 'facebook' ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 13px', color: '#65676b', fontSize: 13.5, borderTop: '1px solid #e4e6eb' }}>
              <span>👍 {T('Thích', 'Like')}</span><span>💬 {T('Bình luận', 'Comment')}</span><span>↗ {T('Chia sẻ', 'Share')}</span>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 14, padding: '10px 13px 2px', fontSize: 20 }}><span>♡</span><span>💬</span><span>➤</span></div>
              {p.message && (
                <div style={{ padding: '4px 13px 12px', fontSize: 13.5, lineHeight: 1.45, wordBreak: 'break-word' }}>
                  <b>{feedMeta.igUsername || feedMeta.pageName}</b>{' '}
                  {expanded || lines[0].length <= fold ? <span style={{ whiteSpace: 'pre-line' }}>{p.message}</span> : <>{lines[0].slice(0, fold).trimEnd()}… <span onClick={() => setExpanded(true)} style={{ color: '#65676b', fontWeight: 600, cursor: 'pointer' }}>{T('thêm', 'more')}</span></>}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--c64748b)', textAlign: 'center', marginTop: 8 }}>{T('Đây đúng là bài khách của tiệm sẽ thấy.', 'This is exactly what your customers will see.')}</div>

      {/* posted: the real links */}
      {p.clientStatus === 'posted' && (
        <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {p.links.filter((l) => l.url).map((l) => (
            <a key={l.channel} href={l.url!} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--c60a5fa, #60a5fa)', textDecoration: 'none', padding: '10px 4px', minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>
              🔗 {T('Xem bài trên', 'View on')} {l.channel === 'facebook' ? 'Facebook' : 'Instagram'}
            </a>
          ))}
        </div>
      )}
    </div>
  );

  // ---- "not quite": four buttons and an optional line ----
  const fixCard = (inSheet: boolean) => (
    <div style={inSheet
      ? { display: 'flex', flexDirection: 'column', gap: 12 }
      : { marginTop: 14, background: 'var(--c1e293b)', border: '1px solid var(--c334155)', borderRadius: 16, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {!inSheet && (
        <div style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--ce2e8f0)' }}>
          {canFix ? T('Chưa ưng? Bấm một ô, Lumio sửa giúp', 'Not quite? Tap one, Lumio fixes it') : `💬 ${T('Nhắn Lumio', 'Message Lumio')}`}
        </div>
      )}
      {canFix && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
          {FIXES.map((f) => {
            const on = fix === f.id;
            return (
              <button key={f.id} onClick={() => setFix(on ? null : f.id)} aria-pressed={on} style={on ? fixOn : f.id === 'skip' ? fixStop : fixOff}>
                {on ? '✓ ' : `${f.icon} `}{T(f.vi, f.en)}
              </button>
            );
          })}
        </div>
      )}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, fontWeight: 700, color: 'var(--c94a3b8)' }}>
        {canFix ? (fix ? T('Nói thêm cho Lumio (không bắt buộc)', 'Anything to add? (optional)') : T('Hoặc nhắn Lumio', 'Or write to Lumio')) : T('Góp ý cho bài đã đăng', 'A note about this post')}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') sendFix(); }}
          placeholder={fix === 'text' ? T('Ví dụ: ghi giá 45$ thay vì 15%', 'e.g. say $45 instead of 15%') : fix === 'photo' ? T('Ví dụ: dùng ảnh bộ móng cam tuần trước', 'e.g. the orange set from last week') : fix === 'time' ? T('Ví dụ: đăng thứ Bảy 10 giờ sáng', 'e.g. Saturday 10am') : T('Viết góp ý…', 'Write a note…')}
          style={{ font: 'inherit', fontSize: 16, fontWeight: 500, background: 'var(--c0f172a)', border: '1px solid var(--c334155)', borderRadius: 12, padding: '12px 13px', color: 'var(--ce2e8f0)', minWidth: 0, minHeight: 48, boxSizing: 'border-box' }}
        />
      </label>
      <button onClick={sendFix} disabled={busy || (!fix && !draft.trim())} style={{ ...(busy || (!fix && !draft.trim()) ? sendIdle : sendReady), minHeight: inSheet ? 54 : 46 }}>
        {queue && canFix ? T('Gửi góp ý · xem bài sau', 'Send · next post') : T('Gửi góp ý', 'Send note')}
      </button>
      {canFix && (
        <div style={{ fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.5 }}>
          ⏸ {T('Gửi góp ý thì bài tạm dừng, không bị đăng. Lumio sửa xong sẽ gửi lại để chị xem.', 'Sending a note holds the post — it will not go out. Lumio sends it back once fixed.')}
        </div>
      )}
    </div>
  );

  const thread = msgs.length > 0 && (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--c94a3b8)', marginBottom: 10 }}>
        💬 {T('Trao đổi với Lumio', 'Notes with Lumio')}
      </div>
      {msgs.map((m) => (
        <div key={m.id} style={{ display: 'flex', gap: 9, marginBottom: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, color: '#fff', background: m.side === 'lumio' ? '#6366f1' : '#d97706' }}>
            {(m.authorName || '?').slice(0, 1).toUpperCase()}
          </div>
          <div style={{ background: m.side === 'lumio' ? 'var(--c1e1b4b)' : 'var(--c1e293b)', border: `1px solid ${m.side === 'lumio' ? '#312e81' : 'var(--c334155)'}`, borderRadius: 10, padding: '8px 12px', fontSize: 13.5, lineHeight: 1.5, minWidth: 0, wordBreak: 'break-word' }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--c94a3b8)', marginBottom: 2 }}>{m.authorName}</div>
            <div style={{ whiteSpace: 'pre-line', wordBreak: 'break-word' }}><Linkified text={m.body} /></div>
          </div>
        </div>
      ))}
    </div>
  );

  const notices = (
    <>
      {/* the team fixed it after a note: say so, above the approve button */}
      {p.clientStatus === 'wait' && p.reviewRequestedAt && !justApproved && (
        <div style={{ marginTop: 12, fontSize: 13, lineHeight: 1.55, color: '#c4b5fd', background: '#2e1065', border: '1px solid #6d28d9', borderRadius: 10, padding: '10px 13px' }}>
          🔄 {T('Lumio đã sửa bài theo góp ý của chị — mời xem lại và bấm duyệt để bài được đăng.', 'The team updated this post after your note — please look again and approve so it can go out.')}
        </div>
      )}
      {/* held: say why the clock stopped */}
      {p.clientStatus === 'held' && (
        <div style={{ marginTop: 12, fontSize: 13, lineHeight: 1.55, color: '#fdba74', background: '#341505', border: '1px solid #9a3412', borderRadius: 10, padding: '10px 13px' }}>
          ⏸ {T('Bài tạm giữ, sẽ không tự đăng. Lumio sẽ sửa rồi gửi lại cho chị duyệt — chị sẽ nhận thông báo.', 'On hold — it will not auto-publish. The team will fix it and send it back for your approval; you will be notified.')}
        </div>
      )}
    </>
  );

  /** The decision, as a column: when it goes out, the big yes, then "not quite". Laptop rounds only. */
  const decision = (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: 'var(--c1e293b)', border: '1px solid var(--c334155)', borderRadius: 16, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: 0.6, color: 'var(--c94a3b8)' }}>{p.clientStatus === 'posted' ? T('BÀI NÀY ĐÃ ĐĂNG', 'THIS POST WENT OUT') : T('BÀI NÀY SẼ ĐĂNG', 'THIS POST GOES OUT')}</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ce2e8f0)', lineHeight: 1.25 }}>{fmtDay(p.scheduledAt)} · {fmtTime(p.scheduledAt)}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {p.channels.filter((c) => c === 'facebook' || c === 'instagram').map((c) => (
            <span key={c} style={{ padding: '5px 10px', borderRadius: 999, background: 'var(--c334155)', color: 'var(--ce2e8f0)', fontWeight: 700, fontSize: 12.5 }}>{c === 'facebook' ? 'Facebook' : 'Instagram'}</span>
          ))}
        </div>
      </div>
      {notices}
      {showApprove ? (
        <>
          <button onClick={doApprove} disabled={busy} style={{ ...approveBig, marginTop: 14, opacity: busy ? 0.6 : 1 }}>✓ {T('Duyệt bài này', 'Approve this post')}</button>
          <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', textAlign: 'center', marginTop: 8 }}>{T('Lumio tự đăng đúng giờ. Chị không cần làm gì thêm.', 'Lumio posts it on time. Nothing else to do.')}</div>
        </>
      ) : p.clientStatus !== 'posted' && (
        <div style={{ marginTop: 14, textAlign: 'center', fontSize: 14, fontWeight: 700, color: 'var(--ink-good)', padding: '12px 0' }}>
          ✓ {T('Đã duyệt', 'Approved')}{(justApproved || p.approvedByName) ? ` — ${justApproved || p.approvedByName}` : ''} · {T('bài sẽ đăng đúng lịch', 'publishing on schedule')}
        </div>
      )}
      {fixCard(false)}
      {thread}
      {queue && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 14 }}>
          <span>{T('Phím tắt', 'Shortcuts')}: <b>A</b> {T('duyệt', 'approve')} · <b>→</b> {T('bài sau', 'next')} · <b>←</b> {T('bài trước', 'back')}</span>
          {queue.onSkip && <button onClick={queue.onSkip} style={linkish}>{T('Bỏ qua, xem bài sau →', 'Skip, next post →')}</button>}
        </div>
      )}
    </div>
  );

  const progress = queue && (
    <div style={{ display: 'flex', gap: 3, marginTop: 6 }}>
      {queue.items.map((it, i) => (
        <span key={it.id} style={{ flex: 1, height: 5, borderRadius: 3, background: it.result === 'approved' ? '#22c55e' : it.result === 'fixed' ? '#f59e0b' : i === queue.index ? '#7c3aed' : 'var(--c334155)' }} />
      ))}
    </div>
  );

  return (
    <div style={drawer
      ? { position: 'fixed', top: 0, right: 0, bottom: 0, width: wide ? 'min(1080px, 100vw)' : 'min(520px, 100vw)', zIndex: 200, background: 'var(--c0f172a)', display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--c334155)', boxShadow: '-24px 0 60px rgba(0,0,0,.45)' }
      : { position: 'fixed', inset: 0, zIndex: 200, background: 'var(--c0f172a)', display: 'flex', flexDirection: 'column', paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      {/* top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <button onClick={onClose} aria-label={queue ? T('Về lịch tháng', 'Back to the month') : undefined} style={{ font: 'inherit', fontSize: 15, fontWeight: 600, color: 'var(--ce2e8f0)', background: queue ? 'var(--c1e293b)' : 'none', border: queue ? '1px solid var(--c334155)' : 'none', borderRadius: 12, cursor: 'pointer', padding: queue ? '0 14px' : '8px 10px 8px 4px', minHeight: 44, flexShrink: 0 }}>
          {queue ? (phone ? '←' : `← ${T('Về lịch tháng', 'Back to the month')}`) : drawer ? `✕ ${T('Đóng', 'Close')}` : `‹ ${T('Quay lại', 'Back')}`}
        </button>
        {queue ? (
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--ce2e8f0)' }}>
              {T(`Bài ${queue.index + 1} / ${queue.total} chờ chị duyệt`, `Post ${queue.index + 1} of ${queue.total} to review`)}
            </div>
            {phone && <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{T('Đăng', 'Goes out')} {fmtDay(p.scheduledAt)} · {fmtTime(p.scheduledAt)}</div>}
            {progress}
          </div>
        ) : (
          <span style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 600, background: st.bg, border: `1px solid ${st.bd}`, color: st.fg, padding: '3px 10px', borderRadius: 20 }}>
            {st.dot} {T(st.vi, st.en)}
          </span>
        )}
        {queue?.onApproveAll && queue.remaining > 1 && !phone && (
          <button onClick={approveAll} disabled={allBusy} style={allArmed ? allArmedBtn : linkish}>
            {allBusy ? T('Đang duyệt…', 'Approving…') : allArmed ? T(`Bấm lần nữa để duyệt ${queue.remaining} bài`, `Tap again to approve ${queue.remaining}`) : T(`Duyệt cả ${queue.remaining} bài một lần`, `Approve all ${queue.remaining}`)}
          </button>
        )}
      </div>

      {/* scrolling body */}
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' as never, padding: wide ? '18px 22px 24px' : '14px 12px 24px' }}>
        {wide ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1fr)', gap: 22, alignItems: 'start', maxWidth: 1020, margin: '0 auto' }}>
              {preview}
              {decision}
            </div>
            {queue && queue.items.length > 1 && (
              <div style={{ maxWidth: 1020, margin: '18px auto 0', background: 'var(--c1e293b)', border: '1px solid var(--c334155)', borderRadius: 16, padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center', overflowX: 'auto' }}>
                <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: 0.6, color: 'var(--c94a3b8)', flexShrink: 0 }}>{T('HÀNG CHỜ', 'QUEUE')}</span>
                {queue.items.map((it) => {
                  const on = it.id === p.id;
                  return (
                    <button key={it.id} onClick={() => queue.onJump(it.id)} style={on ? queueOn : queueOff}>
                      <PostThumb media={it.media} w={40} h={40} radius={8} vi={vi} />
                      <span style={{ fontSize: 12, lineHeight: 1.3, maxWidth: 150, minWidth: 0 }}>
                        <b style={{ display: 'block' }}>{it.when}</b>
                        <span style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--c94a3b8)' }}>{it.title || T('(bài chỉ có ảnh)', '(media only)')}</span>
                      </span>
                      {it.result && <span style={{ fontSize: 13, fontWeight: 800, color: it.result === 'approved' ? 'var(--ink-good)' : 'var(--ink-warn)' }}>{it.result === 'approved' ? '✓' : '✎'}</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <div style={{ maxWidth: 560, margin: '0 auto' }}>
            {preview}
            {notices}
            {thread}
            {/* the phone keeps "not quite" in its own sheet while there is something to approve */}
            {(!phone || !showApprove) && fixCard(false)}
          </div>
        )}
      </div>

      {/* bottom bar — the thumb zone */}
      {!wide && (showApprove || justApproved || p.clientStatus === 'approved') && (
        <div style={{ flexShrink: 0, borderTop: '1px solid var(--line)', background: 'var(--c0f172a)', padding: '10px 14px calc(10px + env(safe-area-inset-bottom, 0px))' }}>
          <div style={{ maxWidth: 560, margin: '0 auto' }}>
            {showApprove ? (
              <>
                <div style={{ fontSize: 12, color: 'var(--cfcd34d)', marginBottom: 8, lineHeight: 1.5 }}>
                  ⏰ {T(`Bài sẽ tự đăng ${fmtDay(p.scheduledAt)} lúc ${fmtTime(p.scheduledAt)} nếu bạn không có ý kiến.`,
                        `Publishes automatically ${fmtDay(p.scheduledAt)} at ${fmtTime(p.scheduledAt)} unless you say otherwise.`)}
                </div>
                {phone ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setFixOpen(true)} style={needsFixBtn}>{T('Cần sửa', 'Needs a fix')}</button>
                    <button onClick={doApprove} disabled={busy} style={{ ...approvePhone, opacity: busy ? 0.6 : 1 }}>✓ {T('Duyệt', 'Approve')}</button>
                  </div>
                ) : (
                  <button onClick={doApprove} disabled={busy} style={{ ...approveWide, opacity: busy ? 0.6 : 1 }}>
                    ✓ {T('Duyệt đăng bài này', 'Approve this post')}
                  </button>
                )}
                {phone && queue && (queue.onSkip || (queue.onApproveAll && queue.remaining > 1)) && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 6 }}>
                    {queue.onSkip ? <button onClick={queue.onSkip} style={linkish}>{T('Xem bài sau ›', 'Next post ›')}</button> : <span />}
                    {queue.onApproveAll && queue.remaining > 1 && (
                      <button onClick={approveAll} disabled={allBusy} style={allArmed ? allArmedBtn : linkish}>
                        {allBusy ? T('Đang duyệt…', 'Approving…') : allArmed ? T(`Bấm lần nữa · duyệt ${queue.remaining} bài`, `Tap again · approve ${queue.remaining}`) : T(`Duyệt cả ${queue.remaining} bài`, `Approve all ${queue.remaining}`)}
                      </button>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div style={{ textAlign: 'center', fontSize: 14, fontWeight: 600, color: 'var(--ink-good)', padding: '12px 0' }}>
                🟢 {T('Đã duyệt', 'Approved')}{(justApproved || p.approvedByName) ? ` — ${justApproved || p.approvedByName}` : ''} · {T('bài sẽ đăng đúng lịch', 'publishing on schedule')}
              </div>
            )}
          </div>
        </div>
      )}

      {/* the phone's "Cần sửa": a sheet from the bottom, the buttons under the thumb */}
      {fixOpen && phone && (
        <div onClick={() => setFixOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 205, background: 'rgba(2,6,23,.6)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" style={{ background: 'var(--c0f172a)', borderTop: '1px solid var(--c334155)', borderRadius: '20px 20px 0 0', padding: '10px 16px calc(16px + env(safe-area-inset-bottom, 0px))', maxHeight: '88vh', overflowY: 'auto' }}>
            <span style={{ display: 'block', width: 44, height: 5, borderRadius: 3, background: 'var(--c475569)', margin: '0 auto 12px' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <PostThumb media={p.media} w={44} h={44} radius={10} vi={vi} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <b style={{ display: 'block', fontSize: 16, color: 'var(--ce2e8f0)' }}>{T('Chị muốn sửa gì?', 'What should change?')}</b>
                <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{fmtDay(p.scheduledAt)} · {fmtTime(p.scheduledAt)}</span>
              </span>
              <button onClick={() => setFixOpen(false)} aria-label={T('Đóng', 'Close')} style={{ width: 40, height: 40, borderRadius: 12, border: '1px solid var(--c334155)', background: 'var(--c1e293b)', color: 'var(--ce2e8f0)', fontSize: 16, cursor: 'pointer' }}>✕</button>
            </div>
            {fixCard(true)}
          </div>
        </div>
      )}

      {/* name ask — once, then remembered on this phone */}
      {askName && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 210, background: 'rgba(2,6,23,.8)', display: 'grid', placeItems: 'center', padding: 20 }}>
          <div style={{ background: 'var(--c151f38)', border: '1px solid var(--c334155)', borderRadius: 14, padding: 20, width: '100%', maxWidth: 340 }}>
            <div style={{ fontSize: 15.5, fontWeight: 700, marginBottom: 4 }}>{T('Ai đang duyệt vậy ạ?', 'Who is reviewing?')}</div>
            <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginBottom: 12, lineHeight: 1.5 }}>
              {T('Chỉ hỏi một lần — để team biết ai đã xem và duyệt bài.', 'Asked once — so the team knows who reviewed.')}
            </div>
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitName(); }}
              placeholder={T('Tên của bạn (vd: Chị Hoa)', 'Your name')}
              style={{ width: '100%', font: 'inherit', fontSize: 16, background: 'var(--c0f172a)', border: '1px solid var(--c334155)', borderRadius: 10, padding: '12px 13px', color: 'var(--ce2e8f0)', marginBottom: 10 }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setAskName(false); pendingAction.current = null; }} style={{ flex: 1, font: 'inherit', fontSize: 14, fontWeight: 600, background: 'transparent', color: 'var(--c94a3b8)', border: '1px solid var(--c475569)', borderRadius: 10, padding: 12, cursor: 'pointer' }}>
                {T('Để sau', 'Not now')}
              </button>
              <button onClick={submitName} disabled={!nameDraft.trim()} style={{ flex: 2, font: 'inherit', fontSize: 14, fontWeight: 700, background: '#6366f1', color: '#fff', border: 'none', borderRadius: 10, padding: 12, cursor: 'pointer', opacity: nameDraft.trim() ? 1 : 0.5 }}>
                {T('Tiếp tục', 'Continue')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* Each state of a button is its own literal object: a white label sits on the
   same line as the accent it is white on, so the theme lint can see it. */
const BTN: React.CSSProperties = { fontFamily: 'inherit', cursor: 'pointer', borderRadius: 12, fontSize: 13.5, fontWeight: 700, minHeight: 48, padding: '0 10px', boxSizing: 'border-box' };
const fixOff: React.CSSProperties = { ...BTN, background: 'var(--c0f172a)', border: '1px solid var(--c475569)', color: 'var(--ce2e8f0)' };
const fixStop: React.CSSProperties = { ...BTN, background: 'var(--c0f172a)', border: '1px solid var(--c475569)', color: 'var(--ink-bad)' };
const fixOn: React.CSSProperties = { ...BTN, background: 'var(--c451a03)', border: '2px solid #f59e0b', color: 'var(--cfcd34d)', fontWeight: 800 };
const sendReady: React.CSSProperties = { ...BTN, border: 'none', fontSize: 15, fontWeight: 800, background: '#c2410c', color: '#fff' };
const sendIdle: React.CSSProperties = { ...BTN, border: '1px solid var(--c334155)', fontSize: 15, fontWeight: 800, background: 'var(--c1e293b)', color: 'var(--c64748b)', cursor: 'default' };
const approveBig: React.CSSProperties = { ...BTN, minHeight: 60, borderRadius: 16, border: 'none', fontSize: 18, fontWeight: 800, background: '#16a34a', color: '#fff' };
const approveWide: React.CSSProperties = { ...BTN, width: '100%', minHeight: 52, border: 'none', fontSize: 16, background: '#22c55e', color: '#fff' };
const approvePhone: React.CSSProperties = { ...BTN, flex: 2, minHeight: 56, borderRadius: 16, border: 'none', fontSize: 17, fontWeight: 800, background: '#16a34a', color: '#fff' };
const needsFixBtn: React.CSSProperties = { ...BTN, flex: 1, minHeight: 56, borderRadius: 16, border: '1.5px solid #f59e0b', fontSize: 15, fontWeight: 800, background: 'var(--c451a03)', color: 'var(--cfcd34d)' };
const linkish: React.CSSProperties = { background: 'none', border: 'none', padding: '8px 2px', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, color: 'var(--ca5b4fc)', cursor: 'pointer', minHeight: 36 };
const allArmedBtn: React.CSSProperties = { ...BTN, minHeight: 38, fontSize: 13, border: 'none', background: '#16a34a', color: '#fff' };
const queueOff: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', padding: '5px 10px 5px 5px', borderRadius: 12, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--ce2e8f0)', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, textAlign: 'left' };
const queueOn: React.CSSProperties = { ...queueOff, border: '2px solid #7c3aed', background: 'var(--c1e1b4b)' };
