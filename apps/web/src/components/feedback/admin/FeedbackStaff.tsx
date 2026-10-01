'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { C, cardStyle, lblStyle, Lx, Pill, Chip, Btn, Seg, Avatar, CardHead, Delta, Bars, Meter, Spark, LineChart, axisRange, reasonText, weekLabel, whenText, shortDate, ordinal, Empty } from './fb-ui';
import type { Overview } from './FeedbackOverview';

/** Every technician at a glance — the door to each one's scorecard. */
export function FeedbackStaffList({ data, lang, periodLabel, onStaff }: { data: Overview; lang: string; periodLabel: string; onStaff: (id: string) => void }) {
  const L = Lx(lang);
  const flagged = new Map(data.attention.flags.map((f) => [f.staffId, f]));
  const goal = data.goalPct;
  if (!data.staff.length) return <div style={cardStyle}><Empty>{L('Chưa có câu trả lời nào gắn với thợ trong kỳ này.', 'No answers linked to a technician in this period yet.')}</Empty></div>;
  return (
    <>
      <div style={{ fontSize: 13, color: C.muted }}>{L(`${periodLabel} · bấm vào thợ để xem bảng điểm, xu hướng và ghi chú kèm cặp.`, `${periodLabel} · tap a technician for their scorecard, trend and coaching notes.`)}</div>
      <div className="fb-staffgrid">
        {data.staff.map((s) => {
          const f = flagged.get(s.staffId);
          const low = s.pct != null && s.pct < goal - 5;
          const col = low ? C.amber : C.acc2;
          return (
            <div key={s.staffId} className="fb-row" onClick={() => onStaff(s.staffId)} role="button" tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') onStaff(s.staffId); }}
              style={{ ...cardStyle, padding: 18, display: 'flex', flexDirection: 'column', gap: 12, background: f ? C.flagRow : C.card }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Avatar name={s.name} initials={s.initials} url={s.avatarUrl} size={42} seed={s.staffId} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ color: C.ink, fontSize: 15 }}>{s.name}</b>
                  <div style={{ fontSize: 12.5, color: C.muted }}>{L(`${s.answers} trả lời · ${s.google} lên Google`, `${s.answers} answers · ${s.google} to Google`)}</div>
                </div>
                {f && <Pill tone="warn">⚠</Pill>}
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
                <div>
                  <div style={lblStyle}>{L('Hài lòng', 'Happy')}</div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: low ? C.warn : C.ink, marginTop: 4 }}>{s.pct == null ? '—' : `${s.pct}%`}</div>
                </div>
                <Spark data={s.weeks} color={col} w={110} h={34} />
              </div>
              <Meter pct={s.pct} color={col} />
              <div style={{ fontSize: 13, color: C.muted, minHeight: 20 }}>
                {f ? <span style={{ color: C.warn, fontWeight: 700 }}>{L(`${f.count} × “${reasonText(f.reason, lang)}” trong ${f.days} ngày`, `${f.count} × “${f.reason}” in ${f.days} days`)}</span>
                  : s.complaints ? L(`${s.complaints} chưa hài lòng${s.topReason ? ` · nhiều nhất: ${reasonText(s.topReason, lang)}` : ''}`, `${s.complaints} not quite${s.topReason ? ` · mostly ${s.topReason}` : ''}`)
                  : L('Chưa có lời phàn nàn nào', 'No complaints')}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

interface Card {
  staff: { id: string; name: string; initials: string; avatarUrl: string | null; since: string; active: boolean };
  kpis: { answers: number; happy: number; pct: number | null; salonPct: number | null; trendDelta: number | null; rank: number | null; ranked: number; google: number; googleOfHappy: number | null; cases: number; overdue: number; wonBack: number; needsAttention: boolean };
  trend: { week: string; pct: number | null; salon: number | null; answers: number }[];
  reasons: { reason: string; count: number }[];
  pattern: string | null;
  latest: { id: string; createdAt: string; sentiment: 'HAPPY' | 'UNHAPPY'; reasons: string[]; comment: string | null; toGoogle: boolean; customerName: string; service: string | null; case: { id: string; status: string; overdue: boolean; wonBack: boolean } | null }[];
  coaching: { id: string; kind: string; text: string; goalPct: number | null; goalUntil: string | null; byName: string | null; createdAt: string }[];
  goal: { pct: number; until: string; since: string; text: string } | null;
}

function tenure(since: string, lang: string): string {
  const L = Lx(lang);
  const months = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / (30.44 * 86_400_000)));
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (!y && !m) return L('mới vào tiệm', 'new at the salon');
  return L(`${y ? `${y} năm ` : ''}${m ? `${m} tháng ` : ''}ở tiệm`, `${y ? `${y} yr ` : ''}${m ? `${m} mo ` : ''}at the salon`).replace(/\s+/g, ' ');
}

/** One technician: the numbers, the trend against the salon, what customers said, and the coaching log. */
export function StaffScorecard({ token, lang, staffId, range, canCoach, onBack, onCase }: {
  token: string; lang: string; staffId: string; range: { from: string; to: string } | null; canCoach: boolean;
  onBack: () => void; onCase: (id: string) => void;
}) {
  const L = Lx(lang);
  const [d, setD] = useState<Card | null>(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<'all' | 'happy' | 'unhappy'>('all');
  const [form, setForm] = useState<null | 'NOTE' | 'PRAISE' | 'GOAL'>(null);
  const [text, setText] = useState('');
  const [goalPct, setGoalPct] = useState(90);
  const [goalDays, setGoalDays] = useState(30);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const qs = range ? `?from=${range.from}&to=${range.to}` : '';
    try { setD(await apiFetch<Card>(`/feedback/staff/${encodeURIComponent(staffId)}${qs}`, { token })); setErr(''); }
    catch (e) { setErr((e as Error).message); }
  }, [staffId, range, token]);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!form || busy) return;
    setBusy(true); setErr('');
    try {
      await apiFetch(`/feedback/staff/${encodeURIComponent(staffId)}/coaching`, { method: 'POST', token, body: form === 'GOAL' ? { kind: 'GOAL', goalPct, goalDays, text } : { kind: form, text } });
      setForm(null); setText('');
      await load();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const crumbs = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.muted, fontSize: 13.5, flexWrap: 'wrap' }}>
      <button type="button" className="fb-btn" onClick={onBack} style={{ background: 'none', border: 'none', padding: 0, color: C.muted, fontSize: 13.5 }}>{L('Phản hồi', 'Feedback')}</button>
      <span>›</span>
      <button type="button" className="fb-btn" onClick={onBack} style={{ background: 'none', border: 'none', padding: 0, color: C.muted, fontSize: 13.5 }}>{L('Thợ', 'Staff')}</button>
      <span>›</span>
      <b style={{ color: C.ink }}>{d?.staff.name ?? '…'}</b>
    </div>
  );
  if (!d) return <>{crumbs}<div style={cardStyle}><Empty>{err || L('Đang tải…', 'Loading…')}</Empty></div></>;

  const k = d.kpis;
  const first = d.staff.name.split(' ')[0];
  const color = k.pct != null && k.salonPct != null && k.pct < k.salonPct - 5 ? C.amber : C.acc2;
  const { min, max } = axisRange([...d.trend.map((t) => t.pct), ...d.trend.map((t) => t.salon)]);
  const lastMine = [...d.trend].reverse().find((t) => t.pct != null)?.pct;
  const lastSalon = [...d.trend].reverse().find((t) => t.salon != null)?.salon;
  const unhappyN = d.latest.filter((x) => x.sentiment === 'UNHAPPY').length;
  const latest = d.latest.filter((x) => filter === 'all' || (filter === 'happy' ? x.sentiment === 'HAPPY' : x.sentiment === 'UNHAPPY'));
  const goal = d.goal;
  const goalDay = goal ? Math.max(1, Math.ceil((Date.now() - new Date(goal.since).getTime()) / 86_400_000)) : 0;
  const goalLen = goal ? Math.max(1, Math.round((new Date(goal.until).getTime() - new Date(goal.since).getTime()) / 86_400_000)) : 0;
  const scoreCell = { padding: '4px 22px', borderLeft: `1px solid ${C.line}` } as const;

  return (
    <>
      {crumbs}
      <div style={{ ...cardStyle, display: 'flex', gap: 22, alignItems: 'center', padding: '20px 22px', flexWrap: 'wrap' }}>
        <Avatar name={d.staff.name} initials={d.staff.initials} url={d.staff.avatarUrl} size={72} seed={d.staff.id} />
        <div style={{ minWidth: 230 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 24, fontWeight: 800, color: C.ink }}>{d.staff.name}</span>
            {k.needsAttention && <Pill tone="warn">⚠ {L('Cần chú ý', 'Needs attention')}</Pill>}
          </div>
          <div style={{ color: C.muted, marginTop: 4 }}>{tenure(d.staff.since, lang)}{!d.staff.active ? L(' · đã nghỉ', ' · no longer active') : ''}</div>
          {canCoach && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <Btn primary onClick={() => { setForm('NOTE'); setText(''); }}>💬 {L('Ghi chú kèm cặp', 'Coaching note')}</Btn>
              <Btn onClick={() => { setForm('GOAL'); setText(''); }}>🎯 {L('Đặt mục tiêu', 'Set a goal')}</Btn>
              <Btn href="/salon/calendar">📅 {L('Lịch làm', 'Schedule')}</Btn>
            </div>
          )}
        </div>
        <div className="fb-score" style={{ minWidth: 'min(640px, 100%)' }}>
          <div style={scoreCell}>
            <div style={lblStyle}>{L('Hài lòng', 'Happy')}</div>
            <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-.02em', marginTop: 6, color: color === C.amber ? C.warn : C.ink }}>{k.pct == null ? '—' : `${k.pct}%`}</div>
            <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>{k.trendDelta != null ? <Delta v={k.trendDelta} unit={L(' điểm', ' pts')} suffix={L('trong 8 tuần', 'in 8 weeks')} /> : L(`Tiệm ${k.salonPct ?? '—'}%`, `Salon ${k.salonPct ?? '—'}%`)}</div>
          </div>
          <div style={scoreCell}>
            <div style={lblStyle}>{L(`Xếp hạng (${k.ranked} thợ)`, `Rank (${k.ranked} techs)`)}</div>
            <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-.02em', marginTop: 6, color: C.ink }}>{k.rank ? ordinal(k.rank, lang) : '—'}</div>
            <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>{L(`Trung bình tiệm ${k.salonPct ?? '—'}%`, `Salon average ${k.salonPct ?? '—'}%`)}</div>
          </div>
          <div style={scoreCell}>
            <div style={lblStyle}>{L('Lên Google', 'Sent to Google')}</div>
            <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-.02em', marginTop: 6, color: C.ink }}>{k.google}</div>
            <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>{k.googleOfHappy != null ? L(`${k.googleOfHappy}% khách hài lòng`, `${k.googleOfHappy}% of happy`) : '—'}</div>
          </div>
          <div style={scoreCell}>
            <div style={lblStyle}>{L('Ca', 'Cases')}</div>
            <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-.02em', marginTop: 6, color: C.ink }}>{k.cases}</div>
            <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>{L(`${k.overdue} trễ hạn · ${k.wonBack} giữ lại được`, `${k.overdue} overdue · ${k.wonBack} won back`)}</div>
          </div>
        </div>
        {form && (
          <div style={{ flexBasis: '100%', borderTop: `1px solid ${C.line}`, paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {form === 'GOAL' ? (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', color: C.ink2, fontSize: 14 }}>
                <b style={{ color: C.ink }}>{L('Mục tiêu:', 'Goal:')}</b>
                {L('đưa lại', 'back to')}
                <select value={goalPct} onChange={(e) => setGoalPct(Number(e.target.value))} style={selStyle}>{[80, 85, 90, 95].map((v) => <option key={v} value={v}>{v}%</option>)}</select>
                {L('hài lòng trong', 'happy within')}
                <select value={goalDays} onChange={(e) => setGoalDays(Number(e.target.value))} style={selStyle}>{[14, 30, 60, 90].map((v) => <option key={v} value={v}>{v} {L('ngày', 'days')}</option>)}</select>
              </div>
            ) : (
              <Seg<'NOTE' | 'PRAISE'> value={form} onChange={(v) => setForm(v)} style={{ alignSelf: 'flex-start' }} options={[{ key: 'NOTE', label: `💬 ${L('Kèm cặp', 'Coaching')}` }, { key: 'PRAISE', label: `⭐ ${L('Khen', 'Praise')}` }]} />
            )}
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} autoFocus
              placeholder={form === 'GOAL' ? L('Cách đạt được (tuỳ chọn)…', 'How to get there (optional)…') : form === 'PRAISE' ? L(`Điều khách khen ${first}…`, `What customers loved about ${first}…`) : L(`Đã nói gì với ${first}…`, `What you talked about with ${first}…`)}
              style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${C.line}`, borderRadius: 12, padding: '11px 13px', fontSize: 14, color: C.ink, background: C.card, fontFamily: 'inherit', resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              {err && <span style={{ color: C.bad, fontSize: 13, marginRight: 'auto', alignSelf: 'center' }}>{err}</span>}
              <Btn onClick={() => setForm(null)}>{L('Huỷ', 'Cancel')}</Btn>
              <Btn primary disabled={busy || (form !== 'GOAL' && !text.trim())} onClick={() => void save()}>{busy ? '…' : L('Lưu', 'Save')}</Btn>
            </div>
          </div>
        )}
      </div>

      <div className="fb-g2b">
        <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column' }}>
          <CardHead title={L(`${first} so với tiệm, theo tuần`, `${first} vs the salon, week by week`)} right={L('% hài lòng, 12 tuần', 'Happy %, last 12 weeks')} />
          <div style={{ display: 'flex', gap: 18, padding: '10px 18px 0', fontSize: 12.5, color: C.ink2 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 16, height: 3, borderRadius: 2, background: color }} />{first}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 16, borderTop: `2px dashed ${C.faint}` }} />{L('Trung bình tiệm', 'Salon average')}</span>
          </div>
          <div style={{ padding: '0 8px 4px' }}>
            <LineChart
              labels={d.trend.map((t) => weekLabel(t.week, lang))}
              series={{ label: lastMine != null ? `${first} ${lastMine}%` : '', color, data: d.trend.map((t) => t.pct) }}
              reference={{ label: lastSalon != null ? L(`Tiệm ${lastSalon}%`, `Salon ${lastSalon}%`) : '', data: d.trend.map((t) => t.salon) }}
              min={min} max={max} ticks={3}
              tip={(i) => {
                const t = d.trend[i];
                if (!t) return null;
                return [L(`Tuần ${weekLabel(t.week, lang)}`, `Week of ${weekLabel(t.week, lang)}`), `${first} ${t.pct == null ? '—' : `${t.pct}%`} · ${L('tiệm', 'salon')} ${t.salon == null ? '—' : `${t.salon}%`}`, L(`${t.answers} câu trả lời`, `${t.answers} answers`)];
              }}
            />
          </div>
        </div>
        <div style={cardStyle}>
          <CardHead title={L(`Khách nói gì về ${first}`, `What customers said about ${first}`)} right={L(`${k.answers - k.happy} “chưa hài lòng”`, `${k.answers - k.happy} “not quite”`)} />
          <div style={{ padding: '16px 18px 6px', display: 'flex', flexDirection: 'column', gap: 11 }}>
            {d.reasons.length ? <Bars items={d.reasons.map((r) => ({ label: reasonText(r.reason, lang), count: r.count }))} /> : <Empty>{L('Chưa có lời phàn nàn nào trong kỳ này.', 'No complaints in this period.')}</Empty>}
          </div>
          {d.pattern && (
            <div style={{ margin: '10px 18px 18px', padding: '13px 15px', borderRadius: 12, background: C.accSoft, fontSize: 13.5, lineHeight: 1.55, color: C.ink2 }}>
              <b style={{ color: C.accInk }}>✦ {L('Quy luật', 'Pattern')}</b> — {d.pattern}
            </div>
          )}
        </div>
      </div>

      <div className="fb-g2b">
        <div style={cardStyle}>
          <CardHead title={L('Phản hồi gần đây', 'Latest feedback')} style={{ paddingBottom: 10, flexWrap: 'wrap' }} right={
            <Seg value={filter} onChange={setFilter} options={[{ key: 'all', label: L('Tất cả', 'All') }, { key: 'happy', label: `😊 ${L('Hài lòng', 'Happy')}` }, { key: 'unhappy', label: `😕 ${L('Chưa hài lòng', 'Not quite')}${unhappyN ? ` · ${unhappyN}` : ''}` }]} />
          } />
          {latest.length === 0 && <Empty>{L('Chưa có phản hồi.', 'No feedback yet.')}</Empty>}
          {latest.map((x) => {
            const sad = x.sentiment === 'UNHAPPY';
            const status = x.case
              ? (x.case.wonBack ? <Pill tone="good">✓ {L('Đã giữ lại', 'Won back')}</Pill>
                : x.case.overdue ? <Pill tone="bad">⚠ {L('Trễ hạn', 'Overdue')}</Pill>
                : x.case.status === 'RESOLVED' ? <Pill tone="good">✓ {L('Đã xong', 'Resolved')}</Pill>
                : x.case.status === 'CONTACTED' ? <Pill tone="acc">{L('Đã liên hệ', 'Contacted')}</Pill>
                : <Pill tone="warn">{L('Ca đang mở', 'Open case')}</Pill>)
              : x.toGoogle ? <Pill tone="good">★ {L('Đã lên Google', 'Went to Google')}</Pill>
              : sad ? null : <Pill tone="mut">{L('Hài lòng · chưa lên Google', 'Happy · no Google')}</Pill>;
            return (
              <div key={x.id} className={x.case ? 'fb-row' : undefined} onClick={x.case ? () => onCase(x.case!.id) : undefined}
                style={{ display: 'flex', gap: 12, padding: '13px 18px', borderTop: `1px solid ${C.line}` }}>
                <span style={{ width: 34, height: 34, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0, background: sad ? C.badBg : C.goodBg }}>{sad ? '😕' : '😊'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><b style={{ color: C.ink }}>{x.customerName}</b>{status}</div>
                  <div style={{ color: C.muted, fontSize: 13, margin: sad && (x.reasons.length || x.comment) ? '2px 0 6px' : '2px 0 0' }}>{[x.service, whenText(x.createdAt, lang)].filter(Boolean).join(' · ')}</div>
                  {sad && (x.reasons.length > 0 || x.comment) && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      {x.reasons.map((r) => <Chip key={r} bad>{reasonText(r, lang)}</Chip>)}
                      {x.comment && <span style={{ fontSize: 13.5, color: C.ink2 }}>“{x.comment}”</span>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div style={cardStyle}>
          <CardHead title={L('Kèm cặp & mục tiêu', 'Coaching & goals')} right={L('Chỉ chủ tiệm & quản lý thấy', 'Only owners and managers see this')} />
          {goal && (
            <div style={{ margin: '14px 18px 0', padding: '14px 16px', borderRadius: 12, border: `1px solid ${C.accLine}`, background: C.accSoft }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <b style={{ color: C.ink }}>{L(`Mục tiêu: lại ${goal.pct}% hài lòng`, `Goal: back to ${goal.pct}% happy`)}</b>
                <Pill tone={(k.pct ?? 0) >= goal.pct ? 'good' : 'warn'}>{L(`Ngày ${Math.min(goalDay, goalLen)}/${goalLen}`, `Day ${Math.min(goalDay, goalLen)} of ${goalLen}`)}</Pill>
              </div>
              <div style={{ height: 10, borderRadius: 5, background: C.track, margin: '12px 0 6px', position: 'relative' }}>
                <div style={{ height: '100%', width: `${k.pct ?? 0}%`, background: (k.pct ?? 0) >= goal.pct ? C.good : C.amber, borderRadius: 5 }} />
                <div style={{ position: 'absolute', left: `${goal.pct}%`, top: -4, height: 18, borderLeft: `2px solid ${C.ink}` }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: C.muted }}>
                <span>{L(`Hiện ${k.pct ?? '—'}%`, `Now ${k.pct ?? '—'}%`)}</span><span>{L(`Mục tiêu ${goal.pct}%`, `Goal ${goal.pct}%`)}</span>
              </div>
            </div>
          )}
          <div style={{ padding: '10px 18px 16px' }}>
            {d.coaching.length === 0 && <Empty>{L(`Chưa có ghi chú nào cho ${first}.`, `No notes for ${first} yet.`)}</Empty>}
            {d.coaching.map((c) => {
              const dot = c.kind === 'AUTO' ? C.amber : c.kind === 'PRAISE' ? 'var(--c4ade80)' : C.acc2;
              const title = c.kind === 'AUTO' ? L('Nhắc tự động', 'Reminder sent') : c.kind === 'PRAISE' ? L('Đã khen', 'Praise shared') : c.kind === 'GOAL' ? L('Đặt mục tiêu', 'Goal set') : L('Buổi kèm cặp', 'Coaching talk');
              return (
                <div key={c.id} style={{ display: 'flex', gap: 12, padding: '10px 0' }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', marginTop: 5, flexShrink: 0, background: dot }} />
                  <div style={{ minWidth: 0 }}>
                    <b style={{ color: C.ink }}>{title}</b> <span style={{ color: C.muted, fontSize: 12.5 }}>· {c.kind === 'AUTO' ? L('tự động', 'auto') : c.byName ?? ''} · {shortDate(c.createdAt)}</span>
                    <div style={{ fontSize: 13.5, color: C.ink2, marginTop: 2, lineHeight: 1.45 }}>{c.text}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

const selStyle = { height: 34, padding: '0 10px', borderRadius: 10, border: `1px solid ${C.line}`, background: C.card, color: C.ink, fontSize: 13.5, fontWeight: 600, fontFamily: 'inherit' } as const;
