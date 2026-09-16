'use client';

/**
 * WHERE THE API MONEY WENT — the screen that answers "nothing is running, so
 * why is the balance going down?"
 *
 * The Anthropic console shows one number for the whole account. It cannot
 * name the salon, the feature or the hour, and those three are the entire
 * question. This reads the meter (api common/ai-usage.ts) and puts them in
 * the order a person actually asks:
 *
 *   1. what did the window cost, and how much of it ran ON A TIMER — the
 *      answer to "nobody was at a screen";
 *   2. which FEATURE, dearest first, with its cache hit rate beside it,
 *      because a feature at 0% cache is usually the whole bill;
 *   3. which SALON, dearest first — a shop nobody has opened since July can
 *      still be drafted for every morning;
 *   4. which HOUR of today, so a 7am spike is visible as a spike.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';

interface FeatureRow {
  feature: string;
  label: { vi: string; en: string };
  automatic: boolean;
  calls: number; errors: number;
  input: number; output: number; cacheRead: number; cacheWrite: number;
  usd: number; estimated: boolean;
  cacheHitRate: number;
  models: { model: string; calls: number; usd: number }[];
}
interface TenantRow {
  tenantId: string; name: string; calls: number; usd: number;
  features: { feature: string; calls: number; usd: number }[];
}
interface Report {
  from: string; to: string;
  days: { day: string; calls: number; errors: number; tokens: number; usd: number }[];
  totals: { calls: number; errors: number; tokens: number; usd: number; estimated: boolean };
  cacheHitRate: number;
  features: FeatureRow[];
  tenants: TenantRow[];
  today: { hour: number; calls: number; usd: number }[];
}

const usd = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : n > 0 ? `$${n.toFixed(4)}` : '$0');
const num = (n: number) => n.toLocaleString('en-US');
const pct = (n: number) => `${Math.round(n * 100)}%`;

export default function AiUsagePage() {
  const { token, user, ready } = useAuth();
  const [days, setDays] = useState(7);
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openTenant, setOpenTenant] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    try {
      setR(await apiFetch<Report>(`/admin/ai-usage?days=${days}`, { token }));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Không tải được số liệu.');
    } finally { setBusy(false); }
  }, [token, days]);

  useEffect(() => { void load(); }, [load]);

  if (!ready) return <main style={wrap}><p style={{ color: 'var(--c94a3b8)' }}>Đang tải…</p></main>;
  if (!user) return <main style={wrap}><p style={{ color: 'var(--cfca5a5)' }}>Cần đăng nhập Super Admin.</p></main>;

  const auto = (r?.features ?? []).filter((f) => f.automatic).reduce((a, f) => a + f.usd, 0);
  const manual = (r?.features ?? []).filter((f) => !f.automatic).reduce((a, f) => a + f.usd, 0);
  const perDay = r && r.days.length ? r.totals.usd / r.days.length : 0;
  const maxDay = Math.max(1, ...(r?.days ?? []).map((d) => d.usd));
  const maxHour = Math.max(1, ...(r?.today ?? []).map((h) => h.calls));

  return (
    <main style={wrap}>
      <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>API đang tốn vào đâu</h1>
      <p style={{ color: 'var(--c94a3b8)', margin: '0 0 18px', fontSize: 14, lineHeight: 1.6 }}>
        Mỗi lần hệ thống gọi AI đều được ghi lại: <b>mục nào</b>, <b>tiệm nào</b>, <b>giờ nào</b>.
        Số tiền là ước tính theo bảng giá niêm yết — dùng để so sánh giữa các mục, con số chốt vẫn là hoá đơn của Anthropic.
      </p>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        {[1, 7, 30].map((d) => (
          <button key={d} onClick={() => setDays(d)} style={d === days ? chipOn : chip}>
            {d === 1 ? 'Hôm nay' : `${d} ngày`}
          </button>
        ))}
        <button onClick={() => void load()} style={ghost}>{busy ? 'Đang tải…' : '↻ Tải lại'}</button>
        {r && <span style={{ fontSize: 12.5, color: 'var(--c64748b)' }}>{r.from} → {r.to} · giờ UTC</span>}
      </div>

      {err && <div style={{ ...banner, borderColor: '#ef4444', color: 'var(--cfca5a5)' }}>{err}</div>}

      {r && r.totals.calls === 0 && (
        <div style={{ ...card, borderColor: '#f59e0b' }}>
          <b style={{ color: 'var(--cfde68a)' }}>Chưa có số liệu nào trong khoảng này.</b>
          <p style={{ ...hint, marginBottom: 0 }}>
            Bộ đếm chỉ ghi từ lúc bản này được deploy — những gì chạy trước đó không có trong đây.
            Nếu sau một ngày vẫn trống mà hoá đơn vẫn tăng, nghĩa là có chỗ gọi AI chưa được đếm; báo lại để bổ sung.
          </p>
        </div>
      )}

      {r && r.totals.calls > 0 && (
        <>
          {/* ---- 1. the bottom line, and the half of it nobody asked for ---- */}
          <div style={{ ...card, display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <Stat label="Tổng ước tính" value={usd(r.totals.usd)} big />
            <Stat label="Trung bình / ngày" value={usd(perDay)} />
            <Stat label="Lượt gọi" value={num(r.totals.calls)} sub={r.totals.errors ? `${num(r.totals.errors)} lỗi` : undefined} />
            <Stat label="Token" value={`${(r.totals.tokens / 1e6).toFixed(1)}M`} />
            <Stat label="Cache dùng lại" value={pct(r.cacheHitRate)} sub={r.cacheHitRate < 0.2 ? 'thấp — xem cột cache bên dưới' : undefined} />
          </div>

          <div style={{ ...card, borderColor: auto > manual ? '#f59e0b' : 'var(--c334155)' }}>
            <h2 style={h2}>Tự động chạy hay do người bấm?</h2>
            <p style={hint}>
              Đây là câu trả lời cho “hệ thống ít chạy mà vẫn bị trừ tiền”. Phần <b>tự động</b> chạy theo giờ hẹn
              cho mọi tiệm đang hoạt động, không cần ai mở màn hình.
            </p>
            <Bar left={{ label: 'Tự động (theo lịch)', usd: auto, fill: '#f59e0b' }} right={{ label: 'Do người dùng bấm', usd: manual, fill: '#6366f1' }} />
          </div>

          {/* ---- 2. by feature ---- */}
          <div style={card}>
            <h2 style={h2}>Theo từng mục — tốn nhất lên đầu</h2>
            <p style={hint}>
              Cột <b>cache</b> là phần input được dùng lại với giá rẻ hơn 10 lần. Mục nào tốn nhiều mà cache 0%
              là chỗ đáng sửa trước tiên.
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={table}>
                <thead>
                  <tr>
                    <th style={th}>Mục</th>
                    <th style={thR}>Ước tính</th>
                    <th style={thR}>Lượt</th>
                    <th style={thR}>Input</th>
                    <th style={thR}>Output</th>
                    <th style={thR}>Cache</th>
                  </tr>
                </thead>
                <tbody>
                  {r.features.map((f) => (
                    <tr key={f.feature}>
                      <td style={td}>
                        <div style={{ fontWeight: 600, color: 'var(--ce2e8f0)' }}>{f.label.vi}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginTop: 2 }}>
                          {f.automatic ? '⏱ tự động theo lịch' : '👤 do người bấm'}
                          {f.errors > 0 && <> · <span style={{ color: 'var(--cfca5a5)' }}>{num(f.errors)} lỗi</span></>}
                          {f.estimated && <> · giá ước tính</>}
                          {' · '}{f.models.map((m) => m.model).join(', ')}
                        </div>
                      </td>
                      <td style={{ ...tdR, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{usd(f.usd)}</td>
                      <td style={tdR}>{num(f.calls)}</td>
                      <td style={tdR}>{num(f.input)}</td>
                      <td style={tdR}>{num(f.output)}</td>
                      <td style={{ ...tdR, color: f.cacheHitRate >= 0.5 ? 'var(--ink-good)' : f.cacheHitRate > 0 ? 'var(--cfde68a)' : 'var(--c64748b)' }}>
                        {pct(f.cacheHitRate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ---- 3. by salon ---- */}
          <div style={card}>
            <h2 style={h2}>Theo từng tiệm — bấm vào một dòng để xem tiệm đó tốn vào mục gì</h2>
            <p style={hint}>
              “Toàn hệ thống” là phần việc không thuộc tiệm nào (tóm tắt hội thoại, đọc kiến thức chatbot).
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={table}>
                <thead>
                  <tr>
                    <th style={th}>Tiệm</th>
                    <th style={thR}>Ước tính</th>
                    <th style={thR}>Lượt gọi</th>
                    <th style={thR}>% tổng</th>
                  </tr>
                </thead>
                <tbody>
                  {r.tenants.map((t) => {
                    const open = openTenant === t.tenantId;
                    return (
                      <>
                        <tr
                          key={t.tenantId || 'platform'}
                          onClick={() => setOpenTenant(open ? null : t.tenantId)}
                          style={{ cursor: 'pointer' }}
                        >
                          <td style={td}>
                            <span style={{ color: 'var(--c64748b)', marginRight: 6 }}>{open ? '▾' : '▸'}</span>
                            {t.name}
                          </td>
                          <td style={{ ...tdR, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{usd(t.usd)}</td>
                          <td style={tdR}>{num(t.calls)}</td>
                          <td style={tdR}>{r.totals.usd ? pct(t.usd / r.totals.usd) : '—'}</td>
                        </tr>
                        {open && (
                          <tr key={`${t.tenantId}-d`}>
                            <td colSpan={4} style={{ ...td, background: 'var(--c111827)' }}>
                              {t.features.map((f) => (
                                <div key={f.feature} style={{ display: 'flex', gap: 10, fontSize: 12.5, padding: '3px 0', color: 'var(--c94a3b8)' }}>
                                  <span style={{ flex: 1 }}>{r.features.find((x) => x.feature === f.feature)?.label.vi ?? f.feature}</span>
                                  <span>{num(f.calls)} lượt</span>
                                  <span style={{ minWidth: 76, textAlign: 'right', color: 'var(--ce2e8f0)' }}>{usd(f.usd)}</span>
                                </div>
                              ))}
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ---- 4. when ---- */}
          <div style={card}>
            <h2 style={h2}>Hôm nay tốn vào giờ nào (giờ UTC)</h2>
            <p style={hint}>
              Một cột cao lúc 7 giờ sáng mà không ai mở máy nghĩa là bộ lập lịch đang chạy, không phải khách dùng.
            </p>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 90, marginTop: 6 }}>
              {r.today.map((h) => (
                <div key={h.hour} title={`${h.hour}:00 — ${num(h.calls)} lượt · ${usd(h.usd)}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                  <div style={{ height: `${Math.round((h.calls / maxHour) * 100)}%`, minHeight: h.calls ? 2 : 0, background: h.calls ? '#6366f1' : 'transparent', borderRadius: 3 }} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 3, marginTop: 4 }}>
              {r.today.map((h) => (
                <div key={h.hour} style={{ flex: 1, textAlign: 'center', fontSize: 9, color: 'var(--c64748b)' }}>{h.hour % 3 === 0 ? h.hour : ''}</div>
              ))}
            </div>
          </div>

          {/* ---- 5. day by day ---- */}
          <div style={card}>
            <h2 style={h2}>Từng ngày</h2>
            <div style={{ display: 'grid', gap: 5, marginTop: 8 }}>
              {r.days.map((d) => (
                <div key={d.day} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5 }}>
                  <span style={{ width: 86, color: 'var(--c94a3b8)', fontVariantNumeric: 'tabular-nums' }}>{d.day}</span>
                  <div style={{ flex: 1, height: 14, background: 'var(--c1e293b)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.round((d.usd / maxDay) * 100)}%`, height: '100%', background: '#6366f1' }} />
                  </div>
                  <span style={{ width: 70, textAlign: 'right', color: 'var(--ce2e8f0)', fontWeight: 600 }}>{usd(d.usd)}</span>
                  <span style={{ width: 84, textAlign: 'right', color: 'var(--c64748b)' }}>{num(d.calls)} lượt</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </main>
  );
}

function Stat({ label, value, sub, big }: { label: string; value: string; sub?: string; big?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: 'var(--c64748b)', letterSpacing: .3 }}>{label}</div>
      <div style={{ fontSize: big ? 26 : 20, fontWeight: 800, color: 'var(--cf1f5f9)', lineHeight: 1.25 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--cfde68a)' }}>{sub}</div>}
    </div>
  );
}

function Bar({ left, right }: { left: { label: string; usd: number; fill: string }; right: { label: string; usd: number; fill: string } }) {
  const all = left.usd + right.usd || 1;
  const p = Math.round((left.usd / all) * 100);
  return (
    <div>
      <div style={{ display: 'flex', height: 22, borderRadius: 6, overflow: 'hidden', background: 'var(--c1e293b)' }}>
        <div style={{ width: `${p}%`, background: left.fill }} />
        <div style={{ width: `${100 - p}%`, background: right.fill }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 7, fontSize: 12.5 }}>
        <span style={{ color: 'var(--cfde68a)' }}>⏱ {left.label}: <b>{usd(left.usd)}</b> ({p}%)</span>
        <span style={{ color: 'var(--ca5b4fc)' }}>👤 {right.label}: <b>{usd(right.usd)}</b> ({100 - p}%)</span>
      </div>
    </div>
  );
}

const wrap: React.CSSProperties = { maxWidth: 1040, margin: '0 auto', padding: '28px 20px 60px', color: 'var(--ce2e8f0)' };
const card: React.CSSProperties = { background: 'var(--c0f172a)', border: '1px solid var(--c334155)', borderRadius: 12, padding: 18, marginBottom: 18 };
const h2: React.CSSProperties = { fontSize: 17, margin: '0 0 4px' };
const hint: React.CSSProperties = { fontSize: 12.5, color: 'var(--c64748b)', margin: '0 0 12px', lineHeight: 1.55 };
const banner: React.CSSProperties = { border: '1px solid', borderRadius: 8, padding: '9px 13px', marginBottom: 14, fontSize: 13.5 };
const chip: React.CSSProperties = { padding: '6px 13px', borderRadius: 999, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--c94a3b8)', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' };
const chipOn: React.CSSProperties = { ...chip, border: '1px solid #6366f1', background: 'rgba(99,102,241,.16)', color: 'var(--ink-link)', fontWeight: 700 };
const ghost: React.CSSProperties = { padding: '6px 12px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--c94a3b8)', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th: React.CSSProperties = { textAlign: 'left', padding: '7px 8px', borderBottom: '1px solid var(--c334155)', color: 'var(--c64748b)', fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .4 };
const thR: React.CSSProperties = { ...th, textAlign: 'right' };
const td: React.CSSProperties = { padding: '8px', borderBottom: '1px solid var(--line)', verticalAlign: 'top' };
const tdR: React.CSSProperties = { ...td, textAlign: 'right', color: 'var(--c94a3b8)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
