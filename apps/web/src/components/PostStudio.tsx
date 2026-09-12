'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { moveItem } from '../lib/reorder';
import { dayKeyInTz, hourInTz, fmtInTz } from '../lib/datetime';

/**
 * Planning a month of posts, and seeing what it will look like before it exists.
 *
 * WHAT WAS WRONG WITH A LIST
 *
 * A list is fine for three posts and useless for thirty. Somebody laying out a
 * month needs two things a list cannot give: which days are still EMPTY, and
 * what the Instagram profile will look like once it has all published — because
 * a feed is judged as a wall of squares, not as thirty captions in a row.
 *
 * So there are three views over exactly the same queue:
 *   Calendar — thirty boxes; the empty ones are the point.
 *   Grid     — the Instagram profile, newest first, three across.
 *   List     — the detail, when you need to read rather than look.
 *
 * NOTHING HERE INVENTS A PREVIEW IT CANNOT SUPPORT
 *
 * The post preview draws the salon's real caption over the salon's real image
 * at the real aspect ratio, and cuts the caption where the platform cuts it. It
 * does NOT draw fake like counts, fake comments or a fake follower number — a
 * mockup that decorates itself with numbers nobody has is a mockup that teaches
 * the reader to distrust the parts that are true.
 */

export type Channel = 'facebook' | 'instagram' | 'google' | 'tiktok';
/** What each place is called on screen. 'google' is the shop's Business Profile on Maps. */
export const CHANNEL_NAME: Record<Channel, string> = { facebook: 'Facebook', instagram: 'Instagram', google: 'Google Business', tiktok: 'TikTok' };
/** Each platform's own colour, so a dot reads without a legend. TikTok's cyan, because black is the page. */
export const CHANNEL_COLOR: Record<Channel, string> = { facebook: '#1877f2', instagram: '#e1306c', google: '#34a853', tiktok: '#69c9d0' };
export const CHANNEL_SHORT: Record<Channel, string> = { facebook: 'FB', instagram: 'IG', google: 'GG', tiktok: 'TT' };

/**
 * Where a post goes, as coloured dots — replaces the ◈ ▣ ◉ glyphs nobody
 * could read. One dot per platform in the platform's colour; hover names them.
 */
export function ChannelDots({ channels, size = 7 }: { channels: Channel[]; size?: number }) {
  const list = (['facebook', 'instagram', 'google', 'tiktok'] as Channel[]).filter((c) => channels?.includes(c));
  return (
    <span title={list.map((c) => CHANNEL_NAME[c]).join(' + ')} style={{ display: 'inline-flex', gap: 2, alignItems: 'center', flexShrink: 0, verticalAlign: 'middle' }}>
      {list.map((c) => (
        <span key={c} style={{ width: size, height: size, borderRadius: '50%', background: CHANNEL_COLOR[c], display: 'inline-block' }} />
      ))}
    </span>
  );
}

/**
 * Where a post goes, as two-letter chips in the platform's own colour.
 *
 * The dots above are still right for a dense list, but on the month view they
 * were the thing people could not read: two small circles, one pink and one
 * blue, tell you there are two platforms and not WHICH. FB / IG / GG / TT
 * needs no legend and survives being looked at from a metre away.
 *
 * Outlined rather than filled on purpose — the colour has to carry in both
 * themes, and a hard-coded ink on a hard-coded fill cannot.
 */
export function ChannelChips({ channels }: { channels: Channel[] }) {
  const list = (['facebook', 'instagram', 'google', 'tiktok'] as Channel[]).filter((c) => channels?.includes(c));
  return (
    <span title={list.map((c) => CHANNEL_NAME[c]).join(' + ')} style={{ display: 'inline-flex', gap: 3, alignItems: 'center', flexShrink: 0 }}>
      {list.map((c) => (
        <span
          key={c}
          style={{
            fontSize: 8.5, fontWeight: 800, letterSpacing: .3, lineHeight: 1,
            padding: '2px 3px', borderRadius: 3,
            color: CHANNEL_COLOR[c], border: `1px solid ${CHANNEL_COLOR[c]}`,
          }}
        >{CHANNEL_SHORT[c]}</span>
      ))}
    </span>
  );
}

export type MediaKind = 'image' | 'video';
export interface MediaItem { url: string; kind: MediaKind; /** The archive copy on Drive, once filed. */ driveUrl?: string }
export type Stage = 'writing' | 'design' | 'ready';

export interface StudioPost {
  id: string;
  channels: Channel[];
  message: string;
  media: MediaItem[];
  shape: 'text' | 'image' | 'video' | 'carousel';
  scheduledAt: string;
  status: string;
  blockers: string[];
  /**
   * The client asked for something on this post and nobody has said it is done.
   *
   * Red on every view, and the post does not publish while it is set. There is
   * no separate "urgent" flag: the colour and the hold are the same field, so
   * the calendar cannot show a colour the scheduler does not honour.
   */
  held?: { at: string; by: string | null; note: string | null } | null;
  /** The team's path — see api post-workflow.ts. Absent on rows that predate it. */
  stage?: Stage;
  writerName?: string | null;
  designerName?: string | null;
  teamNote?: string | null;
  driveFolderUrl?: string | null;
}

/**
 * The colours a card can be, in the order they win.
 *
 * Red first, because it is the only one that means a person is waiting. Amber
 * — the post cannot go out as it stands — is the team's own problem and can
 * wait behind the client's. Green is history.
 */
export type Tone = 'held' | 'failed' | 'blocked' | 'posted' | 'writing' | 'design' | 'ready' | 'plain';
export function postTone(p: { held?: unknown; blockers: string[]; status: string; stage?: Stage }): Tone {
  if (p.held) return 'held';
  if (p.status === 'failed' || p.status === 'expired') return 'failed';
  if (p.status === 'posted') return 'posted';
  // The team's own path, before anything the platform has to say about it: a
  // caption with no picture yet is "in design", not "blocked".
  if (p.stage === 'writing') return 'writing';
  if (p.stage === 'design') return 'design';
  if (p.blockers.length) return 'blocked';
  if (p.status === 'scheduled') return 'ready';
  return 'plain';
}

/**
 * One look per tone, shared by the calendar, the grid and the legend — so a
 * colour means the same thing on every screen and nobody has to remember
 * which shade of green was "posted".
 */
/**
 * One look per tone, shared by the calendar, the board and the legend.
 *
 * `bar` is the 4px stripe down the left edge — on the month view that stripe
 * IS the status, because a whole card tinted in a tone stops being a signal
 * once every card has one. `alarm` marks the three tones that mean somebody
 * has to do something: only those get a filled card, so a month with two
 * problems in it shows two red boxes instead of thirty coloured ones.
 */
export const TONES: Record<Tone, { bg: string; border: string; fg: string; bar: string; alarm: boolean; icon: string; vi: string; en: string }> = {
  held:    { bg: 'var(--c450a0a)', border: '#ef4444', fg: 'var(--cfecaca)', bar: '#ef4444', alarm: true,  icon: '🔴', vi: 'Khách yêu cầu sửa', en: 'Client asked for a change' },
  failed:  { bg: 'var(--c450a0a)', border: '#f87171', fg: 'var(--cfecaca)', bar: '#f87171', alarm: true,  icon: '⚠', vi: 'Đăng lỗi', en: 'Failed' },
  blocked: { bg: 'var(--c451a03)', border: '#f59e0b', fg: 'var(--ce2e8f0)', bar: '#f59e0b', alarm: true,  icon: '⚠', vi: 'Thiếu điều kiện đăng', en: 'Cannot publish as is' },
  writing: { bg: 'var(--c1e293b)', border: '#60a5fa', fg: 'var(--ce2e8f0)', bar: '#60a5fa', alarm: false, icon: '✍', vi: 'Đang viết content', en: 'Writing' },
  design:  { bg: 'var(--c1e293b)', border: '#c084fc', fg: 'var(--ce2e8f0)', bar: '#c084fc', alarm: false, icon: '🎨', vi: 'Đang thiết kế', en: 'In design' },
  ready:   { bg: 'var(--c1e293b)', border: '#22c55e', fg: 'var(--ce2e8f0)', bar: '#22c55e', alarm: false, icon: '📅', vi: 'Đã chốt lịch', en: 'Scheduled' },
  posted:  { bg: 'var(--c14532d)', border: '#22c55e', fg: 'var(--ce2e8f0)', bar: 'var(--c475569)', alarm: false, icon: '✓', vi: 'Đã đăng', en: 'Published' },
  plain:   { bg: 'var(--c1e293b)', border: 'var(--c334155)', fg: 'var(--ce2e8f0)', bar: 'var(--c475569)', alarm: false, icon: '', vi: 'Nháp', en: 'Draft' },
};

/** The calendar's tooltip: state, owners, the team note — what the hover has to answer. */
export function postHint(p: StudioPost, vi: boolean): string {
  const tone = postTone(p);
  const t = TONES[tone];
  const lines = [`${t.icon} ${vi ? t.vi : t.en}`];
  if (p.held) lines.push(`${p.held.by ? `${p.held.by}: ` : ''}${(p.held.note ?? '').slice(0, 200)}`);
  const who = [p.writerName ? `✍ ${p.writerName}` : '', p.designerName ? `🎨 ${p.designerName}` : ''].filter(Boolean).join(' · ');
  if (who) lines.push(who);
  if (p.teamNote) lines.push(`📝 ${p.teamNote.slice(0, 200)}`);
  lines.push(p.message.slice(0, 100) || (vi ? '(ảnh)' : '(media)'));
  if (p.status !== 'posted') lines.push(vi ? 'Bấm để mở · chuột phải để xoá' : 'Click to open · right-click to delete');
  return lines.join('\n');
}

/** Where Facebook and Instagram cut a caption before "… See more". */
const FB_FOLD = 250;
const IG_FOLD = 125;

const pad = (n: number) => String(n).padStart(2, '0');
// A month cell's Date is a plain calendar-day carrier (local midnight, Y-M-D);
// its key reads those digits back. A stored INSTANT is different: it must be
// keyed by the SALON's calendar day (dayKeyInTz), or an Austin evening post
// files itself under the viewer's tomorrow.
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// ---------------------------------------------------------------------------

/**
 * The month, as boxes.
 *
 * Starts on Monday because a salon's week does, and shows the whole grid
 * including the days that spill over from the neighbouring months — a calendar
 * with holes in the corners is harder to read than one with grey edges.
 */
export function MonthCalendar({
  posts, month, onMonth, onPick, onDrop, onDelete, vi, compact = false, canDeletePosted = false,
}: {
  posts: StudioPost[];
  month: Date;
  onMonth: (d: Date) => void;
  onPick: (id: string) => void;
  onDrop: (id: string, day: Date) => void;
  onDelete: (id: string) => void;
  vi: boolean;
  /** A phone. Seven columns of cards do not fit; see the compact branch below. */
  compact?: boolean;
  /**
   * A Lumio support session, which may delete a PUBLISHED row.
   *
   * A salon may not: that row is the record of what really went out, and the
   * server refuses. But the menu still opens on a published post and says so —
   * a gesture that does nothing at all is a gesture people conclude is broken.
   */
  canDeletePosted?: boolean;
}) {
  const [over, setOver] = useState<string | null>(null);
  /** A day whose overflow the reader has opened. Busy days stay short by default. */
  const [openDay, setOpenDay] = useState<string | null>(null);
  /**
   * The right-click menu, and its long-press twin.
   *
   * A published post is deliberately absent from it: that row is the record of
   * what really went up, and the server refuses to delete it. Offering a menu
   * item that always errors is worse than offering none.
   */
  const [menu, setMenu] = useState<{ id: string; x: number; y: number; posted: boolean } | null>(null);
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('click', close); window.removeEventListener('scroll', close, true); };
  }, [menu]);
  const T = (v: string, e: string) => (vi ? v : e);

  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    // getDay() is 0 for Sunday; a Monday-first grid needs Sunday to be 6.
    const lead = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(first.getDate() - lead);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [month]);

  const byDay = useMemo(() => {
    const m = new Map<string, StudioPost[]>();
    for (const p of posts) {
      const k = dayKeyInTz(p.scheduledAt);
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    // Within a day, the order on screen is the order of the day.
    for (const [k, list] of m) m.set(k, [...list].sort((a, b) => (a.scheduledAt < b.scheduledAt ? -1 : 1)));
    return m;
  }, [posts]);

  const today = dayKeyInTz(new Date());
  const label = month.toLocaleDateString(vi ? 'vi-VN' : 'en-US', { month: 'long', year: 'numeric' });
  const dows = vi ? ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const step = (n: number) => onMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  /** How many posts a day shows before it offers "+N more". */
  const CAP = 3;

  /** The month at a glance: how much work is waiting, and how much is bleeding. */
  const totals = useMemo(() => {
    let alarm = 0; let doing = 0; let locked = 0; let done = 0;
    for (const p of posts) {
      const t = postTone(p);
      if (TONES[t].alarm) alarm += 1;
      else if (t === 'writing' || t === 'design') doing += 1;
      else if (t === 'posted') done += 1;
      else locked += 1;
    }
    return { alarm, doing, locked, done };
  }, [posts]);

  /**
   * One post, drawn the same everywhere.
   *
   * `big` is the phone: same card, room to breathe. A month grid squeezed onto
   * a 390px screen gives each day about fifty pixels, which is a colour and
   * nothing else — so on a phone the grid becomes a glance-map and this card
   * is shown full width underneath, where a thumbnail and a sentence fit.
   */
  const card = (p: StudioPost, big = false) => {
    const tone = postTone(p);
    const t = TONES[tone];
    const thumb = p.media[0];
    const owner = tone === 'design' ? (p.designerName || p.writerName) : (p.writerName || p.designerName);
    /**
     * The second line answers "what do I do about this one", and only falls
     * back to the caption when the answer is nothing. A caption cut at 24
     * characters was never the answer.
     */
    const detail = t.alarm
      ? `${t.icon} ${vi ? t.vi : t.en}${p.held?.note ? ` — ${p.held.note}` : p.blockers[0] ? ` — ${p.blockers[0]}` : ''}`
      : tone === 'writing' || tone === 'design'
        ? `${t.icon} ${vi ? t.vi : t.en}${owner ? ` · ${owner}` : ''}`
        : p.teamNote
          ? `📝 ${p.teamNote}`
          : (p.message.trim() || T('(chưa có caption)', '(no caption yet)'));
    const box: React.CSSProperties = big
      ? { width: 46, height: 46, borderRadius: 8, flexShrink: 0, background: 'var(--c0f172a)', border: '1px solid var(--c334155)' }
      : thumbBox;
    return (
      <div
        key={p.id}
        draggable={!big}
        onDragStart={(e) => {
          // Firefox refuses to start a drag unless setData is called.
          e.dataTransfer.setData('text/plain', p.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onClick={() => onPick(p.id)}
        /**
         * The menu opens on EVERY card, published ones included.
         *
         * It used to bail out silently on anything already posted — and since
         * most of a month IS already posted, the gesture looked broken. Now it
         * opens and says why a published row cannot be deleted. That is an
         * answer; nothing at all is not.
         */
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ id: p.id, x: e.clientX, y: e.clientY, posted: p.status === 'posted' });
        }}
        // Touch has no right-click. A long press is the same gesture.
        onTouchStart={(e) => {
          const t2 = e.touches[0];
          const wasPosted = p.status === 'posted';
          press.current = setTimeout(() => setMenu({ id: p.id, x: t2.clientX, y: t2.clientY, posted: wasPosted }), 500);
        }}
        onTouchEnd={() => { if (press.current) clearTimeout(press.current); }}
        onTouchMove={() => { if (press.current) clearTimeout(press.current); }}
        title={postHint(p, vi)}
        style={{
          marginTop: big ? 6 : 3, padding: big ? '9px 10px' : '3px 5px', borderRadius: big ? 10 : 6,
          cursor: big ? 'pointer' : 'grab',
          // Only a problem gets a filled card. Everything else is a neutral box
          // with a coloured stripe, so the two red ones in a month of thirty are
          // the two things you see.
          background: t.alarm ? t.bg : 'var(--c1e293b)',
          border: `1px solid ${t.alarm ? t.border : 'var(--c334155)'}`,
          borderLeft: `${big ? 5 : 4}px solid ${t.bar}`,
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: big ? 'flex-start' : 'center', gap: big ? 9 : 4 }}>
          {/* The picture is how a designer recognises their own post.
              A 24-character caption is not. */}
          {thumb ? (
            thumb.kind === 'video' ? (
              <span style={{ ...box, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: big ? 15 : 8, color: 'var(--c94a3b8)' }}>▶</span>
            ) : (
              <img src={thumb.url} alt="" loading="lazy" style={{ ...box, objectFit: 'cover', opacity: tone === 'posted' ? .7 : 1 }} />
            )
          ) : (
            <span style={{ ...box, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: big ? 14 : 8, color: 'var(--ink-faint)' }}>✎</span>
          )}

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: big ? 7 : 4 }}>
              {/* Published recedes by colour, never by opacity.
                  Fading a card works on a dark screen and erases it on a light
                  one: the text loses contrast AND the card's own surface fades
                  into the white behind it, so a month of finished work turned
                  into a page of ghosts the moment somebody switched themes.
                  A dimmer TEXT token flips with the theme and stays legible in
                  both. */}
              <b style={{ fontSize: big ? 14 : 10.5, color: t.alarm ? t.fg : tone === 'posted' ? 'var(--c94a3b8)' : 'var(--ce2e8f0)', flexShrink: 0 }}>
                {fmtInTz(new Date(p.scheduledAt), { hour: '2-digit', minute: '2-digit' })}
              </b>
              <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <ChannelChips channels={p.channels} />
                {/* The archive, one click from the month — the reason it exists
                    is to be found from here, not from the composer. */}
                {p.driveFolderUrl && (
                  <a
                    href={p.driveFolderUrl} target="_blank" rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    title={T('Mở thư mục Drive (ảnh/clip của bài này)', 'Open the Drive folder (this post’s files)')}
                    style={{ flexShrink: 0, textDecoration: 'none', fontSize: big ? 13 : 10 }}
                  >📁</a>
                )}
              </span>
            </div>
            <div style={{
              fontSize: big ? 12.5 : 9.5, lineHeight: 1.4, marginTop: big ? 3 : 1,
              color: t.alarm ? t.fg : tone === 'posted' ? 'var(--c64748b)' : 'var(--c94a3b8)',
              fontWeight: t.alarm ? 700 : 400,
              ...(big
                ? { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' }
                : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
            }}>
              {detail}
            </div>
          </div>
        </div>
      </div>
    );
  };

  /**
   * What the menu offers, which depends on whether the post already went out.
   *
   * A published row is the record of what really reached the customer, and the
   * server refuses to delete it for a salon — so instead of a greyed-out
   * "Delete" that invites people to keep clicking, the menu says in a sentence
   * where the post actually lives now. A Lumio support session may delete it,
   * and for them the item is real.
   */
  const menuBody = (m: { id: string; posted: boolean }) => (
    <>
      <button onClick={() => { onPick(m.id); setMenu(null); }} style={menuItem}>
        ✎ {m.posted ? T('Mở bài', 'Open post') : T('Sửa bài', 'Edit post')}
      </button>
      {(!m.posted || canDeletePosted) ? (
        <button onClick={() => { onDelete(m.id); setMenu(null); }} style={{ ...menuItem, color: '#ef4444' }}>
          🗑 {m.posted ? T('Xoá bản ghi khỏi lịch', 'Delete this record') : T('Xoá bài này', 'Delete this post')}
        </button>
      ) : (
        <div style={{ padding: '8px 11px', fontSize: 11.5, color: 'var(--c94a3b8)', lineHeight: 1.5, maxWidth: 215 }}>
          {T('Bài đã đăng được giữ làm sổ ghi. Muốn gỡ hẳn thì xoá trực tiếp trên Facebook / Instagram / TikTok.',
             'A published post is kept as the record. To take it down, delete it on Facebook / Instagram / TikTok itself.')}
        </div>
      )}
    </>
  );

  /** The month's summary chips — same numbers on both layouts. */
  const tallies = (
    <>
      <Tally n={totals.alarm} bar="#ef4444" label={T('cần xử lý', 'need attention')} loud />
      <Tally n={totals.doing} bar="#c084fc" label={T('đang làm', 'in progress')} />
      <Tally n={totals.locked} bar="#22c55e" label={T('chờ đăng', 'waiting to go')} />
      <Tally n={totals.done} bar="var(--c475569)" label={T('đã đăng', 'published')} />
    </>
  );

  /** The key, as one wrapping row. On a phone it hides behind a tap. */
  const legend = (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 12px', fontSize: 11, color: 'var(--c94a3b8)', alignItems: 'center' }}>
      {(['held', 'failed', 'blocked', 'writing', 'design', 'ready', 'posted'] as Tone[]).map((k) => (
        <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: k === 'posted' ? 'var(--c64748b)' : 'var(--c94a3b8)' }}>
          <span style={{
            width: 13, height: 11, borderRadius: 3,
            background: TONES[k].alarm ? TONES[k].bg : 'var(--c1e293b)',
            border: `1px solid ${TONES[k].alarm ? TONES[k].border : 'var(--c334155)'}`,
            borderLeft: `4px solid ${TONES[k].bar}`,
          }} />
          {TONES[k].icon} {vi ? TONES[k].vi : TONES[k].en}
        </span>
      ))}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginLeft: 2, paddingLeft: 10, borderLeft: '1px solid var(--c334155)' }}>
        <ChannelChips channels={['facebook', 'instagram', 'google', 'tiktok']} />
      </span>
    </div>
  );

  /**
   * THE PHONE.
   *
   * Seven columns of cards do not fit and never will: each day would be about
   * fifty pixels wide, which holds a colour and no information. So the month
   * splits in two — a glance-map of thirty-odd squares that answers "where is
   * the work and where is the trouble", and, under it, the days that actually
   * have something on them, full width, in the order they happen.
   *
   * Tapping a square jumps to that day rather than opening anything: on a phone
   * the question is nearly always "what is on the 14th", and an answer that
   * costs one tap and no typing is the whole point of the map.
   */
  if (compact) {
    const withPosts = days.filter((d) => !((byDay.get(dayKey(d)) ?? []).length === 0) && d.getMonth() === month.getMonth());
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
          <button onClick={() => step(-1)} style={navBtn}>‹</button>
          <div style={{ flex: 1, fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)', textAlign: 'center' }}>{label}</div>
          <button onClick={() => step(1)} style={navBtn}>›</button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>{tallies}</div>
        <div style={{ fontSize: 11, color: 'var(--c64748b)', marginBottom: 8 }}>
          {T('Chạm để mở bài · Nhấn giữ để sửa hoặc xoá', 'Tap to open · press and hold to edit or delete')}
        </div>

        {/* The glance-map: a day is a number and up to four dots. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 3, marginBottom: 4 }}>
          {dows.map((d) => (
            <div key={d} style={{ fontSize: 10, color: 'var(--c64748b)', textAlign: 'center' }}>{d}</div>
          ))}
          {days.map((d) => {
            const k = dayKey(d);
            const mine = byDay.get(k) ?? [];
            const outside = d.getMonth() !== month.getMonth();
            const alarmHere = mine.filter((x) => TONES[postTone(x)].alarm).length;
            return (
              <button
                key={k}
                onClick={() => {
                  if (!mine.length) return;
                  document.getElementById(`agenda-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                style={{
                  minHeight: 42, padding: '3px 2px', borderRadius: 7, fontFamily: 'inherit',
                  cursor: mine.length ? 'pointer' : 'default',
                  background: k === today ? 'var(--c1e1b4b)' : 'var(--c0f172a)',
                  border: `1px solid ${k === today ? '#6366f1' : 'var(--c1e293b)'}`,
                  opacity: outside ? .35 : 1,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', gap: 2,
                }}
              >
                <span style={{ fontSize: 11, fontWeight: alarmHere ? 800 : 600, color: alarmHere ? '#ef4444' : k === today ? 'var(--ca5b4fc)' : 'var(--c94a3b8)' }}>
                  {d.getDate()}
                </span>
                <span style={{ display: 'flex', gap: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
                  {mine.slice(0, 4).map((x) => (
                    <span key={x.id} style={{ width: 5, height: 5, borderRadius: '50%', background: TONES[postTone(x)].bar }} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>

        <details style={{ marginBottom: 10 }}>
          <summary style={{ fontSize: 11.5, color: 'var(--c94a3b8)', cursor: 'pointer', padding: '4px 0' }}>
            {T('Chú thích màu', 'What the colours mean')}
          </summary>
          <div style={{ paddingTop: 7 }}>{legend}</div>
        </details>

        {/* The days that have something on them, in order. */}
        {withPosts.length === 0 && (
          <div style={{ padding: 18, textAlign: 'center', fontSize: 13, color: 'var(--c64748b)', lineHeight: 1.6 }}>
            {T('Tháng này chưa có bài nào.', 'Nothing scheduled this month.')}
          </div>
        )}
        {withPosts.map((d) => {
          const k = dayKey(d);
          const mine = byDay.get(k) ?? [];
          const alarmHere = mine.filter((x) => TONES[postTone(x)].alarm).length;
          return (
            <div key={k} id={`agenda-${k}`} style={{ marginBottom: 14, scrollMarginTop: 8 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 7, padding: '5px 2px',
                borderBottom: `1px solid ${k === today ? '#6366f1' : 'var(--c1e293b)'}`,
              }}>
                <b style={{ fontSize: 13, color: k === today ? 'var(--ca5b4fc)' : 'var(--ce2e8f0)' }}>
                  {d.toLocaleDateString(vi ? 'vi-VN' : 'en-US', { weekday: 'short', day: 'numeric', month: 'numeric' })}
                </b>
                {k === today && <span style={{ fontSize: 10.5, color: 'var(--ca5b4fc)' }}>{T('hôm nay', 'today')}</span>}
                {alarmHere > 0 && <span style={{ fontSize: 11, fontWeight: 800, color: '#ef4444' }}>● {alarmHere}</span>}
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--c64748b)' }}>{mine.length}</span>
              </div>
              {mine.map((x) => card(x, true))}
            </div>
          );
        })}

        {menu && (
          <div
            style={{
              position: 'fixed', left: Math.min(menu.x, (typeof window !== 'undefined' ? window.innerWidth : 1000) - 190),
              top: menu.y, zIndex: 90, minWidth: 176, padding: 5, borderRadius: 10,
              background: 'var(--c111827)', border: '1px solid var(--c334155)',
              boxShadow: '0 12px 32px rgba(0,0,0,.45)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {menuBody(menu)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9, flexWrap: 'wrap' }}>
        <button onClick={() => step(-1)} style={navBtn}>‹</button>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)', minWidth: 150, textAlign: 'center' }}>{label}</div>
        <button onClick={() => step(1)} style={navBtn}>›</button>

        {/* The month in four numbers. A person opening this screen wants to
            know "is anything on fire" before they want to know anything else,
            and counting red boxes by eye is not an answer. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginLeft: 4 }}>{tallies}</div>

        {/* Two gestures nobody can see. Dragging a card and right-clicking one
            are both invisible affordances; a line of grey text is what turns
            them into features people actually have. */}
        <div style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--c64748b)', textAlign: 'right', lineHeight: 1.5 }}>
          {T('Kéo bài sang ngày khác để đổi lịch', 'Drag a post to another day to move it')}
          <br />
          {T('Chuột phải vào bài để sửa hoặc xoá', 'Right-click a post to edit or delete it')}
        </div>
      </div>

      {/* The key sits ABOVE the grid now. Under it, nobody scrolled to it. */}
      <div style={{ marginBottom: 9 }}>{legend}</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4, minWidth: 0 }}>
        {dows.map((d) => (
          <div key={d} style={{ fontSize: 11, color: 'var(--c64748b)', textAlign: 'center', padding: '2px 0' }}>{d}</div>
        ))}
        {days.map((d) => {
          const k = dayKey(d);
          const mine = byDay.get(k) ?? [];
          const outside = d.getMonth() !== month.getMonth();
          const alarmHere = mine.filter((p) => TONES[postTone(p)].alarm).length;
          const shown = openDay === k ? mine : mine.slice(0, CAP);
          const hidden = mine.length - shown.length;
          return (
            <div
              key={k}
              onDragOver={(e) => { e.preventDefault(); setOver(k); }}
              onDragLeave={() => setOver((o) => (o === k ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const id = e.dataTransfer.getData('text/plain');
                if (id) onDrop(id, d);
              }}
              style={{
                minHeight: 84, padding: 5, borderRadius: 8, minWidth: 0, overflow: 'hidden',
                background: over === k ? 'var(--c1e1b4b)' : 'var(--c0f172a)',
                border: `1px solid ${k === today ? '#6366f1' : over === k ? '#6366f1' : 'var(--c1e293b)'}`,
                opacity: outside ? 0.4 : 1,
              }}
            >
              {/* The day number, and — only when it earns the ink — how much is
                  on this day and how much of it is a problem. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 1 }}>
                <span style={{ fontSize: 11, color: k === today ? 'var(--ca5b4fc)' : 'var(--c64748b)', fontWeight: k === today ? 700 : 500 }}>
                  {d.getDate()}
                </span>
                {alarmHere > 0 && (
                  <span title={T('bài cần xử lý', 'posts needing attention')} style={{ fontSize: 9, fontWeight: 800, color: '#ef4444' }}>●{alarmHere}</span>
                )}
                {mine.length > 0 && (
                  <span style={{ marginLeft: 'auto', fontSize: 9.5, color: 'var(--ink-faint)' }}>{mine.length}</span>
                )}
              </div>

              {shown.map((p) => card(p))}

              {hidden > 0 && (
                <button
                  onClick={() => setOpenDay(k)}
                  style={{
                    marginTop: 3, width: '100%', padding: '2px 4px', borderRadius: 5, cursor: 'pointer',
                    border: '1px dashed var(--c334155)', background: 'transparent',
                    color: 'var(--c94a3b8)', fontSize: 9.5, fontFamily: 'inherit',
                  }}
                >+{hidden} {T('bài nữa', 'more')}</button>
              )}
              {openDay === k && mine.length > CAP && (
                <button
                  onClick={() => setOpenDay(null)}
                  style={{
                    marginTop: 3, width: '100%', padding: '2px 4px', borderRadius: 5, cursor: 'pointer',
                    border: '1px dashed var(--c334155)', background: 'transparent',
                    color: 'var(--c94a3b8)', fontSize: 9.5, fontFamily: 'inherit',
                  }}
                >{T('Thu gọn', 'Collapse')}</button>
              )}
            </div>
          );
        })}
      </div>

      {menu && (
        <div
          style={{
            position: 'fixed', left: Math.min(menu.x, (typeof window !== 'undefined' ? window.innerWidth : 1000) - 190),
            top: menu.y, zIndex: 90, minWidth: 176, padding: 5, borderRadius: 10,
            background: 'var(--c111827)', border: '1px solid var(--c334155)',
            boxShadow: '0 12px 32px rgba(0,0,0,.45)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {menuBody(menu)}
        </div>
      )}
    </div>
  );
}

/** One number in the month's summary strip. Zero is drawn faint, not hidden —
 *  "0 cần xử lý" is information; a missing chip is ambiguity. */
function Tally({ n, bar, label, loud }: { n: number; bar: string; label: string; loud?: boolean }) {
  const on = n > 0;
  return (
    <span
      title={label}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '2px 8px 2px 6px', borderRadius: 20,
        border: '1px solid var(--c334155)', background: 'var(--c0f172a)',
      }}
    >
      {/* A zero goes quiet through colour. Fading the whole chip made it
          unreadable on a light background — and "0 waiting" is information
          worth reading. */}
      <span style={{ width: 4, height: 12, borderRadius: 2, background: bar, display: 'inline-block', opacity: on ? 1 : .35 }} />
      <b style={{ fontSize: 12, color: loud && on ? '#ef4444' : on ? 'var(--ce2e8f0)' : 'var(--c64748b)' }}>{n}</b>
      <span style={{ fontSize: 10.5, color: on ? 'var(--c94a3b8)' : 'var(--c64748b)' }}>{label}</span>
    </span>
  );
}

const thumbBox: React.CSSProperties = {
  width: 17, height: 17, borderRadius: 4, flexShrink: 0,
  background: 'var(--c0f172a)', border: '1px solid var(--c334155)',
};

const menuItem: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left', padding: '9px 11px',
  borderRadius: 7, border: 'none', background: 'transparent',
  color: 'var(--ce2e8f0)', fontSize: 13.5, cursor: 'pointer',
};

const navBtn: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 8, cursor: 'pointer', fontSize: 16,
  border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--c94a3b8)',
};

// ---------------------------------------------------------------------------

/**
 * The Instagram profile, before it exists.
 *
 * Three across, newest first, square-cropped — because that is what a profile
 * page does, and a salon judging whether their month "looks right" is judging
 * this wall, not the captions.
 */
export function IgGrid({ posts, onPick, vi }: { posts: StudioPost[]; onPick: (id: string) => void; vi: boolean }) {
  const T = (v: string, e: string) => (vi ? v : e);
  if (!posts.length) {
    return (
      <div style={{ padding: 24, textAlign: 'center', fontSize: 13.5, color: 'var(--c94a3b8)', lineHeight: 1.6 }}>
        {T('Chưa có bài Instagram nào có ảnh. Lưới này hiện đúng những gì sẽ lên trang cá nhân.',
           'No Instagram posts with media yet. This grid shows exactly what will land on the profile.')}
      </div>
    );
  }
  return (
    <div>
      <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginBottom: 8, lineHeight: 1.5 }}>
        {T('Trang cá nhân Instagram sẽ trông như thế này sau khi đăng hết — mới nhất ở trên.',
           'How the Instagram profile will look once everything has published — newest first.')}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 3, maxWidth: 460 }}>
        {posts.map((p) => {
          const first = p.media[0];
          return (
            <button
              key={p.id}
              onClick={() => onPick(p.id)}
              title={`${fmtInTz(p.scheduledAt, { day: 'numeric', month: 'short', year: 'numeric' })} · ${p.message.slice(0, 80)}`
                + (p.held ? `\n🔴 ${T('Khách yêu cầu sửa', 'Client asked for a change')}: ${(p.held.note ?? '').slice(0, 160)}` : '')}
              style={{
                position: 'relative', aspectRatio: '1 / 1', padding: 0, cursor: 'pointer',
                border: p.held ? '2px solid #ef4444'
                  : p.blockers.length ? '2px solid #f59e0b' : '1px solid var(--line)',
                borderRadius: 2, overflow: 'hidden', background: 'var(--c1e293b)',
              }}
            >
              {first?.kind === 'video' ? (
                <video src={first.url} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={first?.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              )}
              {/* Instagram's own corner marks: a carousel and a reel are read at
                  a glance on a profile, and the salon is judging that glance. */}
              {p.media.length > 1 && (
                <span style={corner}>▤</span>
              )}
              {p.media.length === 1 && first?.kind === 'video' && (
                <span style={corner}>▶</span>
              )}
              {/* The ring alone is easy to miss at 150px; the dot is not. */}
              {p.held && (
                <span style={{
                  position: 'absolute', right: 4, bottom: 4, width: 10, height: 10, borderRadius: 10,
                  background: '#ef4444', boxShadow: '0 0 0 2px rgba(0,0,0,.45)',
                }} />
              )}
              {p.status !== 'posted' && (
                <span style={{
                  position: 'absolute', left: 4, bottom: 4, padding: '1px 5px', borderRadius: 4,
                  background: 'rgba(0,0,0,.6)', color: '#fff', fontSize: 9.5, fontWeight: 700,
                }}>
                  {dayKeyInTz(p.scheduledAt).slice(8, 10).replace(/^0/, '')}/{dayKeyInTz(p.scheduledAt).slice(5, 7).replace(/^0/, '')}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const corner: React.CSSProperties = {
  position: 'absolute', right: 4, top: 3, color: '#fff', fontSize: 12,
  textShadow: '0 1px 3px rgba(0,0,0,.7)',
};

// ---------------------------------------------------------------------------

/**
 * One post as the follower will meet it.
 *
 * The caption is cut where the platform cuts it — Instagram at roughly 125
 * characters, Facebook at roughly 250 — because "the first line is the whole
 * ad" is advice nobody acts on until they can see their own first line ending
 * mid-word.
 */
export function PostPreview({ channel, message, media, pageName, igUsername, vi }: {
  channel: Channel;
  message: string;
  media: MediaItem[];
  pageName: string | null;
  igUsername: string | null;
  vi: boolean;
}) {
  const T = (v: string, e: string) => (vi ? v : e);
  const fold = channel === 'instagram' ? IG_FOLD : FB_FOLD;
  const text = (message ?? '').trim();
  const cut = text.length > fold;
  const head = cut ? text.slice(0, fold) : text;
  // Google takes one photo and no video: the preview shows exactly what Maps
  // will, so a carousel's second picture is not promised where it will not go.
  const first = channel === 'google' ? media.find((m) => m.kind === 'image') : channel === 'tiktok' ? media.find((m) => m.kind === 'video') : media[0];
  const name = channel === 'instagram'
    ? (igUsername ? `@${igUsername}` : 'instagram')
    : (pageName ?? (channel === 'google' ? T('Hồ sơ doanh nghiệp', 'Business Profile') : channel === 'tiktok' ? 'TikTok' : 'Facebook Page'));

  // TikTok is a phone screen: the video fills it, the caption sits over the
  // bottom edge. Drawn as such so nobody is surprised by a landscape clip
  // arriving letterboxed.
  if (channel === 'tiktok') {
    return (
      <div style={{ width: 220, aspectRatio: '9 / 16', borderRadius: 14, overflow: 'hidden', position: 'relative', background: '#000', border: '1px solid var(--c334155)' }}>
        {first ? (
          <video src={first.url} muted playsInline controls style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#94a3b8', fontSize: 12, textAlign: 'center', padding: 16 }}>
            {T('Cần một video MP4', 'Needs an MP4 video')}
          </div>
        )}
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '28px 12px 12px', background: 'linear-gradient(transparent, rgba(0,0,0,.75))', color: '#fff', fontSize: 11.5, lineHeight: 1.4 }}>
          <div style={{ fontWeight: 700, marginBottom: 3 }}>@{(pageName ?? 'tiktok').replace(/^@/, '')}</div>
          <div style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{text}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      maxWidth: 340, borderRadius: 10, overflow: 'hidden',
      border: '1px solid var(--c334155)', background: 'var(--c0f172a)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px' }}>
        <span style={{
          width: 28, height: 28, borderRadius: '50%', background: 'var(--c334155)',
          display: 'grid', placeItems: 'center', fontSize: 12, color: 'var(--c94a3b8)',
        }}>{(name || '?').replace('@', '')[0]?.toUpperCase()}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{name}</div>
          <div style={{ fontSize: 10.5, color: 'var(--c64748b)' }}>
            {channel === 'facebook' ? T('Được tài trợ · Trang', 'Page') : channel === 'google' ? T('Google Maps · Cập nhật', 'Google Maps · Update') : T('Bài đăng', 'Post')}
          </div>
        </div>
      </div>

      {/* Facebook puts the text above the picture, Instagram below it. Swapping
          them would preview a layout neither platform produces. */}
      {channel !== 'instagram' && text && (
        <div style={{ padding: '0 11px 9px', fontSize: 13, color: 'var(--ce2e8f0)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
          {head}{cut && <span style={{ color: 'var(--c64748b)' }}>… {T('Xem thêm', 'See more')}</span>}
        </div>
      )}

      {first && (
        <div style={{
          position: 'relative', width: '100%',
          aspectRatio: channel === 'instagram' ? '1 / 1' : channel === 'google' ? '4 / 3' : '1.91 / 1',
          background: 'var(--c1e293b)',
        }}>
          {first.kind === 'video' ? (
            <video src={first.url} controls muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={first.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          )}
          {media.length > 1 && (
            <span style={{
              position: 'absolute', right: 8, top: 8, padding: '2px 8px', borderRadius: 20,
              background: 'rgba(0,0,0,.6)', color: '#fff', fontSize: 11, fontWeight: 700,
            }}>1/{media.length}</span>
          )}
        </div>
      )}

      {channel === 'instagram' && text && (
        <div style={{ padding: '9px 11px', fontSize: 13, color: 'var(--ce2e8f0)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
          <b>{igUsername ? igUsername : ''}</b> {head}
          {cut && <span style={{ color: 'var(--c64748b)' }}>… {T('thêm', 'more')}</span>}
        </div>
      )}

      {/* The Book button Lumio attaches to every Google post — it points at the
          shop's own booking page, so a reader on Maps lands in the calendar. */}
      {channel === 'google' && (
        <div style={{ padding: '8px 11px 10px' }}>
          <span style={{
            display: 'inline-block', padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
            border: '1px solid var(--c60a5fa)', color: 'var(--c60a5fa)',
          }}>{T('Đặt lịch', 'Book')}</span>
        </div>
      )}

      {cut && (
        <div style={{ padding: '0 11px 10px', fontSize: 11, color: '#f59e0b', lineHeight: 1.5 }}>
          {T(`Bị cắt sau ${fold} ký tự — câu đầu phải nói hết ý.`,
             `Cut after ${fold} characters — the first line has to carry the message.`)}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * The media list, in the order they will appear.
 *
 * Order is the whole feature for a carousel: item one is the thumbnail in the
 * feed and on the profile grid, and it is the only one most people ever see. So
 * the list is draggable, and item one is labelled as the cover rather than left
 * for the salon to work out.
 */
export function MediaList({ media, onChange, vi }: {
  media: MediaItem[];
  onChange: (m: MediaItem[]) => void;
  vi: boolean;
}) {
  const T = (v: string, e: string) => (vi ? v : e);
  const [from, setFrom] = useState<number | null>(null);

  return (
    <div>
      {media.map((m, i) => (
        <div
          key={`${m.url}-${i}`}
          draggable
          onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(i)); setFrom(i); }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const src = from ?? Number(e.dataTransfer.getData('text/plain'));
            if (Number.isInteger(src) && src !== i) onChange(moveItem(media, src, i));
            setFrom(null);
          }}
          style={{
            display: 'flex', alignItems: 'center', gap: 9, padding: '7px 9px', marginBottom: 6,
            borderRadius: 8, background: 'var(--c0f172a)',
            border: `1px solid ${i === 0 ? '#6366f1' : 'var(--c334155)'}`,
            cursor: 'grab',
          }}
        >
          <span style={{ color: 'var(--c64748b)', fontSize: 14 }}>⠿</span>
          <span style={{
            width: 40, height: 40, borderRadius: 6, overflow: 'hidden', flex: '0 0 40px',
            background: 'var(--c1e293b)', display: 'grid', placeItems: 'center',
          }}>
            {m.kind === 'video'
              ? <span style={{ fontSize: 16 }}>▶</span>
              // eslint-disable-next-line @next/next/no-img-element
              : <img src={m.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11.5, color: 'var(--c94a3b8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {m.url}
            </div>
            <div style={{ fontSize: 10.5, color: i === 0 ? 'var(--ca5b4fc)' : 'var(--c64748b)' }}>
              {m.kind === 'video' ? T('Video', 'Video') : T('Ảnh', 'Photo')}
              {i === 0 && ` · ${T('ảnh bìa — cái duy nhất hầu hết người ta nhìn thấy', 'cover — the one most people ever see')}`}
            </div>
          </div>
          <select
            value={m.kind}
            onChange={(e) => onChange(media.map((x, j) => (j === i ? { ...x, kind: e.target.value as MediaKind } : x)))}
            style={{
              fontSize: 12, padding: '5px 7px', borderRadius: 7,
              border: '1px solid var(--c334155)', background: 'var(--c1e293b)', color: 'var(--ce2e8f0)',
            }}
          >
            <option value="image">{T('Ảnh', 'Photo')}</option>
            <option value="video">{T('Video', 'Video')}</option>
          </select>
          <button
            onClick={() => onChange(media.filter((_, j) => j !== i))}
            aria-label={T('Xoá', 'Remove')}
            style={{
              width: 30, height: 30, borderRadius: 7, cursor: 'pointer', fontSize: 14,
              border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--c64748b)',
            }}
          >✕</button>
        </div>
      ))}
      {media.length > 1 && (
        <div style={{ fontSize: 11, color: 'var(--c64748b)', lineHeight: 1.5 }}>
          {T('Kéo để đổi thứ tự. Instagram cho tối đa 10 ảnh/video một bài.',
             'Drag to reorder. Instagram allows up to 10 items per post.')}
        </div>
      )}
    </div>
  );
}
