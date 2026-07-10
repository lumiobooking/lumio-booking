'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { useIsMobile } from '../lib/responsive';

const STATUS_COLOR: Record<string, string> = {
  PENDING: '#eab308', ASSIGNED: '#3b82f6', ACCEPTED: '#22c55e', CONFIRMED: '#22c55e',
  ARRIVED: '#14b8a6', COMPLETED: '#a855f7', REJECTED: '#ef4444', CANCELLED: '#94a3b8', NO_SHOW: '#ef4444',
};

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

/**
 * Read-only detail sheet for a single booking/reservation. Fetches GET
 * /bookings/:id and renders customer, service, staff, table, timing, payment
 * and quick call / profile actions. Used by the Notifications feed and the
 * top-bar notification bell. Bottom-sheet on phones, centered modal on desktop.
 */
export function BookingDetailSheet({ token, apptId, onClose, lang, L }: { token?: string | null; apptId: string; onClose: () => void; lang: string; L: (vi: string, en: string) => string }) {
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
