'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import { ui } from '../lib/ui';
import { useIsMobile } from '../lib/responsive';

/**
 * The conversation between the Lumio team and the salon, about the work.
 *
 * THREE SHAPES, ONE THREAD ENGINE
 *
 *   ItemComments   — the comments under one item: an idea, a week, the ad plan.
 *   TeamChatDock   — the shared thread, docked in the sidebar on a desktop.
 *   TeamChatWindow — the same shared thread on a phone, as a full-screen sheet.
 *
 * They share useThread, because they are one conversation with three addresses.
 * Separate implementations would drift, and the drift always lands on the phone.
 *
 * WHY THE DESKTOP ONE IS DOCKED, NOT FLOATING
 *
 * A floating bubble was the first attempt and it was the wrong shape. The point
 * of the shared window is working THROUGH the plan together — read a line on
 * the left, say something about it on the right. A bubble has to be opened, and
 * once open it covers the very thing being discussed. Docked into the sidebar
 * column it is always visible, needs no click before typing, and the plan stays
 * readable beside it.
 *
 * AND WHY THE PHONE ONE IS NOT
 *
 * At 375px there is no sidebar to dock into, and a chat pinned into a corner of
 * that screen is a chat nobody types in — which matters most here, because the
 * phone is where the owner writes, standing in the salon. So: a sheet that
 * fills the screen, a send button big enough for a thumb, the newest message in
 * view without scrolling, and a composer clear of the on-screen keyboard.
 */

export interface ChatMessage {
  id: string;
  side: 'lumio' | 'salon';
  authorName: string;
  body: string;
  createdAt: string;
}

const timeOf = (iso: string) => {
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch { return ''; }
};

function Bubbles({ messages, mine, empty }: {
  messages: ChatMessage[]; mine: 'lumio' | 'salon'; empty: string;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages.length]);

  if (!messages.length) {
    return <div style={{ fontSize: 12.5, color: 'var(--c64748b)', padding: '10px 2px', lineHeight: 1.5 }}>{empty}</div>;
  }
  return (
    <>
      {messages.map((m) => {
        const isMine = m.side === mine;
        return (
          <div key={m.id} style={{ display: 'flex', justifyContent: isMine ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
            <div style={{ maxWidth: '85%' }}>
              <div style={{
                fontSize: 10.5, color: 'var(--c64748b)', marginBottom: 2,
                textAlign: isMine ? 'right' : 'left',
              }}>
                {m.authorName} · {timeOf(m.createdAt)}
              </div>
              <div style={{
                fontSize: 13.5, lineHeight: 1.55, padding: '8px 11px', borderRadius: 12,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                // The two sides must be told apart at a glance, and the colours
                // are tokens so they survive light mode.
                background: isMine ? '#6366f1' : 'var(--c1e293b)',
                color: isMine ? 'var(--cf8fafc)' : 'var(--ce2e8f0)',
                border: isMine ? 'none' : '1px solid var(--c334155)',
                borderBottomRightRadius: isMine ? 3 : 12,
                borderBottomLeftRadius: isMine ? 12 : 3,
              }}>{m.body}</div>
            </div>
          </div>
        );
      })}
      <div ref={endRef} />
    </>
  );
}

function Composer({ onSend, sending, placeholder, big }: {
  onSend: (t: string) => void; sending: boolean; placeholder: string; big: boolean;
}) {
  const [text, setText] = useState('');
  const submit = () => {
    const t = text.trim();
    if (!t || sending) return;
    onSend(t);
    setText('');
  };
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter sends on a desktop keyboard; Shift+Enter is a new line. On a
          // phone Enter must NOT send — the return key is how people write a
          // second sentence, and a message that fires halfway is worse than one
          // that takes an extra tap.
          if (e.key === 'Enter' && !e.shiftKey && !big) { e.preventDefault(); submit(); }
        }}
        rows={big ? 2 : 1}
        placeholder={placeholder}
        style={{
          ...ui.input, flex: 1, resize: 'none', minHeight: big ? 44 : 38,
          maxHeight: 120, boxSizing: 'border-box', fontSize: 14,
        }}
      />
      <button
        onClick={submit}
        disabled={sending || !text.trim()}
        style={{
          ...ui.primaryBtn,
          // A thumb needs 44px. Anything smaller gets missed on a phone.
          minWidth: 56, minHeight: big ? 44 : 38, padding: '0 14px',
          opacity: sending || !text.trim() ? 0.5 : 1,
        }}
      >↑</button>
    </div>
  );
}

/**
 * Who is on the other end, from the reader's side.
 *
 * The first version said "Talk to Lumio · Internal — customers never see this"
 * to everybody, and both halves were wrong. "Internal" reads as "inside my own
 * company", when this is a staff member talking to a CLIENT — the salon. And
 * the salon does not want a label naming itself; it wants to know it is talking
 * to the people who run its marketing.
 *
 * So the header names the OTHER side: the salon sees its marketing team, the
 * team sees the salon.
 */
function counterpart(side: 'lumio' | 'salon', salonName: string | undefined, vi: boolean): {
  title: string; sub: string;
} {
  if (side === 'lumio') {
    return {
      title: salonName || (vi ? 'Tiệm' : 'The salon'),
      sub: vi ? 'Trao đổi công việc với tiệm' : 'Working thread with this salon',
    };
  }
  return {
    title: vi ? 'Đội marketing' : 'Your marketing team',
    sub: vi
      ? 'Riêng giữa tiệm và đội marketing — khách của tiệm không thấy'
      : 'Between you and your marketing team — your customers never see this',
  };
}

/** Shared by both shapes: load a thread, send into it, keep it fresh. */
function useThread(token: string | null, subject: string, open: boolean) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [side, setSide] = useState<'lumio' | 'salon'>('salon');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!token || !open) return;
    try {
      const r = await apiFetch<{ side: 'lumio' | 'salon'; messages: ChatMessage[] }>(
        `/content/chat?subject=${encodeURIComponent(subject)}`, { token },
      );
      setMessages(r.messages ?? []);
      setSide(r.side);
    } catch { /* a thread that will not load must not break the page under it */ }
  }, [token, subject, open]);

  useEffect(() => { load(); }, [load]);

  // A reply should arrive without anybody pressing refresh. Twenty seconds is
  // slow enough to be free and fast enough that a conversation feels live; the
  // tab is skipped while hidden so a forgotten window costs nothing.
  useEffect(() => {
    if (!token || !open) return undefined;
    const t = setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) void load();
    }, 20_000);
    return () => clearInterval(t);
  }, [token, open, load]);

  const send = async (body: string) => {
    if (!token) return;
    setSending(true);
    try {
      await apiFetch('/content/chat', { method: 'POST', token, body: { subject, body } });
      await load();
    } finally { setSending(false); }
  };

  return { messages, side, sending, send, reload: load };
}

/** The comment thread under one item. Collapsed until asked for. */
export function ItemComments({ token, subject, unread, labelVi, vi }: {
  token: string | null; subject: string; unread?: number; labelVi?: string; vi: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { messages, side, sending, send } = useThread(token, subject, open);
  const count = open ? messages.length : (unread ?? 0);

  return (
    <div style={{ marginTop: 8 }}>
      {/* Big enough to see and to press.
          The first version was a 12px grey pill that read "Discuss" — on a busy
          card it disappeared entirely, and a comment box nobody notices is a
          comment box nobody uses. It is now a full-width bar in the accent
          colour, 40px tall, and it says what it will show. */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%', minHeight: 40, padding: '9px 13px', borderRadius: 10,
          cursor: 'pointer', fontSize: 13.5, fontWeight: 600, textAlign: 'left',
          border: `1px solid ${unread ? '#ef4444' : '#6366f1'}`,
          background: open ? '#6366f1' : 'var(--c1e1b4b)',
          color: open ? 'var(--cf8fafc)' : 'var(--ca5b4fc)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}
      >
        <span style={{ fontSize: 15 }}>💬</span>
        <span style={{ flex: 1 }}>
          {labelVi ?? (vi ? 'Trao đổi về mục này' : 'Discuss this')}
          {!open && count > 0 && (
            <span style={{ fontWeight: 400, opacity: 0.85 }}>
              {' · '}{count} {vi ? 'tin' : count === 1 ? 'message' : 'messages'}
            </span>
          )}
        </span>
        {!!unread && (
          <span style={{
            fontSize: 11, fontWeight: 700, minWidth: 20, height: 20, borderRadius: 20,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: '#ef4444', color: 'var(--cf8fafc)', padding: '0 6px',
          }}>{unread}</span>
        )}
        <span style={{ fontSize: 12, opacity: 0.7 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{
          marginTop: 8, padding: 12, borderRadius: 10,
          background: 'var(--c0f172a)', border: '1px solid #6366f1',
        }}>
          <div style={{ minHeight: 150, maxHeight: 420, overflowY: 'auto', marginBottom: 10 }}>
            <Bubbles
              messages={messages}
              mine={side}
              empty={vi ? 'Chưa có trao đổi nào về mục này.' : 'Nothing discussed here yet.'}
            />
          </div>
          <Composer
            onSend={send}
            sending={sending}
            big={false}
            placeholder={vi ? 'Viết trao đổi về mục này…' : 'Comment on this item…'}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The shared thread, DOCKED into the sidebar.
 *
 * A floating bubble was the wrong shape for this. The point of the shared
 * window is working THROUGH the plan together — read a line on the left, say
 * something about it on the right — and a bubble you have to open, which then
 * covers the thing you are discussing, breaks exactly that. So on a desktop it
 * is a panel in the sidebar column: always open, always visible, no click
 * before you can type.
 *
 * On a phone there is no sidebar, so it stays a button that opens full screen —
 * see TeamChatWindow below.
 */
export function TeamChatDock({ token, unread, vi, height, salonName }: {
  token: string | null; unread: number; vi: boolean;
  /** Omit to fill whatever the sidebar has left. */
  height?: number;
  /** Shown to the TEAM side, so a staff member knows whose thread this is. */
  salonName?: string;
}) {
  const { messages, side, sending, send } = useThread(token, 'general', true);
  const who = counterpart(side, salonName, vi);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      // Fills the column rather than claiming a fixed slice of it: the cards
      // above vary in height from salon to salon, and a hardcoded 420px is
      // either a gap under the chat or a chat pushed off the screen.
      // 420 minimum. The first version bottomed out at 260 and the reading area
      // came out barely three messages tall — a thread you cannot see is a
      // thread you scroll instead of read, and this is where the work happens.
      ...(height ? { height } : { flex: '1 1 auto', minHeight: 420 }),
      borderRadius: 12, overflow: 'hidden',
      background: 'var(--c0f172a)', border: '1px solid var(--c334155)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
        borderBottom: '1px solid var(--c334155)', flex: '0 0 auto',
        background: 'var(--c1e293b)',
      }}>
        <span style={{ fontSize: 15 }}>💬</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ce2e8f0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {who.title}
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--c64748b)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {who.sub}
          </div>
        </div>
        {unread > 0 && (
          <span style={{
            minWidth: 20, height: 20, borderRadius: 20, background: '#ef4444',
            color: 'var(--cf8fafc)', fontSize: 11, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px',
          }}>{unread > 9 ? '9+' : unread}</span>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
        <Bubbles
          messages={messages}
          mine={side}
          empty={side === 'lumio'
            ? (vi
              ? 'Chưa có tin nhắn nào. Nhắn cho tiệm ở đây về nội dung, quảng cáo và kế hoạch tuần.'
              : 'No messages yet. Write to the salon here about content, ads and the weekly plan.')
            : (vi
              ? 'Chưa có tin nhắn nào. Nhắn cho đội marketing ở đây — hỏi về bài đăng, quảng cáo, hay kế hoạch tuần này.'
              : 'No messages yet. Write to your marketing team here — about posts, ads, or this week’s plan.')}
        />
      </div>

      <div style={{ flex: '0 0 auto', padding: 10, borderTop: '1px solid var(--c334155)' }}>
        <Composer
          onSend={send}
          sending={sending}
          big={false}
          placeholder={side === 'lumio'
            ? (vi ? `Nhắn cho ${salonName || 'tiệm'}…` : 'Message the salon…')
            : (vi ? 'Nhắn cho đội marketing…' : 'Message your marketing team…')}
        />
      </div>
    </div>
  );
}

/**
 * The same thread on a phone: a button that opens full screen.
 *
 * There is no sidebar to dock into at 375px, and a chat pinned into a corner of
 * that screen is a chat nobody types in — which matters most here, because this
 * is the one the owner writes standing in the salon.
 */
export function TeamChatWindow({ token, unread, vi }: {
  token: string | null; unread: number; vi: boolean;
}) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile(700);
  const { messages, side, sending, send } = useThread(token, 'general', open);

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label={vi ? 'Mở trao đổi với Lumio' : 'Open the Lumio thread'}
          style={{
            position: 'fixed', right: 16, bottom: 16, zIndex: 60,
            width: 54, height: 54, borderRadius: '50%', cursor: 'pointer',
            border: 'none', background: '#6366f1', color: 'var(--cf8fafc)',
            fontSize: 22, boxShadow: '0 8px 24px rgba(0,0,0,.35)',
          }}
        >
          💬
          {unread > 0 && (
            <span style={{
              position: 'absolute', top: -2, right: -2, minWidth: 21, height: 21,
              borderRadius: 20, background: '#ef4444', color: 'var(--cf8fafc)',
              fontSize: 11.5, fontWeight: 700, display: 'flex',
              alignItems: 'center', justifyContent: 'center', padding: '0 5px',
            }}>{unread > 9 ? '9+' : unread}</span>
          )}
        </button>
      )}

      {open && (
        <div style={{
          position: 'fixed', zIndex: 70,
          // Phone: the whole screen. Desktop: a panel in the corner.
          ...(isMobile
            ? { inset: 0, borderRadius: 0 }
            : { right: 18, bottom: 18, width: 380, height: 560, borderRadius: 14 }),
          display: 'flex', flexDirection: 'column',
          background: 'var(--c0f172a)', border: '1px solid var(--c334155)',
          boxShadow: '0 18px 50px rgba(0,0,0,.45)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px',
            borderBottom: '1px solid var(--c334155)', flex: '0 0 auto',
          }}>
            <span style={{ fontSize: 15 }}>💬</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ce2e8f0)' }}>
                {counterpart(side, undefined, vi).title}
              </div>
              <div style={{ fontSize: 11, color: 'var(--c64748b)' }}>
                {counterpart(side, undefined, vi).sub}
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label={vi ? 'Đóng' : 'Close'}
              style={{
                width: 36, height: 36, borderRadius: 9, cursor: 'pointer', fontSize: 17,
                border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--c94a3b8)',
              }}
            >✕</button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
            <Bubbles
              messages={messages}
              mine={side}
              empty={vi
                ? 'Chưa có tin nhắn nào. Nhắn cho đội marketing ở đây — hỏi về bài đăng, quảng cáo, hay kế hoạch tuần này. Khách của tiệm không thấy phần này.'
                : 'No messages yet. Write to your marketing team here — about posts, ads, or this week’s plan. Your customers never see it.'}
            />
          </div>

          <div style={{
            flex: '0 0 auto', padding: 12, borderTop: '1px solid var(--c334155)',
            // Keeps the composer clear of the iPhone home bar.
            paddingBottom: `calc(12px + env(safe-area-inset-bottom, 0px))`,
          }}>
            <Composer
              onSend={send}
              sending={sending}
              big={isMobile}
              placeholder={vi ? 'Nhắn cho đội marketing…' : 'Message your marketing team…'}
            />
          </div>
        </div>
      )}
    </>
  );
}
