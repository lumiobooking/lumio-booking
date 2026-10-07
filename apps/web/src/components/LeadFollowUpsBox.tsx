'use client';

/**
 * CẦN GỌI LẠI — a real-estate office's call-backs that are due.
 *
 * Every lead whose "Hẹn liên hệ lại" date has come (today or overdue) and who
 * is not closed, most overdue first, with the number to call. The team also
 * gets one morning push with the count; it opens this list.
 */
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ui } from '../lib/ui';

interface Item { id: string; name: string; phone: string | null; stage: string | null; nextStep: string; overdueDays: number }
const STAGE: Record<string, [string, string]> = { new: ['Mới', 'New'], contacted: ['Đã liên hệ', 'Contacted'], viewing: ['Đang xem nhà', 'Viewing'], negotiating: ['Đàm phán', 'Negotiating'] };

export function LeadFollowUpsBox({ vi }: { vi: boolean }) {
  const { token } = useAuth();
  const [items, setItems] = useState<Item[] | null>(null);
  useEffect(() => {
    if (!token) return;
    apiFetch<{ items: Item[] }>('/customers/follow-ups', { token }).then((r) => setItems(r?.items ?? [])).catch(() => setItems(null));
  }, [token]);
  if (!items) return null;
  return (
    <div id="followups" style={{ ...ui.card, marginBottom: 14, borderColor: items.length ? 'rgba(245,158,11,0.55)' : 'var(--c334155)' }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--cf1f5f9)', marginBottom: 8 }}>
        📞 {vi ? 'Cần gọi lại' : 'Call-backs due'} {items.length > 0 && <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 9px', borderRadius: 999, background: 'rgba(245,158,11,0.16)', color: 'var(--ink-warn)' }}>{items.length}</span>}
      </div>
      {items.length === 0 && <div style={{ fontSize: 13, color: 'var(--ink-good)' }}>✓ {vi ? 'Không có khách nào đến hạn gọi lại hôm nay.' : 'No call-backs due today.'}</div>}
      <div style={{ display: 'grid', gap: 6 }}>
        {items.slice(0, 30).map((x) => (
          <div key={x.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 10px', border: '1px solid var(--c334155)', borderRadius: 10, background: 'var(--c0f172a)' }}>
            <a href={`/salon/customers/${x.id}`} style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--c818cf8)', textDecoration: 'none' }}>{x.name}</a>
            {x.stage && STAGE[x.stage] && <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 999, background: 'var(--c1e293b)', color: 'var(--ccbd5e1)' }}>{vi ? STAGE[x.stage][0] : STAGE[x.stage][1]}</span>}
            <span style={{ fontSize: 12, fontWeight: 700, color: x.overdueDays > 0 ? 'var(--ink-bad)' : 'var(--ink-warn)' }}>
              {x.overdueDays > 0 ? (vi ? `quá hạn ${x.overdueDays} ngày` : `${x.overdueDays} day(s) overdue`) : (vi ? 'hôm nay' : 'today')}
            </span>
            {x.phone && <a href={`tel:${x.phone}`} style={{ marginLeft: 'auto', padding: '5px 10px', borderRadius: 8, border: '1px solid var(--c475569)', color: 'var(--ccbd5e1)', fontSize: 12.5, textDecoration: 'none' }}>📞 {x.phone}</a>}
          </div>
        ))}
      </div>
    </div>
  );
}
