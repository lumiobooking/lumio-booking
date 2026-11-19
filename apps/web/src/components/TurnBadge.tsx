'use client';

/**
 * Chia turn on a conversation row: "Quảng cáo" when the customer came from an
 * ad, and the time left before the turn passes to the next person.
 */
import { useEffect, useState } from 'react';
import { countdown } from '../lib/turn-countdown';

export function TurnBadge({ fromAd, dueAt, vi }: { fromAd?: boolean; dueAt?: string | null; vi: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!dueAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [dueAt]);
  const c = countdown(dueAt, now);
  if (!fromAd && !c) return null;
  const pill = (bg: string, ink: string) => ({ height: 20, padding: '0 7px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' as const, flexShrink: 0, background: bg, color: ink });
  return (
    <>
      {fromAd && <span title={vi ? 'Khách nhắn từ quảng cáo — chuyển turn nhanh hơn' : 'Came from an ad — passed on sooner'} style={pill('var(--wash-red)', 'var(--ink-bad)')}>{vi ? 'Quảng cáo' : 'Ad'}</span>}
      {c && <span title={vi ? 'Thời gian còn lại trước khi chuyển cho người kế tiếp' : 'Time left before it passes to the next person'}
        style={c.tone === 'bad' ? pill('var(--wash-red)', 'var(--ink-bad)') : c.tone === 'warn' ? pill('var(--wash-amber-3)', 'var(--ink-warn)') : pill('var(--wash-blue)', 'var(--ink-link)')}>⏱ {vi ? c.text : c.text.replace('còn', 'left').replace('đang chuyển…', 'passing on…')}</span>}
    </>
  );
}
