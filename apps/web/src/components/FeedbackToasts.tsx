'use client';

import { useEffect, useRef, useState } from 'react';
import { FEEDBACK_EVENT, NoticeKind } from '../lib/feedback';

/**
 * The little receipts — "✓ Đã lưu", "✗ lỗi", "máy chủ đang khởi động".
 *
 * Mounted ONCE in the root layout and fed by a window event, so every screen
 * in the product gets action feedback without any screen knowing this exists.
 * The answer to "tôi bấm rồi mà không biết được hay chưa" has to be global,
 * or it is only answered on the pages somebody remembered to wire up.
 */

interface Toast { id: number; kind: NoticeKind; text: string }

const TONE: Record<NoticeKind, { bg: string; fg: string; icon: string }> = {
  success: { bg: 'var(--c052e16)', fg: 'var(--c86efac)', icon: '✓' },
  error: { bg: 'var(--c450a0a)', fg: 'var(--cfca5a5)', icon: '✗' },
  info: { bg: 'var(--c1e293b)', fg: 'var(--ccbd5e1)', icon: '⏳' },
};

/** success 1.8s, info 3.5s, error 5s — bad news gets read, good news gets glanced. */
const LIFE: Record<NoticeKind, number> = { success: 1800, info: 3500, error: 5000 };

export function FeedbackToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const lastRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });

  useEffect(() => {
    const onNotify = (e: Event) => {
      const { kind, text } = (e as CustomEvent).detail as { kind: NoticeKind; text: string };
      // A double-clicked save fires twice in a breath. One receipt is a
      // confirmation; two identical receipts are a glitch.
      const now = Date.now();
      if (lastRef.current.text === `${kind}:${text}` && now - lastRef.current.at < 800) return;
      lastRef.current = { text: `${kind}:${text}`, at: now };

      const id = nextId.current++;
      setToasts((prev) => [...prev.slice(-2), { id, kind, text }]);
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), LIFE[kind]);
    };
    window.addEventListener(FEEDBACK_EVENT, onNotify);
    return () => window.removeEventListener(FEEDBACK_EVENT, onNotify);
  }, []);

  if (!toasts.length) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 'calc(18px + env(safe-area-inset-bottom))', left: '50%', transform: 'translateX(-50%)',
      zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, pointerEvents: 'none',
      maxWidth: 'min(92vw, 460px)',
    }}>
      {toasts.map((t) => (
        <div key={t.id} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: TONE[t.kind].bg, color: TONE[t.kind].fg,
          border: `1px solid ${TONE[t.kind].fg}33`,
          borderRadius: 999, padding: '9px 18px', fontSize: 13.5, fontWeight: 600,
          boxShadow: '0 8px 26px rgba(0,0,0,.35)',
          animation: 'lumio-toast-in .18s ease-out',
          maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          <span aria-hidden>{TONE[t.kind].icon}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
