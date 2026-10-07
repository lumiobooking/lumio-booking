'use client';

/** "⚠ Khách này đã không đến 3 lần" under the phone field while the desk books. */
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

export function NoShowWarning({ token, phone, customerId, vi }: { token: string | null; phone?: string; customerId?: string; vi: boolean }) {
  const [hit, setHit] = useState<{ count: number; months: number } | null>(null);
  const digits = (phone ?? '').replace(/\D/g, '');
  useEffect(() => {
    setHit(null);
    if (!token || (!customerId && digits.length < 7)) return undefined;
    let alive = true;
    const q = customerId ? `customerId=${encodeURIComponent(customerId)}` : `phone=${encodeURIComponent(digits)}`;
    const t = setTimeout(() => {
      apiFetch<{ count: number; months: number; warn: boolean }>(`/bookings/no-show-check?${q}`, { token })
        .then((r) => { if (alive && r?.warn) setHit({ count: r.count, months: r.months }); })
        .catch(() => undefined);
    }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [token, digits, customerId]);
  if (!hit) return null;
  return (
    <div role="status" style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: 'var(--ink-warn)' }}>
      ⚠ {vi ? `Khách này đã không đến ${hit.count} lần trong ${hit.months} tháng qua — cân nhắc gọi xác nhận hoặc lấy cọc.`
        : `This client didn't show ${hit.count} times in the last ${hit.months} months — consider confirming by phone or taking a deposit.`}
    </div>
  );
}
