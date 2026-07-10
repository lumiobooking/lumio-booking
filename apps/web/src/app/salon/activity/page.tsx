'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { useLang } from '../../../lib/i18n';
import { useIsMobile } from '../../../lib/responsive';
import { PushEnable } from '../../../components/PushEnable';

interface Item { id: string; type: 'booking' | 'cancel' | 'payment'; customer: string; detail: string; at: string; when: string | null; appointmentId?: string | null }

const ACT_SEEN_KEY = 'lumio_activity_seen';

export default function ActivityPage() {
  return <SalonShell><Inner /></SalonShell>;
}

const TYPE_META: Record<string, { bg: string; icon: string }> = {
  booking: { bg: '#6366f1', icon: 'M3 4h18v17H3zM8 2v4M16 2v4M3 10h18M12 13v5M9.5 15.5h5' },
  cancel: { bg: '#ef4444', icon: 'M3 4h18v17H3zM8 2v4M16 2v4M3 10h18M9.5 14l5 4M14.5 14l-5 4' },
  payment: { bg: '#10b981', icon: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' },
};

const STATUS_COLOR: Record<string, string> = {
  PENDING: '#eab308', ASSIGNED: '#3b82f6', ACCEPTED: '#22c55e', CONFIRMED: '#22c55e',
  ARRIVED: '#14b8a6', COMPLETED: '#a855f7', REJECTED: '#ef4444', CANCELLED: '#94a3b8', NO_SHOW: '#ef4444',
};

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const L = (vi: string, en: string) => (lang === 'vi' ? vi : en);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'booking' | 'cancel' | 'payment'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try { setItems(await apiFetch<Item[]>('/activity', { token })); }
    catch { /* ignore */ }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  // Opening this screen marks everything as seen -> clears the tab badge.
  useEffect(() => {
    try { window.localStorage.setItem(ACT_SEEN_KEY, new Date().toISOString()); } catch { /* ignore */ }
    window.dispatchEvent(new Event('lumio-activity-seen'));
  }, [items]);

  const rel = (at: string) => {
    const s = Math.max(0, (Date.now() - new Date(at).getTime()) / 1000);
    if (s < 60) return L('vừa xong', 'now');
    if (s < 3600) return Math.floor(s / 60) + L(' phút', 'm');
    if (s < 86400) return Math.floor(s / 3600) + L(' giờ', 'h');
    return Math.floor(s / 86400) + L(' ngày', 'd');
  };
  const whenText = (when: string | null) => {
    if (!when) return '';
    const d = new Date(when);
    return d.toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-US', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };
  const dayKey = (at: string) => {
    const d = new Date(at); const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    if (dd === start) return L('HÔM NAY', 'TODAY');
    if (dd === start - 86400000) return L('HÔM QUA', 'YESTERDAY');
    return d.toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-US', { day: 'numeric', month: 'short' }).toUpperCase();
  };
  const verb = (t: Item['type']) => t === 'booking' ? L('đặt', 'booked') : t === 'cancel' ? L('huỷ', 'cancelled') : L('· Thanh toán', '· Paid');

  const shown = useMemo(() => items.filter((i) => filter === 'all' || i.type === filter), [items, filter]);
  const groups = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of shown) { const k = dayKey(i.at); const a = m.get(k) ?? []; a.push(i); m.set(k, a); }
    return Array.from(m.entries());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, lang]);

  const chips: { k: typeof filter; label: string }[] = [
    { k: 'all', label: L('Tất cả', 'All') },
    { k: 'booking', label: L('Đặt lịch', 'Bookings') },
    { k: 'cancel', label: L('Huỷ', 'Cancels') },
    { k: 'payment', label: L('Đơn hàng', 'Payments') },
  ];

  return (
    <section style={{ maxWidth: 640 }}>
      <h1 style={{ fontSize: 22, margin: '0 0 2px' }}>{L('Thông báo', 'Notifications')}</h1>
      <p style={{ color: '#94a3b8', fontSize: 14, marginTop: 0 }}>{L('Booking mới, huỷ lịch và thanh toán — chạm để xem chi tiết.', 'New bookings, cancellations and payments — tap to see details.')}</p>

      <PushEnable />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '14px 0 6px' }}>
        {chips.map((c) => {
          const on = filter === c.k;
          return <button key={c.k} onClick={() => setFilter(c.k)} style={{ padding: '7px 14px', borderRadius: 999, border: `1px solid ${on ? '#6366f1' : '#334155'}`, background: on ? '#6366f1' : 'transparent', color: on ? '#fff' : '#cbd5e1', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{c.label}</button>;
        })}
      </div>

      {loading ? <p style={{ color: '#64748b', fontSize: 14, marginTop: 16 }}>{L('Đang tải…', 'Loading…')}</p>
        : shown.length === 0 ? <p style={{ color: '#64748b', fontSize: 14, marginTop: 20 }}>{L('Chưa có thông báo nào.', 'No notifications yet.')}</p>
        : groups.map(([day, list]) => (
          <div key={day} style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.6, color: '#64748b', marginBottom: 8 }}>{day}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {list.map((i) => {
                const m = TYPE_META[i.type];
                const clickable = !!i.appointmentId;
                const hovered = hoverId === i.id;
                const open = () => { if (i.appointmentId) setOpenId(i.appointmentId); };
                return (
                  <div
                    key={i.id}
                    onClick={clickable ? open : undefined}
                    onMouseEnter={clickable ? () => setHoverId(i.id) : undefined}
                    onMouseLeave={clickable ? () => setHoverId(null) : undefined}
                    onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } : undefined}
                    role={clickable ? 'button' : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    aria-label={clickable ? L('Xem chi tiết', 'View details') : undefined}
                    style={{ display: 'flex', gap: 12, alignItems: 'center', background: hovered ? '#243044' : '#1e293b', border: `1px solid ${hovered ? '#3b4a63' : '#223047'}`, borderRadius: 12, padding: '11px 13px', cursor: clickable ? 'pointer' : 'default', transition: 'background .12s, border-color .12s' }}
                  >
                    <span style={{ width: 38, height: 38, borderRadius: 11, background: m.bg, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        {m.icon.split('M').filter(Boolean).map((s, k) => <path key={k} d={'M' + s} />)}
                      </svg>
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14.5, color: '#f1f5f9', lineHeight: 1.35 }}><b style={{ fontWeight: 700 }}>{i.customer}</b> {verb(i.type)} {i.detail}</div>
                      {(i.when || i.type === 'payment') && <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 2 }}>{i.when ? whenText(i.when) : L('Đã thanh toán', 'Paid')}</div>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
                      <span style={{ fontSize: 12, color: '#64748b' }}>{rel(i.at)}</span>
                      {clickable && (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={hovered ? '#94a3b8' : '#475569'} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

      {openId && <BookingDetail token={token} apptId={openId} onClose={() => setOpenId(null)} lang={lang} L={L} />}
    </section>
  );
}

interface Detail {
  id: string;
  status: string;
  startTime: string;
  endTime: string;
  notes: string | null;
  partySize?: number | null;
  source?: string | null;
  customer: { id: string; firstName: string; lastName: string | null; email: string | null; phone: string | null } | null;
  service: { id: string; name: string; durationMinutes: number } | null;
  assignedStaff: { id: string; firstName: string; lastName: string | null } | null;
  table?: { id: string; name: string; seats: number } | null;
  payments?: { status: string; amountCents: number }[];
}

function BookingDetail({ token, apptId, onClose, lang, L }: { token?: string | null; apptId: string; onClose: () => void; lang: string; L: (vi: string, en: string) => string }) {
  const isMobile = useIsMobile();
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    setD(null); setErr(false);
    (async () => {
      try { const r = await apiFetch<Detail>(`/bookings/${apptId}`, { token }); if (alive) setD(r); }
      catch { if (alive) setErr(true); }
    })();
    return () => { alive = false; };
  }, [apptId, token]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const fullName = (o?: { firstName: string; lastName: string | null } | null, fb = L('Khách', 'Guest')) =>
    o ? ([o.firstName, o.lastName].filter(Boolean).join(' ').trim() || fb) : fb;
  const fmtWhen = (iso: string) => new Date(iso).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const money = (cents: number) => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100); } catch { return '$' + Math.round(cents / 100); } };
  const sourceLabel = (s?: string | null) => {
    switch ((s || '').toUpperCase()) {
      case 'ONLINE': case 'PUBLIC': case 'WEB': return L('Khách đặt online', 'Online');
      case 'ADMIN': case 'STAFF': case 'DASHBOARD': return L('Tạo tại tiệm', 'In-store');
      case 'PHONE': case 'VOICE': case 'HOTLINE': return L('Gọi điện', 'Phone');
      case 'MESSENGER': return 'Messenger';
      case 'WALK_IN': case 'WALKIN': return L('Khách vãng lai', 'Walk-in');
      default: return s || '';
    }
  };

  const paid = d?.payments?.find((p) => p.status === 'PAID');
  const status = d?.status ?? '';
  const statusColor = STATUS_COLOR[status] ?? '#94a3b8';

  const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.72)', display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', zIndex: 200 };
  const card: CSSProperties = { width: '100%', maxWidth: 460, background: '#0f172a', border: '1px solid #223047', borderRadius: isMobile ? '18px 18px 0 0' : 16, padding: '16px 18px 20px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 -8px 40px rgba(0,0,0,0.5)' };

  const Row = ({ label, children }: { label: string; children: ReactNode }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '10px 0', borderTop: '1px solid #1e293b' }}>
      <span style={{ color: '#94a3b8', fontSize: 13, flexShrink: 0 }}>{label}</span>
      <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600, textAlign: 'right', wordBreak: 'break-word' }}>{children}</span>
    </div>
  );

  return (
    <div style={overlay} onClick={onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#f8fafc' }}>{d ? fullName(d.customer) : L('Đang tải…', 'Loading…')}</div>
            {d && <span style={{ display: 'inline-block', marginTop: 6, color: statusColor, border: `1px solid ${statusColor}`, borderRadius: 999, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>{status}</span>}
          </div>
          <button onClick={onClose} aria-label={L('Đóng', 'Close')} style={{ background: '#1e293b', border: '1px solid #334155', color: '#cbd5e1', width: 34, height: 34, borderRadius: 9, cursor: 'pointer', fontSize: 18, lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>

        {err ? (
          <p style={{ color: '#f87171', fontSize: 14, marginTop: 14 }}>{L('Không tải được chi tiết. Có thể lịch hẹn đã bị xoá.', 'Could not load details — the booking may have been removed.')}</p>
        ) : !d ? (
          <p style={{ color: '#64748b', fontSize: 14, marginTop: 14 }}>{L('Đang tải chi tiết…', 'Loading details…')}</p>
        ) : (
          <>
            <div style={{ marginTop: 8 }}>
              <Row label={L('Thời gian', 'When')}>{fmtWhen(d.startTime)}{d.endTime ? ` – ${fmtTime(d.endTime)}` : ''}</Row>
              <Row label={L('Dịch vụ', 'Service')}>{d.service?.name ?? '—'}{d.service?.durationMinutes ? ` · ${d.service.durationMinutes} min` : ''}</Row>
              <Row label={L('Nhân viên', 'Staff')}>{d.assignedStaff ? fullName(d.assignedStaff, '—') : L('Chưa phân công', 'Unassigned')}</Row>
              {d.table && <Row label={L('Bàn', 'Table')}>{d.table.name}{d.table.seats ? ` · ${d.table.seats} ${L('chỗ', 'seats')}` : ''}</Row>}
              {d.partySize ? <Row label={L('Số người', 'Party')}>{d.partySize}</Row> : null}
              {d.source ? <Row label={L('Nguồn', 'Source')}>{sourceLabel(d.source)}</Row> : null}
              <Row label={L('Thanh toán', 'Payment')}>
                {paid ? <span style={{ color: '#34d399' }}>{L('Đã thu', 'Paid')} {money(paid.amountCents)}</span> : <span style={{ color: '#94a3b8' }}>{L('Chưa thu · thu tại quầy', 'Unpaid · at checkout')}</span>}
              </Row>
              {d.customer?.phone && <Row label={L('Điện thoại', 'Phone')}><a href={`tel:${d.customer.phone}`} style={{ color: '#818cf8', textDecoration: 'none' }}>{d.customer.phone}</a></Row>}
              {d.customer?.email && <Row label="Email"><a href={`mailto:${d.customer.email}`} style={{ color: '#818cf8', textDecoration: 'none' }}>{d.customer.email}</a></Row>}
              {d.notes && <Row label={L('Ghi chú', 'Notes')}>{d.notes}</Row>}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              {d.customer?.phone && (
                <a href={`tel:${d.customer.phone}`} style={{ flex: 1, minWidth: 130, textAlign: 'center', padding: '11px 14px', borderRadius: 10, background: '#6366f1', color: '#fff', fontWeight: 700, fontSize: 14, textDecoration: 'none' }}>{L('Gọi khách', 'Call guest')}</a>
              )}
              {d.customer?.id && (
                <a href={`/salon/customers/${d.customer.id}`} style={{ flex: 1, minWidth: 130, textAlign: 'center', padding: '11px 14px', borderRadius: 10, background: 'transparent', border: '1px solid #475569', color: '#e2e8f0', fontWeight: 600, fontSize: 14, textDecoration: 'none' }}>{L('Hồ sơ khách', 'Customer')}</a>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
