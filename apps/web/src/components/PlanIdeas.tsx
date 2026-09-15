'use client';

import { useMemo, useState } from 'react';
import type { Job } from './WeekPlanBoard';
import { dayKeyInTz } from '../lib/datetime';
import { layoutGrid, KIND_ICON, WD_VI, WD_EN, MONTH_VI, MONTH_EN, mondayIndex, type AheadBlock } from './plan-grid';

/**
 * WHAT THE SYSTEM SUGGESTS FOR THE NEXT THIRTY DAYS — as ideas, not orders.
 *
 * The generated plan used to BE the plan: it sat on the calendar and the
 * team worked around it. The agency's decision is that the calendar is the
 * team's, filled by hand, and the generator's output is raw material — read
 * next to the trends, picked from, and turned into a scheduled post with one
 * tap. So the suggestions live on the Ideas tab, grouped by the day they
 * were meant for (that day was chosen from the shop's own quiet hours, which
 * is the one thing worth keeping), each with the reason and the button.
 */

const KIND_LABEL: Record<string, { vi: string; en: string }> = {
  film: { vi: 'Quay clip', en: 'Film' }, photo: { vi: 'Chụp ảnh', en: 'Photos' }, post: { vi: 'Bài đăng', en: 'Post' },
  story: { vi: 'Story', en: 'Story' }, offer: { vi: 'Ưu đãi', en: 'Offer' }, winback: { vi: 'Kéo khách cũ', en: 'Win back' },
  engage: { vi: 'Tương tác', en: 'Engage' }, gbp: { vi: 'Google Maps', en: 'Google profile' }, event: { vi: 'Sự kiện', en: 'Event' },
};

export function PlanIdeas({
  blocks, tz, vi, onSchedule, onOpenSheet,
}: {
  blocks: AheadBlock[];
  tz: string;
  vi: boolean;
  onSchedule: (job: Job, dayKey: string) => void;
  onOpenSheet?: () => void;
}) {
  const T = (a: string, b: string) => (vi ? a : b);
  const todayKey = dayKeyInTz(new Date(), tz);
  const days = useMemo(() => layoutGrid(blocks, [], todayKey, tz).filter((d) => d.inWindow && d.jobs.length > 0), [blocks, todayKey, tz]);
  const [kind, setKind] = useState<string>('all');
  const kinds = useMemo(() => Array.from(new Set(days.flatMap((d) => d.jobs.map((j) => j.job.kind)))), [days]);
  const shown = days.map((d) => ({ ...d, jobs: d.jobs.filter((j) => kind === 'all' || j.job.kind === kind) })).filter((d) => d.jobs.length);
  const total = days.reduce((n, d) => n + d.jobs.length, 0);

  const label = (key: string) => {
    const [, m, d] = key.split('-').map(Number);
    const wd = mondayIndex(key);
    return `${vi ? WD_VI[wd] : WD_EN[wd]} ${d} ${vi ? MONTH_VI[m - 1] : MONTH_EN[m - 1]}`;
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--cf1f5f9)' }}>💡 {T('Hệ thống gợi ý cho 30 ngày tới', 'Suggested for the next 30 days')}</div>
        <div style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{total} {T('ý tưởng · ngày gợi ý lấy từ giờ vắng của tiệm', 'ideas · days picked from the shop’s quiet hours')}</div>
        {onOpenSheet && (
          <button type="button" onClick={onOpenSheet} style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-link)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0, fontWeight: 600 }}>
            📋 {T('Phiếu việc chi tiết theo tuần', 'Weekly working sheet')} →
          </button>
        )}
      </div>

      {kinds.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {['all', ...kinds].map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} style={{ padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', border: `1px solid ${kind === k ? '#6366f1' : 'var(--c334155)'}`, background: kind === k ? 'rgba(99,102,241,.16)' : 'transparent', color: kind === k ? 'var(--ink-link)' : 'var(--c94a3b8)' }}>
              {k === 'all' ? T('Tất cả', 'All') : `${KIND_ICON[k] ?? ''} ${vi ? KIND_LABEL[k]?.vi ?? k : KIND_LABEL[k]?.en ?? k}`}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--c94a3b8)', padding: '10px 0' }}>{T('Chưa có gợi ý nào — hệ thống cần vài tuần lịch hẹn để biết tiệm vắng ngày nào.', 'No suggestions yet — the system needs a few weeks of bookings to know the quiet days.')}</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 10 }}>
          {shown.map((d) => (
            <div key={d.key} style={{ borderRadius: 12, border: `1px solid ${d.today ? '#6366f1' : 'var(--c334155)'}`, background: 'var(--c0f172a)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: d.today ? 'var(--ink-link)' : 'var(--ccbd5e1)' }}>{label(d.key)}</span>
                {d.today && <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: .4, textTransform: 'uppercase', color: 'var(--ink-link)' }}>{T('hôm nay', 'today')}</span>}
              </div>
              {d.jobs.map((j, i) => (
                <div key={i} style={{ borderTop: i ? '1px solid var(--line)' : 'none', paddingTop: i ? 8 : 0, display: 'grid', gap: 5 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 14, flex: '0 0 auto' }}>{j.done ? '✅' : (KIND_ICON[j.job.kind] ?? '•')}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: j.done ? 'var(--ink-faint)' : 'var(--cf1f5f9)', lineHeight: 1.4, textDecoration: j.done ? 'line-through' : 'none' }}>{j.job.text}</div>
                      {j.job.why && <div style={{ fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.45, marginTop: 2 }}>{j.job.why}</div>}
                      {j.job.when && <div style={{ fontSize: 11.5, color: 'var(--ink-warn)', marginTop: 2 }}>⏰ {j.job.when}</div>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 7px', borderRadius: 999, background: j.who === 'salon' ? 'rgba(251,191,36,.14)' : 'rgba(99,102,241,.14)', color: j.who === 'salon' ? 'var(--ink-warn)' : 'var(--ink-link)' }}>
                      {j.who === 'salon' ? T('tiệm làm', 'shop does') : T('bên em làm', 'we do')}
                    </span>
                    {!j.done && j.who !== 'salon' && (
                      <button type="button" onClick={() => onSchedule(j.job, d.key)} style={{ marginLeft: 'auto', padding: '5px 11px', borderRadius: 8, border: '1px solid #6366f1', background: 'rgba(99,102,241,.14)', color: 'var(--ink-link)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                        🗓️ {T('Lên lịch ngày này', 'Schedule this day')}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
