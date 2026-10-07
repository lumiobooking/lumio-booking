'use client';

// THẺ KHÁCH inside the technician's booking sheet.
//
// Before the client sits down, one glance: anything to be careful about
// (red, first), how they like things done, the desk's note, new or regular,
// what they usually have, who they usually see. GET /bookings/:id/client-card
// only answers for HER booking (or the desk), so a technician never reads
// another technician's clients.

import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { fmtInTz } from '../../lib/datetime';
import { L, Pill } from './kit';
import { regularLine } from '../../lib/client-card-ui';

export interface ClientCardData {
  name: string; firstVisit: boolean; visits: number; withMe: number; lastVisit: string | null; lastWithMe: string | null;
  warnings: { label: { vi: string; en: string }; value: string }[];
  prefs: { label: { vi: string; en: string }; value: string }[];
  notes: string | null;
  favourites: { name: string; count: number }[];
  preferredStaff: { name: string; count: number } | null;
  recent: { at: string; services: string[]; staff: string | null; withMe: boolean }[];
  points: number; birthdaySoon: boolean; pastVisits: number;
}

export function ClientCard({ bookingId, token, vi }: { bookingId: string; token: string | null; vi: boolean }) {
  const [card, setCard] = useState<ClientCardData | null | undefined>(undefined);
  const [more, setMore] = useState(false);
  useEffect(() => {
    let alive = true;
    setCard(undefined); setMore(false);
    if (!token) return;
    apiFetch<{ card: ClientCardData | null }>(`/bookings/${bookingId}/client-card`, { token })
      .then((r) => { if (alive) setCard(r.card); })
      .catch(() => { if (alive) setCard(null); });
    return () => { alive = false; };
  }, [bookingId, token]);

  if (card === undefined) return <div style={{ fontSize: 13, color: 'var(--c94a3b8)', marginTop: 10 }}>…</div>;
  if (!card) return null;
  const day = (iso: string) => fmtInTz(iso, { day: 'numeric', month: 'numeric' });
  const lab = (l: { vi: string; en: string }) => (vi ? l.vi : l.en);

  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* who */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Pill text={card.firstVisit ? L(vi, 'Khách mới', 'New') : L(vi, 'Khách quen', 'Regular')} tone={card.firstVisit ? 'sky' : 'good'} />
        {card.birthdaySoon && <Pill text={L(vi, '🎂 Sắp sinh nhật', '🎂 Birthday soon')} tone="warn" />}
        {card.points > 0 && <Pill text={L(vi, `${card.points} điểm`, `${card.points} pts`)} tone="info" />}
        <span style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{regularLine(card, vi, day)}</span>
      </div>

      {/* careful with */}
      {card.warnings.length > 0 && (
        <div style={{ padding: '10px 12px', borderRadius: 12, background: 'var(--wash-red)', border: '1px solid var(--ink-bad)' }}>
          {card.warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 14, color: 'var(--ink-bad)', lineHeight: 1.45 }}><b>⚠ {lab(w.label)}:</b> {w.value}</div>
          ))}
        </div>
      )}

      {/* how they like it */}
      {(card.prefs.length > 0 || card.notes) && (
        <div style={{ padding: '10px 12px', borderRadius: 12, background: 'var(--c0f172a)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {card.prefs.map((p, i) => (
            <div key={i} style={{ fontSize: 14, color: 'var(--ce2e8f0)', lineHeight: 1.45 }}><span style={{ color: 'var(--c94a3b8)' }}>{lab(p.label)}:</span> {p.value}</div>
          ))}
          {card.notes && <div style={{ fontSize: 14, color: 'var(--ccbd5e1)', lineHeight: 1.45 }}><span style={{ color: 'var(--c94a3b8)' }}>{L(vi, 'Ghi chú của tiệm', 'Salon note')}:</span> {card.notes}</div>}
        </div>
      )}

      {/* habits */}
      {!card.firstVisit && (card.favourites.length > 0 || card.preferredStaff) && (
        <div style={{ fontSize: 13.5, color: 'var(--ccbd5e1)', lineHeight: 1.5 }}>
          {card.favourites.length > 0 && <span>{L(vi, 'Hay làm', 'Usually')}: {card.favourites.map((f) => `${f.name}${f.count > 1 ? ` ×${f.count}` : ''}`).join(', ')}</span>}
          {card.preferredStaff && <span>{card.favourites.length ? ' · ' : ''}{L(vi, `thường với ${card.preferredStaff.name}`, `usually with ${card.preferredStaff.name}`)}</span>}
        </div>
      )}

      {/* recent visits */}
      {card.recent.length > 0 && (
        <div>
          <button type="button" onClick={() => setMore((v) => !v)} style={{ background: 'transparent', border: 'none', padding: '6px 0', color: 'var(--ink-link)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            {more ? L(vi, 'Ẩn các lần trước', 'Hide past visits') : L(vi, `Xem ${card.recent.length} lần gần đây`, `See last ${card.recent.length} visits`)}
          </button>
          {more && (
            <div style={{ border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
              {card.recent.map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, padding: '8px 12px', borderBottom: i < card.recent.length - 1 ? '1px solid var(--line)' : 'none', fontSize: 13.5 }}>
                  <span style={{ color: 'var(--c94a3b8)', minWidth: 44 }}>{day(r.at)}</span>
                  <span style={{ flex: 1, color: 'var(--ce2e8f0)' }}>{r.services.join(', ') || '—'}</span>
                  <span style={{ color: r.withMe ? 'var(--ink-good)' : 'var(--c94a3b8)' }}>{r.withMe ? L(vi, 'bạn', 'you') : (r.staff ?? '')}</span>
                </div>
              ))}
              {card.pastVisits > 0 && <div style={{ padding: '8px 12px', fontSize: 12.5, color: 'var(--c94a3b8)' }}>{L(vi, `+ ${card.pastVisits} lần ở hệ thống cũ`, `+ ${card.pastVisits} visits in the old system`)}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
