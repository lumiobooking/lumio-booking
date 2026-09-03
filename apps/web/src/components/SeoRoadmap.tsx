'use client';

/**
 * The Google Maps roadmap, as a board somebody works through.
 *
 * DESIGN RULES THIS SCREEN OBEYS
 *
 * 1. ONE next action, always visible at the top. A list of thirty jobs with
 *    equal weight is a list nobody starts. The board answers "what do I do
 *    right now" before it answers anything else.
 * 2. Three states, never two. A measured task can be 'unknown' — the system
 *    cannot see it yet — and painting that as "not done" would be a lie the
 *    owner acts on. Unknown gets its own quiet grey and says why.
 * 3. Measured tasks have NO checkbox. If the numbers decide it, offering a box
 *    invites someone to tick a thing that is not true, and from then on the
 *    whole board is a guess. They carry a "hệ thống tự xác nhận" badge instead.
 * 4. A phase already finished collapses. Progress you can see is motivating;
 *    thirty rows of green you must scroll past is not.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { ui } from '../lib/ui';

type TaskState = 'done' | 'todo' | 'unknown';

interface Task {
  id: string; phase: number; title: string; how: string; why: string;
  kind: 'manual' | 'check'; state: TaskState; auto: boolean;
  minutes?: number; at?: string | null; by?: string | null;
}
interface Phase {
  n: number; title: string; when: string; goal: string;
  tasks: Task[]; done: number; total: number;
}
interface Roadmap { phases: Phase[]; done: number; total: number; next: Task | null }

const TONE: Record<TaskState, { fg: string; bg: string; label: string }> = {
  done:    { fg: '#22c55e', bg: 'rgba(34,197,94,.12)',  label: 'Đã xong' },
  todo:    { fg: 'var(--c94a3b8)', bg: 'transparent',   label: 'Chưa làm' },
  unknown: { fg: '#f59e0b', bg: 'rgba(245,158,11,.12)', label: 'Chưa đo được' },
};

export function SeoRoadmap({ token }: { token: string | null }) {
  const [data, setData] = useState<Roadmap | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<number, boolean>>({});

  const load = useCallback(async () => {
    try { setData(await apiFetch<Roadmap>('/content/seo-roadmap', { token })); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Không tải được'); }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const toggle = async (t: Task) => {
    if (t.auto || busy) return;
    setBusy(t.id);
    try { setData(await apiFetch<Roadmap>(`/content/seo-roadmap/${t.id}`, { method: 'POST', token, body: { done: t.state !== 'done' } })); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Không lưu được'); }
    finally { setBusy(null); }
  };

  if (err) return <div style={{ ...ui.card, padding: 16, color: '#ef4444', fontSize: 13.5 }}>{err}</div>;
  if (!data) return <div style={{ fontSize: 13, color: 'var(--c64748b)', padding: '18px 0' }}>Đang tải…</div>;

  const pct = data.total ? Math.round((data.done / data.total) * 100) : 0;

  return (
    <>
      {/* ---- where we are, and the ONE next thing ---- */}
      <div style={{ ...ui.card, padding: 16, marginBottom: 14, borderColor: '#6366f1' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)' }}>📍 Lộ trình lên top Google Maps</div>
          <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, fontWeight: 700, color: 'var(--ce2e8f0)' }}>
            {data.done}/{data.total} <span style={{ color: 'var(--c64748b)', fontWeight: 500 }}>· {pct}%</span>
          </div>
        </div>

        <div style={{ height: 8, background: 'var(--c0f172a)', borderRadius: 4, overflow: 'hidden', margin: '11px 0 4px' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: '#22c55e', borderRadius: 4, transition: 'width .3s' }} />
        </div>

        {data.next ? (
          <div style={{ marginTop: 14, padding: '13px 14px', borderRadius: 10, background: 'var(--c0f172a)', border: '1px solid #6366f1' }}>
            <div style={{ fontSize: 10.5, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--c64748b)', marginBottom: 4 }}>
              Làm cái này trước
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ca5b4fc)', lineHeight: 1.4 }}>{data.next.title}</div>
            <div style={{ fontSize: 13, color: 'var(--ccbd5e1)', lineHeight: 1.6, marginTop: 6 }}>{data.next.how}</div>
            {data.next.minutes ? (
              <div style={{ fontSize: 12, color: 'var(--c64748b)', marginTop: 6 }}>≈ {data.next.minutes} phút</div>
            ) : null}
          </div>
        ) : (
          <div style={{ marginTop: 14, padding: '13px 14px', borderRadius: 10, background: 'rgba(34,197,94,.1)', border: '1px solid #22c55e', fontSize: 13.5, color: 'var(--ce2e8f0)', lineHeight: 1.6 }}>
            ✓ Hết việc trong danh sách. Từ đây là giai đoạn giữ hạng — đo lưới điểm mỗi tháng và đừng để đứt nhịp đánh giá.
          </div>
        )}
      </div>

      {/* ---- the phases ---- */}
      {data.phases.map((p) => {
        const finished = p.done === p.total && p.total > 0;
        const shown = open[p.n] ?? !finished; // a finished phase folds itself away
        return (
          <div key={p.n} style={{ ...ui.card, padding: 0, marginBottom: 12, overflow: 'hidden' }}>
            <button
              onClick={() => setOpen({ ...open, [p.n]: !shown })}
              style={{
                width: '100%', textAlign: 'left', background: 'transparent', border: 'none',
                padding: '14px 16px', cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'flex-start',
                fontFamily: 'inherit',
              }}
            >
              <span style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, fontWeight: 700,
                color: finished ? '#22c55e' : '#a5b4fc', background: finished ? 'rgba(34,197,94,.12)' : 'var(--c1e293b)',
                borderRadius: 7, minWidth: 30, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>{finished ? '✓' : p.n}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 15.5, fontWeight: 700, color: 'var(--ce2e8f0)', lineHeight: 1.3 }}>{p.title}</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--c64748b)', marginTop: 2 }}>{p.when}</span>
              </span>
              <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5, fontWeight: 600, color: finished ? '#22c55e' : 'var(--c94a3b8)', flexShrink: 0, paddingTop: 4 }}>
                {p.done}/{p.total} {shown ? '▾' : '▸'}
              </span>
            </button>

            {shown && (
              <div style={{ padding: '0 16px 14px' }}>
                <div style={{ fontSize: 13, color: 'var(--c94a3b8)', lineHeight: 1.6, margin: '0 0 14px', paddingLeft: 42 }}>{p.goal}</div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {p.tasks.map((t) => {
                    const tone = TONE[t.state];
                    return (
                      <div key={t.id} style={{
                        display: 'flex', gap: 11, alignItems: 'flex-start',
                        padding: '12px 13px', borderRadius: 10,
                        background: t.state === 'done' ? 'transparent' : 'var(--c0f172a)',
                        border: `1px solid ${t.state === 'done' ? 'var(--c1e293b)' : 'var(--c334155)'}`,
                        opacity: t.state === 'done' ? 0.62 : 1,
                      }}>
                        {/* the box — absent when the system decides, on purpose */}
                        {t.auto ? (
                          <span title="Hệ thống tự xác nhận" style={{
                            width: 22, height: 22, borderRadius: 6, flexShrink: 0, marginTop: 1,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: tone.bg, color: tone.fg, fontSize: 12, fontWeight: 700,
                            border: `1px solid ${t.state === 'done' ? '#22c55e' : t.state === 'unknown' ? '#f59e0b' : 'var(--c334155)'}`,
                          }}>{t.state === 'done' ? '✓' : t.state === 'unknown' ? '?' : '·'}</span>
                        ) : (
                          <button
                            onClick={() => toggle(t)}
                            disabled={busy === t.id}
                            aria-label={t.state === 'done' ? 'Bỏ đánh dấu' : 'Đánh dấu đã xong'}
                            style={{
                              width: 22, height: 22, borderRadius: 6, flexShrink: 0, marginTop: 1, padding: 0,
                              cursor: busy === t.id ? 'wait' : 'pointer',
                              background: t.state === 'done' ? '#22c55e' : 'transparent',
                              border: `1.5px solid ${t.state === 'done' ? '#22c55e' : 'var(--c475569)'}`,
                              color: '#0f172a', fontSize: 13, fontWeight: 800, lineHeight: 1,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}
                          >{t.state === 'done' ? '✓' : ''}</button>
                        )}

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                            <span style={{
                              fontSize: 14.5, fontWeight: 600, lineHeight: 1.4,
                              color: 'var(--ce2e8f0)',
                              textDecoration: t.state === 'done' ? 'line-through' : 'none',
                            }}>{t.title}</span>
                            {t.auto && (
                              <span style={{ fontSize: 10.5, fontWeight: 600, color: tone.fg, border: `1px solid ${tone.fg}`, borderRadius: 20, padding: '1px 7px', whiteSpace: 'nowrap' }}>
                                {t.state === 'unknown' ? 'chưa đo được' : 'hệ thống tự xác nhận'}
                              </span>
                            )}
                            {!t.auto && t.minutes ? (
                              <span style={{ fontSize: 11.5, color: 'var(--c64748b)', whiteSpace: 'nowrap' }}>≈{t.minutes}p</span>
                            ) : null}
                          </div>

                          {t.state !== 'done' && (
                            <>
                              <div style={{ fontSize: 13, color: 'var(--ccbd5e1)', lineHeight: 1.6, marginTop: 5 }}>{t.how}</div>
                              <div style={{ fontSize: 12.5, color: 'var(--c64748b)', lineHeight: 1.55, marginTop: 5 }}>{t.why}</div>
                            </>
                          )}
                          {t.state === 'done' && t.at && (
                            <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginTop: 3 }}>
                              Xong {new Date(t.at).toLocaleDateString('vi-VN')}{t.by ? ` · ${t.by}` : ''}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div style={{ fontSize: 12, color: 'var(--c64748b)', lineHeight: 1.7, marginTop: 16, padding: '0 2px' }}>
        Mục có nhãn <b style={{ color: 'var(--c94a3b8)' }}>hệ thống tự xác nhận</b> không tích tay được — hệ thống đọc thẳng từ số liệu thật của tiệm, nên không ai tích nhầm một việc chưa làm.
        Mục <b style={{ color: '#f59e0b' }}>chưa đo được</b> nghĩa là hệ thống chưa nhìn thấy dữ liệu, thường vì chưa kết nối Google Business Profile — không phải là chưa làm.
      </div>
    </>
  );
}
