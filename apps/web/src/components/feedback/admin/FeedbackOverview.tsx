'use client';

import { C, cardStyle, lblStyle, Lx, Pill, Chip, Btn, Avatar, CardHead, Delta, Bars, Meter, Spark, LineChart, axisRange, reasonText, weekLabel, minutesText, Empty } from './fb-ui';

export interface StaffRow {
  staffId: string; name: string; initials: string; avatarUrl: string | null;
  answers: number; happy: number; pct: number | null; google: number; complaints: number;
  topReason: string | null; topReasonCount: number; weeks: (number | null)[];
}
export interface CaseHead {
  id: string; status: string; dueAt: string; overdue: boolean; createdAt: string; assigneeName: string | null;
  customerName: string; staffName: string | null; service: string | null; visitAt: string;
  reasons: string[]; wantsContact: boolean; comment: string | null;
}
export interface Overview {
  range: { from: string; to: string };
  kpis: {
    answers: number; happy: number; pct: number | null; prevPct: number | null; responseRate: number | null; visits: number;
    google: number; prevGoogle: number; googleOfHappy: number | null; open: number; overdue: number; avgReplyMin: number | null;
    wonBack: number; closed: number;
  };
  spark: (number | null)[];
  trend: { week: string; answers: number; happy: number; google?: number; pct: number | null }[];
  staff: StaffRow[];
  reasons: { reason: string; count: number }[];
  unhappy: number;
  attention: {
    flags: { kind: 'tech'; staffId: string; name: string; reason: string; count: number; days: number; pct: number | null; weeks: (number | null)[] }[];
    overdue: CaseHead[];
    waitCluster: { from: number; to: number; count: number; total: number } | null;
  };
  goalPct: number;
}

const hourText = (h: number, lang: string) => {
  if (lang === 'vi') return `${h}h`;
  const hh = h % 12 || 12;
  return `${hh} ${h < 12 ? 'AM' : 'PM'}`;
};

export function FeedbackOverview({ data, lang, replyHours, periodLabel, onStaff, onCase }: {
  data: Overview; lang: string; replyHours: number; periodLabel: string;
  onStaff: (id: string) => void; onCase: (id: string) => void;
}) {
  const L = Lx(lang);
  const k = data.kpis;
  const goal = data.goalPct;
  const ptsDelta = k.pct != null && k.prevPct != null ? k.pct - k.prevPct : null;
  const flagged = new Set(data.attention.flags.map((f) => f.staffId));

  // Needs your attention: technician patterns, overdue cases, a wait cluster.
  const alerts: { key: string; icon: string; tone: 'bad' | 'warn' | 'acc'; title: string; sub: string; action: string; go: () => void; href?: string }[] = [];
  for (const f of data.attention.flags) {
    const w = f.weeks.filter((v): v is number => v != null);
    const fell = w.length >= 2 && w[w.length - 1] < w[0]
      ? L(`Hài lòng giảm ${w[0]}% → ${w[w.length - 1]}% trong 8 tuần.`, `Happy fell ${w[0]}% → ${w[w.length - 1]}% in 8 weeks.`)
      : f.pct != null ? L(`Hài lòng ${f.pct}% kỳ này.`, `Happy ${f.pct}% this period.`) : '';
    alerts.push({
      key: `t${f.staffId}`, icon: '⚠', tone: 'bad',
      title: `${f.name}: ${f.count} × “${reasonText(f.reason, lang)}”`,
      sub: `${fell} ${L(`Trong ${f.days} ngày qua.`, `In the last ${f.days} days.`)}`.trim(),
      action: L('Mở', 'Open'), go: () => onStaff(f.staffId),
    });
  }
  for (const c of data.attention.overdue) {
    const hrs = Math.max(1, Math.round((Date.now() - new Date(c.dueAt).getTime()) / 3_600_000));
    alerts.push({
      key: `c${c.id}`, icon: '⏱', tone: 'warn',
      title: L(`Ca trễ ${hrs} giờ — ${c.customerName}`, `Case ${hrs} h overdue — ${c.customerName}`),
      sub: [c.service, c.staffName ? L(`với ${c.staffName}`, `with ${c.staffName}`) : null].filter(Boolean).join(' ') + (c.wantsContact ? L(' · muốn được gọi lại', ' · wants a call back') : ''),
      action: L('Trả lời', 'Reply'), go: () => onCase(c.id),
    });
  }
  const wc = data.attention.waitCluster;
  if (wc) {
    alerts.push({
      key: 'wait', icon: '✦', tone: 'acc',
      title: L(`Khách chờ lâu sau ${hourText(wc.from, lang)}`, `Long waits after ${hourText(wc.from, lang)}`),
      sub: L(`${wc.count}/${wc.total} lần “chờ lâu” rơi vào ${hourText(wc.from, lang)}–${hourText(wc.to, lang)}. Thêm 15 phút đệm?`, `${wc.count} of ${wc.total} “waited” were ${hourText(wc.from, lang)}–${hourText(wc.to, lang)}. Add a 15-min buffer?`),
      action: L('Sửa', 'Fix'), go: () => undefined, href: '/salon/settings',
    });
  }

  const trendVals = data.trend.map((t) => t.pct);
  const { min, max } = axisRange(trendVals, goal);
  const lastPct = [...trendVals].reverse().find((v) => v != null);
  const reasonsTotal = data.reasons.reduce((a, r) => a + r.count, 0);
  const top2 = data.reasons.slice(0, 2);

  return (
    <>
      <div className="fb-kpis">
        <div style={{ ...cardStyle, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 18 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={lblStyle}>{L('Khách hài lòng', 'Happy customers')}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 8 }}>
              <span style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1, whiteSpace: 'nowrap', color: k.pct == null ? C.ink : k.pct >= goal ? C.good : k.pct >= goal - 10 ? C.warn : C.bad }}>{k.pct == null ? '—' : `${k.pct}%`}</span>
              <Delta v={ptsDelta} unit={L(' điểm', ' pts')} />
            </div>
            <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>
              {L(`${k.happy}/${k.answers}`, `${k.happy} of ${k.answers}`)}{k.responseRate != null ? L(` · ${k.responseRate}% lượt khách trả lời`, ` · ${k.responseRate}% of visits answered`) : ''}
            </div>
          </div>
          <div className="fb-hide-sm"><Spark data={data.spark} color={C.acc2} w={120} h={46} /></div>
        </div>
        <div style={{ ...cardStyle, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={lblStyle}>{L('Đã gửi lên Google', 'Sent to Google')}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}><span style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1, color: C.ink }}>{k.google}</span><Delta v={k.google - k.prevGoogle} /></div>
          <div style={{ fontSize: 13, color: C.muted }}>{k.googleOfHappy != null ? L(`${k.googleOfHappy}% khách hài lòng đã bấm qua Google`, `${k.googleOfHappy}% of happy customers tapped through`) : L('Chưa có khách hài lòng trong kỳ', 'No happy customers in this period yet')}</div>
        </div>
        <div style={{ ...cardStyle, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={lblStyle}>{L('Ca đang mở', 'Open cases')}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1, color: k.open ? C.warn : C.ink }}>{k.open}</span>
            {k.overdue > 0 ? <Pill tone="bad">⚠ {L(`${k.overdue} trễ hạn`, `${k.overdue} overdue`)}</Pill> : k.open > 0 ? <Pill tone="mut">{L('đúng hạn', 'on time')}</Pill> : null}
          </div>
          <div style={{ fontSize: 13, color: C.muted }}>{L(`Trả lời TB ${minutesText(k.avgReplyMin, lang)} · mục tiêu ${replyHours} giờ`, `Avg reply ${minutesText(k.avgReplyMin, lang)} · goal ${replyHours} h`)}</div>
        </div>
        <div style={{ ...cardStyle, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={lblStyle}>{L('Giữ lại được', 'Won back')}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1, color: C.ink }}>{k.wonBack}<span style={{ fontSize: 20, color: C.faint }}> / {k.closed}</span></span>
            {k.closed > 0 && <Pill tone={k.wonBack * 2 >= k.closed ? 'good' : 'mut'}>{Math.round((k.wonBack / k.closed) * 100)}%</Pill>}
          </div>
          <div style={{ fontSize: 13, color: C.muted }}>{L('Quay lại sau một lần “chưa hài lòng”', 'Came back after a “not quite”')}</div>
        </div>
      </div>

      <div className="fb-g2">
        <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column' }}>
          <CardHead title={L('Khách hài lòng theo tuần', 'Happy customers, week by week')} right={L('Rê chuột vào một tuần để xem', 'Hover a week for details')} />
          <div style={{ padding: '6px 8px 4px', flex: 1 }}>
            <LineChart
              labels={data.trend.map((t) => weekLabel(t.week, lang))}
              series={{ label: lastPct != null ? L(`${lastPct}% hài lòng`, `${lastPct}% happy`) : '', color: C.acc2, data: trendVals }}
              reference={{ label: L(`Mục tiêu ${goal}%`, `Goal ${goal}%`), data: data.trend.map(() => goal) }}
              min={min} max={max}
              tip={(i) => {
                const t = data.trend[i];
                if (!t) return null;
                const head = L(`Tuần ${weekLabel(t.week, lang)}`, `Week of ${weekLabel(t.week, lang)}`);
                if (!t.answers) return [head, L('Chưa có câu trả lời', 'No answers')];
                return [head, L(`${t.pct}% hài lòng · ${t.answers} trả lời`, `${t.pct}% happy · ${t.answers} answers`), L(`${t.answers - t.happy} chưa hài lòng${t.google != null ? ` · ${t.google} lên Google` : ''}`, `${t.answers - t.happy} not quite${t.google != null ? ` · ${t.google} to Google` : ''}`)];
              }}
            />
          </div>
        </div>
        <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column' }}>
          <CardHead title={L('Cần anh/chị xem', 'Needs your attention')} right={alerts.length ? <Pill tone="warn">{alerts.length}</Pill> : undefined} />
          <div style={{ marginTop: 12 }}>
            {alerts.length === 0 && <Empty>✓ {L('Không có gì cần xử lý lúc này.', 'Nothing needs you right now.')}</Empty>}
            {alerts.map((a) => (
              <div key={a.key} style={{ display: 'flex', gap: 12, padding: '13px 16px', borderTop: `1px solid ${C.line}`, alignItems: 'flex-start' }}>
                <span style={{ width: 32, height: 32, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0, background: a.tone === 'bad' ? C.badBg : a.tone === 'warn' ? C.warnBg : C.accSoft, color: a.tone === 'bad' ? C.bad : a.tone === 'warn' ? C.warn : C.accInk }}>{a.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ color: C.ink, fontSize: 14 }}>{a.title}</b>
                  <div style={{ color: C.muted, fontSize: 13, marginTop: 2, lineHeight: 1.45 }}>{a.sub}</div>
                </div>
                <Btn small onClick={a.go} href={a.href}>{a.action}</Btn>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="fb-g2">
        <div style={{ ...cardStyle, overflow: 'hidden' }}>
          <CardHead title={L('Thợ', 'Technicians')} right={L(`${periodLabel} · bấm một dòng để xem bảng điểm`, `${periodLabel} · tap a row for the full scorecard`)} style={{ paddingBottom: 8 }} />
          {data.staff.length === 0 ? <Empty>{L('Chưa có câu trả lời nào gắn với thợ trong kỳ này.', 'No answers linked to a technician in this period yet.')}</Empty> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: 600, borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: 14 }}>
                <thead>
                  <tr>
                    {[[L('Thợ', 'Technician'), undefined], [L('Trả lời', 'Answers'), 76], [L('Hài lòng', 'Happy'), 128], ['Google', 66], [L('Phàn nàn', 'Complaints'), 150], [L('8 tuần', '8 weeks'), 96]].map(([t, wd]) => (
                      <th key={String(t)} style={{ ...lblStyle, letterSpacing: '.06em', whiteSpace: 'nowrap', textAlign: 'left', padding: '10px 12px', borderBottom: `1px solid ${C.line}`, width: wd as number | undefined }}>{t}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.staff.map((s) => {
                    const flag = flagged.has(s.staffId);
                    const low = s.pct != null && s.pct < goal - 5;
                    const col = low ? C.amber : C.acc2;
                    return (
                      <tr key={s.staffId} className="fb-row" onClick={() => onStaff(s.staffId)} style={{ background: flag ? C.flagRow : undefined }}>
                        <td style={{ padding: '11px 12px', borderBottom: `1px solid ${C.line}` }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                            <Avatar name={s.name} initials={s.initials} url={s.avatarUrl} size={32} seed={s.staffId} />
                            <b style={{ color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</b>
                            {flag && <span title={L('Cần chú ý', 'Needs attention')} style={{ color: C.warn, fontWeight: 800 }}>⚠</span>}
                          </div>
                        </td>
                        <td style={{ padding: '11px 12px', borderBottom: `1px solid ${C.line}`, color: C.ink2 }}>{s.answers}</td>
                        <td style={{ padding: '11px 12px', borderBottom: `1px solid ${C.line}` }}><Meter pct={s.pct} color={col} /></td>
                        <td style={{ padding: '11px 12px', borderBottom: `1px solid ${C.line}`, color: C.ink2 }}>{s.google}</td>
                        <td style={{ padding: '11px 12px', borderBottom: `1px solid ${C.line}` }}>
                          {s.complaints ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                              <b style={{ minWidth: 14, color: C.ink }}>{s.complaints}</b>
                              {s.topReason && <span style={{ minWidth: 0, overflow: 'hidden', display: 'flex' }}><Chip bad={flag}>{reasonText(s.topReason, lang)}{flag && s.topReasonCount > 1 ? ` ×${s.topReasonCount}` : ''}</Chip></span>}
                            </div>
                          ) : <span style={{ color: C.faint }}>—</span>}
                        </td>
                        <td style={{ padding: '11px 8px', borderBottom: `1px solid ${C.line}` }}><Spark data={s.weeks} color={col} w={80} h={28} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div style={cardStyle}>
          <CardHead title={L('Lý do “chưa hài lòng”', 'Reasons for “not quite”')} right={L(`${data.unhappy} câu trả lời`, `${data.unhappy} answers`)} />
          <div style={{ padding: '16px 18px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {data.reasons.length === 0 ? <Empty>{L('Chưa có ai chọn “chưa hài lòng” trong kỳ này.', 'Nobody picked “not quite” in this period.')}</Empty>
              : <Bars items={data.reasons.map((r) => ({ label: reasonText(r.reason, lang), count: r.count }))} />}
            {top2.length >= 1 && reasonsTotal >= 3 && (
              <div style={{ marginTop: 6, padding: '12px 14px', borderRadius: 12, background: C.accSoft, color: C.ink2, fontSize: 13, lineHeight: 1.5 }}>
                <b style={{ color: C.accInk }}>✦ {periodLabel}</b> — {top2.length === 2
                  ? L(`“${reasonText(top2[0].reason, lang)}” và “${reasonText(top2[1].reason, lang)}” chiếm ${top2[0].count + top2[1].count}/${reasonsTotal} lý do. Sửa hai chuyện này trước.`, `“${top2[0].reason}” and “${top2[1].reason}” explain ${top2[0].count + top2[1].count} of ${reasonsTotal} reasons picked. Fix those two first.`)
                  : L(`“${reasonText(top2[0].reason, lang)}” là lý do duy nhất (${top2[0].count}).`, `“${top2[0].reason}” is the only reason picked (${top2[0].count}).`)}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
