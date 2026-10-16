'use client';

// ---------------------------------------------------------------------------
// "Đặt lịch" as a pop-up. The calendar opens this instead of sending the desk
// to the bookings page: the day they were looking at stays right behind it,
// and when the booking is made the calendar refreshes in place.
//
// It loads what the form needs (services, technicians, opening hours, the
// salon's timezone) itself; the caller passes the bookings it already holds
// so "who is free at this hour" is answered without a second big read.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { apiFetch } from '../lib/api';
import { useLang } from '../lib/i18n';
import { useIsMobile } from '../lib/responsive';
import type { HoursRules } from '../lib/desk-hours';
import { CreateBookingForm, type BookingFormBooking, type BookingFormService, type BookingFormStaff } from './CreateBookingForm';

export interface NewBookingPrefill { staffId?: string; startLocal?: string; firstName?: string; lastName?: string; phone?: string }

export function NewBookingModal({ initial, bookings, onClose, onCreated }: {
  initial?: NewBookingPrefill;
  bookings: BookingFormBooking[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { token, user } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const phone = useIsMobile(640);
  const isOwner = user?.role === 'SALON_ADMIN' || user?.role === 'SUPER_ADMIN';
  const [services, setServices] = useState<BookingFormService[] | null>(null);
  const [staff, setStaff] = useState<BookingFormStaff[]>([]);
  const [tz, setTz] = useState('');
  const [hours, setHours] = useState<HoursRules | null>(null);
  const [currency, setCurrency] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    Promise.all([
      apiFetch<BookingFormService[]>('/services', { token }),
      apiFetch<BookingFormStaff[]>('/staff', { token }),
      apiFetch<{ company?: { timezone?: string }; booking?: HoursRules }>('/settings', { token }).catch(() => ({} as { company?: { timezone?: string }; booking?: HoursRules })),
    ]).then(([s, st, settings]) => {
      if (!alive) return;
      setServices(s);
      setStaff(st);
      setTz(settings?.company?.timezone ?? '');
      setHours(settings?.booking ?? null);
      setCurrency((settings?.booking as { currency?: string } | undefined)?.currency);
    }).catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Could not load'); });
    return () => { alive = false; };
  }, [token]);

  // Esc closes; the page behind does not scroll while the form is open.
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = prev; };
  }, [onClose]);

  const box: React.CSSProperties = phone
    ? { position: 'fixed', inset: 0, borderRadius: 0 }
    : { position: 'relative', width: 'min(960px, calc(100vw - 48px))', maxHeight: 'calc(100dvh - 48px)', borderRadius: 16, border: '1px solid var(--c334155)', boxShadow: '0 32px 64px -16px rgba(0,0,0,.6)' };

  return (
    <div role="dialog" aria-modal="true" aria-label={vi ? 'Đặt lịch' : 'New booking'}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(2,6,23,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ ...box, background: 'var(--c1e293b)', overflowY: 'auto', overscrollBehavior: 'contain' }}>
        {services === null ? (
          <div style={{ padding: 28, display: 'flex', alignItems: 'center', gap: 12, color: 'var(--c94a3b8)', fontSize: 14 }}>
            <span style={{ flex: 1 }}>{error ?? (vi ? 'Đang mở form đặt lịch…' : 'Opening the booking form…')}</span>
            <button type="button" onClick={onClose} aria-label={vi ? 'Đóng' : 'Close'}
              style={{ width: 36, height: 36, borderRadius: 10, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--c94a3b8)', cursor: 'pointer' }}>✕</button>
          </div>
        ) : (
          <CreateBookingForm
            bare
            onCancel={onClose}
            token={token!}
            services={services}
            staff={staff.filter((s) => s.isActive)}
            bookings={bookings}
            initial={initial}
            salonTz={tz}
            hours={hours}
            isOwner={isOwner}
            currency={currency}
            onCreated={onCreated}
          />
        )}
      </div>
    </div>
  );
}
