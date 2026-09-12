'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { fresh, useLive } from '../../../lib/live';

/**
 * The bench: everything Lumio owes every salon today, on one screen.
 *
 * WHY IT IS GROUPED BY KIND AND NOT BY SALON
 *
 * Two people cover thirty clients. That is roughly a hundred and fifty jobs a
 * week, or a dozen each per day, and at that volume the expensive thing is
 * not the work — it is opening a salon, remembering what it looks like, and
 * closing it again, thirty times. So the batch is the unit: twenty-five photo
 * sets in one sitting, with the salon as a label on the row.
 *
 * WHY EVERY ROW CARRIES A NAME
 *
 * A colleague who is off must not be a hole in the week. Every job says who
 * holds it and since when, anybody may take any job back, and nothing lives
 * in a chat message or somebody's memory. Two states and a name is the whole
 * mechanism — a stage pipeline would double the bookkeeping for two people
 * who sit beside each other.
 */

interface CrewJob {
  tenantId: string; salon: string; slug: string; weekKey: string; jobId: string;
  kind: string; role: 'design' | 'content'; text: string; steps: string[];
  due: string; lateDays: number; by: string | null; heldAt: string | null; done: boolean;
}
interface CrewGroup { kind: string; label: string; jobs: CrewJob[] }
interface Board {
  me: string | null; today: string;
  counts: { open: number; mine: number; late: number; done: number; waiting?: number };
  groups: CrewGroup[]; done: number;
  /**
   * Jobs that are a phone call, not work — the clip they are made from has
   * not arrived. Optional so an older API simply renders the board it always
   * did rather than crashing this page.
   */
  blocked?: CrewJob[];
  /** One line per salon being chased. Several stuck jobs are still one call. */
  chase?: { tenantId: string; salon: string; slug: string; jobs: number; waitingDays: number }[];
}

const ICON: Record<string, string> = {
  post: '📣', story: '📱', offer: '🎁', winback: '💌', gbp: '📍', event: '📅',
};

/** First name only. Two people do not need each other's domain repeated forty times. */
const who = (email: string | null) => (email ? email.split('@')[0] : '');

const ago = (iso: string | null) => {
  if (!iso) return '';
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (m < 60) return `${m} phút`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} giờ` : `${Math.round(h / 24)} ngày`;
};

type Filter = 'all' | 'mine' | 'free' | 'design' | 'content';

export default function TodayPage() {
  const { token, user, ready } = useAuth();
  const router = useRouter();
  const [board, setBoard] = useState<Board | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    if (!token) return;
    await apiFetch<Board>(fresh('/support/today'), { token }).then(setBoard).catch(() => undefined);
  }, [token]);

  useEffect(() => { if (ready && !token) router.replace('/login'); }, [ready, token, router]);
  useEffect(() => { void load(); }, [load]);
  // Two people working the same queue must not claim the same job twice.
  useLive(load, 30_000, Boolean(token));

  const groups = useMemo(() => {
    if (!board) return [];
    const keep = (j: CrewJob) => {
      if (filter === 'mine') return j.by === board.me;
      if (filter === 'free') return !j.by;
      if (filter === 'design' || filter === 'content') return j.role === filter;
      return true;
    };
    return board.groups.map((g) => ({ ...g, jobs: g.jobs.filter(keep) })).filter((g) => g.jobs.length);
  }, [board, filter]);

  async function act(j: CrewJob, state: 'claim' | 'release' | 'done') {
    if (!token) return;
    const mark = `${j.tenantId}:${j.jobId}`;
    setBusy(mark); setError(null);
    try {
      await apiFetch('/support/today/state', {
        method: 'POST', token,
        body: { tenantId: j.tenantId, weekKey: j.weekKey, jobId: j.jobId, state },
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không cập nhật được');
    } finally { setBusy(null); }
  }

  if (!ready || !token) return null;
  const c = board?.counts;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--c0b1220)', color: 'var(--ce2e8f0)', padding: '22px 18px 60px' }}>
      <div style={{ maxWidth: 940, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
          <h1 style={{ fontSize: 23, margin: 0, fontWeight: 800 }}>🛠 Việc hôm nay</h1>
          <Link href="/agency" style={{ fontSize: 13, color: '#a5b4fc', textDecoration: 'none' }}>← Danh sách tiệm</Link>
          <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--c64748b)' }}>
            {who(board?.me ?? null) || user?.email} · {board?.today}
          </span>
        </div>
        <p style={{ color: 'var(--c94a3b8)', fontSize: 13.5, margin: '0 0 14px', lineHeight: 1.6 }}>
          Toàn bộ việc của Lumio ở mọi tiệm, gộp theo loại để làm một lô. Bấm <b>Nhận</b> là tên bạn hiện lên dòng đó —
          bạn kia thấy ngay, không ai làm trùng. Một bạn nghỉ thì bạn còn lại gỡ việc về được.
        </p>

        {error && <div style={{ background: 'var(--c7f1d1d)', color: 'var(--cfecaca)', padding: '10px 14px', borderRadius: 8, fontSize: 13.5, marginBottom: 12 }}>{error}</div>}

        {/* The four numbers that decide what a person does next. */}
        {c && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <Tally n={c.late} label="trễ hạn" tone={c.late ? 'bad' : 'flat'} />
            <Tally n={c.open} label="chưa ai nhận" tone={c.open ? 'warn' : 'flat'} />
            {/* Not work. A job with no clip behind it used to be counted in
                "chưa ai nhận", so the board read 14 việc on a morning when four
                of them were four phone calls. */}
            {!!c.waiting && <Tally n={c.waiting} label="chờ tiệm gửi" tone="warn" />}
            <Tally n={c.mine} label="của tôi" tone="mine" />
            <Tally n={c.done} label="đã xong" tone="good" />
          </div>
        )}

        {/* THE LANE crew-board.ts PROMISED ON DAY ONE.
            "A job whose material has not arrived is not work — it is a phone
            call." Mixed into the queue, a designer opened "Đăng clip", found
            no clip, put it back, and three days later somebody asked why
            nothing went out. Above the work, sorted by how long each salon has
            been sitting there, one line per salon however many jobs are stuck
            behind it. */}
        {!!board?.chase?.length && (
          <div style={{
            border: '1px solid #f59e0b', background: 'rgba(245,158,11,.07)',
            borderRadius: 12, padding: '13px 15px', marginBottom: 14,
          }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#fbbf24' }}>
              📞 Gọi tiệm — {board.chase.length} tiệm đang nợ ảnh/clip
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.55, marginTop: 3 }}>
              Chưa có nguyên liệu thì mấy việc bên dưới không làm được. Đây là cuộc gọi, không phải việc.
            </div>
            <div style={{ marginTop: 9, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {board.chase.map((cs) => (
                <div key={cs.tenantId} style={{
                  display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                  padding: '7px 10px', borderRadius: 8, background: 'var(--c0f172a)', border: '1px solid var(--line-strong)',
                }}>
                  <Link href={`/agency/${cs.slug}`} style={{ fontSize: 13.5, fontWeight: 700, color: '#a5b4fc', textDecoration: 'none' }}>
                    {cs.salon}
                  </Link>
                  <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{cs.jobs} việc đang kẹt</span>
                  <span style={{
                    marginLeft: 'auto', fontSize: 11.5, fontWeight: 800, padding: '2px 9px', borderRadius: 999,
                    background: cs.waitingDays >= 3 ? 'rgba(239,68,68,.18)' : 'rgba(245,158,11,.18)',
                    color: cs.waitingDays >= 3 ? '#fca5a5' : '#fbbf24',
                  }}>chờ {cs.waitingDays} ngày</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          {([
            ['all', 'Tất cả'], ['free', 'Chưa ai nhận'], ['mine', 'Của tôi'],
            ['design', '🎨 Thiết kế'], ['content', '✍️ Content'],
          ] as [Filter, string][]).map(([k, label]) => (
            <button
              key={k} onClick={() => setFilter(k)}
              style={{
                border: `1px solid ${filter === k ? '#6366f1' : 'var(--c334155)'}`,
                background: filter === k ? '#6366f1' : 'transparent',
                color: filter === k ? '#fff' : 'var(--c94a3b8)',
                borderRadius: 999, padding: '6px 13px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >{label}</button>
          ))}
        </div>

        {board && !groups.length && (
          <div style={{ border: '1px solid var(--c1f2937)', borderRadius: 12, padding: 30, textAlign: 'center', color: 'var(--c64748b)', fontSize: 14 }}>
            {filter === 'all' ? 'Hết việc hôm nay. Đẹp.' : 'Không có việc nào trong bộ lọc này.'}
          </div>
        )}

        {groups.map((g) => (
          <section key={g.kind} style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 7 }}>
              <span style={{ fontSize: 17 }}>{ICON[g.kind] ?? '•'}</span>
              <h2 style={{ fontSize: 15.5, margin: 0, fontWeight: 800 }}>{g.label}</h2>
              <span style={{ fontSize: 12, fontWeight: 800, background: 'var(--c1f2937)', color: 'var(--c94a3b8)', borderRadius: 999, padding: '2px 9px' }}>{g.jobs.length}</span>
            </div>
            <div style={{ border: '1px solid var(--c1f2937)', borderRadius: 12, overflow: 'hidden' }}>
              {g.jobs.map((j, i) => {
                const key = `${j.tenantId}:${j.jobId}`;
                const mine = j.by === board?.me;
                return (
                  <div key={key} style={{ borderTop: i ? '1px solid var(--c1f2937)' : 'none', background: 'var(--c111827)' }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 13px' }}>
                      {/* Late is the only colour on the row: everything red is a debt. */}
                      <span title={j.lateDays > 0 ? `Trễ ${j.lateDays} ngày` : 'Đúng hạn'} style={{
                        width: 8, height: 8, borderRadius: 999, marginTop: 6, flex: '0 0 auto',
                        background: j.lateDays > 0 ? '#ef4444' : j.lateDays === 0 ? '#f59e0b' : '#334155',
                      }} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12.5, fontWeight: 800, color: '#fbbf24' }}>{j.salon}</span>
                          <span style={{ fontSize: 11.5, color: j.lateDays > 0 ? '#fca5a5' : 'var(--c64748b)' }}>
                            {j.lateDays > 0 ? `trễ ${j.lateDays} ngày` : j.lateDays === 0 ? 'hôm nay' : `còn ${-j.lateDays} ngày`}
                          </span>
                          {j.by && (
                            <span style={{
                              fontSize: 11, fontWeight: 800, padding: '1px 7px', borderRadius: 999,
                              background: mine ? 'rgba(99,102,241,.2)' : 'rgba(148,163,184,.16)',
                              color: mine ? '#a5b4fc' : 'var(--c94a3b8)',
                            }}>{mine ? 'TÔI' : who(j.by).toUpperCase()} · {ago(j.heldAt)}</span>
                          )}
                        </div>
                        <div style={{ fontSize: 13.5, color: 'var(--ce2e8f0)', lineHeight: 1.5, marginTop: 2 }}>{j.text}</div>
                        {!!j.steps.length && (
                          <button
                            onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}
                            style={{ background: 'transparent', border: 'none', padding: '3px 0', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--ca5b4fc)' }}
                          >Bản làm việc ({j.steps.length}) {open[key] ? '↑' : '→'}</button>
                        )}
                        {open[key] && (
                          <ol style={{ margin: '3px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.65 }}>
                            {j.steps.map((s, k) => <li key={k}>{s}</li>)}
                          </ol>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 6, flex: '0 0 auto', alignItems: 'center' }}>
                        {!j.by && <Btn onClick={() => act(j, 'claim')} busy={busy === key} tone="primary">Nhận</Btn>}
                        {j.by && <Btn onClick={() => act(j, 'release')} busy={busy === key} tone="ghost">Trả lại</Btn>}
                        <Btn onClick={() => act(j, 'done')} busy={busy === key} tone="good">✓ Xong</Btn>
                        <a
                          href={`/agency?open=${encodeURIComponent(j.tenantId)}`}
                          title="Mở tiệm này"
                          style={{ color: 'var(--c64748b)', textDecoration: 'none', fontSize: 17, padding: '0 2px' }}
                        >›</a>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Tally({ n, label, tone }: { n: number; label: string; tone: 'bad' | 'warn' | 'mine' | 'good' | 'flat' }) {
  const col = tone === 'bad' ? '#fca5a5' : tone === 'warn' ? '#fbbf24' : tone === 'mine' ? '#a5b4fc' : tone === 'good' ? '#86efac' : 'var(--c64748b)';
  return (
    <div style={{ border: '1px solid var(--c1f2937)', background: 'var(--c111827)', borderRadius: 10, padding: '7px 13px', minWidth: 92 }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: col, lineHeight: 1.1 }}>{n}</div>
      <div style={{ fontSize: 11.5, color: 'var(--c94a3b8)' }}>{label}</div>
    </div>
  );
}

function Btn({ children, onClick, busy, tone }: { children: React.ReactNode; onClick: () => void; busy: boolean; tone: 'primary' | 'ghost' | 'good' }) {
  const style: React.CSSProperties = tone === 'primary'
    ? { background: '#6366f1', color: '#fff', border: 'none' }
    : tone === 'good'
      ? { background: 'transparent', color: '#86efac', border: '1px solid rgba(34,197,94,.4)' }
      : { background: 'transparent', color: 'var(--c94a3b8)', border: '1px solid var(--c334155)' };
  return (
    <button onClick={onClick} disabled={busy} style={{ ...style, borderRadius: 8, padding: '6px 11px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', opacity: busy ? 0.5 : 1, whiteSpace: 'nowrap' }}>
      {busy ? '…' : children}
    </button>
  );
}
