'use client';

import { AdminBack } from '../../../components/AdminBack';

/**
 * THE PLATFORM'S AI HEALTH — "which salon's AI is doing badly, and why?"
 *
 * Until 17/11/2026 nothing answered that. The AI failed for four customers on
 * 16/11 and the owner found out by testing his own page; that a reply took a
 * median of 14 seconds and that 62 of 94 salons had the AI off were found by
 * hand. This screen reads the numbers (api messenger/ai-fleet.ts) in the order
 * a person running the platform asks:
 *
 *   1. how is the AI doing overall — speed, failures, customers left waiting;
 *   2. what new behaviour is being tried on the test accounts, and the switch
 *      that takes it to every salon (api common/ai-release.ts);
 *   3. which salon needs attention, worst first.
 *
 * Numbers only: no message, no customer's name crosses from a salon to here.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';

type Flag = 'slow' | 'waiting' | 'errors' | 'blocked' | 'off';
interface Row {
  tenantId: string; name: string; slug: string; bot: 'on' | 'off' | 'none';
  conversations: number; botReplies: number;
  medianSec: number | null; p90Sec: number | null; over15: number;
  phases: { waitMs: number; thinkMs: number; sendMs: number; samples: number } | null;
  apologies: number; waiting: number;
  selfHandledRate: number | null; humanTook: number; booked: number;
  blockRate: number | null; flags: Flag[];
}
interface Fleet {
  days: number; from: string; to: string; truncated: boolean;
  totals: { salons: number; botOn: number; botOff: number; noChannel: number; conversations: number; botReplies: number; medianSec: number | null; p90Sec: number | null; apologies: number; waiting: number; selfHandledRate: number | null; booked: number };
  rows: Row[];
}
type Stage = 'off' | 'canary' | 'on';
interface Release {
  features: { feature: string; stage: Stage; ships: Stage; vi: string; en: string }[];
  testAccounts: { id: string; name: string; slug: string }[];
  updatedAt: string | null; updatedBy: string | null;
}
interface PerAction { ok: number; failed: number; lastOkAt: string | null }
interface Health { presence?: { sent: number; failed: number; lastError: string | null; seen?: PerAction; typingOn?: PerAction; typingOff?: PerAction }; failures?: number; replies?: number; lastDetail?: string | null; hardModel?: string | null }
/** Support's test of the typing dots (api MessengerService.typingTestStart). */
interface DotsStart { started: boolean; reason?: string; account?: string | null; channel?: string; seconds?: number; lastCustomerAt?: string | null }
interface DotsRun { running: boolean; startedAt: string; endedAt: string | null; account: string | null; channel: string; seenFirst: boolean; seconds: number; calls: { action: string; ok: boolean; status: number | null; error: string | null; at: string }[] }
const DOTS_REFUSED: Record<string, string> = {
  'no-recent-thread': 'Chưa có ai nhắn vào trang thử trong 30 phút qua. Anh nhắn một tin vào trang thử rồi bấm lại.',
  busy: 'Đang chạy một lần thử — chờ xong rồi bấm lại.',
  'no-test-account': 'Chưa có tài khoản thử nào.',
  'not-a-test-account': 'Chỉ thử được trên tài khoản thử, không thử trên tiệm của khách.',
  'channel-has-no-typing': 'Kênh này không có dấu “đang soạn” (chỉ Messenger và Instagram có).',
  'no-token': 'Trang thử chưa kết nối Facebook.',
  'no-thread': 'Không tìm thấy cuộc trò chuyện.',
};
const CHANNEL_VI: Record<string, string> = { messenger: 'Messenger', instagram: 'Instagram' };
const clock = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString('vi-VN') : '—');

const FLAG: Record<Flag, { vi: string; color: string }> = {
  slow: { vi: 'Trả lời chậm', color: 'var(--ink-warn)' },
  waiting: { vi: 'Khách đang chờ', color: 'var(--ink-bad)' },
  errors: { vi: 'AI có lỗi', color: 'var(--ink-bad)' },
  blocked: { vi: 'Dặn dò chặn nhiều', color: 'var(--ink-warn)' },
  off: { vi: 'AI đang tắt', color: 'var(--c94a3b8)' },
};
const STAGE: Record<Stage, string> = { off: 'Tắt', canary: 'Chỉ tài khoản thử', on: 'Mọi tiệm' };

const sec = (n: number | null) => (n === null ? '—' : `${n < 10 && !Number.isInteger(n) ? n.toFixed(1) : Math.round(n)} giây`);
const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n * 100)}%`);
const ms = (n: number) => `${(n / 1000).toFixed(1)}s`;

export default function AiFleetPage() {
  const { token, user, ready } = useAuth();
  const [days, setDays] = useState(7);
  const [fleet, setFleet] = useState<Fleet | null>(null);
  const [release, setRelease] = useState<Release | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The switch a person has pressed once and must press again: `feature:stage`. */
  const [arming, setArming] = useState<string | null>(null);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  /** The dots test: what was started, and what Meta answered once it ended. */
  const [dots, setDots] = useState<{ phase: 'idle' | 'running' | 'done'; start?: DotsStart; run?: DotsRun | null; note?: string }>({ phase: 'idle' });

  const load = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    try {
      const [f, r, h] = await Promise.all([
        apiFetch<Fleet>(`/support/ai-fleet?days=${days}`, { token }),
        apiFetch<Release>('/support/ai-release', { token }).catch(() => null),
        apiFetch<Health>('/support/ai-leaks/health', { token }).catch(() => null),
      ]);
      setFleet(f); setRelease(r); setHealth(h); setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Không tải được số liệu.');
    } finally { setBusy(false); }
  }, [token, days]);

  useEffect(() => { void load(); }, [load]);

  const move = async (feature: string, stage: Stage) => {
    if (!token) return;
    const key = `${feature}:${stage}`;
    // "Mọi tiệm" reaches every salon's customers: a second press, never a single slip.
    if (stage === 'on' && arming !== key) { setArming(key); return; }
    setArming(null);
    try {
      setRelease(await apiFetch<Release>('/support/ai-release', { token, method: 'POST', body: { stages: { [feature]: stage } } }));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Không đổi được. Chỉ Super Admin được đổi.');
    }
  };

  const tryDots = async (seenFirst: boolean) => {
    if (!token || dots.phase === 'running') return;
    try {
      const start = await apiFetch<DotsStart>('/support/ai-fleet/typing-test', { token, method: 'POST', body: { seenFirst, seconds: 12 } });
      if (!start.started) { setDots({ phase: 'idle', note: DOTS_REFUSED[start.reason ?? ''] ?? 'Không thử được lúc này.' }); return; }
      setDots({ phase: 'running', start });
      // The dots end by themselves; then ask what Meta answered to each call.
      window.setTimeout(() => {
        void apiFetch<{ last: DotsRun | null }>('/support/ai-fleet/typing-test', { token })
          .then((r) => setDots({ phase: 'done', start, run: r.last }))
          .catch(() => setDots({ phase: 'done', start, run: null }));
      }, ((start.seconds ?? 12) + 3) * 1000);
    } catch (e) {
      setDots({ phase: 'idle', note: e instanceof Error ? e.message : 'Không thử được. Chỉ Super Admin được thử.' });
    }
  };

  if (!ready) return <main style={wrap}><p style={{ color: 'var(--c94a3b8)' }}>Đang tải…</p></main>;
  if (!user) return <main style={wrap}><p style={{ color: 'var(--cfca5a5)' }}>Cần đăng nhập Super Admin.</p></main>;

  const t = fleet?.totals;
  const rows = (fleet?.rows ?? []).filter((r) => !onlyFlagged || r.flags.length > 0);
  const flagged = (fleet?.rows ?? []).filter((r) => r.flags.length > 0).length;

  return (
    <main style={wrap}>
      <AdminBack />
      <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>Sức khoẻ AI toàn hệ thống</h1>
      <p style={{ color: 'var(--c94a3b8)', margin: '0 0 18px', fontSize: 14, lineHeight: 1.6 }}>
        AI của từng tiệm đang trả lời nhanh hay chậm, có lỗi không, còn khách nào đang chờ.
        Chỉ có <b>con số</b> — không có nội dung tin nhắn hay tên khách của tiệm nào.
      </p>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        {[1, 7, 30].map((d) => (
          <button key={d} onClick={() => setDays(d)} style={d === days ? chipOn : chip}>
            {d === 1 ? '24 giờ' : `${d} ngày`}
          </button>
        ))}
        <button onClick={() => void load()} style={ghost}>{busy ? 'Đang tải…' : '↻ Tải lại'}</button>
      </div>

      {err && <div style={{ ...banner, borderColor: '#ef4444', color: 'var(--cfca5a5)' }}>{err}</div>}
      {fleet?.truncated && <div style={{ ...banner, borderColor: '#f59e0b', color: 'var(--cfde68a)' }}>Quá nhiều cuộc trò chuyện trong khoảng này — số liệu chỉ tính một phần. Chọn khoảng ngắn hơn.</div>}

      {t && (
        <div style={{ ...card, display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          <Stat label="Khách chờ (trung vị)" value={sec(t.medianSec)} sub={t.medianSec !== null && t.medianSec > 10 ? 'mục tiêu: dưới 5 giây' : undefined} big />
          <Stat label="90% câu trả lời trong" value={sec(t.p90Sec)} />
          <Stat label="AI tự xử lý trọn cuộc" value={pct(t.selfHandledRate)} sub={`${t.conversations} cuộc trò chuyện`} />
          <Stat label="Lịch AI đặt" value={String(t.booked)} />
          <Stat label="AI lỗi, phải xin lỗi khách" value={String(t.apologies)} sub={t.apologies ? 'xem tiệm có nhãn “AI có lỗi”' : undefined} />
          <Stat label="Khách đang chờ > 30 phút" value={String(t.waiting)} />
          <Stat label="Tiệm bật AI" value={`${t.botOn} / ${t.botOn + t.botOff}`} sub={`${t.botOff} tiệm đang tắt`} />
        </div>
      )}

      {release && (
        <div style={card}>
          <h2 style={h2}>Tính năng mới đang thử</h2>
          <p style={hint}>
            Mỗi thay đổi của AI chạy trước trên <b>tài khoản thử</b>
            {release.testAccounts.length ? ` (${release.testAccounts.map((a) => a.name).join(', ')})` : ''}.
            Thấy ổn mới bật cho mọi tiệm — bấm nút, không cần deploy. Có vấn đề thì bấm <b>Tắt</b>.
          </p>
          <div style={{ display: 'grid', gap: 10 }}>
            {release.features.map((f) => (
              <div key={f.feature} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '10px 12px', border: '1px solid var(--c334155)', borderRadius: 10 }}>
                <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                  <b style={{ fontSize: 14 }}>{f.vi}</b>
                  <div style={{ fontSize: 12, color: 'var(--c64748b)' }}>Đang: {STAGE[f.stage]}</div>
                </div>
                {(['off', 'canary', 'on'] as Stage[]).map((s) => {
                  const key = `${f.feature}:${s}`;
                  const armed = arming === key;
                  return (
                    <button key={s} onClick={() => void move(f.feature, s)} disabled={f.stage === s}
                      style={f.stage === s ? chipOn : armed ? { ...chip, border: '1px solid var(--ink-warn)', color: 'var(--ink-warn)' } : chip}>
                      {armed ? 'Bấm lần nữa để bật cho mọi tiệm' : STAGE[s]}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          {health?.presence && (
            <p style={{ ...hint, margin: '12px 0 0' }}>
              Dấu “đã xem / đang soạn” gửi tới Meta từ lúc máy chủ khởi động: <b>{health.presence.sent}</b> lần thành công, <b>{health.presence.failed}</b> lần lỗi
              {health.presence.lastError ? ` — lỗi gần nhất: ${health.presence.lastError}` : ''}.
              {health.presence.typingOn && health.presence.seen && (
                <> Trong đó: “đã xem” <b>{health.presence.seen.ok}</b> (gần nhất {clock(health.presence.seen.lastOkAt)}),
                  “đang soạn” <b>{health.presence.typingOn.ok}</b> (gần nhất {clock(health.presence.typingOn.lastOkAt)}),
                  tắt <b>{health.presence.typingOff?.ok ?? 0}</b>.</>
              )}
            </p>
          )}
          {user.role === 'SUPER_ADMIN' && (
            <div style={{ marginTop: 14, padding: '12px 14px', border: '1px dashed var(--c334155)', borderRadius: 10 }}>
              <b style={{ fontSize: 14 }}>Thử ba dấu chấm “đang soạn”</b>
              <p style={{ ...hint, margin: '4px 0 10px' }}>
                Máy chủ chỉ biết Meta đã nhận lệnh; điện thoại có vẽ ba dấu chấm hay không thì phải nhìn mới biết.
                Cách thử: <b>1)</b> mở Messenger trên điện thoại, nhắn một tin vào trang thử
                {release.testAccounts.length ? ` (${release.testAccounts.map((a) => a.name).join(' hoặc ')})` : ''};
                <b> 2)</b> chờ AI trả lời xong; <b>3)</b> bấm một nút dưới đây rồi nhìn điện thoại 12 giây.
                Không có tin nhắn nào được gửi, và chỉ chạy trên tài khoản thử.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={() => void tryDots(false)} disabled={dots.phase === 'running'} style={chip}>Chỉ hiện ba dấu chấm</button>
                <button onClick={() => void tryDots(true)} disabled={dots.phase === 'running'} style={chip}>“Đã xem” rồi ba dấu chấm</button>
              </div>
              {dots.note && dots.phase === 'idle' && <p style={{ ...hint, margin: '10px 0 0', color: 'var(--ink-warn)' }}>{dots.note}</p>}
              {dots.phase === 'running' && dots.start && (
                <p style={{ ...hint, margin: '10px 0 0', color: 'var(--ink-link)' }}>
                  Đang hiện ba dấu chấm trong {dots.start.seconds} giây trên cuộc trò chuyện khách vừa nhắn lúc {clock(dots.start.lastCustomerAt)}
                  {' '}({dots.start.account ?? 'tài khoản thử'} · {CHANNEL_VI[dots.start.channel ?? ''] ?? dots.start.channel}) — anh nhìn điện thoại ngay bây giờ.
                </p>
              )}
              {dots.phase === 'done' && (
                <p style={{ ...hint, margin: '10px 0 0' }}>
                  {dots.run
                    ? <>Xong. Meta đã nhận <b>{dots.run.calls.filter((c) => c.ok).length}/{dots.run.calls.length}</b> lệnh
                        ({dots.run.calls.map((c) => `${c.action === 'mark_seen' ? 'đã xem' : c.action === 'typing_on' ? 'đang soạn' : 'tắt'} ${clock(c.at)}${c.ok ? '' : ' ✕'}`).join(' · ')}).
                        {dots.run.calls.some((c) => !c.ok)
                          ? <span style={{ color: 'var(--ink-bad)' }}> Meta từ chối: {dots.run.calls.find((c) => !c.ok)?.error ?? 'không rõ lý do'}.</span>
                          : ' Nếu Meta nhận đủ mà điện thoại vẫn không hiện ba dấu chấm, lỗi không nằm ở lệnh gửi — thử lại bằng một tài khoản Facebook khác (không phải quản trị viên trang) rồi báo kết quả.'}</>
                    : 'Xong, nhưng không đọc được kết quả. Bấm ↻ Tải lại rồi thử lại.'}
                </p>
              )}
            </div>
          )}
          {release.updatedAt && <p style={{ ...hint, margin: '6px 0 0' }}>Đổi lần cuối: {new Date(release.updatedAt).toLocaleString('vi-VN')} bởi {release.updatedBy ?? '—'}.</p>}
        </div>
      )}

      {fleet && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            <h2 style={{ ...h2, margin: 0, flex: 1 }}>Từng tiệm — cần chú ý lên đầu</h2>
            <button onClick={() => setOnlyFlagged((v) => !v)} style={onlyFlagged ? chipOn : chip}>Chỉ tiệm cần chú ý ({flagged})</button>
          </div>
          <p style={hint}>
            <b>Khách chờ</b> = từ tin cuối của khách đến câu AI trả lời. Cột <b>Chờ · AI · Gửi</b> cho biết thời gian đó đi đâu:
            chờ khách nhắn xong, AI soạn và kiểm tra, rồi gửi qua kênh (chỉ có ở câu trả lời sau bản 17/11).
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Tiệm</th>
                  <th style={thR}>Cuộc chat</th>
                  <th style={thR}>AI trả lời</th>
                  <th style={thR}>Khách chờ</th>
                  <th style={thR}>90%</th>
                  <th style={thR}>Chờ · AI · Gửi</th>
                  <th style={thR}>AI tự xử lý</th>
                  <th style={thR}>Lịch</th>
                  <th style={thR}>Lỗi</th>
                  <th style={thR}>Đang chờ</th>
                  <th style={thR}>Bị chặn</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.tenantId}>
                    <td style={td}>
                      <b style={{ color: 'var(--cf1f5f9)' }}>{r.name}</b>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 4 }}>
                        <span style={{ ...tag, borderColor: r.bot === 'on' ? 'var(--ink-good)' : 'var(--c334155)', color: r.bot === 'on' ? 'var(--ink-good)' : 'var(--c94a3b8)' }}>
                          {r.bot === 'on' ? 'AI bật' : r.bot === 'off' ? 'AI tắt' : 'Chưa nối kênh'}
                        </span>
                        {r.flags.filter((f) => f !== 'off').map((f) => (
                          <span key={f} style={{ ...tag, borderColor: FLAG[f].color, color: FLAG[f].color }}>{FLAG[f].vi}</span>
                        ))}
                      </div>
                    </td>
                    <td style={tdR}>{r.conversations}</td>
                    <td style={tdR}>{r.botReplies}</td>
                    <td style={{ ...tdR, color: r.medianSec !== null && r.medianSec > 10 ? 'var(--ink-warn)' : 'var(--c94a3b8)' }}>{sec(r.medianSec)}</td>
                    <td style={tdR}>{sec(r.p90Sec)}</td>
                    <td style={tdR}>{r.phases ? `${ms(r.phases.waitMs)} · ${ms(r.phases.thinkMs)} · ${ms(r.phases.sendMs)}` : '—'}</td>
                    <td style={tdR}>{pct(r.selfHandledRate)}</td>
                    <td style={tdR}>{r.booked}</td>
                    <td style={{ ...tdR, color: r.apologies ? 'var(--ink-bad)' : 'var(--c94a3b8)' }}>{r.apologies}</td>
                    <td style={{ ...tdR, color: r.waiting >= 3 ? 'var(--ink-bad)' : 'var(--c94a3b8)' }}>{r.waiting}</td>
                    <td style={{ ...tdR, color: r.blockRate !== null && r.blockRate > 0.25 ? 'var(--ink-warn)' : 'var(--c94a3b8)' }}>{pct(r.blockRate)}</td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr><td style={td} colSpan={11}><span style={{ color: 'var(--c64748b)' }}>Không có tiệm nào trong danh sách này.</span></td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p style={{ ...hint, margin: '12px 0 0' }}>
            Ngoài danh sách: {fleet.totals.noChannel} tài khoản chưa nối kênh chat nào.
            “Bị chặn” = tỉ lệ câu trả lời bị chính dặn dò của chủ tiệm chặn lại (tính từ trước tới nay, cần ít nhất 20 lần kiểm tra).
          </p>
        </div>
      )}
    </main>
  );
}

function Stat({ label, value, sub, big }: { label: string; value: string; sub?: string; big?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: 'var(--c64748b)', letterSpacing: .3 }}>{label}</div>
      <div style={{ fontSize: big ? 26 : 20, fontWeight: 700, color: 'var(--cf1f5f9)', lineHeight: 1.25 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--cfde68a)' }}>{sub}</div>}
    </div>
  );
}

const wrap: React.CSSProperties = { maxWidth: 1180, margin: '0 auto', padding: '28px 20px 60px', color: 'var(--ce2e8f0)' };
const card: React.CSSProperties = { background: 'var(--c0f172a)', border: '1px solid var(--c334155)', borderRadius: 12, padding: 18, marginBottom: 18 };
const h2: React.CSSProperties = { fontSize: 17, margin: '0 0 4px' };
const hint: React.CSSProperties = { fontSize: 12.5, color: 'var(--c64748b)', margin: '0 0 12px', lineHeight: 1.55 };
const banner: React.CSSProperties = { border: '1px solid', borderRadius: 8, padding: '9px 13px', marginBottom: 14, fontSize: 13.5 };
const chip: React.CSSProperties = { padding: '6px 13px', borderRadius: 999, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--c94a3b8)', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' };
const chipOn: React.CSSProperties = { ...chip, border: '1px solid #6366f1', background: 'rgba(99,102,241,.16)', color: 'var(--ink-link)', fontWeight: 600 };
const ghost: React.CSSProperties = { padding: '6px 12px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--c94a3b8)', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' };
const tag: React.CSSProperties = { fontSize: 11, border: '1px solid', borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap' };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th: React.CSSProperties = { textAlign: 'left', padding: '7px 8px', borderBottom: '1px solid var(--c334155)', color: 'var(--c64748b)', fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: .4 };
const thR: React.CSSProperties = { ...th, textAlign: 'right' };
const td: React.CSSProperties = { padding: '8px', borderBottom: '1px solid var(--line)', verticalAlign: 'top' };
const tdR: React.CSSProperties = { ...td, textAlign: 'right', color: 'var(--c94a3b8)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
