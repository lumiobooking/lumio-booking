'use client';

// WALK-IN 2.0, STEP 3 — ĐỐI SOÁT CUỐI NGÀY.
//
// Before the salon calls it a day: what is still open, what waits at the
// till, what has no service, what was closed without a receipt (and why),
// every time the desk seated someone other than the suggestion, and each
// technician's turns and money. Export to a spreadsheet; the owner signs the
// day off. Read-only apart from "Chốt ngày" — fixing happens on the walk-in
// board and at the till, one tap away.

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { SalonShell } from '../../../../components/SalonShell';
import { useAuth } from '../../../../lib/auth';
import { apiFetch } from '../../../../lib/api';
import { ui, formatPrice } from '../../../../lib/ui';
import { uiCurrency } from '../../../../lib/ui-currency';
import { uiLocale, salonTz } from '../../../../lib/datetime';
import { clockIn } from '../../../../lib/desk-time';
import { dayCsv, CLOSE_REASON_LABEL, OVERRIDE_REASON_LABEL, type DayReview } from '../../../../lib/walkin-day';

export default function WalkinDayPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token, user } = useAuth();
  const vi = uiLocale().startsWith('vi');
  const L = (a: string, b: string) => (vi ? a : b);
  const cur = uiCurrency();
  const isOwner = user?.role === 'SALON_ADMIN' || user?.role === 'SUPER_ADMIN' || Boolean(user?.supportSession);
  const [day, setDay] = useState('');
  const [data, setData] = useState<DayReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (d?: string) => {
    if (!token) return;
    setError(null);
    try {
      const r = await apiFetch<DayReview>(`/walkins/day-review${d ? `?day=${encodeURIComponent(d)}` : ''}`, { token });
      setData(r); setDay(r.day); setNote(r.closed?.note ?? '');
    } catch (e) { setError(e instanceof Error ? e.message : 'error'); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  const staffName = useMemo(() => {
    const m = new Map((data?.staff ?? []).map((s) => [s.id, s.name]));
    return (id: string | null) => (id ? m.get(id) ?? '—' : '—');
  }, [data]);
  const userName = useMemo(() => {
    const m = new Map((data?.users ?? []).map((u) => [u.id, u.name]));
    return (id: string | null) => (id ? m.get(id) ?? '' : '');
  }, [data]);

  async function closeDay() {
    if (!token || !data) return;
    if (data.issues.length && !window.confirm(L(`Còn ${data.issues.length} phiếu cần xử lý. Vẫn chốt ngày?`, `${data.issues.length} ticket(s) still need attention. Sign the day off anyway?`))) return;
    setBusy(true); setError(null);
    try { await apiFetch('/walkins/day-review/close', { method: 'POST', token, body: { day: data.day, note } }); await load(data.day); }
    catch (e) { setError(e instanceof Error ? e.message : 'error'); }
    finally { setBusy(false); }
  }

  function download() {
    if (!data) return;
    const blob = new Blob(['﻿' + dayCsv(data, { staffName, userName, vi, currency: cur })], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `walk-in-${data.day}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const time = (iso: string) => clockIn(iso, salonTz() || null, vi);
  const counts = { no_service: 0, unpaid: 0, open: 0 };
  for (const i of data?.issues ?? []) counts[i.kind] += 1;

  const kindLabel = { no_service: L('Thiếu dịch vụ', 'No service'), unpaid: L('Chưa tính tiền', 'Not paid'), open: L('Chưa xong', 'Still open') };
  const check = (ok: boolean, text: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 12, fontSize: 13.5, fontWeight: 700,
      background: ok ? 'rgba(34,197,94,0.10)' : 'var(--wash-amber-2)', color: ok ? 'var(--ink-good)' : 'var(--ink-warn)' }}>
      <span aria-hidden>{ok ? '✓' : '⚠'}</span>{text}
    </div>
  );

  return (
    <section style={{ maxWidth: 1240 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <a href="/salon/walkins" style={{ color: 'var(--ink-link)', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>← Walk-in</a>
        <h1 style={{ margin: 0, fontSize: 22 }}>{L('Đối soát cuối ngày', 'End-of-day review')}</h1>
        <input type="date" value={day} onChange={(e) => { setDay(e.target.value); void load(e.target.value); }} aria-label={L('Ngày', 'Day')}
          style={{ ...ui.input, width: 'auto', marginBottom: 0, padding: '7px 10px' }} />
        <span style={{ flex: 1 }} />
        <button type="button" onClick={download} disabled={!data} style={ghost}>{L('Xuất Excel (CSV)', 'Export (CSV)')}</button>
      </div>
      {error && <div style={ui.banner}>{error}</div>}
      {!data ? <div style={{ color: 'var(--c94a3b8)' }}>…</div> : (<>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10, marginBottom: 14 }}>
          {check(counts.open === 0, counts.open ? L(`${counts.open} khách chưa xong`, `${counts.open} still open`) : L('Không còn khách đang chờ / đang làm', 'Nobody waiting or in a chair'))}
          {check(counts.unpaid === 0, counts.unpaid ? L(`${counts.unpaid} phiếu chưa tính tiền`, `${counts.unpaid} not paid`) : L('Không còn phiếu chờ tính tiền', 'Nothing waiting to pay'))}
          {check(counts.no_service === 0, counts.no_service ? L(`${counts.no_service} phiếu thiếu dịch vụ`, `${counts.no_service} without a service`) : L('Phiếu nào cũng có dịch vụ', 'Every ticket has a service'))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
          {tile(String(data.totals.tickets), L('Phiếu walk-in', 'Walk-in tickets'))}
          {tile(String(data.totals.done), L('Đã xong', 'Done'))}
          {tile(formatPrice(data.totals.serviceCents, cur), L('Tiền dịch vụ', 'Service money'))}
          {tile(data.totals.avgWaitMin != null ? `${data.totals.avgWaitMin}′` : '—', L('Chờ trung bình', 'Average wait'))}
          {tile(data.totals.longestWaitMin != null ? `${data.totals.longestWaitMin}′` : '—', L('Chờ lâu nhất', 'Longest wait'))}
          {tile(`${data.totals.cancelled}`, L(`Bỏ về / huỷ (${data.totals.noShows} vắng mặt)`, `Left / cancelled (${data.totals.noShows} no-show)`))}
        </div>

        <div style={{ ...ui.card, padding: 0, overflowX: 'auto', marginBottom: 14 }}>
          <div style={head}>{L('Phiếu cần xử lý', 'Tickets to sort out')} · {data.issues.length}</div>
          {data.issues.length === 0 ? <div style={{ padding: '12px 16px', color: 'var(--c94a3b8)', fontSize: 13.5 }}>{L('Không có — mọi phiếu đã gọn.', 'None — every ticket is settled.')}</div> : (
            <table style={table}>
              <thead><tr><th style={th}>{L('Khách', 'Customer')}</th><th style={th}>{L('Thợ', 'Tech')}</th><th style={th}>{L('Từ', 'Since')}</th><th style={{ ...th, textAlign: 'right' }}>{L('Số tiền', 'Amount')}</th><th style={th}>{L('Vấn đề', 'Issue')}</th><th style={th} /></tr></thead>
              <tbody>
                {data.issues.map((i) => (
                  <tr key={`${i.kind}-${i.id}`}>
                    <td style={td}>{i.name}</td>
                    <td style={td}>{staffName(i.staffId)}</td>
                    <td style={td}>{time(i.since)}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{i.amountCents ? formatPrice(i.amountCents, cur) : '—'}</td>
                    <td style={td}><span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-warn)' }}>{kindLabel[i.kind]}</span></td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {i.kind === 'unpaid'
                        ? <a href={`/salon/pos?walkInId=${i.id}`} style={link}>{L('Thu tiền', 'Check out')}</a>
                        : <a href="/salon/walkins" style={link}>{L('Mở walk-in', 'Open walk-ins')}</a>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 14, alignItems: 'start', marginBottom: 14 }}>
          <div style={{ ...ui.card, padding: 0, overflowX: 'auto' }}>
            <div style={head}>{L('Tua & doanh thu theo thợ', 'Turns & money by technician')}</div>
            <table style={table}>
              <thead><tr><th style={th}>{L('Thợ', 'Tech')}</th><th style={thR}>{L('Tua', 'Turns')}</th><th style={thR}>Request</th><th style={thR}>{L('Bỏ lượt', 'Skips')}</th><th style={thR}>{L('Quầy đổi', 'Overrides')}</th><th style={thR}>{L('Dịch vụ', 'Services')}</th></tr></thead>
              <tbody>
                {data.techs.map((t) => (
                  <tr key={t.staffId}>
                    <td style={td}><b>{t.name}</b></td>
                    <td style={tdR}>{t.turns}</td>
                    <td style={tdR}>{t.requested}</td>
                    <td style={tdR}>{t.skips}</td>
                    <td style={tdR}>{t.overrides}</td>
                    <td style={tdR}>{formatPrice(t.moneyCents, cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ ...ui.card, padding: '12px 16px' }}>
              <div style={{ ...head, padding: 0, marginBottom: 8 }}>{L('Quầy chọn thợ khác gợi ý', 'Desk overrides')} · {data.overrides.length}</div>
              {data.overrides.length === 0 ? <div style={muted}>{L('Không có.', 'None.')}</div> : data.overrides.map((o, k) => (
                <div key={k} style={{ fontSize: 13, lineHeight: 1.5, padding: '4px 0', borderTop: k ? '1px solid var(--line)' : 0 }}>
                  <b>{time(String(o.at))}</b> · {L('máy gợi ý', 'suggested')} {staffName(o.suggested)} → {L('quầy chọn', 'desk chose')} <b>{staffName(o.chosen)}</b>
                  <div style={muted}>{o.reason ? (OVERRIDE_REASON_LABEL[o.reason]?.[vi ? 'vi' : 'en'] ?? o.reason) : L('không ghi lý do', 'no reason')}{userName(o.userId) ? ` · ${userName(o.userId)}` : ''}</div>
                </div>
              ))}
            </div>
            <div style={{ ...ui.card, padding: '12px 16px' }}>
              <div style={{ ...head, padding: 0, marginBottom: 8 }}>{L('Đóng không thu tiền', 'Closed without payment')} · {data.closedUnpaid.length}</div>
              {data.closedUnpaid.length === 0 ? <div style={muted}>{L('Không có.', 'None.')}</div> : data.closedUnpaid.map((c, k) => (
                <div key={k} style={{ fontSize: 13, lineHeight: 1.5, padding: '4px 0', borderTop: k ? '1px solid var(--line)' : 0 }}>
                  <b>{time(String(c.at))}</b> · {CLOSE_REASON_LABEL[c.reason ?? 'other']?.[vi ? 'vi' : 'en'] ?? c.reason}
                  <div style={muted}>{[c.note, userName(c.userId)].filter(Boolean).join(' · ')}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ ...ui.card, padding: '14px 16px', display: 'grid', gap: 10 }}>
          {data.closed
            ? <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-good)' }}>✓ {L('Đã chốt ngày lúc', 'Signed off at')} {time(data.closed.at)}{userName(data.closed.by) ? ` · ${userName(data.closed.by)}` : ''}</div>
            : <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{L('Chưa chốt ngày', 'Not signed off yet')}</div>}
          {isOwner ? (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={L('Ghi chú (không bắt buộc)', 'Note (optional)')} aria-label={L('Ghi chú', 'Note')}
                style={{ ...ui.input, marginBottom: 0, flex: '1 1 260px' }} />
              <button type="button" onClick={closeDay} disabled={busy} style={{ ...ui.primaryBtn, padding: '10px 18px' }}>{busy ? '…' : data.closed ? L('Cập nhật chốt ngày', 'Update sign-off') : L('Chốt ngày', 'Sign the day off')}</button>
            </div>
          ) : <div style={muted}>{L('Chủ tiệm chốt ngày.', 'The owner signs the day off.')}</div>}
        </div>
      </>)}
    </section>
  );
}

function tile(value: string, label: string) {
  return (
    <div style={{ ...ui.card, margin: 0, padding: '12px 14px' }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--cf8fafc)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{label}</div>
    </div>
  );
}

const ghost: CSSProperties = { background: 'transparent', border: '1px solid var(--line-strong)', borderRadius: 8, color: 'var(--ink-link)', fontSize: 13, fontWeight: 700, padding: '8px 12px', cursor: 'pointer' };
const head: CSSProperties = { padding: '12px 16px 6px', fontSize: 15, fontWeight: 800, color: 'var(--ce2e8f0)' };
const table: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13.5 };
const th: CSSProperties = { textAlign: 'left', fontSize: 11.5, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--c94a3b8)', padding: '9px 14px', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' };
const thR: CSSProperties = { ...th, textAlign: 'right' };
const td: CSSProperties = { padding: '10px 14px', borderBottom: '1px solid var(--line)', color: 'var(--ce2e8f0)' };
const tdR: CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const link: CSSProperties = { color: 'var(--ink-link)', fontWeight: 700, textDecoration: 'none', fontSize: 13 };
const muted: CSSProperties = { fontSize: 12.5, color: 'var(--c94a3b8)' };
