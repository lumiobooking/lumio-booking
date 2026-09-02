'use client';

import { useCallback, useEffect, useState } from 'react';
import { fmtInTz } from '../lib/datetime';
import { apiFetch } from '../lib/api';
import { ui } from '../lib/ui';
import { useIsMobile } from '../lib/responsive';

/**
 * Every marketing conversation, across every salon — the team's working queue.
 *
 * WHY THIS EXISTS AT ALL
 *
 * The chat itself was easy. Keeping it ALIVE for a year is the hard part, and
 * this screen is the difference. Without it the only door into a conversation
 * is that salon's own content page, so a staff member covering forty salons
 * would have to open forty pages to find the three that wrote in. Nobody does
 * that twice. The replies stop, and a channel the client was told to use but
 * that nobody answers is worse than one that was never offered.
 *
 * SORTED BY WHO HAS WAITED LONGEST, NOT BY WHO WROTE LAST
 *
 * A newest-first list buries the message that has been ignored for three days
 * under the one that arrived this morning — and the three-day-old one is the
 * expensive one. So: waiting-on-us first, oldest wait at the top.
 */

interface Thread {
  tenantId: string;
  salonName: string;
  subject: string;
  lastMessageAt: string;
  lastSide: 'lumio' | 'salon' | null;
  assigneeName: string | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
  unread: number;
  preview: string;
  waiting: boolean;
}

interface Msg { id: string; side: 'lumio' | 'salon'; authorName: string; body: string; createdAt: string }

const SUBJECT_LABEL = (s: string): string => {
  if (s === 'general') return 'Trao đổi chung';
  if (s === 'ads') return 'Quảng cáo';
  const w = /^week:(\d{4})-W(\d{2})$/.exec(s);
  if (w) return `Kế hoạch tuần ${Number(w[2])}/${w[1]}`;
  if (s.startsWith('idea:')) return 'Một ý tưởng nội dung';
  return s;
};

/** How long it has been waiting, in the words somebody would use out loud. */
function waitedFor(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return 'vài phút trước';
  if (h < 24) return `${h} giờ trước`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'hôm qua' : `${d} ngày trước`;
}

export function ContentInbox({ token }: { token: string | null }) {
  const [filter, setFilter] = useState<'waiting' | 'open' | 'mine' | 'all'>('waiting');
  const [threads, setThreads] = useState<Thread[]>([]);
  const [waiting, setWaiting] = useState(0);
  const [open, setOpen] = useState<Thread | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const isMobile = useIsMobile(900);

  const loadList = useCallback(async () => {
    if (!token) return;
    try {
      const r = await apiFetch<{ threads: Thread[]; waiting: number }>(
        `/admin/content/inbox?filter=${filter}`, { token },
      );
      setThreads(r.threads ?? []);
      setWaiting(r.waiting ?? 0);
    } catch { setThreads([]); }
  }, [token, filter]);

  useEffect(() => { loadList(); }, [loadList]);

  // The queue must be current without anybody pressing anything, or the oldest
  // waiting message stays invisible until somebody happens to reload.
  useEffect(() => {
    if (!token) return undefined;
    const t = setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) void loadList();
    }, 30_000);
    return () => clearInterval(t);
  }, [token, loadList]);

  const openThread = async (t: Thread) => {
    setOpen(t);
    setMsgs([]);
    if (!token) return;
    try {
      const r = await apiFetch<{ messages: Msg[] }>(
        `/admin/content/inbox/${t.tenantId}?subject=${encodeURIComponent(t.subject)}`, { token },
      );
      setMsgs(r.messages ?? []);
      await loadList();
    } catch { /* an unreadable thread must not break the queue */ }
  };

  const reply = async () => {
    const body = text.trim();
    if (!body || !open || !token) return;
    setBusy(true);
    try {
      await apiFetch(`/admin/content/inbox/${open.tenantId}`, {
        method: 'POST', token, body: { subject: open.subject, body },
      });
      setText('');
      await openThread(open);
    } finally { setBusy(false); }
  };

  const setState = async (patch: { resolved?: boolean; assignToMe?: boolean }) => {
    if (!open || !token) return;
    // Closing is a STATE change, not a message. The first version posted
    // "đã xử lý xong" into the thread — which reopens it, because a reply is
    // exactly the signal that a matter was not settled. Two lines that undid
    // each other.
    await apiFetch(`/admin/content/inbox/${open.tenantId}/state`, {
      method: 'PATCH', token, body: { subject: open.subject, ...patch },
    }).catch(() => undefined);
    await loadList();
    setOpen(null);
  };

  const chip = (k: typeof filter, label: string, n?: number) => (
    <button
      key={k}
      onClick={() => { setFilter(k); setOpen(null); }}
      style={{
        padding: '6px 13px', borderRadius: 999, cursor: 'pointer', fontSize: 12.5, whiteSpace: 'nowrap',
        fontWeight: filter === k ? 700 : 500,
        border: `1px solid ${filter === k ? '#6366f1' : 'var(--c334155)'}`,
        background: filter === k ? '#6366f1' : 'transparent',
        color: filter === k ? 'var(--cf8fafc)' : 'var(--c94a3b8)',
      }}
    >
      {label}{n ? ` (${n})` : ''}
    </button>
  );

  return (
    <section style={{
      border: '1px solid var(--c334155)', borderRadius: 12, padding: 16, marginBottom: 20,
      background: 'var(--c0f172a)',
    }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
        <h2 style={{ fontSize: 17, margin: 0, color: 'var(--ce2e8f0)' }}>💬 Trao đổi với các tiệm</h2>
        {waiting > 0 && (
          <span style={{
            fontSize: 12, fontWeight: 700, padding: '2px 9px', borderRadius: 20,
            background: '#ef4444', color: 'var(--cf8fafc)',
          }}>{waiting} đang chờ mình</span>
        )}
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--c64748b)', margin: '0 0 12px', lineHeight: 1.5 }}>
        Sắp theo tiệm chờ lâu nhất, không phải theo tin mới nhất — tin bị bỏ quên ba ngày mới là tin đắt tiền.
      </p>

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 12 }}>
        {chip('waiting', 'Đang chờ mình', waiting)}
        {chip('open', 'Chưa đóng')}
        {chip('mine', 'Mình phụ trách')}
        {chip('all', 'Tất cả')}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile || open ? '1fr' : '1fr', gap: 12 }}>
        {!open && (
          <div>
            {threads.length === 0 && (
              <div style={{ fontSize: 13, color: 'var(--c64748b)', padding: '10px 2px' }}>
                Không có trao đổi nào trong mục này.
              </div>
            )}
            {threads.map((t) => (
              <button
                key={`${t.tenantId}|${t.subject}`}
                onClick={() => openThread(t)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                  padding: '11px 13px', marginBottom: 8, borderRadius: 10,
                  background: 'var(--c1e293b)',
                  border: `1px solid ${t.waiting ? '#ef4444' : 'var(--c334155)'}`,
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{t.salonName}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--ca5b4fc)' }}>{SUBJECT_LABEL(t.subject)}</span>
                  {t.unread > 0 && (
                    <span style={{
                      fontSize: 10.5, fontWeight: 700, minWidth: 18, height: 18, borderRadius: 20,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      background: '#ef4444', color: 'var(--cf8fafc)', padding: '0 5px',
                    }}>{t.unread}</span>
                  )}
                  <span style={{ fontSize: 11.5, color: 'var(--c64748b)', marginLeft: 'auto' }}>
                    {waitedFor(t.lastMessageAt)}
                  </span>
                </div>
                {t.preview && (
                  <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 4, lineHeight: 1.5 }}>
                    {t.preview}
                  </div>
                )}
                <div style={{ fontSize: 11, color: 'var(--c64748b)', marginTop: 4 }}>
                  {t.assigneeName ? `Phụ trách: ${t.assigneeName}` : 'Chưa ai nhận'}
                  {t.resolvedAt ? ' · đã đóng' : ''}
                </div>
              </button>
            ))}
          </div>
        )}

        {open && (
          <div style={{ border: '1px solid var(--c334155)', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
              background: 'var(--c1e293b)', borderBottom: '1px solid var(--c334155)',
            }}>
              <button
                onClick={() => setOpen(null)}
                style={{
                  border: '1px solid var(--c334155)', background: 'transparent', cursor: 'pointer',
                  color: 'var(--c94a3b8)', borderRadius: 8, padding: '4px 10px', fontSize: 12.5,
                }}
              >← Danh sách</button>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{open.salonName}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ca5b4fc)' }}>{SUBJECT_LABEL(open.subject)}</div>
              </div>
              <button
                onClick={() => setState({ resolved: !open.resolvedAt })}
                style={{
                  marginLeft: 'auto', cursor: 'pointer', borderRadius: 8, padding: '5px 11px',
                  fontSize: 12.5, fontWeight: 600,
                  border: '1px solid #22c55e', background: 'transparent', color: '#22c55e',
                }}
              >{open.resolvedAt ? 'Mở lại' : '✓ Đóng'}</button>
            </div>

            <div style={{ maxHeight: 380, overflowY: 'auto', padding: '12px 14px' }}>
              {msgs.length === 0 && (
                <div style={{ fontSize: 12.5, color: 'var(--c64748b)' }}>Chưa có tin nhắn.</div>
              )}
              {msgs.map((m) => {
                const mine = m.side === 'lumio';
                return (
                  <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
                    <div style={{ maxWidth: '85%' }}>
                      <div style={{ fontSize: 10.5, color: 'var(--c64748b)', marginBottom: 2, textAlign: mine ? 'right' : 'left' }}>
                        {m.authorName} · {fmtInTz(m.createdAt, { dateStyle: 'short', timeStyle: 'short' })}
                      </div>
                      <div style={{
                        fontSize: 13.5, lineHeight: 1.55, padding: '8px 11px', borderRadius: 12,
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        background: mine ? '#6366f1' : 'var(--c1e293b)',
                        color: mine ? 'var(--cf8fafc)' : 'var(--ce2e8f0)',
                        border: mine ? 'none' : '1px solid var(--c334155)',
                      }}>{m.body}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: 8, padding: 10, borderTop: '1px solid var(--c334155)' }}>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void reply(); } }}
                rows={1}
                placeholder={`Trả lời ${open.salonName}…`}
                style={{ ...ui.input, flex: 1, resize: 'none', minHeight: 38, maxHeight: 120, boxSizing: 'border-box' }}
              />
              <button
                onClick={reply}
                disabled={busy || !text.trim()}
                style={{ ...ui.primaryBtn, minWidth: 56, opacity: busy || !text.trim() ? 0.5 : 1 }}
              >↑</button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
