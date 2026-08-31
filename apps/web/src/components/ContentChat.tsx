'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import { ui } from '../lib/ui';
import { useIsMobile } from '../lib/responsive';

/**
 * The conversation between the Lumio team and the salon, about the work.
 *
 * TWO SHAPES, ONE COMPONENT
 *
 * `variant="inline"` is the comment thread under one item — an idea, a week, an
 * ad plan. `variant="window"` is the shared window: a floating button that
 * opens a full conversation, and on a phone it takes the whole screen, because
 * a chat squeezed into a corner of a 375px display is a chat nobody types in.
 *
 * They are one component because they are one conversation with two addresses.
 * Two components would drift, and the drift always lands on the phone.
 *
 * DESIGNED FOR THE PHONE FIRST
 *
 * The owner reads this standing in the salon. So: a sheet that fills the screen
 * rather than a floating box, a send button big enough for a thumb, the newest
 * message in view without scrolling, and a composer that does not sit under the
 * on-screen keyboard.
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
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          padding: '4px 10px', borderRadius: 20, cursor: 'pointer', fontSize: 12,
          border: '1px solid var(--c334155)', background: 'transparent',
          color: unread ? 'var(--ca5b4fc)' : 'var(--c64748b)',
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}
      >
        💬 {labelVi ?? (vi ? 'Trao đổi' : 'Discuss')}
        {!!count && (
          <span style={{
            fontSize: 10.5, fontWeight: 700, minWidth: 17, height: 17, borderRadius: 20,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: unread ? '#ef4444' : 'var(--c334155)',
            color: unread ? 'var(--cf8fafc)' : 'var(--c94a3b8)', padding: '0 5px',
          }}>{count}</span>
        )}
      </button>

      {open && (
        <div style={{
          marginTop: 8, padding: 10, borderRadius: 10,
          background: 'var(--c0f172a)', border: '1px solid var(--c334155)',
        }}>
          <div style={{ maxHeight: 280, overflowY: 'auto', marginBottom: 8 }}>
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
 * The shared window: one thread for everything that belongs to no single item.
 *
 * A floating button, and on a phone the sheet fills the screen. A chat pinned
 * into a 320px corner on a 375px display is a chat nobody writes in — and this
 * one exists precisely so the owner can write while standing in the salon.
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
                {vi ? 'Trao đổi với Lumio' : 'Talk to Lumio'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--c64748b)' }}>
                {vi ? 'Nội bộ — khách của tiệm không thấy' : 'Internal — your customers never see this'}
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
                ? 'Chưa có tin nhắn nào. Đây là chỗ trao đổi giữa tiệm và team Lumio về nội dung, quảng cáo, kế hoạch — riêng tư, khách không thấy.'
                : 'No messages yet. This is where the salon and the Lumio team talk about content, ads and the plan — private, never seen by customers.'}
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
              placeholder={vi ? 'Nhắn cho team Lumio…' : 'Message the Lumio team…'}
            />
          </div>
        </div>
      )}
    </>
  );
}
