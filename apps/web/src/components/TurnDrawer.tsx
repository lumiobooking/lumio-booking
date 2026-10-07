'use client';

// CHIA TUA — today's turns, line by line, and the salon's rules.
//
// Opened from "Lượt hôm nay" on the walk-in board. The top shows who is up
// next and why (turns, or money under the MONEY rule; the tie-break); the
// list under each technician says where every turn came from — a leg, a
// booking, a correction — so a dispute is settled by reading. The owner can
// add or take a turn with a reason (logged), and set the rules.

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { apiFetch } from '../lib/api';
import { ui, formatPrice, toMinorUnits, fromMinorUnits, priceInputStep } from '../lib/ui';
import { uiCurrency } from '../lib/ui-currency';
import { ind } from '../lib/ui-industry';
import { fmtInTz } from '../lib/datetime';
import { fmtTurns } from '../lib/walkin-floor';

import { rulesLine, TurnRules } from '../lib/turn-rules-ui';

export type { TurnRules };
interface Tech { id: string; name: string; priority: number; turns: number; moneyCents: number; busy: boolean; onBreak?: boolean; breakSince?: string | null; rank: number | null; lastDoneAt: string | null; clockInAt: string | null; fromLegs: number; fromAppointments: number; fromAdjustments: number; fromLate?: number; fromBoost?: number; inRotation?: boolean }
interface Entry { at: string; staffId: string; name: string; kind: 'leg' | 'appointment' | 'adjust' | 'late' | 'boost'; value: number; label: string; pinned: boolean; priceCents: number | null }
interface Data { day: string; rules: TurnRules; techs: Tech[]; entries: Entry[] }
interface SvcOpt { id: string; name: string; isActive?: boolean }
interface ReportTech { staffId: string; name: string; active: boolean; turns: number; legs: number; requested: number; bookings: number; adjustments: number; skips: number; moneyCents: number; days: string[]; perTurnCents: number }
interface Report { from: string; to: string; techs: ReportTech[]; totals: { turns: number; moneyCents: number; requested: number; skips: number }; spread: number }

/** YYYY-MM-DD ± n days (UTC arithmetic on a day key — no zone involved). */
const shiftDay = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** The rank bubble: a fixed accent ground, so its white digit reads in both themes. */
const RANK_BADGE = { width: 26, height: 26, borderRadius: 999, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 800, background: '#4f46e5', color: '#fff' } as const;

export function TurnDrawer({ vi, isOwner, onClose }: { vi: boolean; isOwner: boolean; onClose: () => void }) {
  const { token } = useAuth();
  const L = (v: string, e: string) => ind(vi ? v : e);
  const cur = uiCurrency();
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adjust, setAdjust] = useState<{ staffId: string; delta: number; reason: string } | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [rules, setRules] = useState<TurnRules | null>(null);
  const [half, setHalf] = useState('');
  const [grace, setGrace] = useState('15');
  const [newDays, setNewDays] = useState('0');
  const [services, setServices] = useState<SvcOpt[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [view, setView] = useState<'today' | 'report'>('today');
  const [report, setReport] = useState<Report | null>(null);
  const [reportFrom, setReportFrom] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try { const d = await apiFetch<Data>('/walkins/turns', { token }); setData(d); setErr(null); if (!rules) { setRules(d.rules); setHalf(d.rules.halfBelowCents ? fromMinorUnits(d.rules.halfBelowCents, cur) : ''); setGrace(String(d.rules.lateGraceMin ?? 15)); setNewDays(String(d.rules.newTechDays ?? 0)); } }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }, [token, rules, cur]);
  useEffect(() => { void load(); }, [load]);
  // The menu, for "tua ngược" — loaded once the owner opens the rules.
  useEffect(() => {
    if (!showRules || !token || services.length) return;
    apiFetch<SvcOpt[]>('/services', { token }).then((list) => setServices((list ?? []).filter((x) => x.isActive !== false))).catch(() => undefined);
  }, [showRules, token, services.length]);
  // The week in numbers: Monday–Sunday around `reportFrom` (null = this week).
  useEffect(() => {
    if (view !== 'report' || !token) return;
    const q = reportFrom ? `?from=${reportFrom}&to=${shiftDay(reportFrom, 6)}` : '';
    apiFetch<Report>(`/walkins/turn-report${q}`, { token }).then(setReport).catch((e) => setErr(e instanceof Error ? e.message : 'Failed'));
  }, [view, reportFrom, token]);

  async function saveAdjust() {
    if (!adjust) return;
    setBusy(true); setErr(null);
    try { await apiFetch('/walkins/turns/adjust', { method: 'POST', token, body: { staffId: adjust.staffId, delta: adjust.delta, reason: adjust.reason.trim() || undefined } }); setAdjust(null); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }
  /** Owner sends a technician on break (held in place or to the bottom, per the rule) or brings them back. */
  async function toggleBreak(t: Tech) {
    setBusy(true); setErr(null);
    try { await apiFetch(`/walkins/techs/${t.id}/break`, { method: 'POST', token, body: { on: !t.onBreak } }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }
  async function saveRules() {
    if (!rules) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch<TurnRules>('/walkins/turn-rules', { method: 'PATCH', token, body: { ...rules, halfBelowCents: half.trim() ? Math.max(0, toMinorUnits(half, cur) || 0) : 0, lateGraceMin: Math.min(240, Math.max(0, Math.round(Number(grace) || 0))), newTechDays: Math.min(365, Math.max(0, Math.round(Number(newDays) || 0))) } });
      setRules(r); setShowRules(false); await load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }

  const time = (iso: string | null) => (iso ? fmtInTz(iso, { hour: 'numeric', minute: '2-digit' }) : '—');
  const kindLabel = (e: Entry) => e.kind === 'leg' ? (e.pinned ? L('Khách request', 'Requested') : L('Walk-in', 'Walk-in')) : e.kind === 'appointment' ? L('Lịch hẹn', 'Booking') : e.kind === 'late' ? L('Đi trễ', 'Late') : e.kind === 'boost' ? L('Thợ mới', 'New tech') : L('Chỉnh tay', 'By hand');
  const toggleReverse = (id: string) => { if (!rules) return; const cur = rules.reverseServiceIds ?? []; setRules({ ...rules, reverseServiceIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] }); };
  const money = data?.rules.mode === 'MONEY';
  const techs = data ? [...data.techs].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || a.name.localeCompare(b.name)) : [];

  return (
    <div role="dialog" aria-modal="true" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 400, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(560px, 100%)', height: '100%', overflowY: 'auto', background: 'var(--c0b1120)', borderLeft: '1px solid var(--line)', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--cf1f5f9)' }}>{L('Tua hôm nay', 'Turns today')}{data ? ` · ${data.day}` : ''}</div>
            {data && <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 2, lineHeight: 1.4 }}>{rulesLine(data.rules, vi)}</div>}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <a href="/turns-tv" target="_blank" rel="noreferrer" title={L('Mở bảng tua cho TV phòng nghỉ', 'Open the break-room TV board')} style={{ ...ui.input, width: 'auto', padding: '6px 10px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>📺</a>
            <button type="button" onClick={() => setView((v) => (v === 'today' ? 'report' : 'today'))} style={{ ...ui.input, width: 'auto', cursor: 'pointer', padding: '6px 10px' }}>{view === 'today' ? L('📊 Tuần', '📊 Week') : L('Hôm nay', 'Today')}</button>
            {isOwner && <button type="button" onClick={() => setShowRules((v) => !v)} style={{ ...ui.input, width: 'auto', cursor: 'pointer', padding: '6px 10px' }}>{L('Quy tắc', 'Rules')}</button>}
            <button type="button" onClick={onClose} style={{ ...ui.input, width: 'auto', cursor: 'pointer', padding: '6px 10px' }}>✕</button>
          </div>
        </div>
        {err && <div style={ui.banner}>{err}</div>}

        {showRules && rules && (
          <div style={{ padding: 12, borderRadius: 12, border: '1px solid var(--line)', background: 'var(--c111827)', display: 'grid', gap: 10 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--cf1f5f9)' }}>{L('Quy tắc chia tua của tiệm', 'How this salon shares turns')}</div>
            <label><span style={ui.label}>{L('Ai đi trước', 'Who goes first')}</span>
              <select value={rules.mode} onChange={(e) => setRules({ ...rules, mode: e.target.value as TurnRules['mode'] })} style={ui.input}>
                <option value="COUNT">{L('Ít tua nhất (mỗi dịch vụ tính theo giá trị tua của nó)', 'Fewest turns (each service by its turn value)')}</option>
                <option value="HYBRID">{L('Ít tua nhất, dịch vụ nhỏ dưới mức $ chỉ tính ½ tua', 'Fewest turns, services under a $ amount are ½ a turn')}</option>
                <option value="MONEY">{L('Ai làm ít tiền dịch vụ nhất hôm nay', 'Lowest service $ today')}</option>
              </select>
            </label>
            {rules.mode === 'HYBRID' && (
              <label><span style={ui.label}>{L(`Dịch vụ dưới (${cur}) = ½ tua`, `Services under (${cur}) = ½ turn`)}</span>
                <input type="number" min={0} step={priceInputStep(cur)} value={half} onChange={(e) => setHalf(e.target.value)} style={ui.input} placeholder="25" />
              </label>
            )}
            <label><span style={ui.label}>{L('Bằng nhau thì', 'When tied')}</span>
              <select value={rules.tieBreak} onChange={(e) => setRules({ ...rules, tieBreak: e.target.value as TurnRules['tieBreak'] })} style={ui.input}>
                <option value="PRIORITY_LIST">{L('Theo ưu tiên của chủ tiệm, rồi thứ tự danh sách (như trước)', 'Owner priority, then list order (as before)')}</option>
                <option value="LAST_FINISHED">{L('Ai xong khách lâu hơn (rảnh lâu hơn) đi trước', 'Whoever has been free longest')}</option>
                <option value="CLOCK_IN">{L('Ai vào ca sớm hơn đi trước (cần chấm công)', 'Whoever clocked in first (needs the time clock)')}</option>
              </select>
            </label>
            <label><span style={ui.label}>{L('Khách request thợ tính', 'A requested client counts')}</span>
              <select value={String(rules.requestWeight)} onChange={(e) => setRules({ ...rules, requestWeight: Number(e.target.value) as TurnRules['requestWeight'] })} style={ui.input}>
                <option value="1">{L('1 tua (như walk-in)', '1 turn (like a walk-in)')}</option>
                <option value="0.5">{L('½ tua', '½ turn')}</option>
                <option value="0">{L('Không tính tua', 'No turn')}</option>
              </select>
            </label>
            <label><span style={ui.label}>{L('Lịch hẹn hoàn thành tính', 'A completed booking counts')}</span>
              <select value={rules.appointmentWeight} onChange={(e) => setRules({ ...rules, appointmentWeight: e.target.value as TurnRules['appointmentWeight'] })} style={ui.input}>
                <option value="ONE">{L('1 tua', '1 turn')}</option>
                <option value="BY_SERVICE">{L('Theo giá trị tua của dịch vụ', 'By the service’s turn value')}</option>
                <option value="NONE">{L('Không tính', 'None')}</option>
              </select>
            </label>
            <label><span style={ui.label}>{L('Thợ tạm nghỉ (ăn trưa, giải lao)', 'A technician on break')}</span>
              <select value={rules.breakPolicy ?? 'HOLD'} onChange={(e) => setRules({ ...rules, breakPolicy: e.target.value as TurnRules['breakPolicy'] })} style={ui.input}>
                <option value="HOLD">{L('Giữ chỗ: quay lại đúng vị trí cũ', 'Hold the spot: comes back where they were')}</option>
                <option value="BOTTOM">{L('Xuống cuối hàng khi quay lại', 'Goes to the back of the line when back')}</option>
              </select>
            </label>
            <label><span style={ui.label}>{L('Thợ bỏ qua khách tới lượt', 'A technician skips a client')}</span>
              <select value={rules.skipPolicy ?? 'FREE'} onChange={(e) => setRules({ ...rules, skipPolicy: e.target.value as TurnRules['skipPolicy'] })} style={ui.input}>
                <option value="FREE">{L('Không tính gì (vẫn giữ lượt)', 'Nothing counted (keeps the turn)')}</option>
                <option value="COUNT_AS_TURN">{L('Vẫn tính 1 tua như đã làm', 'Still counts as a turn')}</option>
                <option value="BOTTOM">{L('Xuống cuối hàng', 'Back of the line')}</option>
              </select>
            </label>
            <label><span style={ui.label}>{L('Vào ca trễ (cần chấm công & giờ làm)', 'Clocking in late (needs the time clock & hours)')}</span>
              <select value={rules.latePolicy ?? 'NONE'} onChange={(e) => setRules({ ...rules, latePolicy: e.target.value as TurnRules['latePolicy'] })} style={ui.input}>
                <option value="NONE">{L('Không phạt', 'No penalty')}</option>
                <option value="PLUS_HALF">{L('Tính thêm ½ tua', 'Counts +½ turn')}</option>
                <option value="PLUS_ONE">{L('Tính thêm 1 tua', 'Counts +1 turn')}</option>
              </select>
            </label>
            {(rules.latePolicy ?? 'NONE') !== 'NONE' && (
              <label><span style={ui.label}>{L('Trễ quá bao nhiêu phút thì tính', 'Grace period (minutes)')}</span>
                <input type="number" min={0} max={240} step={5} value={grace} onChange={(e) => setGrace(e.target.value)} style={ui.input} placeholder="15" />
              </label>
            )}
            <label><span style={ui.label}>{L('Thợ mới được ưu tiên trong (ngày) — 0 = tắt', 'New technicians go first for (days) — 0 = off')}</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="number" min={0} max={365} value={newDays} onChange={(e) => setNewDays(e.target.value)} style={{ ...ui.input, flex: 1 }} placeholder="0" />
                <select value={String(rules.newTechBoost ?? 0.5)} onChange={(e) => setRules({ ...rules, newTechBoost: Number(e.target.value) as TurnRules['newTechBoost'] })} style={{ ...ui.input, width: 'auto' }}>
                  <option value="0.5">{L('đi trước ½ tua', '½ turn ahead')}</option>
                  <option value="1">{L('đi trước 1 tua', '1 turn ahead')}</option>
                </select>
              </div>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={rules.ownerInRotation !== false} onChange={(e) => setRules({ ...rules, ownerInRotation: e.target.checked })} />
              <span style={{ fontSize: 13, color: 'var(--ce2e8f0)' }}>{L('Chủ tiệm có trong vòng tua (bỏ chọn = chỉ nhận khách request)', 'The owner is in the rotation (unticked = requested clients only)')}</span>
            </label>
            <div>
              <span style={ui.label}>{L('Tua ngược — dịch vụ nhỏ không ai muốn: giao cho thợ ĐANG NHIỀU tua nhất', 'Reverse turn — the small jobs nobody wants go to whoever has the MOST turns')}</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                {services.length === 0 && <span style={{ fontSize: 12, color: 'var(--c64748b)' }}>{L('Đang tải dịch vụ…', 'Loading services…')}</span>}
                {services.map((sv) => {
                  const on = (rules.reverseServiceIds ?? []).includes(sv.id);
                  return <button key={sv.id} type="button" onClick={() => toggleReverse(sv.id)} style={{ ...ui.input, width: 'auto', cursor: 'pointer', padding: '4px 9px', fontSize: 12, borderColor: on ? '#4f46e5' : undefined, color: on ? 'var(--ink-link)' : undefined }}>{on ? '✓ ' : ''}{sv.name}</button>;
                })}
              </div>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--c94a3b8)', lineHeight: 1.45 }}>{L('Đổi quy tắc có hiệu lực ngay cho hôm nay; lịch sử tua các ngày trước không đổi.', 'A change applies to today at once; earlier days are not recomputed.')}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={saveRules} disabled={busy} style={ui.primaryBtn}>{busy ? '…' : L('Lưu quy tắc', 'Save rules')}</button>
              <button type="button" onClick={() => setShowRules(false)} style={{ ...ui.input, width: 'auto', cursor: 'pointer' }}>{L('Huỷ', 'Cancel')}</button>
            </div>
          </div>
        )}

        {view === 'report' && (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button type="button" onClick={() => setReportFrom(shiftDay(report?.from ?? data?.day ?? new Date().toISOString().slice(0, 10), -7))} style={{ ...ui.input, width: 'auto', cursor: 'pointer', padding: '4px 10px' }}>‹</button>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--cf1f5f9)', flex: 1, textAlign: 'center' }}>{report ? `${report.from} → ${report.to}` : '…'}</div>
              <button type="button" disabled={!report || (data ? report.to >= data.day : false)} onClick={() => setReportFrom(shiftDay(report!.from, 7))} style={{ ...ui.input, width: 'auto', cursor: 'pointer', padding: '4px 10px' }}>›</button>
            </div>
            {report && report.techs.length === 0 && <div style={{ color: 'var(--c64748b)', fontSize: 13 }}>{L('Tuần này chưa có tua nào.', 'No turns this week.')}</div>}
            {report && report.techs.length > 0 && (
              <div style={{ borderRadius: 12, border: '1px solid var(--line)', background: 'var(--c111827)', overflow: 'hidden', fontSize: 12.5 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.6fr 0.8fr 0.7fr 0.5fr 0.5fr', gap: 6, padding: '8px 12px', color: 'var(--c94a3b8)', fontSize: 11, fontWeight: 700, borderBottom: '1px solid var(--line)' }}>
                  <span>{L('Thợ', 'Tech')}</span><span style={{ textAlign: 'right' }}>{L('Tua', 'Turns')}</span><span style={{ textAlign: 'right' }}>{L('Tiền DV', 'Service $')}</span><span style={{ textAlign: 'right' }}>{L('$/tua', '$/turn')}</span><span style={{ textAlign: 'right' }}>{L('Request', 'Req.')}</span><span style={{ textAlign: 'right' }}>{L('Bỏ qua', 'Skips')}</span>
                </div>
                {report.techs.map((r) => (
                  <div key={r.staffId} style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.6fr 0.8fr 0.7fr 0.5fr 0.5fr', gap: 6, padding: '8px 12px', borderTop: '1px solid var(--line)', color: 'var(--ce2e8f0)', fontVariantNumeric: 'tabular-nums' }}>
                    <span style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}<span style={{ color: 'var(--c64748b)', fontWeight: 500 }}> · {r.days.length}{L('ng', 'd')}</span></span>
                    <span style={{ textAlign: 'right', fontWeight: 800 }}>{fmtTurns(r.turns)}</span>
                    <span style={{ textAlign: 'right' }}>{formatPrice(r.moneyCents, cur)}</span>
                    <span style={{ textAlign: 'right', color: 'var(--c94a3b8)' }}>{r.perTurnCents ? formatPrice(r.perTurnCents, cur) : '—'}</span>
                    <span style={{ textAlign: 'right' }}>{r.requested || '—'}</span>
                    <span style={{ textAlign: 'right', color: r.skips ? 'var(--ink-warn)' : undefined }}>{r.skips || '—'}</span>
                  </div>
                ))}
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.6fr 0.8fr 0.7fr 0.5fr 0.5fr', gap: 6, padding: '8px 12px', borderTop: '1px solid var(--line)', color: 'var(--cf1f5f9)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  <span>{L('Cả tiệm', 'Salon')}</span><span style={{ textAlign: 'right' }}>{fmtTurns(report.totals.turns)}</span><span style={{ textAlign: 'right' }}>{formatPrice(report.totals.moneyCents, cur)}</span><span style={{ textAlign: 'right', color: 'var(--c94a3b8)' }}>{report.totals.turns ? formatPrice(Math.round(report.totals.moneyCents / report.totals.turns), cur) : '—'}</span><span style={{ textAlign: 'right' }}>{report.totals.requested || '—'}</span><span style={{ textAlign: 'right' }}>{report.totals.skips || '—'}</span>
                </div>
              </div>
            )}
            {report && report.techs.length > 1 && (
              <div style={{ fontSize: 12, color: report.spread >= 3 ? 'var(--ink-warn)' : 'var(--c94a3b8)', lineHeight: 1.45 }}>
                {L(`Chênh lệch nhiều nhất – ít nhất: ${fmtTurns(report.spread)} tua.`, `Most – fewest: ${fmtTurns(report.spread)} turns.`)} {report.spread >= 3 ? L('Nên xem lại ai hay nghỉ, đi trễ, hoặc khách request dồn về một người.', 'Worth a look: breaks, late starts, or requests piling onto one person.') : L('Chia khá đều.', 'Fairly even.')}
              </div>
            )}
          </div>
        )}
        {view === 'today' && !data && !err && <div style={{ color: 'var(--c94a3b8)', fontSize: 13 }}>{L('Đang tải…', 'Loading…')}</div>}
        {view === 'today' && techs.map((t) => {
          const mine = data!.entries.filter((e) => e.staffId === t.id);
          const isOpen = open === t.id;
          return (
            <div key={t.id} style={{ borderRadius: 12, border: `1px solid ${t.rank === 1 ? '#22c55e' : 'var(--line)'}`, background: 'var(--c111827)', overflow: 'hidden' }}>
              <button type="button" onClick={() => setOpen(isOpen ? null : t.id)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'transparent', border: 'none', color: 'var(--cf1f5f9)', cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ ...RANK_BADGE, background: t.rank === 1 ? '#15803d' : t.busy || t.onBreak ? '#475569' : '#4f46e5' }}>{t.rank ?? '·'}</span>
                <span style={{ fontWeight: 700, flex: 1 }}>{t.name}{t.inRotation === false ? <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--c94a3b8)', marginLeft: 8 }}>{L('chỉ khách request', 'requests only')}</span> : t.onBreak ? <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--c94a3b8)', marginLeft: 8 }}>☕ {L('tạm nghỉ', 'on break')}{t.breakSince ? ` ${time(t.breakSince)}` : ''}</span> : t.busy ? <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-warn)', marginLeft: 8 }}>{L('đang làm', 'serving')}</span> : t.rank === 1 ? <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-good)', marginLeft: 8 }}>{L('tới lượt', 'next up')}</span> : null}</span>
                <span style={{ fontSize: 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fmtTurns(t.turns)} <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--c94a3b8)' }}>{L('tua', 'turns')}</span></span>
                {money && <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ccbd5e1)', fontVariantNumeric: 'tabular-nums' }}>{formatPrice(t.moneyCents, cur)}</span>}
              </button>
              {isOpen && (
                <div style={{ padding: '0 12px 12px', fontSize: 12.5, color: 'var(--ccbd5e1)' }}>
                  <div style={{ color: 'var(--c94a3b8)', marginBottom: 6 }}>
                    {L('Walk-in / request', 'Walk-in / request')} {fmtTurns(t.fromLegs)} · {L('Lịch hẹn', 'Bookings')} {fmtTurns(t.fromAppointments)} · {L('Chỉnh tay', 'By hand')} {t.fromAdjustments > 0 ? '+' : ''}{fmtTurns(t.fromAdjustments)}{t.fromLate ? ` · ${L('Đi trễ', 'Late')} +${fmtTurns(t.fromLate)}` : ''}{t.fromBoost ? ` · ${L('Thợ mới', 'New')} ${fmtTurns(t.fromBoost)}` : ''}
                    {t.lastDoneAt ? ` · ${L('xong khách lúc', 'last finished')} ${time(t.lastDoneAt)}` : ''}{t.clockInAt ? ` · ${L('vào ca', 'clocked in')} ${time(t.clockInAt)}` : ''}
                  </div>
                  {mine.length === 0 && <div style={{ color: 'var(--c64748b)' }}>{L('Chưa có tua nào hôm nay.', 'No turns yet today.')}</div>}
                  {mine.map((e, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, padding: '5px 0', borderTop: '1px solid var(--line)' }}>
                      <span style={{ color: 'var(--c94a3b8)', minWidth: 46 }}>{time(e.at)}</span>
                      <span style={{ minWidth: 86, color: e.kind === 'adjust' || e.kind === 'late' ? 'var(--ink-warn)' : e.kind === 'boost' ? 'var(--ink-good)' : e.pinned ? 'var(--ink-sky)' : 'var(--ccbd5e1)' }}>{kindLabel(e)}</span>
                      <span style={{ flex: 1, color: 'var(--ce2e8f0)' }}>{e.label}{e.priceCents != null && e.kind !== 'adjust' ? <span style={{ color: 'var(--c94a3b8)' }}> · {formatPrice(e.priceCents, cur)}</span> : null}</span>
                      <span style={{ fontWeight: 700, color: e.value < 0 ? 'var(--ink-bad)' : 'var(--cf1f5f9)' }}>{e.value > 0 && e.kind === 'adjust' ? '+' : ''}{fmtTurns(e.value)}</span>
                    </div>
                  ))}
                  {isOwner && (
                    adjust?.staffId === t.id ? (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                        <select value={String(adjust.delta)} onChange={(e) => setAdjust({ ...adjust, delta: Number(e.target.value) })} style={{ ...ui.input, width: 'auto' }}>
                          {[1, 0.5, -0.5, -1].map((d) => <option key={d} value={d}>{d > 0 ? '+' : ''}{fmtTurns(d)} {L('tua', 'turn')}</option>)}
                        </select>
                        <input value={adjust.reason} onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })} maxLength={200} placeholder={L('Lý do (VD: đi trễ, bỏ khách, bù tua)', 'Reason (e.g. late, skipped a client, make-up turn)')} style={{ ...ui.input, flex: 1, minWidth: 160 }} />
                        <button type="button" onClick={saveAdjust} disabled={busy} style={{ ...ui.primaryBtn, padding: '6px 12px' }}>{L('Lưu', 'Save')}</button>
                        <button type="button" onClick={() => setAdjust(null)} style={{ ...ui.input, width: 'auto', cursor: 'pointer', padding: '6px 10px' }}>{L('Huỷ', 'Cancel')}</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                        <button type="button" onClick={() => setAdjust({ staffId: t.id, delta: 1, reason: '' })} style={{ ...ui.input, width: 'auto', cursor: 'pointer', padding: '6px 10px' }}>{L('± Chỉnh tua', '± Adjust')}</button>
                        {!t.busy && <button type="button" onClick={() => void toggleBreak(t)} disabled={busy} style={{ ...ui.input, width: 'auto', cursor: 'pointer', padding: '6px 10px' }}>{t.onBreak ? L('▶ Quay lại làm', '▶ Back to work') : L('☕ Tạm nghỉ', '☕ On break')}</button>}
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          );
        })}
        {view === 'today' && <div style={{ fontSize: 11.5, color: 'var(--c64748b)', lineHeight: 1.45 }}>
          {L('Thứ tự là cách máy sẽ giao khách tiếp theo nếu mọi người đều rảnh. Bấm vào một thợ để xem từng tua và chỉnh tay (chủ tiệm).', 'The order is how the next clients would be handed out if everyone were free. Tap a technician for every turn and corrections (owner).')}
        </div>}
      </div>
    </div>
  );
}
