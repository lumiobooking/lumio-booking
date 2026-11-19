'use client';

/**
 * Nhật ký ca — who did what, and when, during one night (19/11/2026, from the
 * approved mockup "2 · Nhật ký ca"). Read from the server's audit log, so
 * nobody can edit or delete a line. Owners and managers see everyone; other
 * staff see only their own actions.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '../../lib/auth';
import { useLang } from '../../lib/i18n';
import { apiFetch } from '../../lib/api';
import { formatPrice } from '../../lib/ui';
import { fmtInTz } from '../../lib/datetime';
import { useLiveRefresh } from '../../lib/useLiveRefresh';
import { DEFAULT_DAY_START, addDaysKey, bizDayKey, bizWindow, nightLabel } from '../../lib/restaurant-day';
import { C, Card, H2, Row, num, one } from './rk';

import { describe, type Filter, type LogResp, type ShiftResp } from '../../lib/night-log-lines';
export type { LogEvent } from '../../lib/night-log-lines';

const TONE_BG: Record<string, string> = { g: 'rgba(34,197,94,.16)', b: 'rgba(239,68,68,.16)', y: 'rgba(245,158,11,.18)', i: 'rgba(99,102,241,.18)', n: 'rgba(148,163,184,.16)' };

export function NightLog() {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const L = (v: string, e: string) => (vi ? v : e);
  const [startHour, setStartHour] = useState<number | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [data, setData] = useState<LogResp | null>(null);
  const [shift, setShift] = useState<ShiftResp | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [shown, setShown] = useState(40);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    apiFetch<{ dayStartHour?: number }>('/restaurant/settings', { token })
      .then((s) => { const h = typeof s.dayStartHour === 'number' ? s.dayStartHour : DEFAULT_DAY_START; setStartHour(h); setDay(bizDayKey(new Date(), h)); })
      .catch(() => { setStartHour(DEFAULT_DAY_START); setDay(bizDayKey(new Date(), DEFAULT_DAY_START)); });
  }, [token]);

  const load = useCallback(async () => {
    if (!token || startHour === null || !day) return;
    try {
      const w = bizWindow(day, startHour);
      const [d, sh] = await Promise.all([
        apiFetch<LogResp>(`/restaurant/log?from=${encodeURIComponent(w.from)}&to=${encodeURIComponent(w.to)}`, { token }),
        apiFetch<ShiftResp>('/pos/shifts/current', { token }).catch(() => null),
      ]);
      setData(d); setShift(sh); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [token, startHour, day]);
  useEffect(() => { setData(null); setShown(40); void load(); }, [load]);
  useLiveRefresh(load, 60_000);

  const money = (c: number) => formatPrice(c);
  const list = useMemo(() => {
    const ev = data?.events ?? [];
    if (filter === 'all') return ev;
    if (filter === 'discount') return ev.filter((e) => (e.discountPct ?? 0) >= (data?.discountPct ?? 30));
    return ev.filter((e) => e.kind === filter || (filter === 'money' && e.kind === 'cash'));
  }, [data, filter]);

  if (error) return <div style={{ padding: 16, color: C.bad }}>{error}</div>;
  if (startHour === null || !day) return <div style={{ padding: 24, color: C.muted }}>{L('Đang tải…', 'Loading…')}</div>;
  const today = bizDayKey(new Date(), startHour);
  const clock = (iso: string) => fmtInTz(iso, { hour: '2-digit', minute: '2-digit', hour12: false });
  const counts = data?.counts ?? {};
  const chips: [Filter, string, number | undefined][] = [
    ['all', L('Tất cả', 'All'), counts.all],
    ['void', L('Huỷ', 'Voids'), counts.void],
    ['money', L('Tiền', 'Money'), (counts.money ?? 0) + (counts.cash ?? 0)],
    ['shift', L('Ca', 'Shifts'), counts.shift],
    ['table', L('Bàn', 'Tables'), counts.table],
    ['discount', L('Giảm giá', 'Discounts'), counts.discount],
  ];
  const open = shift?.shift && shift.shift.status === 'OPEN' && day === today ? shift : null;
  const seg = (k: string, label: string, active: boolean) => (
    <button key={k} type="button" onClick={() => setDay(k)} style={{ height: 40, border: 0, borderRadius: 9, background: active ? C.card : 'transparent', color: active ? C.ink : C.ink2, font: 'inherit', fontSize: 14, fontWeight: active ? 700 : 500, cursor: 'pointer', ...one }}>{label}</button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 640 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: C.ink, ...one }}>{L('Nhật ký', 'Log')}</h1>
        <span style={{ fontSize: 14, color: C.muted, ...num }}>{nightLabel(day, vi, true)} · {L(`từ ${String(startHour).padStart(2, '0')}:00`, `from ${String(startHour).padStart(2, '0')}:00`)}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 4, padding: 4, background: C.line, borderRadius: 12 }}>
        {seg(today, L('Đêm nay', 'Tonight'), day === today)}
        {seg(addDaysKey(today, -1), L('Đêm qua', 'Last night'), day === addDaysKey(today, -1))}
        <label style={{ position: 'relative', height: 40, borderRadius: 9, background: day !== today && day !== addDaysKey(today, -1) ? C.card : 'transparent', color: C.ink2, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', ...one }}>
          {day !== today && day !== addDaysKey(today, -1) ? nightLabel(day, vi) : L('Chọn ngày', 'Pick a day')}
          <input type="date" value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label={L('Chọn ngày', 'Pick a day')} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
        </label>
      </div>

      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
        {chips.map(([k, label, n]) => (
          <button key={k} type="button" onClick={() => { setFilter(k); setShown(40); }} style={{ flexShrink: 0, height: 36, padding: '0 14px', borderRadius: 18, border: `1px solid ${filter === k ? C.ink : C.line}`, background: filter === k ? C.ink : C.card, color: filter === k ? C.page : C.ink2, fontSize: 14, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {label}{typeof n === 'number' ? ` ${n}` : ''}
          </button>
        ))}
      </div>

      {open?.shift && open.summary && (
        <Card tone="warn">
          <H2 right={<span style={{ fontSize: 13, color: C.muted, ...num }}>{L('từ', 'since')} {clock(open.shift.openedAt)}</span>}>{L(`Ca của ${open.shift.openedByName ?? '—'} · đang mở`, `${open.shift.openedByName ?? '—'}'s shift · open`)}</H2>
          <Row first label={L('Tiền đầu ca', 'Opening float')} value={money(open.shift.openingCents)} />
          <Row label={L('Thu tiền mặt', 'Cash taken')} value={money(open.summary.byMethod.cashCents - open.summary.changeCents)} />
          <Row label={L('Chuyển khoản / QR', 'Transfer / QR')} value={money(open.summary.byMethod.otherCents)} />
          <Row label={L('Két phải có lúc này', 'Drawer should hold now')} value={money(open.summary.expectedCashCents)} />
          {open.summary.voidedItems && open.summary.voidedItems.count > 0 && <Row label={L('Món bị huỷ trong ca', 'Dishes taken back')} value={`${open.summary.voidedItems.count} · ${money(open.summary.voidedItems.totalCents)}`} tone="bad" />}
          <Row label={L('Đóng ca và đếm két', 'Close and count the drawer')} value="" href="/salon/pos/shifts" />
        </Card>
      )}

      <Card>
        <H2>{L('Diễn biến', 'What happened')}</H2>
        {data === null ? <div style={{ color: C.muted, padding: '8px 0' }}>{L('Đang tải…', 'Loading…')}</div>
          : list.length === 0 ? <div style={{ color: C.muted, padding: '8px 0' }}>{L('Chưa có gì trong đêm này.', 'Nothing yet this night.')}</div>
          : list.slice(0, shown).map((e, i) => {
            const d = describe(e, vi, money);
            return (
              <div key={e.id} style={{ display: 'flex', gap: 12, padding: '12px 10px', margin: '0 -10px', borderTop: i && !d.alarm ? `1px solid ${C.line}` : 0, background: d.alarm ? 'rgba(239,68,68,.10)' : undefined, borderRadius: d.alarm ? 14 : 0 }}>
                <div aria-hidden="true" style={{ width: 38, height: 38, borderRadius: 12, background: TONE_BG[d.tone], display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>{d.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 15, fontWeight: 700, color: C.ink }}>
                    <span style={one}>{d.title}</span>
                    {d.amount && <span style={{ ...num, color: d.amountTone ? C[d.amountTone] : C.ink }}>{d.amount}</span>}
                  </div>
                  <div style={{ fontSize: 13, color: C.ink2, marginTop: 2, lineHeight: 1.45 }}><span style={{ color: C.muted, fontWeight: 600, ...num }}>{clock(e.at)}</span>{d.sub ? ` · ${d.sub}` : ''}</div>
                </div>
              </div>
            );
          })}
        {list.length > shown && (
          <button type="button" onClick={() => setShown((n) => n + 60)} style={{ marginTop: 8, width: '100%', height: 48, borderRadius: 14, border: 0, background: 'rgba(99,102,241,.14)', color: C.link, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
            {L(`Xem thêm ${list.length - shown} sự kiện`, `Show ${list.length - shown} more`)}
          </button>
        )}
        {data?.truncated && <div style={{ fontSize: 12.5, color: C.muted, marginTop: 8 }}>{L('Chỉ hiện 1.500 sự kiện mới nhất của đêm.', 'Showing the latest 1,500 events.')}</div>}
      </Card>

      <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.5, padding: '0 4px' }}>
        {data?.mine
          ? L('Bạn đang xem thao tác của chính mình. Chủ và quản lý xem được toàn bộ.', 'You are seeing your own actions. Owners and managers see everyone.')
          : L('Mọi thao tác được ghi theo đúng tài khoản người bấm và không ai sửa / xoá được. Muốn biết đúng ai bấm, mỗi nhân viên cần tài khoản riêng.', 'Every action is recorded under the login that did it and cannot be edited or deleted. To know exactly who did what, give each person their own login.')}
        {' '}<Link href="/salon/pos/report" style={{ color: C.link }}>{L('Báo cáo đêm', 'Night report')}</Link>
      </div>
    </div>
  );
}
