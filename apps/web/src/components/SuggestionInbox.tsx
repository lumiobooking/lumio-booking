'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

/**
 * The team's half of the loop: what the shop actually sent back.
 *
 * WHY IT WAS MISSING AND WHY THAT MATTERED
 *
 * A staff member picked a trend and sent it. The shop filmed it, pressed send,
 * and the files landed in a database column with nothing pointing at them.
 * Every part of the chain existed except the one where somebody sits down to
 * make the post — which is the part the whole feature was for. Footage that
 * arrives and is never opened is worse than footage that never arrives: the
 * shop did the work, and next week it will notice nothing came of it.
 *
 * WHERE IT LIVES
 *
 * At the top of the posting queue, not on a screen of its own. That is where a
 * staff member already goes to build a post, and the one action that matters
 * here — turn these files into a post — hands straight to the composer below
 * it with the media already attached. A separate inbox would be one more place
 * to remember to check.
 *
 * WHAT KEEPS IT SHORT
 *
 * Only cards WAITING ON THE TEAM are open by default: the shop has done its
 * part and nobody has made a post yet. Making the post files the card away.
 * An inbox that only grows is one nobody reads by the third week.
 */

export interface TeamSuggestion {
  id: string;
  title: string;
  note: string | null;
  refUrl: string | null;
  refThumbUrl: string | null;
  sourceUrl: string | null;
  sourceLabel: string | null;
  createdByName: string | null;
  /** The shop opened this card itself — sent files nobody asked for. */
  fromShop?: boolean;
  createdAt: string;
  status: 'sent' | 'done' | 'skipped' | 'used';
  doneAt: string | null;
  media: { url: string; kind: 'image' | 'video'; driveUrl?: string }[];
}
export interface TeamFeed {
  /** The salon's folder in the Drive archive, when the archive is on. */
  driveFolderUrl?: string | null;
  ready: TeamSuggestion[];
  waitingOnShop: TeamSuggestion[];
  recent: TeamSuggestion[];
  readyCount: number;
}

export function SuggestionInbox({
  token, vi, onCount, onMakePost,
}: {
  token: string | null;
  vi: boolean;
  /** How many are waiting on the team, for the tab badge. */
  onCount?: (n: number) => void;
  /** Open the composer with these files already attached. */
  onMakePost: (s: TeamSuggestion) => void;
}) {
  const T = (v: string, e: string) => (vi ? v : e);
  const [feed, setFeed] = useState<TeamFeed | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const r = await apiFetch<TeamFeed>('/content/suggestions/team', { token }).catch(() => null);
    if (r) { setFeed(r); onCount?.(r.readyCount ?? 0); }
  }, [token, onCount]);
  useEffect(() => { load(); }, [load]);

  async function markUsed(id: string) {
    if (!token) return;
    setBusy(id);
    try {
      await apiFetch(`/content/suggestions/${id}/used`, { method: 'POST', token });
      await load();
    } finally { setBusy(null); }
  }

  if (!feed) return null;
  const nothing = !feed.ready.length && !feed.waitingOnShop.length;
  if (nothing) return null;

  return (
    <div style={{
      background: 'var(--c1e293b)', border: `1px solid ${feed.ready.length ? '#22c55e' : 'var(--c334155)'}`,
      borderRadius: 12, padding: 14, marginBottom: 14,
    }}>
      <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap', marginBottom: 3 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)' }}>
          📨 {T('Đề xuất đã gửi tiệm', 'Sent to the shop')}
        </div>
        {feed.ready.length > 0 && (
          <span style={{
            fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
            background: '#14532d', border: '1px solid #22c55e', color: '#86efac',
          }}>
            {feed.ready.length} {T('tiệm đã gửi file — chờ mình dựng', 'with files, waiting on us')}
          </span>
        )}
        {feed.driveFolderUrl && (
          <a href={feed.driveFolderUrl} target="_blank" rel="noopener noreferrer" style={{
            marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: 'var(--ca5b4fc)', textDecoration: 'none',
          }}>
            📁 {T('Folder Drive của tiệm', 'Shop’s Drive folder')} →
          </a>
        )}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--c64748b)', lineHeight: 1.55, marginBottom: 10 }}>
        {T('Tiệm quay xong và bấm gửi ngay trên thẻ đề xuất, nên file nằm cạnh đúng việc đã hỏi.',
           'The shop sends the files on the suggestion card itself, so the footage sits beside the request it answers.')}
      </div>

      {feed.ready.map((s) => (
        <div key={s.id} style={{
          padding: '11px 12px', borderRadius: 10, marginBottom: 8,
          background: 'var(--c0f172a)', border: '1px solid #166534',
        }}>
          <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
            {s.refThumbUrl && (
              <a href={s.refUrl ?? s.refThumbUrl} target="_blank" rel="noopener noreferrer"
                title={T('Mẫu đã gửi tiệm', 'The reference the shop got')}
                style={{
                  width: 46, height: 46, borderRadius: 7, overflow: 'hidden', flex: '0 0 auto',
                  border: '1px solid var(--c334155)', display: 'block',
                }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.refThumbUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </a>
            )}
            <div style={{ minWidth: 0 }}>
              {s.fromShop && (
                <span style={{
                  display: 'inline-block', fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase',
                  color: '#fde68a', background: 'rgba(245,158,11,.14)', border: '1px solid rgba(245,158,11,.5)',
                  borderRadius: 6, padding: '1px 7px', marginBottom: 3,
                }}>📤 {T('Tiệm tự gửi', 'Sent by the shop')}</span>
              )}
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ce2e8f0)', lineHeight: 1.45 }}>{s.title}</div>
              {s.fromShop && s.note && (
                <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.5, marginTop: 2 }}>{s.note}</div>
              )}
            </div>
          </div>
          {s.sourceLabel && (
            // The team's own note about where it came from. This never reaches
            // the salon's payload — see the API's client-view.
            <div style={{ fontSize: 11, color: 'var(--c64748b)', marginTop: 2 }}>
              {T('nguồn', 'from')}: {s.sourceUrl
                ? <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--c818cf8)' }}>{s.sourceLabel}</a>
                : s.sourceLabel}
              {s.createdByName ? ` · ${s.createdByName}` : ''}
            </div>
          )}

          {!!s.media.length && (
            <div style={{ display: 'flex', gap: 6, marginTop: 9, flexWrap: 'wrap' }}>
              {s.media.map((m, i) => (
                <a
                  key={i} href={m.url} target="_blank" rel="noopener noreferrer"
                  title={T('Mở file gốc', 'Open the original')}
                  style={{
                    width: 62, height: 62, borderRadius: 8, overflow: 'hidden', position: 'relative',
                    border: '1px solid var(--c334155)', display: 'block', flex: '0 0 auto',
                    background: 'var(--c1e293b)',
                  }}
                >
                  {m.kind === 'video'
                    // eslint-disable-next-line jsx-a11y/media-has-caption
                    ? <video src={m.url} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    // eslint-disable-next-line @next/next/no-img-element
                    : <img src={m.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                  {/* A small corner mark once the archive copy exists. Its
                      absence is information too: the copy has not happened yet
                      and the sweep will get to it. */}
                  {m.driveUrl && (
                    <span title="Đã lưu lên Google Drive" style={{
                      position: 'absolute', right: 3, bottom: 3, fontSize: 10, lineHeight: 1,
                      background: 'rgba(0,0,0,.6)', color: '#fff', borderRadius: 4, padding: '2px 3px',
                    }}>📁</span>
                  )}
                </a>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 7, marginTop: 10, flexWrap: 'wrap' }}>
            <button
              onClick={() => onMakePost(s)}
              style={{
                minHeight: 36, padding: '8px 13px', borderRadius: 9, cursor: 'pointer',
                border: 'none', background: '#22c55e', color: '#052e16', fontSize: 12.5, fontWeight: 700,
              }}
            >
              ✎ {T('Dựng bài từ file này', 'Make a post from these')}
            </button>
            <button
              onClick={() => markUsed(s.id)}
              disabled={busy === s.id}
              style={{
                minHeight: 36, padding: '8px 13px', borderRadius: 9, cursor: 'pointer',
                border: '1px solid var(--c475569)', background: 'transparent',
                color: 'var(--c94a3b8)', fontSize: 12.5, fontWeight: 600,
              }}
            >
              {busy === s.id ? '…' : T('Cất đi — đã xử lý', 'File it — handled')}
            </button>
          </div>
        </div>
      ))}

      {!!feed.waitingOnShop.length && (
        <div style={{ marginTop: feed.ready.length ? 10 : 0, paddingTop: 9, borderTop: '1px solid var(--c334155)' }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.5px', color: 'var(--c64748b)', marginBottom: 5 }}>
            {T('ĐANG CHỜ TIỆM', 'WAITING ON THE SHOP')}
          </div>
          {feed.waitingOnShop.map((s) => (
            <div key={s.id} style={{ display: 'flex', gap: 8, padding: '4px 0', alignItems: 'baseline' }}>
              <span style={{ color: 'var(--c475569)', flex: '0 0 auto' }}>·</span>
              <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.45 }}>
                {s.title}
                <span style={{ color: 'var(--c475569)' }}> — {ago(s.createdAt, vi)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** How long ago, in the words somebody would use out loud. */
function ago(iso: string, vi: boolean): string {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return vi ? 'vừa gửi' : 'just now';
  if (h < 24) return vi ? `${h} giờ trước` : `${h}h ago`;
  const d = Math.floor(h / 24);
  return vi ? `${d} ngày trước` : `${d}d ago`;
}
