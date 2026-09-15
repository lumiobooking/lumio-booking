'use client';

import { useEffect, type ReactNode } from 'react';
import { instantToWall } from '../lib/datetime';
import { useIsMobile } from '../lib/responsive';

/**
 * ONE POST, IN FULL, WITHOUT LEAVING THE CALENDAR.
 *
 * Tapping a post on the schedule used to open the composer — the editing
 * form, scrolled to wherever it last was, with the picture somewhere below
 * the fold and the state of the post (did it go out? where? what failed?)
 * nowhere at all. To check a post you had to be willing to edit it.
 *
 * This is the reading view: the picture large on one side, everything known
 * about the post on the other, sized to the viewport so nothing needs
 * scrolling to be seen. Editing is one of the buttons, not the door.
 */

export interface DetailPost {
  id: string;
  channels: string[];
  message: string;
  media: { url: string; kind: string }[];
  scheduledAt: string;
  status: string;
  stage?: string | null;
  lastError?: string | null;
  fix?: string | null;
  /** Due, not sent, no error: why. */
  waiting?: { vi: string; en: string } | null;
  results?: { channel: string; id: string | null; url: string | null; error: string | null }[];
  postedAt?: string | null;
  writerName?: string | null;
  designerName?: string | null;
  teamNote?: string | null;
  createdByName?: string | null;
  held?: { at: string; by: string | null; note: string | null } | null;
  mediaPurged?: boolean;
  google?: { button: string; url: string | null } | null;
}

const CH_NAME: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', google: 'Google Business', tiktok: 'TikTok' };
const CH_COLOR: Record<string, string> = { facebook: '#1877f2', instagram: '#e1306c', google: '#34a853', tiktok: '#69c9d0' };

const STATUS: Record<string, { vi: string; en: string; ink: string }> = {
  draft: { vi: 'Nháp', en: 'Draft', ink: 'var(--c94a3b8)' },
  scheduled: { vi: 'Đã lên lịch', en: 'Scheduled', ink: 'var(--ink-link)' },
  publishing: { vi: 'Đang đăng', en: 'Publishing', ink: 'var(--ink-sky)' },
  posted: { vi: 'Đã đăng', en: 'Posted', ink: 'var(--ink-good)' },
  failed: { vi: 'Lỗi', en: 'Failed', ink: 'var(--ink-bad)' },
  expired: { vi: 'Quá hạn', en: 'Expired', ink: 'var(--ink-warn)' },
  cancelled: { vi: 'Đã huỷ', en: 'Cancelled', ink: 'var(--c64748b)' },
};
const STAGE: Record<string, { vi: string; en: string }> = {
  writing: { vi: 'Đang viết', en: 'Writing' }, design: { vi: 'Đang thiết kế', en: 'Design' }, ready: { vi: 'Sẵn sàng', en: 'Ready' },
};

const fmtWall = (w: string, vi: boolean) => {
  // "YYYY-MM-DDTHH:mm" → "T3 16/09 · 10:00"
  const [d, t] = w.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
  const WD = vi ? ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${WD[wd]} ${String(day).padStart(2, '0')}/${String(m).padStart(2, '0')} · ${t}`;
};

export function PostDetailModal({
  post, vi, salonTz, onClose, onEdit, onPublish, onCancel, busy,
}: {
  post: DetailPost;
  vi: boolean;
  salonTz: string;
  onClose: () => void;
  onEdit: () => void;
  onPublish?: (() => void) | null;
  onCancel?: (() => void) | null;
  busy?: boolean;
}) {
  const T = (a: string, b: string) => (vi ? a : b);
  const mobile = useIsMobile(760);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const viewerTz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';
  const salonWall = instantToWall(post.scheduledAt, salonTz);
  const viewerWall = instantToWall(post.scheduledAt, viewerTz);
  const sameZone = !salonTz || salonTz === viewerTz;
  const st = STATUS[post.status] ?? STATUS.draft;
  const cover = post.media?.[0] ?? null;
  const others = (post.media ?? []).slice(1);
  const live = post.status === 'posted' || post.status === 'publishing';

  const Row = ({ k, v }: { k: string; v: ReactNode }) => (
    <div style={{ display: 'grid', gridTemplateColumns: '112px 1fr', gap: 8, fontSize: 12.5, lineHeight: 1.5 }}>
      <span style={{ color: 'var(--ink-faint)', fontSize: 11, letterSpacing: .4, textTransform: 'uppercase', fontWeight: 700, paddingTop: 2 }}>{k}</span>
      <span style={{ color: 'var(--ccbd5e1)', minWidth: 0, wordBreak: 'break-word' }}>{v}</span>
    </div>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(2,6,23,.72)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: mobile ? 8 : 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(1040px, 100%)', maxHeight: '94vh', borderRadius: 16, overflow: 'hidden',
          background: 'var(--c0f172a)', border: '1px solid var(--c334155)', boxShadow: '0 30px 80px -20px rgba(0,0,0,.6)',
          display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'minmax(0, 5fr) minmax(0, 6fr)', gridTemplateRows: mobile ? 'auto 1fr' : '1fr',
        }}
      >
        {/* The picture, as big as the box allows. It is what the customer will
            see; it is the first thing the person checking should see too. */}
        <div style={{ background: 'var(--c0f172a)', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: mobile ? 200 : 360, maxHeight: mobile ? '38vh' : '94vh', position: 'relative' }}>
          {post.mediaPurged ? (
            <div style={{ color: 'var(--c64748b)', fontSize: 12.5, textAlign: 'center', padding: 20 }}>{T('File đã được dọn sau khi đăng — bài trên trang vẫn còn.', 'Files were cleaned up after publishing — the post itself is still live.')}</div>
          ) : cover ? (
            cover.kind === 'video'
              ? <video src={cover.url} controls style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              : <img src={cover.url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          ) : (
            <div style={{ padding: 24, color: 'var(--c94a3b8)', fontSize: 13, textAlign: 'center' }}>{T('Bài chỉ có chữ, không có hình.', 'Text-only post, no media.')}</div>
          )}
          {others.length > 0 && (
            <div style={{ position: 'absolute', bottom: 8, left: 8, display: 'flex', gap: 4 }}>
              {others.slice(0, 6).map((m, i) => (
                <div key={i} style={{ width: 40, height: 40, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--c334155)', background: 'var(--c1e293b)' }}>
                  {m.kind === 'video' ? <div style={{ fontSize: 16, textAlign: 'center', lineHeight: '40px' }}>🎬</div> : <img src={m.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                </div>
              ))}
              {others.length > 6 && <div style={{ fontSize: 11, color: 'var(--ccbd5e1)', alignSelf: 'center' }}>+{others.length - 6}</div>}
            </div>
          )}
        </div>

        {/* Everything known, in the order a person checks it: when, where,
            what state, then the words, then who touched it. */}
        <div style={{ padding: mobile ? '12px 14px 14px' : '16px 18px 18px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: .5, textTransform: 'uppercase', color: st.ink, padding: '3px 9px', borderRadius: 20, border: `1px solid ${'var(--c334155)'}` }}>{vi ? st.vi : st.en}</span>
            {post.stage && !live && <span style={{ fontSize: 11, color: 'var(--c94a3b8)' }}>{vi ? STAGE[post.stage]?.vi : STAGE[post.stage]?.en}</span>}
            {post.held && <span style={{ fontSize: 11, color: 'var(--ink-bad)', fontWeight: 700 }}>🔴 {T('Tiệm đang chờ trả lời', 'Client is waiting')}</span>}
            <button type="button" onClick={onClose} aria-label="close" style={{ marginLeft: 'auto', width: 30, height: 30, borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--c94a3b8)', cursor: 'pointer', fontSize: 16, fontFamily: 'inherit' }}>×</button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--cf1f5f9)', lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}>{fmtWall(salonWall, vi)}</div>
            <div style={{ fontSize: 11.5, color: 'var(--c94a3b8)' }}>
              {T('giờ tiệm', 'salon time')}{salonTz ? ` · ${salonTz}` : ''}
              {!sameZone && <> · <span style={{ color: 'var(--ccbd5e1)' }}>{fmtWall(viewerWall, vi)}</span> {T('giờ máy anh', 'your time')}</>}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {post.channels.map((c) => (
              <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: 'var(--ccbd5e1)', padding: '3px 9px', borderRadius: 20, background: 'var(--c1e293b)' }}>
                <i style={{ width: 8, height: 8, borderRadius: '50%', background: CH_COLOR[c] ?? '#94a3b8', display: 'inline-block' }} />{CH_NAME[c] ?? c}
              </span>
            ))}
            {post.channels.includes('google') && post.google && (
              <span style={{ fontSize: 11.5, color: 'var(--c94a3b8)', alignSelf: 'center' }}>
                {T('nút', 'button')}: {post.google.button === 'none' ? T('không', 'none') : post.google.button}
              </span>
            )}
          </div>

          {/* The caption: the only thing allowed to scroll, inside its own box,
              so a long one cannot push the buttons off the screen. */}
          <div style={{ flex: '1 1 auto', minHeight: 60, maxHeight: mobile ? 140 : 300, overflowY: 'auto', padding: '10px 12px', borderRadius: 10, background: 'var(--c1e293b)', border: '1px solid var(--c334155)', fontSize: 13.5, lineHeight: 1.6, color: 'var(--ce2e8f0)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {post.message}
          </div>

          <div style={{ display: 'grid', gap: 5 }}>
            {post.status === 'posted' && (post.results ?? []).filter((r) => r.url).length > 0 && (
              <Row k={T('Đã lên', 'Live at')} v={(post.results ?? []).filter((r) => r.url).map((r) => (
                <a key={r.channel} href={r.url!} target="_blank" rel="noreferrer" style={{ color: 'var(--ink-link)', marginRight: 10 }}>{CH_NAME[r.channel] ?? r.channel} ↗</a>
              ))} />
            )}
            {post.status === 'failed' && (post.fix || post.lastError) && (
              <Row k={T('Lỗi', 'Error')} v={<span style={{ color: 'var(--ink-bad)' }}>{post.fix ?? post.lastError}</span>} />
            )}
            {post.status === 'scheduled' && post.waiting && (
              <Row k={T('Đang chờ', 'Waiting')} v={<span style={{ color: 'var(--ink-warn)' }}>⏳ {vi ? post.waiting.vi : post.waiting.en}</span>} />
            )}
            {post.status === 'scheduled' && post.lastError && (
              <Row k={T('Lần thử trước', 'Last try')} v={<span style={{ color: 'var(--ink-bad)' }}>{post.fix ?? post.lastError}</span>} />
            )}
            {(post.writerName || post.designerName) && (
              <Row k={T('Người làm', 'Team')} v={[post.writerName && `✍️ ${post.writerName}`, post.designerName && `🎨 ${post.designerName}`].filter(Boolean).join(' · ')} />
            )}
            {post.teamNote && <Row k={T('Ghi chú', 'Note')} v={post.teamNote} />}
            {post.held?.note && <Row k={T('Tiệm nhắn', 'Client')} v={<span style={{ color: 'var(--ink-warn)' }}>{post.held.note}</span>} />}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 'auto', paddingTop: 4 }}>
            {!live && (
              <button type="button" onClick={onEdit} disabled={busy} style={{ minHeight: 38, padding: '0 16px', borderRadius: 9, border: 'none', background: '#6366f1', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                ✏️ {T('Sửa bài', 'Edit')}
              </button>
            )}
            {onPublish && !live && post.status !== 'cancelled' && (
              <button type="button" onClick={onPublish} disabled={busy} style={{ minHeight: 38, padding: '0 14px', borderRadius: 9, border: '1px solid #22c55e', background: 'rgba(34,197,94,.14)', color: 'var(--ink-good)', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                🚀 {T('Đăng ngay', 'Post now')}
              </button>
            )}
            {onCancel && !live && post.status !== 'cancelled' && (
              <button type="button" onClick={onCancel} disabled={busy} style={{ minHeight: 38, padding: '0 14px', borderRadius: 9, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ink-bad)', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                {T('Huỷ bài', 'Cancel post')}
              </button>
            )}
            <button type="button" onClick={onClose} style={{ marginLeft: 'auto', minHeight: 38, padding: '0 14px', borderRadius: 9, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--c94a3b8)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
              {T('Đóng', 'Close')} <span style={{ fontSize: 10, opacity: .7 }}>Esc</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
