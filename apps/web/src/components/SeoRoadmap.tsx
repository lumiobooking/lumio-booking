'use client';

/**
 * The SEO roadmap, as a board somebody works through — two tracks side by side.
 *
 * WHY TWO TRACKS
 *
 * Google Maps and Google Search are two different rankings won by two different
 * kinds of work, on two different clocks. A map listing can move in six weeks;
 * a page ranking for a keyword takes months. Mixing them into one list made the
 * quick wins and the long game look interchangeable, and the long game always
 * lost. So: 📍 Bản đồ and 🔍 Từ khoá & Website, each with its own progress, its
 * own phases and its own honest timeline.
 *
 * DESIGN RULES THIS SCREEN OBEYS
 *
 * 1. "Việc đến hạn" sits above everything, across both tracks. Sixty jobs in
 *    eleven phases is a wall; the honest answer to "what do I do today" is
 *    short — every recurring job whose week has rolled over, plus the next new
 *    job on each track.
 * 2. Three states, never two. A measured task can be 'unknown' — the system
 *    cannot see it yet — and painting that as "not done" would be a lie the
 *    owner acts on. Unknown gets its own quiet amber and says why.
 * 3. Measured tasks have NO checkbox. If the numbers decide it, offering a box
 *    invites someone to tick a thing that is not true, and from then on the
 *    whole board is a guess. They carry a "hệ thống tự xác nhận" badge instead.
 * 4. The keyword list is ON the board, not in another tab. "Lập danh sách từ
 *    khoá" as a bare instruction is where these plans stall; the list itself,
 *    already carrying this salon's city and name, is the difference between a
 *    task someone reads and a task someone does.
 * 5. A phase already finished collapses. Progress you can see is motivating;
 *    thirty rows of green you must scroll past is not.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { ui } from '../lib/ui';
import { CardHead } from './CardHead';

type TaskState = 'done' | 'todo' | 'unknown';
type Tier = 'low' | 'medium' | 'high';
type Cadence = 'once' | 'weekly' | 'monthly' | 'quarterly';
type TrackId = 'map' | 'web';

interface Task {
  id: string; track: TrackId; phase: number; title: string; how: string; why: string;
  kind: 'manual' | 'check'; state: TaskState; auto: boolean; recurring: boolean;
  cadence: Cadence; minutes?: number; at?: string | null; by?: string | null;
}
interface Phase {
  track: TrackId; n: number; title: string; goal: string; target: string;
  tasks: Task[]; done: number; total: number; weeksLeft: [number, number] | null;
}
interface Track {
  track: TrackId; phases: Phase[]; done: number; total: number;
  next: Task | null; weeksToGoal: [number, number];
}
interface KeywordPlan {
  adGroups: { name: string; intent: string; note: string; keywords: string[] }[];
  seoTopics: { title: string; kind: string; why: string; targets: string[] }[];
}
interface Roadmap {
  tier: Tier; tracks: Track[]; dueNow: Task[]; keywords?: KeywordPlan | null;
}

const TRACK_META: Record<TrackId, { icon: string; label: string; blurb: string; accent: string }> = {
  map: {
    icon: '📍', label: 'Bản đồ', accent: '#6366f1',
    blurb: 'Lên top gói bản đồ (3 tiệm hiện đầu tiên khi khách tìm gần đây). Nhanh hơn, thấy kết quả trước.',
  },
  web: {
    icon: '🔍', label: 'Từ khoá & Website', accent: '#38bdf8',
    blurb: 'Lên top kết quả tìm kiếm theo từ khoá. Chậm hơn nhưng bền, và không ai lấy mất được.',
  },
};

const TIER_OPT: { id: Tier; label: string; hint: string }[] = [
  { id: 'low', label: 'Thị trấn nhỏ', hint: 'dưới 10 tiệm cùng ngành trong 5 dặm' },
  { id: 'medium', label: 'Ngoại ô / TP vừa', hint: '10–30 tiệm trong 5 dặm' },
  { id: 'high', label: 'Khu dày đặc', hint: 'trên 30 tiệm — Little Saigon, Houston, San Jose' },
];

const CADENCE_LABEL: Record<Cadence, string> = {
  once: '', weekly: 'mỗi tuần', monthly: 'mỗi tháng', quarterly: 'mỗi quý',
};

/** Why a keyword is on the list, in words an owner recognises. */
const INTENT_LABEL: Record<string, string> = {
  'book-now': 'Khách sẵn sàng đặt ngay',
  service: 'Khách đang tìm dịch vụ',
  design: 'Khách đang tìm mẫu',
  brand: 'Khách tìm đúng tên tiệm',
};

const KIND_LABEL: Record<string, string> = {
  money: 'Trang dịch vụ — trang kiếm tiền',
  local: 'Trang khu vực',
  service: 'Trang dịch vụ',
  guide: 'Bài hướng dẫn — kéo khách chưa sẵn sàng đặt',
};

/**
 * Weeks → a sentence an owner can hold you to.
 *
 * Takes `unknown` on purpose. This reads a field off a JSON response, and
 * destructuring the parameter directly turned a server that had not shipped
 * that field yet into `undefined is not iterable` — a stack trace where the
 * whole screen used to be. A missing timeline is a missing sentence, not an
 * outage.
 */
function monthsText(weeks: unknown): string {
  if (!Array.isArray(weeks) || weeks.length < 2) return '';
  const [lo, hi] = weeks as [number, number];
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return '';
  if (hi === 0) return 'Đã hết việc — từ đây là giữ hạng';
  const m = (w: number) => Math.round((w / 4.35) * 10) / 10;
  return `còn khoảng ${m(lo)}–${m(hi)} tháng nữa`;
}

/** What to show when the server is still on an older shape than this screen. */
function Mismatch({ what }: { what: string }) {
  return (
    <div style={{ ...ui.card, padding: 16, borderColor: '#f59e0b' }}>
      <div style={{ fontSize: 14.5, fontWeight: 700, color: '#f59e0b' }}>Chưa hiển thị được {what}</div>
      <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.65, marginTop: 6 }}>
        Máy chủ đang trả về dữ liệu theo phiên bản cũ hơn màn hình này — thường là vì bản cập nhật
        vừa lên và phần máy chủ còn đang chạy. Đợi vài phút rồi tải lại trang.
      </div>
    </div>
  );
}

const TONE: Record<TaskState, { fg: string; bg: string }> = {
  done:    { fg: '#22c55e', bg: 'rgba(34,197,94,.12)' },
  todo:    { fg: 'var(--c94a3b8)', bg: 'transparent' },
  unknown: { fg: '#f59e0b', bg: 'rgba(245,158,11,.12)' },
};

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ height: 8, background: 'var(--c0f172a)', borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width .3s' }} />
    </div>
  );
}

/** One job. Same row wherever it appears, so a task looks like itself whether
 *  it is read in "việc đến hạn" or inside its phase. */
function TaskRow({
  t, busy, onToggle, showTrack,
}: { t: Task; busy: string | null; onToggle: (t: Task) => void; showTrack?: boolean }) {
  const tone = TONE[t.state];
  const collapsed = t.state === 'done';
  return (
    <div style={{
      display: 'flex', gap: 11, alignItems: 'flex-start',
      padding: '12px 13px', borderRadius: 10,
      background: collapsed ? 'transparent' : 'var(--c0f172a)',
      border: `1px solid ${collapsed ? 'var(--c1e293b)' : 'var(--c334155)'}`,
      opacity: collapsed && !t.recurring ? 0.62 : 1,
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
          onClick={() => onToggle(t)}
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
          {showTrack && (
            <span style={{ fontSize: 11.5, color: TRACK_META[t.track].accent, whiteSpace: 'nowrap' }}>
              {TRACK_META[t.track].icon}
            </span>
          )}
          <span style={{
            fontSize: 14.5, fontWeight: 600, lineHeight: 1.4, color: 'var(--ce2e8f0)',
            textDecoration: collapsed && !t.recurring ? 'line-through' : 'none',
          }}>{t.title}</span>
          {t.auto && (
            <span style={{ fontSize: 10.5, fontWeight: 600, color: tone.fg, border: `1px solid ${tone.fg}`, borderRadius: 20, padding: '1px 7px', whiteSpace: 'nowrap' }}>
              {t.state === 'unknown' ? 'chưa đo được' : 'hệ thống tự xác nhận'}
            </span>
          )}
          {t.recurring && (
            <span style={{ fontSize: 10.5, fontWeight: 600, color: '#38bdf8', border: '1px solid #38bdf8', borderRadius: 20, padding: '1px 7px', whiteSpace: 'nowrap' }}>
              🔁 {CADENCE_LABEL[t.cadence]}
            </span>
          )}
          {!t.auto && t.minutes ? (
            <span style={{ fontSize: 11.5, color: 'var(--c64748b)', whiteSpace: 'nowrap' }}>≈{t.minutes}p</span>
          ) : null}
        </div>

        {!collapsed && (
          <>
            <div style={{ fontSize: 13, color: 'var(--ccbd5e1)', lineHeight: 1.6, marginTop: 5 }}>{t.how}</div>
            <div style={{ fontSize: 12.5, color: 'var(--c64748b)', lineHeight: 1.55, marginTop: 5 }}>{t.why}</div>
          </>
        )}
        {collapsed && t.at && (
          <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginTop: 3 }}>
            {t.recurring ? 'Đã làm kỳ này' : 'Xong'} {new Date(t.at).toLocaleDateString('vi-VN')}{t.by ? ` · ${t.by}` : ''}
          </div>
        )}
      </div>
    </div>
  );
}

/** The keyword list itself, sitting on the web track where the work happens.
 *
 *  Every keyword here already carries this salon's city and name — a template
 *  shown raw is a template that gets pasted raw into an H1. */
function KeywordPanel({ plan }: { plan: KeywordPlan }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [showAds, setShowAds] = useState(false);

  const copy = async (key: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1600); }
    catch { /* a browser that refuses the clipboard is not an error worth a red box */ }
  };

  return (
    <div style={{ ...ui.card, padding: 16, marginBottom: 12, borderColor: '#38bdf8' }}>
      <CardHead
        icon="🎯"
        title="Từ khoá của tiệm này"
        note="Danh sách đã ghép sẵn tên thành phố và tên tiệm. Mỗi trang nhắm MỘT từ khoá chính — hai trang cùng nhắm một từ thì Google chọn đại một trang, và thường chọn sai."
        alsoIn="📣 Quảng cáo & SEO"
      />

      <div style={{ fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--c64748b)', margin: '16px 0 9px' }}>
        Trang và bài cần có
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {plan.seoTopics.map((t, i) => (
          <div key={i} style={{ padding: '11px 12px', borderRadius: 10, background: 'var(--c0f172a)', border: '1px solid var(--c334155)' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ce2e8f0)', lineHeight: 1.4 }}>{t.title}</span>
              <span style={{ fontSize: 10.5, fontWeight: 600, color: '#38bdf8', border: '1px solid #38bdf8', borderRadius: 20, padding: '1px 7px', whiteSpace: 'nowrap' }}>
                {KIND_LABEL[t.kind] ?? t.kind}
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.55, marginTop: 5 }}>{t.why}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {t.targets.map((k, j) => (
                <span key={j} style={{
                  fontFamily: mono, fontSize: 11.5, color: j === 0 ? 'var(--ce2e8f0)' : 'var(--c94a3b8)',
                  background: j === 0 ? 'rgba(56,189,248,.14)' : 'var(--c1e293b)',
                  border: `1px solid ${j === 0 ? '#38bdf8' : 'var(--c334155)'}`,
                  borderRadius: 6, padding: '3px 8px',
                }}>{k}</span>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--c64748b)', marginTop: 6 }}>
              Từ đầu tiên là từ khoá chính — đưa vào tiêu đề, H1 và 100 chữ đầu. Các từ sau rải trong bài.
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={() => setShowAds(!showAds)}
        style={{
          marginTop: 14, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
          fontFamily: 'inherit', fontSize: 12.5, color: '#38bdf8', fontWeight: 600,
        }}
      >
        {showAds ? '▾' : '▸'} Nhóm từ khoá chạy quảng cáo ({plan.adGroups.length} nhóm)
      </button>

      {showAds && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 10 }}>
          {plan.adGroups.map((g, i) => (
            <div key={i} style={{ padding: '11px 12px', borderRadius: 10, background: 'var(--c0f172a)', border: '1px solid var(--c334155)' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ce2e8f0)' }}>
                  {g.name}
                  <span style={{ fontSize: 11.5, color: 'var(--c64748b)', fontWeight: 500, marginLeft: 8 }}>
                    {INTENT_LABEL[g.intent] ?? g.intent}
                  </span>
                </span>
                <button
                  onClick={() => copy(`g${i}`, g.keywords.join('\n'))}
                  style={{
                    background: 'transparent', border: '1px solid var(--c334155)', borderRadius: 7,
                    padding: '3px 9px', cursor: 'pointer', fontFamily: 'inherit',
                    fontSize: 11.5, color: copied === `g${i}` ? '#22c55e' : 'var(--c94a3b8)',
                  }}
                >{copied === `g${i}` ? '✓ đã chép' : 'chép'}</button>
              </div>
              <div style={{ fontSize: 12, color: 'var(--c64748b)', lineHeight: 1.55, marginTop: 4 }}>{g.note}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {g.keywords.map((k, j) => (
                  <span key={j} style={{
                    fontFamily: mono, fontSize: 11.5, color: 'var(--c94a3b8)',
                    background: 'var(--c1e293b)', border: '1px solid var(--c334155)',
                    borderRadius: 6, padding: '3px 8px',
                  }}>{k}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SeoRoadmap({ token }: { token: string | null }) {
  const [data, setData] = useState<Roadmap | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<TrackId>('map');
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try { setData(await apiFetch<Roadmap>('/content/seo-roadmap', { token })); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Không tải được'); }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const setTier = async (tier: Tier) => {
    if (busy) return;
    setBusy('tier');
    try { setData(await apiFetch<Roadmap>('/content/seo-tier', { method: 'POST', token, body: { tier } })); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Không lưu được'); }
    finally { setBusy(null); }
  };

  const toggle = async (t: Task) => {
    if (t.auto || busy) return;
    setBusy(t.id);
    try { setData(await apiFetch<Roadmap>(`/content/seo-roadmap/${t.id}`, { method: 'POST', token, body: { done: t.state !== 'done' } })); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Không lưu được'); }
    finally { setBusy(null); }
  };

  if (err) return <div style={{ ...ui.card, padding: 16, color: '#ef4444', fontSize: 13.5 }}>{err}</div>;
  if (!data) return <div style={{ fontSize: 13, color: 'var(--c64748b)', padding: '18px 0' }}>Đang tải…</div>;

  // The one shape check on this screen. Everything below indexes into
  // `tracks`, so a server that predates it must produce a sentence rather than
  // a crash — and the sentence has to say what is actually wrong, because
  // "đang tải…" for ever is the version of this bug nobody reports.
  if (!Array.isArray(data.tracks) || data.tracks.length === 0) return <Mismatch what="lộ trình SEO" />;
  const cur = data.tracks.find((t) => t.track === tab) ?? data.tracks[0];
  if (!cur || !Array.isArray(cur.phases)) return <Mismatch what="lộ trình SEO" />;
  const meta = TRACK_META[cur.track];
  const due = Array.isArray(data.dueNow) ? data.dueNow : [];
  const pct = cur.total ? Math.round((cur.done / cur.total) * 100) : 0;

  return (
    <>
      {/* ---- what is due right now, across both tracks ---- */}
      <div style={{ ...ui.card, padding: 16, marginBottom: 14, borderColor: due.length ? '#f59e0b' : '#22c55e' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)' }}>
          {due.length ? `⚡ Việc đến hạn — ${due.length} việc` : '✓ Không còn việc đến hạn'}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--c64748b)', lineHeight: 1.6, marginTop: 5 }}>
          {due.length
            ? 'Việc lặp lại của kỳ này xếp trước, rồi tới việc mới của từng nhánh. Làm hết chỗ này là hôm nay xong — phần còn lại chưa tới hạn.'
            : 'Cả hai nhánh đều không có việc quá hạn. Tuần sau các việc lặp lại sẽ tự bật lại.'}
        </div>
        {due.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 12 }}>
            {due.map((t) => (
              <TaskRow key={t.id} t={t} busy={busy} onToggle={toggle} showTrack />
            ))}
          </div>
        )}
      </div>

      {/* ---- the competition tier: the one input that changes both plans ---- */}
      <div style={{ ...ui.card, padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--c64748b)', marginBottom: 8 }}>
          Mức cạnh tranh của khu này
        </div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {TIER_OPT.map((o) => {
            const on = data.tier === o.id;
            return (
              <button
                key={o.id}
                onClick={() => setTier(o.id)}
                disabled={busy === 'tier'}
                title={o.hint}
                style={{
                  flex: '1 1 150px', textAlign: 'left', padding: '9px 11px', borderRadius: 9,
                  cursor: busy === 'tier' ? 'wait' : 'pointer', fontFamily: 'inherit',
                  background: on ? 'rgba(99,102,241,.14)' : 'var(--c0f172a)',
                  border: `1px solid ${on ? '#6366f1' : 'var(--c334155)'}`,
                }}
              >
                <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: on ? 'var(--ca5b4fc)' : 'var(--ccbd5e1)' }}>{o.label}</span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--c64748b)', marginTop: 2, lineHeight: 1.4 }}>{o.hint}</span>
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginTop: 7, lineHeight: 1.5 }}>
          Chọn sai mức là chọn sai cả lộ trình lẫn lời hứa thời gian. Mở Google Maps, tìm từ khoá chính, đếm tiệm cùng ngành trong 5 dặm.
        </div>
      </div>

      {/* ---- the two tracks ---- */}
      <div style={{ display: 'flex', gap: 9, marginBottom: 13, flexWrap: 'wrap' }}>
        {data.tracks.map((t) => {
          const m = TRACK_META[t.track];
          const on = t.track === cur.track;
          const p = t.total ? Math.round((t.done / t.total) * 100) : 0;
          return (
            <button
              key={t.track}
              onClick={() => setTab(t.track)}
              style={{
                flex: '1 1 220px', textAlign: 'left', padding: '12px 13px', borderRadius: 11,
                cursor: 'pointer', fontFamily: 'inherit',
                background: on ? 'var(--c0f172a)' : 'transparent',
                border: `1px solid ${on ? m.accent : 'var(--c1e293b)'}`,
                opacity: on ? 1 : 0.72,
              }}
            >
              <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 14.5, fontWeight: 700, color: on ? 'var(--ce2e8f0)' : 'var(--c94a3b8)' }}>
                  {m.icon} {m.label}
                </span>
                <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, color: on ? m.accent : 'var(--c64748b)' }}>
                  {t.done}/{t.total}
                </span>
              </span>
              <span style={{ display: 'block', marginTop: 9 }}><Bar pct={p} color={on ? '#22c55e' : 'var(--c334155)'} /></span>
              <span style={{ display: 'block', fontSize: 11.5, color: 'var(--c64748b)', marginTop: 6 }}>
                {monthsText(t.weeksToGoal)}
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ ...ui.card, padding: 16, marginBottom: 12, borderColor: meta.accent }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{meta.icon} {meta.label}</div>
        <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.6, marginTop: 5 }}>{meta.blurb}</div>
        <div style={{ margin: '11px 0 4px' }}><Bar pct={pct} color="#22c55e" /></div>
        <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 8 }}>
          {cur.done}/{cur.total} · {pct}% · {monthsText(cur.weeksToGoal)}
        </div>

        {cur.next ? (
          <div style={{ marginTop: 13, padding: '13px 14px', borderRadius: 10, background: 'var(--c0f172a)', border: `1px solid ${meta.accent}` }}>
            <div style={{ fontSize: 10.5, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--c64748b)', marginBottom: 4 }}>
              Bước tiếp theo của nhánh này
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)', lineHeight: 1.4 }}>{cur.next.title}</div>
            <div style={{ fontSize: 13, color: 'var(--ccbd5e1)', lineHeight: 1.6, marginTop: 6 }}>{cur.next.how}</div>
            {cur.next.minutes ? (
              <div style={{ fontSize: 12, color: 'var(--c64748b)', marginTop: 6 }}>≈ {cur.next.minutes} phút</div>
            ) : null}
          </div>
        ) : (
          <div style={{ marginTop: 13, padding: '13px 14px', borderRadius: 10, background: 'rgba(34,197,94,.1)', border: '1px solid #22c55e', fontSize: 13.5, color: 'var(--ce2e8f0)', lineHeight: 1.6 }}>
            ✓ Hết việc trong nhánh này. Từ đây là giai đoạn giữ hạng — đo mỗi tháng và đừng để đứt nhịp.
          </div>
        )}
      </div>

      {/* The keyword list belongs to the web track, next to the work it feeds. */}
      {cur.track === 'web' && data.keywords ? <KeywordPanel plan={data.keywords} /> : null}

      {/* ---- the phases of this track ---- */}
      {cur.phases.map((p) => {
        const key = `${p.track}:${p.n}`;
        const finished = p.done === p.total && p.total > 0;
        const shown = open[key] ?? !finished; // a finished phase folds itself away
        return (
          <div key={key} style={{ ...ui.card, padding: 0, marginBottom: 12, overflow: 'hidden' }}>
            <button
              onClick={() => setOpen({ ...open, [key]: !shown })}
              style={{
                width: '100%', textAlign: 'left', background: 'transparent', border: 'none',
                padding: '14px 16px', cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'flex-start',
                fontFamily: 'inherit',
              }}
            >
              <span style={{
                fontFamily: mono, fontSize: 12, fontWeight: 700,
                color: finished ? '#22c55e' : meta.accent, background: finished ? 'rgba(34,197,94,.12)' : 'var(--c1e293b)',
                borderRadius: 7, minWidth: 30, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>{finished ? '✓' : p.n}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 15.5, fontWeight: 700, color: 'var(--ce2e8f0)', lineHeight: 1.3 }}>{p.title}</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--c64748b)', marginTop: 2 }}>
                  {p.total === 0 ? 'Không cần ở mức cạnh tranh này'
                    : p.weeksLeft ? `dự kiến ${p.weeksLeft[0]}–${p.weeksLeft[1]} tuần` : 'xong'}
                </span>
              </span>
              <span style={{ fontFamily: mono, fontSize: 12.5, fontWeight: 600, color: finished ? '#22c55e' : 'var(--c94a3b8)', flexShrink: 0, paddingTop: 4 }}>
                {p.done}/{p.total} {shown ? '▾' : '▸'}
              </span>
            </button>

            {shown && (
              <div style={{ padding: '0 16px 14px' }}>
                <div style={{ paddingLeft: 42, margin: '0 0 14px' }}>
                  <div style={{ fontSize: 13, color: 'var(--c94a3b8)', lineHeight: 1.6 }}>{p.goal}</div>
                  {p.target && (
                    <div style={{ fontSize: 12.5, color: 'var(--ccbd5e1)', lineHeight: 1.55, marginTop: 7, paddingLeft: 10, borderLeft: '2px solid #22c55e' }}>
                      <b style={{ color: '#22c55e' }}>Xong giai đoạn khi:</b> {p.target}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {p.tasks.map((t) => <TaskRow key={t.id} t={t} busy={busy} onToggle={toggle} />)}
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div style={{ fontSize: 12, color: 'var(--c64748b)', lineHeight: 1.7, marginTop: 16, padding: '0 2px' }}>
        Mục có nhãn <b style={{ color: 'var(--c94a3b8)' }}>hệ thống tự xác nhận</b> không tích tay được — hệ thống đọc thẳng từ số liệu thật của tiệm, nên không ai tích nhầm một việc chưa làm.
        Mục <b style={{ color: '#f59e0b' }}>chưa đo được</b> nghĩa là hệ thống chưa nhìn thấy dữ liệu, thường vì chưa kết nối Google Business Profile — không phải là chưa làm.
        <br />Mục có <b style={{ color: '#38bdf8' }}>🔁</b> là việc lặp lại: tích xong chỉ tính cho kỳ này, sang tuần hoặc sang tháng nó tự bật lại thành chưa làm — vì việc đó thật sự phải làm lại.
        <br /><b style={{ color: '#ef4444' }}>Không mua backlink, không mua traffic, không mua listing.</b> Toàn bộ lộ trình này làm tay. Link mua được là link Google đã biết cách nhận ra, và traffic mua là bot vào rồi thoát ngay — dạy Google đúng một điều là trang này không đáng ở lại.
      </div>
    </>
  );
}
