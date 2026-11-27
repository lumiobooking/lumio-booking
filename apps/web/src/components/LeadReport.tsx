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
          <Rules vi={vi} teamConvPct={data.teamConvPct} />
          {data.people.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{L(vi, 'Chưa có khách nào được giao cho nhân viên trong khoảng này.', 'No chats were given to staff in this range.')}</div>
          ) : (
            <div style={{ overflowX: 'auto', border: '1px solid var(--c334155)', borderRadius: 12 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 980 }}>
                <thead>
                  <tr>
                    <th style={{ ...th, textAlign: 'left' }}>{L(vi, 'Nhân viên', 'Person')}</th>
                    <th style={{ ...th, textAlign: 'left' }}>{L(vi, 'Đánh giá', 'Rating')}</th>
                    <Heads vi={vi} first={null} />
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
                        <Cells c={p.total} vi={vi} />
                      </tr>
                      {open === p.userId && <tr><td colSpan={12} style={{ padding: 0, borderBottom: '1px solid var(--c334155)' }}><Detail p={p} data={data} vi={vi} /></td></tr>}
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
        {tile(L(vi, 'Chốt (đặt lịch / lead thành công)', 'Closed (booked / lead won)'), String(t.booked), L(vi, `tỉ lệ chốt ${pctText(pct(t.booked, t.newChats))}`, `${pctText(pct(t.booked, t.newChats))} closed`))}
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
  const rows = [...data.periods].reverse().map((k) => ({ k, c: p.cells[k] })).filter((r) => r.c && (r.c.turns || r.c.lost || r.c.booked || r.c.selfTaken || r.c.declined));
  if (!rows.length) return <div style={{ padding: 12, fontSize: 13, color: 'var(--c94a3b8)' }}>{L(vi, 'Không có hoạt động trong khoảng này.', 'No activity in this range.')}</div>;
  return (
    <div style={{ padding: '6px 10px 10px', background: 'var(--wash-blue)' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left' }}>{data.grain === 'day' ? L(vi, 'Ngày', 'Day') : data.grain === 'week' ? L(vi, 'Tuần', 'Week') : L(vi, 'Tháng', 'Month')}</th>
            <Heads vi={vi} first={null} />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ k, c }) => (
            <tr key={k}>
              <td style={{ ...td, textAlign: 'left' }}>{periodLabel(k, data.grain, vi)}</td>
              <Cells c={c} vi={vi} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** rt248: the same columns for the totals row and each period. */
function Heads({ vi }: { vi: boolean; first: null }) {
  const h = (v: string, e: string, title: string) => <th style={th} title={title}>{L(vi, v, e)}</th>;
  return (
    <>
      {h('Khách nhận', 'Customers', L(vi, 'Số khách khác nhau được giao', 'Different customers given'))}
      {h('Lượt turn', 'Turns', L(vi, 'Khách mới + khách chuyển tới + khách của mình nhắn lại', 'New + passed on + own customer writing back'))}
      {h('Đúng hạn', 'On time', L(vi, 'Lượt tự trả lời trước khi hết giờ / lượt giữ lại (không tính lượt từ chối)', 'Turns answered before the timer / turns kept'))}
      {h('Phản hồi', 'Answer', L(vi, 'Thời gian trung vị từ lúc nhận tới câu trả lời đầu', 'Median time to the first answer'))}
      {h('Quá giờ', 'Timed out', L(vi, 'Lượt bị hệ thống chuyển đi vì không mở / không trả lời kịp', 'Turns passed on for not opening / not answering in time'))}
      {h('Từ chối', 'Declined', L(vi, 'Lượt bấm "Không nhận" — chuyển ngay cho người khác', 'Turns released with "Decline"'))}
      {h('Tự nhận', 'Self-taken', L(vi, 'Khách chưa ai giữ mà mình chủ động trả lời (không tính là turn)', 'Unheld customers they answered on their own'))}
      {h('Có SĐT', 'Contact', L(vi, 'Khách để lại số / email (khách gõ trong chat, đã lưu, hoặc thẻ lead)', 'Left a phone / email'))}
      {h('Chốt', 'Closed', L(vi, 'Đặt lịch, hoặc thẻ lead chuyển "Thành công", trong lúc mình đang giữ khách', 'Booked, or lead marked won, while they held it'))}
      {h('Tỉ lệ chốt', 'Close %', L(vi, 'Chốt / khách nhận', 'Closed / customers'))}
    </>
  );
}

function Cells({ c, vi }: { c: import('../lib/lead-report-view').Cell; vi: boolean }) {
  const kept = Math.max(0, c.turns - c.declined);
  return (
    <>
      <td style={td}>{c.received}</td>
      <td style={td}>{c.turns}</td>
      <td style={td}>{pctText(pct(c.onTime, kept))}</td>
      <td style={td}>{secText(c.medianSec, vi)}</td>
      <td style={{ ...td, color: c.lost ? 'var(--ink-warn)' : td.color }}>{c.lost}</td>
      <td style={td}>{c.declined}</td>
      <td style={td}>{c.selfTaken}</td>
      <td style={td}>{c.contact}</td>
      <td style={{ ...td, fontWeight: 700 }}>{c.booked}</td>
      <td style={td}>{pctText(pct(c.booked, c.received))}</td>
    </>
  );
}

/** rt248: what a person must do with a turn, and how every number is counted — folded by default. */
function Rules({ vi, teamConvPct }: { vi: boolean; teamConvPct: number | null }) {
  const li = (t: string) => <li style={{ marginBottom: 4 }}>{t}</li>;
  return (
    <details style={{ marginBottom: 10, border: '1px solid var(--c334155)', borderRadius: 10, padding: '8px 12px' }}>
      <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 13, color: 'var(--ce2e8f0)' }}>
        {L(vi, 'Quy tắc nhận turn & cách tính', 'Turn rules & how it is counted')}{teamConvPct != null ? L(vi, ` · mức chốt của nhóm ${teamConvPct}%`, ` · team close rate ${teamConvPct}%`) : ''}
      </summary>
      <div style={{ fontSize: 12.5, color: 'var(--ccbd5e1)', lineHeight: 1.6, marginTop: 8 }}>
        <b>{L(vi, 'Nhân viên khi nhận turn:', 'When a person gets a turn:')}</b>
        <ol style={{ margin: '4px 0 8px', paddingLeft: 20 }}>
          {li(L(vi, 'Mở cuộc trò chuyện trong thời gian "chưa mở" của tiệm, và TỰ trả lời khách trong thời gian "chưa trả lời". AI có trả lời trước thì nhân viên vẫn phải trả lời — câu của AI không tính cho nhân viên.', 'Open the chat within the salon\'s "not opened" time and reply yourself within the "not answered" time. Even when the AI answered first, the person still replies — the AI\'s answer does not count for them.'))}
          {li(L(vi, 'Không nhận được (bận, không đúng chuyên môn): bấm "Không nhận" ở trên ô trả lời — khách chuyển ngay cho người kế tiếp, tính là "Từ chối", không tính "Quá giờ".', 'Cannot take it: press "Decline" above the reply box — it goes to the next person at once and counts as "Declined", not "Timed out".'))}
          {li(L(vi, 'Để hết giờ mà không mở / không trả lời: hệ thống tự chuyển và tính "Quá giờ".', 'Let the timer run out: it is passed on and counted as "Timed out".'))}
          {li(L(vi, 'Khách của mình nhắn lại sau khi mình đã trả lời: là một lượt turn mới, đồng hồ chạy lại.', 'Your customer writes again after you answered: a new turn, the clock restarts.'))}
          {li(L(vi, 'Chủ động trả lời khách chưa ai giữ: khách thành của mình, tính "Tự nhận" (không phải turn, không tính thời gian phản hồi).', 'Answering an unheld customer: they become yours, counted as "Self-taken" (not a turn).'))}
        </ol>
        <b>{L(vi, 'Đánh giá (trong khoảng đang xem, cần ít nhất 10 lượt turn):', 'Rating (in this range, at least 10 turns):')}</b>
        <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
          {li(L(vi, 'Hiệu quả: đúng hạn ≥ 80%, quá giờ ≤ 10% lượt turn, tỉ lệ chốt ≥ mức của nhóm.', 'Strong: on time ≥ 80%, timed out ≤ 10% of turns, close rate ≥ the team.'))}
          {li(L(vi, 'Cần cải thiện: đúng hạn < 50%, quá giờ > 30%, từ chối > 40% lượt turn, hoặc tỉ lệ chốt dưới nửa mức nhóm.', 'Needs work: on time < 50%, timed out > 30%, declined > 40% of turns, or close rate under half the team.'))}
          {li(L(vi, 'Chốt = khách đặt lịch, hoặc thẻ lead chuyển "Thành công" (trang bán hàng), tính cho người đang giữ khách lúc đó.', 'Closed = a booking, or a lead marked won (sales pages), credited to whoever held the customer then.'))}
        </ul>
      </div>
    </details>
  );
}
