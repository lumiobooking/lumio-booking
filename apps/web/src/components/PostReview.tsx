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

export interface ReviewPost {
  id: string;
  channels: string[];
  message: string;
  media: { url: string; kind: 'image' | 'video' }[];
  scheduledAt: string;
  postedAt: string | null;
  clientStatus: 'held' | 'wait' | 'approved' | 'posted';
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
  const T = (v: string, e: string) => (vi ? v : e);
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
            <span style={{ background: '#451a03', border: '1px solid #92400e', color: '#fcd34d', fontSize: 12.5, fontWeight: 700, padding: '3px 10px', borderRadius: 20 }}>
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
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: day === dayKeyOf(new Date().toISOString()) ? '#fbbf24' : 'var(--c64748b)', padding: '0 2px 7px' }}>
            {day === dayKeyOf(new Date().toISOString()) ? T('Hôm nay', 'Today') + ' · ' : ''}{fmtDay(posts[0].scheduledAt)}
          </div>
          {posts.map((p) => <Row key={p.id} p={p} onOpen={() => setOpenId(p.id)} fmtTime={fmtTime} T={T} />)}
        </div>
      ))}

      {/* history, folded */}
      {posted.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <button onClick={() => setShowPosted((s) => !s)} style={{ font: 'inherit', fontSize: 13.5, fontWeight: 700, color: 'var(--c94a3b8)', background: 'none', border: 'none', cursor: 'pointer', padding: '10px 2px', minHeight: 44 }}>
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
            ? <video src={first.url} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={first.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />)
          : <span style={{ fontSize: 20 }}>📝</span>}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginBottom: 3, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, fontWeight: 800 }}>{fmtTime(p.scheduledAt)}</span>
          <span style={{ fontSize: 11, fontWeight: 700, background: st.bg, border: `1px solid ${st.bd}`, color: st.fg, padding: '1px 8px', borderRadius: 20, whiteSpace: 'nowrap' }}>
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
 * The detail sheet: full-screen on the phone, the approve bar under the thumb.
 * ------------------------------------------------------------------------- */
function Detail(props: {
  p: ReviewPost;
  feedMeta: { pageName: string; igUsername: string | null; salonName: string };
  api: ReviewApi;
  vi: boolean;
  fmtDay: (iso: string) => string;
  fmtTime: (iso: string) => string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { p, feedMeta, api, vi, fmtDay, fmtTime, onClose, onChanged } = props;
  const T = (v: string, e: string) => (vi ? v : e);
  const hasIg = p.channels.includes('instagram');
  const hasFb = p.channels.includes('facebook');
  const [mode, setMode] = useState<'facebook' | 'instagram'>(hasFb ? 'facebook' : 'instagram');
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [justApproved, setJustApproved] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<ReviewMsg[]>([]);
  const [draft, setDraft] = useState('');
  const [askName, setAskName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const pendingAction = useRef<null | ((name: string) => void)>(null);

  useEffect(() => {
    api.comments(p.id).then((r) => setMsgs(r.messages ?? [])).catch(() => {});
  }, [api, p.id]);

  // Body scroll lock while the sheet is up — the page under it must not drift.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

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
      setJustApproved(name || T('Bạn', 'You'));
      onChanged();
    } catch { /* the feed reload will show the truth */ }
    finally { setBusy(false); }
  });

  const send = () => withName(async (name) => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await api.comment(p.id, text, name || undefined);
      setDraft('');
      setMsgs((await api.comments(p.id)).messages ?? []);
      onChanged(); // the hold pill just appeared on the row behind us
    } catch { /* keep the draft so nothing typed is lost */ }
    finally { setBusy(false); }
  });

  const st = STATUS[p.clientStatus];
  const fold = mode === 'facebook' ? 250 : 125;
  const showApprove = (p.clientStatus === 'wait' || p.clientStatus === 'held') && !justApproved;
  const lines = p.message.split('\n');
  const firstImg = p.media.find((m) => m.kind === 'image');

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'var(--c0f172a)', display: 'flex', flexDirection: 'column' }}>
      {/* top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--c1e293b)', flexShrink: 0 }}>
        <button onClick={onClose} style={{ font: 'inherit', fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)', background: 'none', border: 'none', cursor: 'pointer', padding: '8px 10px 8px 4px', minHeight: 44 }}>
          ‹ {T('Quay lại', 'Back')}
        </button>
        <span style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 700, background: st.bg, border: `1px solid ${st.bd}`, color: st.fg, padding: '3px 10px', borderRadius: 20 }}>
          {st.dot} {T(st.vi, st.en)}
        </span>
      </div>

      {/* scrolling body */}
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' as never, padding: '14px 12px 24px' }}>
        <div style={{ maxWidth: 560, margin: '0 auto' }}>
          {/* channel toggle — only when the post goes to both */}
          {hasFb && hasIg && (
            <div style={{ display: 'flex', background: 'var(--c151f38)', border: '1px solid var(--c334155)', borderRadius: 10, padding: 3, marginBottom: 12 }}>
              {(['facebook', 'instagram'] as const).map((m) => (
                <button key={m} onClick={() => setMode(m)} style={{
                  flex: 1, font: 'inherit', fontSize: 13.5, fontWeight: 700, minHeight: 40, border: 'none', borderRadius: 8, cursor: 'pointer',
                  background: mode === m ? 'var(--c6366f1, #6366f1)' : 'transparent',
                  color: mode === m ? '#fff' : 'var(--c94a3b8)',
                }}>
                  {m === 'facebook' ? 'Facebook' : 'Instagram'}
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
                  fontWeight: 800, fontSize: mode === 'facebook' ? 17 : 14,
                  outline: mode === 'instagram' ? '2px solid #e1306c' : 'none', outlineOffset: 2,
                }}>
                  {(feedMeta.pageName || 'L').slice(0, 1).toUpperCase()}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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

              {p.media.length > 0 && (
                <div style={{ position: 'relative', background: '#000' }}>
                  {p.media[0].kind === 'video'
                    ? <video src={p.media[0].url} controls muted playsInline style={{ width: '100%', display: 'block', maxHeight: 460, objectFit: 'contain', aspectRatio: mode === 'instagram' ? '1/1' : undefined }} />
                    // eslint-disable-next-line @next/next/no-img-element
                    : <img src={(mode === 'instagram' && firstImg ? firstImg : p.media[0]).url} alt="" style={{ width: '100%', display: 'block', objectFit: 'cover', aspectRatio: mode === 'instagram' ? '1/1' : undefined, maxHeight: 460 }} />}
                  {p.media.length > 1 && (
                    <span style={{ position: 'absolute', top: 8, right: 10, background: 'rgba(0,0,0,.65)', color: '#fff', fontSize: 12, fontWeight: 700, padding: '2px 9px', borderRadius: 12 }}>
                      1/{p.media.length} ▤
                    </span>
                  )}
                </div>
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

          {/* posted: the real links */}
          {p.clientStatus === 'posted' && (
            <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {p.links.filter((l) => l.url).map((l) => (
                <a key={l.channel} href={l.url!} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--c60a5fa, #60a5fa)', textDecoration: 'none', padding: '10px 4px', minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>
                  🔗 {T('Xem bài trên', 'View on')} {l.channel === 'facebook' ? 'Facebook' : 'Instagram'}
                </a>
              ))}
            </div>
          )}

          {/* held: say why the clock stopped */}
          {p.clientStatus === 'held' && (
            <div style={{ marginTop: 12, fontSize: 13, lineHeight: 1.55, color: '#fdba74', background: '#341505', border: '1px solid #9a3412', borderRadius: 10, padding: '10px 13px' }}>
              ⏸ {T('Bài tạm giữ, sẽ không tự đăng cho tới khi team trả lời góp ý của bạn.', 'On hold — it will not auto-publish until the team answers your note.')}
            </div>
          )}

          {/* comments */}
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--c94a3b8)', marginBottom: 10 }}>
              💬 {T('Góp ý cho team', 'Notes for the team')}
            </div>
            {msgs.length === 0 && (
              <div style={{ fontSize: 12.5, color: 'var(--c64748b)', marginBottom: 10 }}>
                {T('Chưa có góp ý nào. Muốn sửa gì cứ nhắn — team nhận được ngay.', 'No notes yet. Anything to change? Write it here — the team sees it right away.')}
              </div>
            )}
            {msgs.map((m) => (
              <div key={m.id} style={{ display: 'flex', gap: 9, marginBottom: 10 }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 800, color: '#fff', background: m.side === 'lumio' ? '#6366f1' : '#d97706' }}>
                  {(m.authorName || '?').slice(0, 1).toUpperCase()}
                </div>
                <div style={{ background: m.side === 'lumio' ? 'var(--c1e1b4b)' : 'var(--c1e293b)', border: `1px solid ${m.side === 'lumio' ? '#312e81' : 'var(--c334155)'}`, borderRadius: 10, padding: '8px 12px', fontSize: 13.5, lineHeight: 1.5, minWidth: 0, wordBreak: 'break-word' }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--c94a3b8)', marginBottom: 2 }}>{m.authorName}</div>
                  <div style={{ whiteSpace: 'pre-line' }}>{m.body}</div>
                </div>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
                placeholder={T('Viết góp ý…', 'Write a note…')}
                style={{ flex: 1, font: 'inherit', fontSize: 16, background: 'var(--c151f38)', border: '1px solid var(--c334155)', borderRadius: 10, padding: '12px 13px', color: 'var(--ce2e8f0)', minWidth: 0 }}
              />
              <button onClick={send} disabled={busy || !draft.trim()} style={{ font: 'inherit', fontSize: 14, fontWeight: 700, background: '#6366f1', color: '#fff', border: 'none', borderRadius: 10, padding: '0 18px', cursor: 'pointer', opacity: busy || !draft.trim() ? 0.5 : 1, minHeight: 48 }}>
                {T('Gửi', 'Send')}
              </button>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginTop: 7, lineHeight: 1.5 }}>
              {T('Gửi góp ý sẽ tạm giữ bài này cho tới khi team trả lời.', 'Sending a note holds this post until the team responds.')}
            </div>
          </div>
        </div>
      </div>

      {/* bottom bar — the thumb zone */}
      {(showApprove || justApproved || p.clientStatus === 'approved') && (
        <div style={{ flexShrink: 0, borderTop: '1px solid var(--c1e293b)', background: 'var(--c0f172a)', padding: '10px 14px calc(10px + env(safe-area-inset-bottom, 0px))' }}>
          <div style={{ maxWidth: 560, margin: '0 auto' }}>
            {showApprove ? (
              <>
                <div style={{ fontSize: 12, color: '#fcd34d', marginBottom: 8, lineHeight: 1.5 }}>
                  ⏰ {T(`Bài sẽ tự đăng ${fmtDay(p.scheduledAt)} lúc ${fmtTime(p.scheduledAt)} nếu bạn không có ý kiến.`,
                        `Publishes automatically ${fmtDay(p.scheduledAt)} at ${fmtTime(p.scheduledAt)} unless you say otherwise.`)}
                </div>
                <button onClick={doApprove} disabled={busy} style={{ width: '100%', font: 'inherit', fontSize: 16, fontWeight: 800, background: '#22c55e', color: '#fff', border: 'none', borderRadius: 12, padding: 15, cursor: 'pointer', opacity: busy ? 0.6 : 1, minHeight: 52 }}>
                  ✓ {T('Duyệt đăng bài này', 'Approve this post')}
                </button>
              </>
            ) : (
              <div style={{ textAlign: 'center', fontSize: 14, fontWeight: 700, color: '#86efac', padding: '12px 0' }}>
                🟢 {T('Đã duyệt', 'Approved')}{(justApproved || p.approvedByName) ? ` — ${justApproved || p.approvedByName}` : ''} · {T('bài sẽ đăng đúng lịch', 'publishing on schedule')}
              </div>
            )}
          </div>
        </div>
      )}

      {/* name ask — once, then remembered on this phone */}
      {askName && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 210, background: 'rgba(2,6,23,.8)', display: 'grid', placeItems: 'center', padding: 20 }}>
          <div style={{ background: 'var(--c151f38)', border: '1px solid var(--c334155)', borderRadius: 14, padding: 20, width: '100%', maxWidth: 340 }}>
            <div style={{ fontSize: 15.5, fontWeight: 800, marginBottom: 4 }}>{T('Ai đang duyệt vậy ạ?', 'Who is reviewing?')}</div>
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
              <button onClick={() => { setAskName(false); pendingAction.current = null; }} style={{ flex: 1, font: 'inherit', fontSize: 14, fontWeight: 700, background: 'transparent', color: 'var(--c94a3b8)', border: '1px solid var(--c475569)', borderRadius: 10, padding: 12, cursor: 'pointer' }}>
                {T('Để sau', 'Not now')}
              </button>
              <button onClick={submitName} disabled={!nameDraft.trim()} style={{ flex: 2, font: 'inherit', fontSize: 14, fontWeight: 800, background: '#6366f1', color: '#fff', border: 'none', borderRadius: 10, padding: 12, cursor: 'pointer', opacity: nameDraft.trim() ? 1 : 0.5 }}>
                {T('Tiếp tục', 'Continue')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
