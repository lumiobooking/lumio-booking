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
interface Tech { id: string; name: string; priority: number; turns: number; moneyCents: number; busy: boolean; rank: number | null; lastDoneAt: string | null; clockInAt: string | null; fromLegs: number; fromAppointments: number; fromAdjustments: number }
interface Entry { at: string; staffId: string; name: string; kind: 'leg' | 'appointment' | 'adjust'; value: number; label: string; pinned: boolean; priceCents: number | null }
interface Data { day: string; rules: TurnRules; techs: Tech[]; entries: Entry[] }

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
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try { const d = await apiFetch<Data>('/walkins/turns', { token }); setData(d); setErr(null); if (!rules) { setRules(d.rules); setHalf(d.rules.halfBelowCents ? fromMinorUnits(d.rules.halfBelowCents, cur) : ''); } }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }, [token, rules, cur]);
  useEffect(() => { void load(); }, [load]);

  async function saveAdjust() {
    if (!adjust) return;
    setBusy(true); setErr(null);
    try { await apiFetch('/walkins/turns/adjust', { method: 'POST', token, body: { staffId: adjust.staffId, delta: adjust.delta, reason: adjust.reason.trim() || undefined } }); setAdjust(null); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }
  async function saveRules() {
    if (!rules) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch<TurnRules>('/walkins/turn-rules', { method: 'PATCH', token, body: { ...rules, halfBelowCents: half.trim() ? Math.max(0, toMinorUnits(half, cur) || 0) : 0 } });
      setRules(r); setShowRules(false); await load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }

  const time = (iso: string | null) => (iso ? fmtInTz(iso, { hour: 'numeric', minute: '2-digit' }) : '—');
  const kindLabel = (e: Entry) => e.kind === 'leg' ? (e.pinned ? L('Khách request', 'Requested') : L('Walk-in', 'Walk-in')) : e.kind === 'appointment' ? L('Lịch hẹn', 'Booking') : L('Chỉnh tay', 'By hand');
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
            <div style={{ fontSize: 11.5, color: 'var(--c94a3b8)', lineHeight: 1.45 }}>{L('Đổi quy tắc có hiệu lực ngay cho hôm nay; lịch sử tua các ngày trước không đổi.', 'A change applies to today at once; earlier days are not recomputed.')}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={saveRules} disabled={busy} style={ui.primaryBtn}>{busy ? '…' : L('Lưu quy tắc', 'Save rules')}</button>
              <button type="button" onClick={() => setShowRules(false)} style={{ ...ui.input, width: 'auto', cursor: 'pointer' }}>{L('Huỷ', 'Cancel')}</button>
            </div>
          </div>
        )}

        {!data && !err && <div style={{ color: 'var(--c94a3b8)', fontSize: 13 }}>{L('Đang tải…', 'Loading…')}</div>}
        {techs.map((t) => {
          const mine = data!.entries.filter((e) => e.staffId === t.id);
          const isOpen = open === t.id;
          return (
            <div key={t.id} style={{ borderRadius: 12, border: `1px solid ${t.rank === 1 ? '#22c55e' : 'var(--line)'}`, background: 'var(--c111827)', overflow: 'hidden' }}>
              <button type="button" onClick={() => setOpen(isOpen ? null : t.id)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'transparent', border: 'none', color: 'var(--cf1f5f9)', cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ ...RANK_BADGE, background: t.rank === 1 ? '#15803d' : t.busy ? '#475569' : '#4f46e5' }}>{t.rank ?? '·'}</span>
                <span style={{ fontWeight: 700, flex: 1 }}>{t.name}{t.busy ? <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-warn)', marginLeft: 8 }}>{L('đang làm', 'serving')}</span> : t.rank === 1 ? <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-good)', marginLeft: 8 }}>{L('tới lượt', 'next up')}</span> : null}</span>
                <span style={{ fontSize: 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fmtTurns(t.turns)} <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--c94a3b8)' }}>{L('tua', 'turns')}</span></span>
                {money && <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ccbd5e1)', fontVariantNumeric: 'tabular-nums' }}>{formatPrice(t.moneyCents, cur)}</span>}
              </button>
              {isOpen && (
                <div style={{ padding: '0 12px 12px', fontSize: 12.5, color: 'var(--ccbd5e1)' }}>
                  <div style={{ color: 'var(--c94a3b8)', marginBottom: 6 }}>
                    {L('Walk-in / request', 'Walk-in / request')} {fmtTurns(t.fromLegs)} · {L('Lịch hẹn', 'Bookings')} {fmtTurns(t.fromAppointments)} · {L('Chỉnh tay', 'By hand')} {t.fromAdjustments > 0 ? '+' : ''}{fmtTurns(t.fromAdjustments)}
                    {t.lastDoneAt ? ` · ${L('xong khách lúc', 'last finished')} ${time(t.lastDoneAt)}` : ''}{t.clockInAt ? ` · ${L('vào ca', 'clocked in')} ${time(t.clockInAt)}` : ''}
                  </div>
                  {mine.length === 0 && <div style={{ color: 'var(--c64748b)' }}>{L('Chưa có tua nào hôm nay.', 'No turns yet today.')}</div>}
                  {mine.map((e, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, padding: '5px 0', borderTop: '1px solid var(--line)' }}>
                      <span style={{ color: 'var(--c94a3b8)', minWidth: 46 }}>{time(e.at)}</span>
                      <span style={{ minWidth: 86, color: e.kind === 'adjust' ? 'var(--ink-warn)' : e.pinned ? 'var(--ink-sky)' : 'var(--ccbd5e1)' }}>{kindLabel(e)}</span>
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
                      <button type="button" onClick={() => setAdjust({ staffId: t.id, delta: 1, reason: '' })} style={{ ...ui.input, width: 'auto', cursor: 'pointer', padding: '6px 10px', marginTop: 8 }}>{L('± Chỉnh tua', '± Adjust')}</button>
                    )
                  )}
                </div>
              )}
            </div>
          );
        })}
        <div style={{ fontSize: 11.5, color: 'var(--c64748b)', lineHeight: 1.45 }}>
          {L('Thứ tự là cách máy sẽ giao khách tiếp theo nếu mọi người đều rảnh. Bấm vào một thợ để xem từng tua và chỉnh tay (chủ tiệm).', 'The order is how the next clients would be handed out if everyone were free. Tap a technician for every turn and corrections (owner).')}
        </div>
      </div>
    </div>
  );
}
