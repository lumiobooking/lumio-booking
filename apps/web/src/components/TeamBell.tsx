'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import { fresh } from '../lib/live';

/**
 * The team's bell on the agency list.
 *
 * Every note a shop leaves — under a post on their approve screen, in the
 * general thread, on the week plan, a file they sent — used to be found only
 * by opening that salon. This is the one place they all land, across every
 * salon, newest first, and every row is a link into the exact post or thread
 * inside that shop's session. Answering or resolving the thread takes the
 * row away, so the count is "things still waiting on us", not "things ever".
 */
export interface TeamNotice {
  id: string;
  kind: 'post' | 'chat' | 'ads' | 'week' | 'idea' | 'files';
  tenantId: string;
  salon: string;
  slug: string;
  title: string;
  when: string | null;
  held: boolean;
  preview: string;
  who: string | null;
  unread: number;
  at: string;
  assigneeName: string | null;
  link: string;
}

const KIND: Record<TeamNotice['kind'], { icon: string; label: string }> = {
  post: { icon: '✏️', label: 'góp ý bài' },
  chat: { icon: '💬', label: 'nhắn Lumio' },
  ads: { icon: '📣', label: 'quảng cáo' },
  week: { icon: '📅', label: 'kế hoạch tuần' },
  idea: { icon: '💡', label: 'ý tưởng' },
  files: { icon: '📤', label: 'gửi file' },
};

function ago(iso: string): string {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (m < 1) return 'vừa xong';
  if (m < 60) return `${m} phút`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} giờ`;
  return `${Math.round(h / 24)} ngày`;
}

export function TeamBell({ token, onOpen, busy }: {
  token: string | null;
  /** Step into the salon and land on `link`. */
  onOpen: (n: TeamNotice) => void;
  busy?: boolean;
}) {
  const [items, setItems] = useState<TeamNotice[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    const pull = () => apiFetch<{ count: number; items: TeamNotice[] }>(fresh('/support/notifications'), { token })
      .then((r) => { if (alive) setItems(r.items ?? []); })
      .catch(() => undefined);
    pull();
    const t = setInterval(() => { if (document.visibilityState === 'visible') pull(); }, 60_000);
    const onVis = () => { if (document.visibilityState === 'visible') pull(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [token]);

  // Click outside closes; Escape too.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const n = items.length;

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={n ? `${n} tiệm đang chờ trả lời` : 'Không có gì chờ'}
        title={n ? `${n} góp ý / tin nhắn chưa trả lời` : 'Không có gì chờ'}
        style={{
          position: 'relative', width: 40, height: 40, borderRadius: 12, cursor: 'pointer',
          border: `1px solid ${n ? '#ef4444' : 'var(--c334155)'}`,
          background: n ? 'rgba(239,68,68,.12)' : 'transparent',
          display: 'grid', placeItems: 'center',
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={n ? '#fca5a5' : 'var(--c94a3b8)'} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {n > 0 && (
          <span style={{
            position: 'absolute', top: -6, right: -6, minWidth: 20, height: 20, borderRadius: 20, padding: '0 6px',
            background: '#ef4444', color: '#fff', fontSize: 11.5, fontWeight: 800, display: 'grid', placeItems: 'center',
            boxShadow: '0 0 0 2px var(--c0b1120)',
          }}>{n > 99 ? '99+' : n}</span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 46, width: 'min(420px, calc(100vw - 32px))', zIndex: 70,
          background: 'var(--c111827)', border: '1px solid var(--c334155)', borderRadius: 14,
          boxShadow: '0 18px 48px rgba(0,0,0,.55)', overflow: 'hidden',
        }}>
          <div style={{ padding: '11px 14px', borderBottom: '1px solid var(--c1f2937)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 800, fontSize: 14 }}>Tiệm đang chờ trả lời</span>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--c64748b)' }}>{n ? `${n} mục` : 'Trống'}</span>
          </div>
          <div style={{ maxHeight: 'min(520px, 70vh)', overflowY: 'auto' }}>
            {n === 0 && (
              <div style={{ padding: '22px 14px', fontSize: 13, color: 'var(--c64748b)', textAlign: 'center' }}>
                Không có góp ý hay tin nhắn nào đang chờ. Mọi thứ tiệm viết đã được trả lời.
              </div>
            )}
            {items.map((it) => {
              const k = KIND[it.kind] ?? KIND.chat;
              return (
                <button
                  key={it.id}
                  disabled={busy}
                  onClick={() => { setOpen(false); onOpen(it); }}
                  style={{
                    display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr) auto', gap: 10, alignItems: 'start',
                    width: '100%', textAlign: 'left', padding: '10px 14px', cursor: busy ? 'wait' : 'pointer',
                    background: 'transparent', border: 'none', borderTop: '1px solid var(--c1f2937)', color: 'inherit',
                  }}
                >
                  <span style={{ fontSize: 18, lineHeight: '22px' }}>{k.icon}</span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13.5, fontWeight: 800, color: 'var(--cf1f5f9)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {it.salon} <span style={{ fontWeight: 600, color: it.held ? 'var(--ink-bad)' : 'var(--c94a3b8)' }}>· {it.held ? 'yêu cầu sửa bài' : k.label}</span>
                    </span>
                    <span style={{ display: 'block', fontSize: 12.5, color: 'var(--ccbd5e1)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {it.kind === 'post' ? `“${it.title}”` : it.title}
                    </span>
                    {it.preview && (
                      <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 2, lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                        {it.who ? `${it.who}: ` : ''}{it.preview}
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize: 11.5, color: 'var(--c64748b)', whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {ago(it.at)}
                    {it.unread > 1 && <span style={{ display: 'block', color: 'var(--ink-bad)', fontWeight: 800 }}>{it.unread} tin</span>}
                    <span style={{ display: 'block', color: 'var(--ink-link)', fontWeight: 800, marginTop: 2 }}>Mở →</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
