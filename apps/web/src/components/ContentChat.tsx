'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fmtInTz } from '../lib/datetime';
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
    return fmtInTz(iso, {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch { return ''; }
};

/**
 * Eight colours that stay apart from each other, and from the indigo that
 * means "me". Assigned by name, so the same person is the same colour on
 * every screen, in every session, without anyone storing a preference.
 */
const PERSON_COLORS = ['#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#c084fc', '#22d3ee', '#fb923c', '#a3e635'];

function personColor(name: string): string {
  const n = String(name ?? '').trim() || '?';
  let h = 0;
  for (let i = 0; i < n.length; i += 1) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return PERSON_COLORS[h % PERSON_COLORS.length];
}

/** Two letters for the avatar. Vietnamese names put the given name last. */
function initialsOf(name: string): string {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const last = parts[parts.length - 1];
  return (parts.length > 1 ? `${parts[0][0]}${last[0]}` : last.slice(0, 2)).toUpperCase();
}

/**
 * The thread.
 *
 * THREE THINGS TELL YOU WHO SAID SOMETHING, not one.
 *
 * Side answers "us or them" — mine right, theirs left. That is the coarse cut
 * and it is not enough, because "them" is four people at an agency and a
 * salon owner, and a wall of identical grey bubbles makes a conversation you
 * have to read from the top to follow.
 *
 * So each person also gets a colour of their own, derived from their name so
 * it never drifts, and it lands in three places at once: a tinted bubble, a
 * coloured edge, and an initials disc. Colour alone would fail anyone who
 * cannot separate two hues; the disc carries the same fact in letters.
 *
 * The tint is deliberately faint. A saturated bubble would have to fight the
 * theme — dark by night, white by day — and text on it could only be right in
 * one of them. A wash over the panel's own surface stays readable in both.
 *
 * A run of messages from one person shows the name once. Repeating it on every
 * line is how a short exchange starts looking like an argument.
 */
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
      {messages.map((m, idx) => {
        const isMine = m.side === mine;
        const prev = idx > 0 ? messages[idx - 1] : null;
        // A new speaker, or the same one after somebody else spoke.
        const opensRun = !prev || prev.authorName !== m.authorName || prev.side !== m.side;
        const color = personColor(m.authorName);
        return (
          <div
            key={m.id}
            style={{
              display: 'flex', gap: 7, marginBottom: 8,
              marginTop: opensRun && idx > 0 ? 10 : 0,
              justifyContent: isMine ? 'flex-end' : 'flex-start',
              alignItems: 'flex-end',
            }}
          >
            {!isMine && (
              opensRun ? (
                <span
                  title={m.authorName}
                  style={{
                    width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 800, letterSpacing: .2,
                    color, border: `1.5px solid ${color}`, background: `${color}1f`,
                  }}
                >{initialsOf(m.authorName)}</span>
              ) : <span style={{ width: 26, flexShrink: 0 }} />
            )}

            <div style={{ maxWidth: '78%', minWidth: 0 }}>
              {opensRun && (
                <div style={{
                  fontSize: 10.5, marginBottom: 3, fontWeight: 700,
                  textAlign: isMine ? 'right' : 'left',
                  color: isMine ? 'var(--c94a3b8)' : color,
                }}>
                  {m.authorName} <span style={{ fontWeight: 400, color: 'var(--c64748b)' }}>· {timeOf(m.createdAt)}</span>
                </div>
              )}
              <div style={{
                fontSize: 13.5, lineHeight: 1.55, padding: '8px 11px', borderRadius: 12,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                // Mine is the one solid colour on the screen. Everyone else is
                // a faint wash of their own colour with a matching edge, which
                // reads in both themes because the surface underneath is the
                // panel's, not a paint the theme cannot follow.
                background: isMine ? '#6366f1' : `${color}1f`,
                color: isMine ? 'var(--cf8fafc)' : 'var(--ce2e8f0)',
                border: isMine ? 'none' : `1px solid ${color}59`,
                borderLeft: isMine ? 'none' : `3px solid ${color}`,
                borderBottomRightRadius: isMine ? 3 : 12,
                borderBottomLeftRadius: isMine ? 12 : 3,
              }}>{m.body}</div>
              {!opensRun && (
                <div style={{ fontSize: 9.5, color: 'var(--c64748b)', marginTop: 2, textAlign: isMine ? 'right' : 'left' }}>
                  {timeOf(m.createdAt)}
                </div>
              )}
            </div>

            {isMine && (
              opensRun ? (
                <span
                  title={m.authorName}
                  style={{
                    width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 800, letterSpacing: .2,
                    color: 'var(--cf8fafc)', border: '1.5px solid #6366f1', background: '#6366f1',
                  }}
                >{initialsOf(m.authorName)}</span>
              ) : <span style={{ width: 26, flexShrink: 0 }} />
            )}
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
            position: 'fixed', right: 14,
            // ---- above the tab bar, not behind it ----
            // The salon app's bottom navigation is fixed at bottom:0 with
            // z-index 60 and stands about 60px tall plus the iPhone home bar.
            // This button sat at bottom:16 with the SAME z-index, so it was
            // drawn underneath it: on a phone the thread was not hard to find,
            // it was invisible. `main` already reserves 88px for the bar, so
            // that is the number to clear, plus the safe area beneath it.
            bottom: 'calc(84px + env(safe-area-inset-bottom, 0px))',
            zIndex: 61,
            display: 'flex', alignItems: 'center', gap: 7,
            minHeight: 46, padding: '0 16px', borderRadius: 24, cursor: 'pointer',
            border: 'none', background: '#6366f1', color: 'var(--cf8fafc)',
            fontSize: 14, fontWeight: 700, boxShadow: '0 8px 24px rgba(0,0,0,.45)',
          }}
        >
          {/* A bare circle in a corner reads as decoration. It says what it is. */}
          <span style={{ fontSize: 18, lineHeight: 1 }}>💬</span>
          {vi ? 'Nhắn Lumio' : 'Message Lumio'}
          {unread > 0 && (
            <span style={{
              minWidth: 21, height: 21,
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
