'use client';

/**
 * ĐẾN HẠN TÁI KHÁM — a dental clinic's recall list (API: /customers/recalls).
 * Patients whose "recall every N months" has come (or comes within 14 days)
 * with nothing booked, most overdue first: call, book, or mark contacted
 * (hidden for 14 days).
 */
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ui } from '../lib/ui';

interface Item { id: string; name: string; phone: string | null; months: number; lastVisit: string; dueDate: string; overdueDays: number; autoReminded: boolean }

export function RecallBox({ vi }: { vi: boolean }) {
  const { token } = useAuth();
  const [items, setItems] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!token) return;
    apiFetch<{ items: Item[] }>('/customers/recalls', { token }).then((r) => setItems(r?.items ?? [])).catch(() => setItems(null));
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function contacted(id: string) {
    setBusy(id);
    try { await apiFetch(`/customers/recalls/${id}/contacted`, { method: 'POST', token }); setItems((xs) => (xs ?? []).filter((x) => x.id !== id)); }
    catch { /* keep the row */ }
    finally { setBusy(null); }
  }

  if (!items) return null;
  const bookHref = (x: Item) => {
    const [first, ...rest] = x.name.split(' ');
    const q = new URLSearchParams({ new: '1', first: first ?? '', last: rest.join(' '), phone: x.phone ?? '' });
    return `/salon/bookings?${q.toString()}`;
  };
  const date = (iso: string) => new Date(iso).toLocaleDateString(vi ? 'vi-VN' : 'en-US', { day: 'numeric', month: 'numeric', year: 'numeric' });
  const btn: React.CSSProperties = { padding: '5px 10px', borderRadius: 8, border: '1px solid var(--c475569)', color: 'var(--ccbd5e1)', background: 'transparent', fontSize: 12.5, textDecoration: 'none', cursor: 'pointer' };
  return (
    <div id="recalls" style={{ ...ui.card, marginBottom: 14, borderColor: items.length ? 'rgba(245,158,11,0.55)' : 'var(--c334155)' }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--cf1f5f9)', marginBottom: 4 }}>
        🦷 {vi ? 'Đến hạn tái khám' : 'Recalls due'} {items.length > 0 && <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 9px', borderRadius: 999, background: 'rgba(245,158,11,0.16)', color: 'var(--ink-warn)' }}>{items.length}</span>}
      </div>
      <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginBottom: 8 }}>
        {vi ? 'Bệnh nhân có "tái khám mỗi N tháng" trong hồ sơ, đã đến hạn (hoặc trong 14 ngày tới) và chưa có lịch.' : 'Patients with "recall every N months" on their record, due now or within 14 days, with nothing booked.'}
      </div>
      {items.length === 0 && <div style={{ fontSize: 13, color: 'var(--ink-good)' }}>✓ {vi ? 'Chưa có bệnh nhân nào đến hạn.' : 'No recalls due.'}</div>}
      <div style={{ display: 'grid', gap: 6 }}>
        {items.slice(0, 40).map((x) => (
          <div key={x.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 10px', border: '1px solid var(--c334155)', borderRadius: 10, background: 'var(--c0f172a)' }}>
            <a href={`/salon/customers/${x.id}`} style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--c818cf8)', textDecoration: 'none' }}>{x.name}</a>
            <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{vi ? `khám lần cuối ${date(x.lastVisit)} · mỗi ${x.months} tháng` : `last visit ${date(x.lastVisit)} · every ${x.months} mo`}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: x.overdueDays > 0 ? 'var(--ink-bad)' : 'var(--ink-warn)' }}>
              {x.overdueDays > 0 ? (vi ? `quá hạn ${x.overdueDays} ngày` : `${x.overdueDays} day(s) overdue`) : x.overdueDays === 0 ? (vi ? 'đến hạn hôm nay' : 'due today') : (vi ? `còn ${-x.overdueDays} ngày` : `in ${-x.overdueDays} day(s)`)}
            </span>
            {x.autoReminded && <span style={{ fontSize: 11, color: 'var(--c94a3b8)' }}>{vi ? '· đã gửi nhắc tự động' : '· auto-reminder sent'}</span>}
            <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
              {x.phone && <a href={`tel:${x.phone}`} style={btn}>📞 {x.phone}</a>}
              <a href={bookHref(x)} style={btn}>{vi ? 'Đặt lịch' : 'Book'}</a>
              <button type="button" style={btn} disabled={busy === x.id} onClick={() => contacted(x.id)}>{vi ? 'Đã liên hệ' : 'Contacted'}</button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
