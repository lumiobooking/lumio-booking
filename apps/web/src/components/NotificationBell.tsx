'use client';

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth';
import { apiFetch } from '../lib/api';
import { useLang } from '../lib/i18n';
import { useIsMobile } from '../lib/responsive';
import { BookingDetailSheet } from './BookingDetailSheet';

interface Item { id: string; type: 'booking' | 'cancel' | 'payment'; customer: string; detail: string; at: string; when: string | null; appointmentId?: string | null }

const ACT_SEEN_KEY = 'lumio_activity_seen';

const TYPE_META: Record<string, { bg: string; icon: string }> = {
  booking: { bg: '#6366f1', icon: 'M3 4h18v17H3zM8 2v4M16 2v4M3 10h18M12 13v5M9.5 15.5h5' },
  cancel: { bg: '#ef4444', icon: 'M3 4h18v17H3zM8 2v4M16 2v4M3 10h18M9.5 14l5 4M14.5 14l-5 4' },
  payment: { bg: '#10b981', icon: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' },
};

/**
 * Top-bar notification bell shown in the corner on desktop and in the mobile
 * header. Polls the activity feed, shows an unread badge, and opens a dropdown
 * of recent events. Clicking an event opens its booking detail sheet; anything
 * without a booking (POS-only payment) routes to the full Notifications page.
 * Uses the same 'lumio_activity_seen' key + 'lumio-activity-seen' event as the
 * mobile tab bar so the badge stays in sync everywhere.
 */
export function NotificationBell() {
  const { token } = useAuth();
  const { lang } = useLang();
  const isMobile = useIsMobile();
  const router = useRouter();
  const L = (vi: string, en: string) => (lang === 'vi' ? vi : en);
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const computeUnread = useCallback((list: Item[]) => {
    let seen = 0;
    try { seen = new Date(window.localStorage.getItem(ACT_SEEN_KEY) || 0).getTime(); } catch { seen = 0; }
    setUnread(list.filter((i) => new Date(i.at).getTime() > seen).length);
  }, []);

  const load = useCallback(() => {
    if (!token) return;
    apiFetch<Item[]>('/activity', { token })
      .then((list) => { if (Array.isArray(list)) { setItems(list); computeUnread(list); } })
      .catch(() => undefined);
  }, [token, computeUnread]);

  useEffect(() => {
    if (!token) return;
    load();
    const iv = window.setInterval(load, 45000);
    const onSeen = () => setUnread(0);
    window.addEventListener('lumio-activity-seen', onSeen);
    window.addEventListener('focus', load);
    return () => { window.clearInterval(iv); window.removeEventListener('lumio-activity-seen', onSeen); window.removeEventListener('focus', load); };
  }, [token, load]);

  // Opening the panel marks all as seen (clears the badge here + tab bar).
  const openPanel = () => {
    setOpen(true);
    try { window.localStorage.setItem(ACT_SEEN_KEY, new Date().toISOString()); } catch { /* ignore */ }
    window.dispatchEvent(new Event('lumio-activity-seen'));
    setUnread(0);
    load();
  };

  const rel = (at: string) => {
    const s = Math.max(0, (Date.now() - new Date(at).getTime()) / 1000);
    if (s < 60) return L('vừa xong', 'now');
    if (s < 3600) return Math.floor(s / 60) + L(' phút', 'm');
    if (s < 86400) return Math.floor(s / 3600) + L(' giờ', 'h');
    return Math.floor(s / 86400) + L(' ngày', 'd');
  };
  const verb = (t: Item['type']) => t === 'booking' ? L('đặt', 'booked') : t === 'cancel' ? L('huỷ', 'cancelled') : L('· TT', '· Paid');

  const recent = items.slice(0, 15);

  const bellBtn: CSSProperties = { position: 'relative', width: 40, height: 40, borderRadius: 10, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', cursor: 'pointer', display: 'grid', placeItems: 'center', flexShrink: 0 };
  const badgeStyle: CSSProperties = { position: 'absolute', top: -5, right: -5, minWidth: 17, height: 17, padding: '0 4px', borderRadius: 999, background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 800, display: 'grid', placeItems: 'center', border: '1.5px solid #111827' };
  const panel: CSSProperties = isMobile
    ? { position: 'fixed', top: 64, right: 8, left: 8, zIndex: 71, background: '#0f172a', border: '1px solid #223047', borderRadius: 14, boxShadow: '0 16px 48px rgba(0,0,0,0.55)', maxHeight: '74vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }
    : { position: 'fixed', top: 58, right: 22, width: 382, zIndex: 71, background: '#0f172a', border: '1px solid #223047', borderRadius: 14, boxShadow: '0 16px 48px rgba(0,0,0,0.55)', maxHeight: '76vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' };

  return (
    <>
      <button onClick={() => (open ? setOpen(false) : openPanel())} aria-label={L('Thông báo', 'Notifications')} style={bellBtn}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e2e8f0" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 && <span style={badgeStyle}>{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'transparent' }} />
          <div style={panel}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 15px', borderBottom: '1px solid #1e293b', flexShrink: 0 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>{L('Thông báo', 'Notifications')}</span>
              <button onClick={() => setOpen(false)} aria-label={L('Đóng', 'Close')} style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>

            <div style={{ overflowY: 'auto', flex: 1 }}>
              {recent.length === 0 ? (
                <p style={{ color: '#64748b', fontSize: 13.5, padding: '22px 15px', textAlign: 'center', margin: 0 }}>{L('Chưa có thông báo nào.', 'No notifications yet.')}</p>
              ) : recent.map((i) => {
                const m = TYPE_META[i.type];
                const clickable = !!i.appointmentId;
                const hovered = hoverId === i.id;
                const go = () => { setOpen(false); if (i.appointmentId) setOpenId(i.appointmentId); else router.push('/salon/activity'); };
                return (
                  <button
                    key={i.id}
                    onClick={go}
                    onMouseEnter={() => setHoverId(i.id)}
                    onMouseLeave={() => setHoverId(null)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', background: hovered ? '#1a2536' : 'transparent', border: 'none', borderTop: '1px solid #1e293b', padding: '11px 14px', cursor: 'pointer' }}
                  >
                    <span style={{ width: 32, height: 32, borderRadius: 9, background: m.bg, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        {m.icon.split('M').filter(Boolean).map((s, k) => <path key={k} d={'M' + s} />)}
                      </svg>
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13.5, color: '#e5e9f0', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><b style={{ fontWeight: 700 }}>{i.customer}</b> {verb(i.type)} {i.detail}</span>
                      <span style={{ display: 'block', fontSize: 11.5, color: '#64748b', marginTop: 1 }}>{rel(i.at)}</span>
                    </span>
                    {clickable && (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={hovered ? '#94a3b8' : '#475569'} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M9 6l6 6-6 6" /></svg>
                    )}
                  </button>
                );
              })}
            </div>

            <button onClick={() => { setOpen(false); router.push('/salon/activity'); }} style={{ borderTop: '1px solid #1e293b', background: 'transparent', color: '#818cf8', fontSize: 13.5, fontWeight: 600, padding: '12px', cursor: 'pointer', border: 'none', flexShrink: 0 }}>
              {L('Xem tất cả thông báo', 'View all notifications')}
            </button>
          </div>
        </>
      )}

      {openId && <BookingDetailSheet token={token} apptId={openId} onClose={() => setOpenId(null)} lang={lang} L={L} />}
    </>
  );
}
