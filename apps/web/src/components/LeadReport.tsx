'use client';

/**
 * rt245 — lead report by day / week / month: each staff member and the whole
 * salon, who is effective and who is not, and each person's detail period by
 * period. Owner sees everyone + salon totals; staff only their own row (the
 * server decides). CSV for the owner's own planning sheet.
 */
import { Fragment, useEffect, useState, type CSSProperties } from 'react';
import { apiFetch } from '../lib/api';
import { maxOf, pct, pctText, periodLabel, ratingLabel, reasonText, secText, type Grain, type LeadReportResponse, type Person, type Rating } from '../lib/lead-report-view';

const L = (vi: boolean, v: string, e: string) => (vi ? v : e);
const RANGE: Record<Grain, [string, string]> = { day: ['31 ngày gần nhất', 'last 31 days'], week: ['12 tuần gần nhất', 'last 12 weeks'], month: ['12 tháng gần nhất', 'last 12 months'] };

const badge = (r: Rating): CSSProperties => ({
  display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
  border: '1px solid currentColor',
  color: r === 'good' ? 'var(--ink-good)' : r === 'weak' ? 'var(--ink-bad)' : r === 'ok' ? 'var(--ink-link)' : 'var(--c94a3b8)',
});
const th: CSSProperties = { textAlign: 'right', padding: '8px 10px', fontSize: 12, fontWeight: 700, color: 'var(--c94a3b8)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--c334155)' };
const td: CSSProperties = { textAlign: 'right', padding: '8px 10px', fontSize: 13.5, color: 'var(--ce2e8f0)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--c334155)', fontVariantNumeric: 'tabular-nums' };

export function LeadReport({ token, vi }: { token: string | null; vi: boolean }) {
  const [grain, setGrain] = useState<Grain>('day');
  const [data, setData] = useState<LeadReportResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    let live = true;
    setData(null); setErr(null);
    apiFetch<LeadReportResponse>(`/messenger/turns/lead-report?by=${grain}`, { token })
      .then((r) => { if (live) { setData(r); if (!r.canSeeAll && r.people[0]) setOpen(r.people[0].userId); } })
      .catch((e) => { if (live) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [token, grain]);

  const download = async () => {
    if (!token) return;
    setBusy(true);
    try {
      const r = await apiFetch<{ csv: string; filename: string }>(`/messenger/turns/lead-report?by=${grain}&format=csv`, { token });
      const url = URL.createObjectURL(new Blob(['﻿' + r.csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url; a.download = r.filename; a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const seg = (g: Grain, label: string) => (
    <button key={g} type="button" aria-pressed={grain === g} onClick={() => setGrain(g)}
      style={{ minHeight: 40, padding: '0 14px', border: 0, borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 13.5, background: grain === g ? '#4f46e5' : 'transparent', color: grain === g ? '#fff' : 'var(--ccbd5e1)' }}>{label}</button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ce2e8f0)' }}>{L(vi, 'Báo cáo lead', 'Lead report')}</div>
          <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{L(vi, RANGE[grain][0], RANGE[grain][1])}{data ? ` · ${L(vi, 'giờ tiệm', 'salon time')} ${data.tz}` : ''}</div>
        </div>
        <div role="group" aria-label={L(vi, 'Xem theo', 'View by')} style={{ display: 'inline-flex', gap: 2, padding: 3, borderRadius: 12, border: '1px solid var(--c334155)' }}>
          {seg('day', L(vi, 'Ngày', 'Day'))}{seg('week', L(vi, 'Tuần', 'Week'))}{seg('month', L(vi, 'Tháng', 'Month'))}
        </div>
        <button type="button" onClick={() => void download()} disabled={busy || !data}
          style={{ minHeight: 40, padding: '0 14px', borderRadius: 10, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ce2e8f0)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: 'inherit', opacity: busy || !data ? 0.6 : 1 }}>{busy ? '…' : L(vi, 'Tải CSV (Excel)', 'Download CSV')}</button>
      </div>

      {err && <div style={{ color: 'var(--ink-bad)', fontSize: 13 }}>{err}</div>}
      {!data && !err && <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{L(vi, 'Đang tính…', 'Working it out…')}</div>}

      {data && data.company && data.companyTotal && <Company data={data} vi={vi} />}

      {data && (
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ce2e8f0)', margin: '4px 0 6px' }}>{data.canSeeAll ? L(vi, 'Từng nhân viên', 'Each person') : L(vi, 'Của tôi', 'Mine')}</div>
          {data.teamConvPct != null && <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginBottom: 8, lineHeight: 1.5 }}>
            {L(vi, `Mức của nhóm: ${data.teamConvPct}% khách nhận được chốt lịch. "Hiệu quả" = trả lời đúng hạn ≥ 80%, bỏ turn ≤ 10% và chốt ≥ mức nhóm. "Cần cải thiện" = đúng hạn < 50%, bỏ turn > 30% hoặc chốt dưới nửa mức nhóm. Dưới 10 khách thì chưa đánh giá. Bấm một người để xem chi tiết từng kỳ.`,
              `Team bar: ${data.teamConvPct}% of chats booked. "Strong" = on time ≥ 80%, turns let go ≤ 10% and booking ≥ the team. "Needs work" = on time < 50%, turns let go > 30% or booking under half the team. Under 10 chats: not judged. Tap a person for their detail.`)}
          </div>}
          {data.people.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{L(vi, 'Chưa có khách nào được giao cho nhân viên trong khoảng này.', 'No chats were given to staff in this range.')}</div>
          ) : (
            <div style={{ overflowX: 'auto', border: '1px solid var(--c334155)', borderRadius: 12 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760 }}>
                <thead>
                  <tr>
                    <th style={{ ...th, textAlign: 'left' }}>{L(vi, 'Nhân viên', 'Person')}</th>
                    <th style={{ ...th, textAlign: 'left' }}>{L(vi, 'Đánh giá', 'Rating')}</th>
                    <th style={th}>{L(vi, 'Khách nhận', 'Chats')}</th>
                    <th style={th}>{L(vi, 'Đúng hạn', 'On time')}</th>
                    <th style={th}>{L(vi, 'Phản hồi', 'Answer')}</th>
                    <th style={th}>{L(vi, 'Bỏ turn', 'Let go')}</th>
                    <th style={th}>{L(vi, 'Có SĐT', 'Phone')}</th>
                    <th style={th}>{L(vi, 'Đặt lịch', 'Booked')}</th>
                    <th style={th}>{L(vi, 'Tỉ lệ chốt', 'Booking %')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.people.map((p) => (
                    <Fragment key={p.userId}>
                      <tr onClick={() => setOpen((o) => (o === p.userId ? null : p.userId))} style={{ cursor: 'pointer' }} aria-expanded={open === p.userId}>
                        <td style={{ ...td, textAlign: 'left', fontWeight: 700 }}>{open === p.userId ? '▾' : '▸'} {p.name}</td>
                        <td style={{ ...td, textAlign: 'left' }}><span style={badge(p.rating)}>{ratingLabel(p.rating, vi)}</span>
                          {p.reasons.length > 0 && <div style={{ fontSize: 11.5, color: 'var(--ink-bad)', marginTop: 3, whiteSpace: 'normal', maxWidth: 220 }}>{p.reasons.map((r) => reasonText(r, vi)).join(' · ')}</div>}
                        </td>
                        <td style={td}>{p.total.received}</td>
                        <td style={td}>{pctText(p.total.onTimePct)}</td>
                        <td style={td}>{secText(p.total.medianSec, vi)}</td>
                        <td style={{ ...td, color: p.total.lost ? 'var(--ink-warn)' : td.color }}>{p.total.lost}</td>
                        <td style={td}>{p.total.contact}</td>
                        <td style={{ ...td, fontWeight: 700 }}>{p.total.booked}</td>
                        <td style={td}>{pctText(p.total.convPct)}</td>
                      </tr>
                      {open === p.userId && <tr><td colSpan={9} style={{ padding: 0, borderBottom: '1px solid var(--c334155)' }}><Detail p={p} data={data} vi={vi} /></td></tr>}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The salon as a whole: every new chat (AI-handled too), phones, bookings, per period. */
function Company({ data, vi }: { data: LeadReportResponse; vi: boolean }) {
  const t = data.companyTotal!;
  const c = data.company!;
  const top = maxOf(data.periods.map((p) => c[p]?.newChats ?? 0));
  const tile = (label: string, value: string, sub?: string) => (
    <div style={{ flex: '1 1 140px', minWidth: 0, padding: 12, borderRadius: 12, border: '1px solid var(--c334155)' }}>
      <div style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ce2e8f0)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--c94a3b8)' }}>{sub}</div>}
    </div>
  );
  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ce2e8f0)', margin: '0 0 6px' }}>{L(vi, 'Tổng tiệm', 'Whole salon')}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {tile(L(vi, 'Chat mới', 'New chats'), String(t.newChats), L(vi, 'mọi kênh, cả khách AI tự lo', 'every channel, AI-handled too'))}
        {tile(L(vi, 'Để lại SĐT', 'Left a phone'), String(t.withContact), pctText(pct(t.withContact, t.newChats)))}
        {tile(L(vi, 'Đặt lịch', 'Booked'), String(t.booked), L(vi, `tỉ lệ chốt ${pctText(pct(t.booked, t.newChats))}`, `${pctText(pct(t.booked, t.newChats))} booked`))}
        {tile(L(vi, 'Nhân viên chốt', 'Booked by staff'), String(t.bookedByStaff), L(vi, `còn ${t.booked - t.bookedByStaff} do AI / tự đặt`, `${t.booked - t.bookedByStaff} by AI / self`))}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, minWidth: data.periods.length * 30, height: 120, padding: '0 2px' }} aria-label={L(vi, 'Chat mới và đặt lịch theo kỳ', 'New chats and bookings by period')}>
          {data.periods.map((p) => {
            const x = c[p] ?? { newChats: 0, booked: 0, withContact: 0, bookedByStaff: 0 };
            return (
              <div key={p} title={`${periodLabel(p, data.grain, vi)}: ${x.newChats} chat · ${x.withContact} SĐT · ${x.booked} ${L(vi, 'lịch', 'booked')}`} style={{ flex: '1 1 0', minWidth: 22, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                <div style={{ fontSize: 10.5, color: 'var(--c94a3b8)', fontVariantNumeric: 'tabular-nums' }}>{x.newChats || ''}</div>
                <div style={{ width: '100%', height: Math.max(2, Math.round((x.newChats / top) * 80)), borderRadius: 4, background: 'var(--wash-blue)', position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: x.newChats ? `${Math.round((x.booked / x.newChats) * 100)}%` : 0, background: '#4f46e5' }} />
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 4, minWidth: data.periods.length * 30, padding: '4px 2px 0' }}>
          {data.periods.map((p, i) => (
            <div key={p} style={{ flex: '1 1 0', minWidth: 22, fontSize: 10, color: 'var(--c94a3b8)', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}>
              {data.grain === 'day' ? (i % 3 === 0 || i === data.periods.length - 1 ? periodLabel(p, 'day', vi).split(' ')[1] : '') : periodLabel(p, data.grain, vi).split('–')[0]}
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--c94a3b8)', marginTop: 4 }}>{L(vi, 'Cột nhạt = chat mới · phần đậm = đã đặt lịch', 'Light = new chats · dark = booked')}</div>
      </div>
    </div>
  );
}

/** One person, period by period (newest first). */
function Detail({ p, data, vi }: { p: Person; data: LeadReportResponse; vi: boolean }) {
  const rows = [...data.periods].reverse().map((k) => ({ k, c: p.cells[k] })).filter((r) => r.c && (r.c.received || r.c.lost || r.c.booked));
  if (!rows.length) return <div style={{ padding: 12, fontSize: 13, color: 'var(--c94a3b8)' }}>{L(vi, 'Không có hoạt động trong khoảng này.', 'No activity in this range.')}</div>;
  return (
    <div style={{ padding: '6px 10px 10px', background: 'var(--wash-blue)' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left' }}>{data.grain === 'day' ? L(vi, 'Ngày', 'Day') : data.grain === 'week' ? L(vi, 'Tuần', 'Week') : L(vi, 'Tháng', 'Month')}</th>
            <th style={th}>{L(vi, 'Nhận', 'Chats')}</th>
            <th style={th}>{L(vi, 'Đã trả lời', 'Answered')}</th>
            <th style={th}>{L(vi, 'Đúng hạn', 'On time')}</th>
            <th style={th}>{L(vi, 'Phản hồi', 'Answer')}</th>
            <th style={th}>{L(vi, 'Bỏ turn', 'Let go')}</th>
            <th style={th}>{L(vi, 'Có SĐT', 'Phone')}</th>
            <th style={th}>{L(vi, 'Đặt lịch', 'Booked')}</th>
            <th style={th}>{L(vi, 'Chốt', 'Booking %')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ k, c }) => (
            <tr key={k}>
              <td style={{ ...td, textAlign: 'left' }}>{periodLabel(k, data.grain, vi)}</td>
              <td style={td}>{c.received}</td>
              <td style={td}>{c.answered}</td>
              <td style={td}>{pctText(pct(c.onTime, c.received))}</td>
              <td style={td}>{secText(c.medianSec, vi)}</td>
              <td style={{ ...td, color: c.lost ? 'var(--ink-warn)' : td.color }}>{c.lost}</td>
              <td style={td}>{c.contact}</td>
              <td style={{ ...td, fontWeight: 700 }}>{c.booked}</td>
              <td style={td}>{pctText(pct(c.booked, c.received))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
