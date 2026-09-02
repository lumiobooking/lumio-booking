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

export type Channel = 'facebook' | 'instagram';
export type MediaKind = 'image' | 'video';
export interface MediaItem { url: string; kind: MediaKind }

export interface StudioPost {
  id: string;
  channels: Channel[];
  message: string;
  media: MediaItem[];
  shape: 'text' | 'image' | 'video' | 'carousel';
  scheduledAt: string;
  status: string;
  blockers: string[];
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
  posts, month, onMonth, onPick, onDrop, onDelete, vi,
}: {
  posts: StudioPost[];
  month: Date;
  onMonth: (d: Date) => void;
  onPick: (id: string) => void;
  onDrop: (id: string, day: Date) => void;
  onDelete: (id: string) => void;
  vi: boolean;
}) {
  const [over, setOver] = useState<string | null>(null);
  /**
   * The right-click menu, and its long-press twin.
   *
   * A published post is deliberately absent from it: that row is the record of
   * what really went up, and the server refuses to delete it. Offering a menu
   * item that always errors is worse than offering none.
   */
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
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
    return m;
  }, [posts]);

  const today = dayKeyInTz(new Date());
  const label = month.toLocaleDateString(vi ? 'vi-VN' : 'en-US', { month: 'long', year: 'numeric' });
  const dows = vi ? ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const step = (n: number) => onMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <button onClick={() => step(-1)} style={navBtn}>‹</button>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)', minWidth: 150, textAlign: 'center' }}>{label}</div>
        <button onClick={() => step(1)} style={navBtn}>›</button>
        <div style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--c64748b)' }}>
          {T('Kéo bài sang ngày khác để đổi lịch', 'Drag a post to another day to move it')}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {dows.map((d) => (
          <div key={d} style={{ fontSize: 11, color: 'var(--c64748b)', textAlign: 'center', padding: '2px 0' }}>{d}</div>
        ))}
        {days.map((d) => {
          const k = dayKey(d);
          const mine = byDay.get(k) ?? [];
          const outside = d.getMonth() !== month.getMonth();
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
                minHeight: 78, padding: 5, borderRadius: 8,
                background: over === k ? 'var(--c1e1b4b)' : 'var(--c0f172a)',
                border: `1px solid ${k === today ? '#6366f1' : over === k ? '#6366f1' : 'var(--c1e293b)'}`,
                opacity: outside ? 0.4 : 1,
              }}
            >
              <div style={{ fontSize: 11, color: k === today ? 'var(--ca5b4fc)' : 'var(--c64748b)', fontWeight: k === today ? 700 : 500 }}>
                {d.getDate()}
              </div>
              {mine.map((p) => (
                <div
                  key={p.id}
                  draggable
                  onDragStart={(e) => {
                    // Firefox refuses to start a drag unless setData is called.
                    e.dataTransfer.setData('text/plain', p.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onClick={() => onPick(p.id)}
                  onContextMenu={(e) => {
                    if (p.status === 'posted') return; // let the browser menu through
                    e.preventDefault();
                    setMenu({ id: p.id, x: e.clientX, y: e.clientY });
                  }}
                  // Touch has no right-click. A long press is the same gesture.
                  onTouchStart={(e) => {
                    if (p.status === 'posted') return;
                    const t = e.touches[0];
                    press.current = setTimeout(() => setMenu({ id: p.id, x: t.clientX, y: t.clientY }), 500);
                  }}
                  onTouchEnd={() => { if (press.current) clearTimeout(press.current); }}
                  onTouchMove={() => { if (press.current) clearTimeout(press.current); }}
                  title={p.status === 'posted'
                    ? `${T('Đã đăng', 'Published')} — ${p.message.slice(0, 100)}`
                    : `${p.message.slice(0, 100)}\n${T('Chuột phải để xoá', 'Right-click to delete')}`}
                  style={{
                    marginTop: 3, padding: '3px 5px', borderRadius: 5, cursor: 'grab',
                    background: p.blockers.length ? 'var(--c451a03)' : p.status === 'posted' ? 'var(--c14532d)' : 'var(--c1e293b)',
                    border: `1px solid ${p.blockers.length ? '#f59e0b' : p.status === 'posted' ? '#22c55e' : 'var(--c334155)'}`,
                    fontSize: 10.5, lineHeight: 1.3, color: 'var(--ce2e8f0)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                >
                  {p.channels.includes('instagram') ? '◈' : '▣'} {hourInTz(p.scheduledAt)}h {p.message.slice(0, 18) || T('(ảnh)', '(media)')}
                </div>
              ))}
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
          <button
            onClick={() => { onPick(menu.id); setMenu(null); }}
            style={menuItem}
          >
            ✎ {T('Sửa bài', 'Edit post')}
          </button>
          <button
            onClick={() => { onDelete(menu.id); setMenu(null); }}
            style={{ ...menuItem, color: '#ef4444' }}
          >
            🗑 {T('Xoá bài này', 'Delete this post')}
          </button>
        </div>
      )}
    </div>
  );
}

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
              title={`${fmtInTz(p.scheduledAt, { day: 'numeric', month: 'short', year: 'numeric' })} · ${p.message.slice(0, 80)}`}
              style={{
                position: 'relative', aspectRatio: '1 / 1', padding: 0, cursor: 'pointer',
                border: p.blockers.length ? '2px solid #f59e0b' : '1px solid var(--c1e293b)',
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
  const first = media[0];
  const name = channel === 'instagram' ? (igUsername ? `@${igUsername}` : 'instagram') : (pageName ?? 'Facebook Page');

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
            {channel === 'facebook' ? T('Được tài trợ · Trang', 'Page') : T('Bài đăng', 'Post')}
          </div>
        </div>
      </div>

      {/* Facebook puts the text above the picture, Instagram below it. Swapping
          them would preview a layout neither platform produces. */}
      {channel === 'facebook' && text && (
        <div style={{ padding: '0 11px 9px', fontSize: 13, color: 'var(--ce2e8f0)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
          {head}{cut && <span style={{ color: 'var(--c64748b)' }}>… {T('Xem thêm', 'See more')}</span>}
        </div>
      )}

      {first && (
        <div style={{
          position: 'relative', width: '100%',
          aspectRatio: channel === 'instagram' ? '1 / 1' : '1.91 / 1',
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
