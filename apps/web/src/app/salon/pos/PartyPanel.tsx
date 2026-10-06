'use client';

/**
 * TÍNH TIỀN NHÓM — a party at the till.
 *
 * Friends who came in together each have their own floor ticket (own
 * services, own technician). Paying used to mean opening three tickets one
 * after another and hoping the cashier remembered who was with whom. This
 * sheet opens from any ticket of the party and shows everyone side by side:
 *
 *  - GỘP 1 BILL: one payment, one receipt listed person by person. Every
 *    unpaid line of every member goes onto the till's cart at once.
 *  - TÁCH BILL: one receipt per person, paid one after another. A line can be
 *    dragged (or sent) to another person's column so a mother pays for her
 *    daughter; "chia đều" splits one merged bill into N equal tenders.
 *  - THU TRƯỚC: while one member is still in a chair, the ones who finished
 *    can pay now; the party stays open until the last person has paid.
 *
 * The sheet never takes money itself: it composes the till's cart (names
 * prefixed, technician per line, tip shared out by line value) and hands over
 * to the ordinary payment step — tax, discounts, gift cards, loyalty and the
 * receipt all work exactly as for one customer. Which lines are already paid
 * comes from the server (each order line remembers the ticket it came from),
 * so a reload, or a second till, shows the same picture.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiFetch } from '../../../lib/api';
import { formatPrice } from '../../../lib/ui';
import { useIsMobile } from '../../../lib/responsive';
import { ind } from '../../../lib/ui-industry';

export interface PartyItem { lineId: string; serviceId: string; name: string; priceCents: number; durationMinutes: number; staffId: string | null; paid: boolean; orderNumber: number | null }
export interface PartyMember {
  id: string; customerName: string | null; customerId: string | null; phone: string | null; status: string; awaitingPayment: boolean;
  phase: string; minutesLeft: number | null; overdueMinutes: number | null; source: string | null; appointmentId: string | null;
  finished: boolean; paid: boolean; orderNumbers: number[]; items: PartyItem[];
}
export interface PartyView {
  groupId: string; tag: string | null; leaderId: string; phone: string | null; source: string | null;
  /** The salon's "N or more people → X% off", when it runs today and this party is big enough. */
  groupPromo?: { percent: number; minSize: number; message: string } | null;
  members: PartyMember[]; staff: { id: string; name: string }[];
}

/** One line for the till's cart, as the panel composes it. */
export interface ComposedLine {
  refId: string; name: string; unitPriceCents: number; staffMemberId: string; tipCents: number;
  walkInId: string; walkInLineId: string; guestName: string;
  /** List price and the party discount applied to it (0 = none) — the sale records what was given away. */
  origUnitPriceCents: number; discountPercent: number;
}
export interface Composed {
  lines: ComposedLine[];
  /** Tickets this sale settles in full — marked Done when it is paid. */
  walkInIds: string[];
  /** The ticket the sale is filed under (the payer's, or the leader's). */
  walkInId: string;
  customerId: string | null;
  customerLabel: string | null;
  /** Split the merged bill into this many equal tenders (chia đều). */
  equalParts?: number;
}

const TIP_STEPS = [0, 15, 18, 20] as const;
const key = (memberId: string, lineId: string) => `${memberId}:${lineId}`;

function nameOf(m: PartyMember, vi: boolean) { return m.customerName || (vi ? 'Khách' : 'Guest'); }
function initials(s: string) { return s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?'; }

export function PartyPanel({ groupId, token, currency, tipsOn, lang, staff, onClose, onCompose, refreshKey = 0 }: {
  groupId: string; token: string | null; currency: string; tipsOn: boolean; lang: string;
  staff: { id: string; firstName: string; lastName?: string | null }[];
  onClose: () => void; onCompose: (c: Composed) => void; refreshKey?: number;
}) {
  const vi = lang === 'vi';
  const L = (v: string, e: string) => ind(vi ? v : e);
  const fmt = (c: number) => formatPrice(c, currency);
  const mobile = useIsMobile(820);
  const [party, setParty] = useState<PartyView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'merge' | 'split'>('merge');
  // Who pays for a line that is not theirs: `${owner}:${lineId}` -> payer member id.
  const [moves, setMoves] = useState<Record<string, string>>({});
  const [tipPct, setTipPct] = useState<number>(0);
  const [tipCustom, setTipCustom] = useState('');
  const [sendOpen, setSendOpen] = useState<string | null>(null); // line key with the "send to…" picker open
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  // The group programme, on by default when the party qualifies; one tap turns it off for this sale.
  const [promoOn, setPromoOn] = useState(true);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const p = await apiFetch<PartyView>(`/walkins/party/${encodeURIComponent(groupId)}`, { token });
      setParty(p);
      // A party someone already started paying for is a split party.
      if (p.members.some((m) => m.paid || m.items.some((i) => i.paid))) setMode('split');
    } catch (e) { setError(e instanceof Error ? e.message : L('Không tải được nhóm', 'Could not load the party')); }
  }, [token, groupId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load, refreshKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const techName = (id: string | null) => {
    if (!id) return '';
    const s = party?.staff.find((x) => x.id === id) ?? null;
    if (s) return s.name;
    const t = staff.find((x) => x.id === id);
    return t ? `${t.firstName}${t.lastName ? ' ' + t.lastName : ''}` : '';
  };
  const techColor = (id: string | null) => {
    if (!id) return 'var(--c64748b)';
    let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return `hsl(${h} 70% 60%)`;
  };

  /** Every unpaid line, with its owner and who pays for it now. */
  const open = useMemo(() => {
    if (!party) return [];
    const out: { owner: PartyMember; payerId: string; item: PartyItem; k: string }[] = [];
    for (const m of party.members) for (const it of m.items) if (!it.paid) {
      const k = key(m.id, it.lineId);
      out.push({ owner: m, payerId: mode === 'split' ? (moves[k] ?? m.id) : m.id, item: it, k });
    }
    return out;
  }, [party, moves, mode]);

  const pct = promoOn && party?.groupPromo ? party.groupPromo.percent : 0;
  /** What a line costs with the party discount on. */
  const net = (cents: number) => (pct ? Math.round((cents * (100 - pct)) / 100) : cents);
  const tipCents = (subtotal: number) => {
    if (!tipsOn) return 0;
    if (tipPct === -1) { const v = Math.round(Number(tipCustom.replace(',', '.')) * 100); return Number.isFinite(v) && v > 0 ? v : 0; }
    return Math.round((subtotal * tipPct) / 100);
  };
  /** Share a tip across lines by value — each technician gets her part. */
  const withTips = (lines: Omit<ComposedLine, 'tipCents'>[], tip: number): ComposedLine[] => {
    const base = lines.reduce((s, l) => s + l.unitPriceCents, 0);
    let given = 0;
    return lines.map((l, i) => {
      const last = i === lines.length - 1;
      const share = last ? Math.max(0, tip - given) : (base > 0 ? Math.round((tip * l.unitPriceCents) / base) : 0);
      given += share;
      return { ...l, tipCents: share };
    });
  };
  const lineOf = (e: { owner: PartyMember; item: PartyItem }): Omit<ComposedLine, 'tipCents'> => ({
    refId: e.item.serviceId, name: `${nameOf(e.owner, vi)} · ${e.item.name}`,
    unitPriceCents: net(e.item.priceCents), origUnitPriceCents: e.item.priceCents, discountPercent: pct,
    staffMemberId: e.item.staffId ?? '', walkInId: e.owner.id, walkInLineId: e.item.lineId, guestName: nameOf(e.owner, vi),
  });
  /** Tickets settled in full once these entries are paid. */
  const settledBy = (entries: typeof open) => {
    if (!party) return [];
    const paying = new Set(entries.map((e) => e.k));
    return party.members
      .filter((m) => !m.paid && m.items.every((it) => it.paid || paying.has(key(m.id, it.lineId))))
      .map((m) => m.id);
  };

  function compose(entries: typeof open, payer: PartyMember | null, equalParts?: number) {
    if (!party || !entries.length) return;
    const subtotal = entries.reduce((s, e) => s + net(e.item.priceCents), 0);
    const lines = withTips(entries.map(lineOf), tipCents(subtotal));
    const lead = party.members.find((m) => m.id === party.leaderId) ?? party.members[0];
    const who = payer ?? lead;
    const settled = settledBy(entries);
    onCompose({
      lines,
      walkInIds: settled,
      walkInId: settled.includes(who.id) ? who.id : (settled[0] ?? who.id),
      customerId: who.customerId,
      customerLabel: payer ? nameOf(payer, vi) : `${L('Nhóm', 'Party')}${party.tag ? ' ' + party.tag : ''} · ${party.members.map((m) => nameOf(m, vi)).join(', ')}`,
      equalParts,
    });
  }

  if (!party && !error) return <Backdrop onClose={onClose}><div style={{ color: 'var(--c94a3b8)', padding: 40 }}>{L('Đang tải nhóm…', 'Loading the party…')}</div></Backdrop>;
  if (!party) return <Backdrop onClose={onClose}><div style={{ color: 'var(--ink-bad)', padding: 40 }}>{error}</div></Backdrop>;

  const members = party.members;
  const unpaidMembers = members.filter((m) => !m.paid);
  const finished = unpaidMembers.filter((m) => m.finished);
  const inChair = unpaidMembers.filter((m) => !m.finished);
  const listSubtotal = open.reduce((s, e) => s + e.item.priceCents, 0);
  const allOpenSubtotal = open.reduce((s, e) => s + net(e.item.priceCents), 0);
  const promoSaved = listSubtotal - allOpenSubtotal;
  const allTip = tipCents(allOpenSubtotal);
  const earlyEntries = open.filter((e) => finished.some((m) => m.id === e.owner.id));
  const earlySubtotal = earlyEntries.reduce((s, e) => s + net(e.item.priceCents), 0);
  const paidCount = members.filter((m) => m.paid).length;
  const names = members.map((m) => nameOf(m, vi));
  const lead = members.find((m) => m.id === party.leaderId);
  const srcLabel = party.source === 'hotline' ? L('Đặt qua AI Hotline', 'Booked on the AI hotline')
    : party.source === 'messenger' ? L('Đặt qua Messenger', 'Booked on Messenger')
    : party.source === 'online' ? L('Đặt online', 'Booked online') : L('Khách vãng lai', 'Walk-in');

  const seg = (on: boolean) => ({ padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none', background: on ? '#4f46e5' : 'transparent', color: on ? '#fff' : 'var(--c94a3b8)' } as const);
  const btn = (kind: 'pri' | 'sec' | 'ok') => ({
    height: 44, borderRadius: 12, fontWeight: 700, fontSize: 14, padding: '0 16px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    border: kind === 'pri' ? 'none' : `1px solid ${kind === 'ok' ? 'rgba(34,197,94,0.45)' : 'var(--c334155)'}`,
    background: kind === 'pri' ? '#4f46e5' : kind === 'ok' ? 'rgba(34,197,94,0.14)' : 'var(--c1e293b)',
    color: kind === 'pri' ? '#fff' : kind === 'ok' ? 'var(--ink-good)' : 'var(--ccbd5e1)',
  } as const);

  const dropTo = (payerId: string) => {
    if (!dragKey) return;
    setMoves((mv) => {
      const [owner] = dragKey.split(':');
      const next = { ...mv };
      if (owner === payerId) delete next[dragKey]; else next[dragKey] = payerId;
      return next;
    });
    setDragKey(null); setOverId(null);
  };

  return (
    <Backdrop onClose={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 1180, maxHeight: mobile ? '96dvh' : '92vh', display: 'flex', flexDirection: 'column', background: 'var(--c0f172a)', border: '1px solid var(--c334155)', borderRadius: mobile ? '16px 16px 0 0' : 16, boxShadow: '0 24px 60px rgba(0,0,0,0.45)' }}>
        {/* ---- head ---- */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px 10px', flexWrap: 'wrap', borderBottom: '1px solid var(--c334155)' }}>
          <span style={{ fontSize: 13, fontWeight: 700, padding: '4px 10px', borderRadius: 999, color: 'var(--cc7d2fe)', background: 'rgba(99,102,241,0.18)', border: '1px solid rgba(99,102,241,0.45)', whiteSpace: 'nowrap' }}>👥 {L('Nhóm', 'Party')}{party.tag ? ` ${party.tag}` : ''}</span>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--cf1f5f9)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{names.join(' · ')}</span>
          <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>{srcLabel}{party.phone ? ` · 📞 ${party.phone}${lead ? ` (${nameOf(lead, vi)})` : ''}` : ''}</span>
          <div style={{ marginLeft: 'auto', display: 'inline-flex', background: 'var(--c111827)', border: '1px solid var(--c334155)', borderRadius: 10, padding: 3 }}>
            <button type="button" style={seg(mode === 'merge')} onClick={() => setMode('merge')} disabled={paidCount > 0} title={paidCount > 0 ? L('Đã có người trả riêng', 'Someone already paid separately') : undefined}>{L('Gộp 1 bill', 'One bill')}</button>
            <button type="button" style={seg(mode === 'split')} onClick={() => setMode('split')}>{L('Tách bill', 'Split bills')}</button>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ width: 34, height: 34, borderRadius: 9, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--ccbd5e1)', cursor: 'pointer', fontSize: 16, flexShrink: 0 }}>✕</button>
        </div>

        <div style={{ overflowY: 'auto', padding: '12px 18px 16px', display: 'flex', flexDirection: 'column', gap: 12, WebkitOverflowScrolling: 'touch' }}>
          {/* ---- the one line of guidance that matters right now ---- */}
          <div style={{ fontSize: 12.5, color: 'var(--cc7d2fe)', background: 'rgba(99,102,241,0.18)', border: '1px solid rgba(99,102,241,0.45)', borderRadius: 10, padding: '8px 12px', lineHeight: 1.45 }}>
            {mode === 'merge'
              ? (inChair.length
                ? L(`${inChair.map((m) => nameOf(m, vi)).join(', ')} vẫn đang làm${inChair[0].minutesLeft != null ? ` (còn ~${inChair[0].minutesLeft}′)` : ''}. Có thể thu trước phần của người đã xong, hoặc đợi cả nhóm. Bill nhóm chỉ đóng khi mọi người đã trả.`,
                    `${inChair.map((m) => nameOf(m, vi)).join(', ')} still in a chair${inChair[0].minutesLeft != null ? ` (~${inChair[0].minutesLeft}′ left)` : ''}. Take the finished ones' part now, or wait for the whole party. The party closes when everyone has paid.`)
                : L('Một hoá đơn, liệt kê theo từng người. Thuế, giảm giá và điểm thưởng tính ở bước thanh toán như bình thường.', 'One receipt, listed person by person. Tax, discounts and points are handled at the payment step as usual.'))
              : L('Mỗi cột là một hoá đơn riêng, trả lần lượt. Kéo một dòng sang cột người khác (hoặc bấm ⇄) để người đó trả thay.', 'Each column is its own receipt, paid one after another. Drag a line to another column (or tap ⇄) so that person pays for it.')}
          </div>

          {/* ---- columns ---- */}
          <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : `repeat(${Math.min(members.length, 3)}, minmax(0, 1fr))`, gap: 12 }}>
            {members.map((m) => {
              const mine = open.filter((e) => e.payerId === m.id);
              const sub = mine.reduce((s, e) => s + net(e.item.priceCents), 0);
              const tip = mode === 'split' ? tipCents(sub) : (allOpenSubtotal > 0 ? Math.round((allTip * sub) / allOpenSubtotal) : 0);
              const paidLines = m.items.filter((i) => i.paid);
              const movedAway = mode === 'split' ? m.items.filter((i) => !i.paid && moves[key(m.id, i.lineId)] && moves[key(m.id, i.lineId)] !== m.id) : [];
              const isLead = m.id === party.leaderId;
              const over = overId === m.id && dragKey && !dragKey.startsWith(m.id + ':');
              return (
                <div key={m.id}
                  onDragOver={(e) => { if (mode === 'split' && dragKey && !m.paid) { e.preventDefault(); setOverId(m.id); } }}
                  onDragLeave={() => setOverId((v) => (v === m.id ? null : v))}
                  onDrop={(e) => { e.preventDefault(); if (mode === 'split' && !m.paid) dropTo(m.id); }}
                  style={{ background: 'var(--c111827)', border: `1px solid ${over ? '#4f46e5' : m.paid ? 'rgba(34,197,94,0.45)' : 'var(--c334155)'}`, borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 200, opacity: m.paid ? 0.72 : 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--c1e1b4b)', color: 'var(--ce0e7ff)', fontSize: 12, fontWeight: 700, display: 'grid', placeItems: 'center', flexShrink: 0 }}>{initials(nameOf(m, vi))}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--cf1f5f9)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nameOf(m, vi)}</div>
                      <div style={{ fontSize: 12, color: 'var(--c94a3b8)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span>{isLead ? L('Trưởng nhóm', 'Party contact') : lead ? L(`Đi cùng ${nameOf(lead, vi)}`, `With ${nameOf(lead, vi)}`) : ''}</span>
                        {m.paid
                          ? <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, color: 'var(--ink-good)', background: 'rgba(34,197,94,0.14)' }}>✓ {L('Đã trả', 'Paid')}{m.orderNumbers.length ? ` · #${m.orderNumbers.join(', #')}` : ''}</span>
                          : m.finished
                            ? <span>· ✓ {L('xong', 'done')}</span>
                            : <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, color: 'var(--ink-warn)', background: 'rgba(245,158,11,0.14)' }}>{L('đang làm', 'in a chair')}{m.minutesLeft != null ? ` · ~${m.minutesLeft}′` : ''}</span>}
                      </div>
                    </div>
                  </div>

                  {paidLines.map((it) => (
                    <div key={it.lineId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: '1px solid var(--c334155)', borderRadius: 10, background: 'var(--c0f172a)', opacity: 0.6 }}>
                      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 600, color: 'var(--cf1f5f9)' }}>{it.name}</div><div style={{ fontSize: 11.5, color: 'var(--c94a3b8)' }}>✓ {L('đã trả', 'paid')}{it.orderNumber ? ` · #${it.orderNumber}` : ''}</div></div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--c94a3b8)' }}>{fmt(it.priceCents)}</div>
                    </div>
                  ))}
                  {mine.map((e) => {
                    const foreign = e.owner.id !== m.id;
                    return (
                      <div key={e.k} draggable={mode === 'split'} onDragStart={(ev) => { setDragKey(e.k); ev.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { setDragKey(null); setOverId(null); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 10, cursor: mode === 'split' ? 'grab' : 'default', opacity: dragKey === e.k ? 0.5 : 1,
                          border: `1px solid ${foreign ? 'rgba(99,102,241,0.45)' : 'var(--c334155)'}`, background: foreign ? 'rgba(99,102,241,0.18)' : 'var(--c0f172a)', position: 'relative' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--cf1f5f9)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.item.name}</div>
                          <div style={{ fontSize: 11.5, color: 'var(--c94a3b8)' }}>
                            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: techColor(e.item.staffId), marginRight: 4 }} />
                            {techName(e.item.staffId) || L('chưa có thợ', 'no technician')}{e.item.durationMinutes ? ` · ${e.item.durationMinutes}′` : ''}
                            {foreign && <em> · {L(`của ${nameOf(e.owner, vi)}, ${nameOf(m, vi)} trả`, `${nameOf(e.owner, vi)}'s, paid by ${nameOf(m, vi)}`)}</em>}
                          </div>
                        </div>
                        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--cf1f5f9)', whiteSpace: 'nowrap', textAlign: 'right' }}>
                          {pct > 0 && <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--c64748b)', textDecoration: 'line-through' }}>{fmt(e.item.priceCents)}</div>}
                          {fmt(net(e.item.priceCents))}
                        </div>
                        {mode === 'split' && members.length > 1 && (
                          <button type="button" onClick={() => setSendOpen((v) => (v === e.k ? null : e.k))} title={L('Người khác trả dòng này', 'Someone else pays this line')}
                            style={{ width: 26, height: 26, borderRadius: 7, border: '1px solid var(--c334155)', background: 'var(--c1e293b)', color: 'var(--ccbd5e1)', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}>⇄</button>
                        )}
                        {sendOpen === e.k && (
                          <div style={{ position: 'absolute', right: 8, top: '100%', zIndex: 5, background: 'var(--c1e293b)', border: '1px solid var(--c334155)', borderRadius: 10, padding: 4, minWidth: 160, boxShadow: '0 12px 30px rgba(0,0,0,0.5)' }}>
                            <div style={{ fontSize: 11, color: 'var(--c94a3b8)', padding: '4px 8px' }}>{L('Ai trả dòng này?', 'Who pays this line?')}</div>
                            {members.filter((x) => !x.paid).map((x) => (
                              <button key={x.id} type="button" onClick={() => { setMoves((mv) => { const n = { ...mv }; if (x.id === e.owner.id) delete n[e.k]; else n[e.k] = x.id; return n; }); setSendOpen(null); }}
                                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', borderRadius: 7, border: 'none', background: x.id === m.id ? 'rgba(99,102,241,0.18)' : 'transparent', color: 'var(--cf1f5f9)', fontSize: 13, cursor: 'pointer' }}>
                                {nameOf(x, vi)}{x.id === e.owner.id ? ` (${L('chính chủ', 'own')})` : ''}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {movedAway.map((it) => (
                    <div key={'away-' + it.lineId} style={{ padding: '8px 10px', border: '1px dashed var(--c334155)', borderRadius: 10, fontSize: 12, color: 'var(--c64748b)', textAlign: 'center' }}>
                      {it.name} → {L(`${nameOf(members.find((x) => x.id === moves[key(m.id, it.lineId)])!, vi)} trả`, `paid by ${nameOf(members.find((x) => x.id === moves[key(m.id, it.lineId)])!, vi)}`)}
                    </div>
                  ))}
                  {!m.paid && !mine.length && !movedAway.length && !paidLines.length && (
                    <div style={{ padding: '8px 10px', border: '1px dashed var(--c334155)', borderRadius: 10, fontSize: 12, color: 'var(--c64748b)', textAlign: 'center' }}>{L('Chưa có dịch vụ', 'No services yet')}</div>
                  )}

                  <div style={{ marginTop: 'auto', borderTop: '1px dashed var(--c334155)', paddingTop: 8, fontSize: 12.5, color: 'var(--c94a3b8)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {m.paid ? (
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--cf1f5f9)', fontWeight: 700, fontSize: 15 }}><span>{L('Đã trả', 'Paid')}</span><span>{fmt(paidLines.reduce((s, i) => s + i.priceCents, 0))}</span></div>
                    ) : (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{L('Tạm tính', 'Subtotal')}</span><span>{fmt(sub)}</span></div>
                        {tipsOn && tip > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{L('Tip', 'Tip')}</span><span>{fmt(tip)}</span></div>}
                        {mode === 'split' && <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--cf1f5f9)', fontWeight: 700, fontSize: 15 }}><span>{L(`${nameOf(m, vi)} trả`, `${nameOf(m, vi)} pays`)}</span><span>{fmt(sub + tip)}</span></div>}
                      </>
                    )}
                  </div>
                  {mode === 'split' && !m.paid && (
                    <button type="button" disabled={!mine.length} onClick={() => compose(mine, m)} style={{ ...btn(m.finished ? 'pri' : 'sec'), opacity: mine.length ? 1 : 0.5 }}>
                      {L(`Thanh toán ${nameOf(m, vi)}`, `Charge ${nameOf(m, vi)}`)} · {fmt(sub + tip)}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* ---- the salon's group programme ---- */}
          {party.groupPromo && open.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--c94a3b8)' }}>
              <button type="button" onClick={() => setPromoOn((v) => !v)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 999, cursor: 'pointer', fontSize: 12.5, fontWeight: 700,
                  border: `1px solid ${promoOn ? 'rgba(34,197,94,0.45)' : 'var(--c334155)'}`, background: promoOn ? 'rgba(34,197,94,0.14)' : 'transparent', color: promoOn ? 'var(--ink-good)' : 'var(--c94a3b8)' }}>
                {promoOn ? '✓' : '○'} 🎉 {L(`Giảm nhóm −${party.groupPromo.percent}% (từ ${party.groupPromo.minSize} người)`, `Group discount −${party.groupPromo.percent}% (${party.groupPromo.minSize}+ people)`)}
              </button>
              {promoOn && promoSaved > 0 && <span>{L('tiết kiệm', 'saves')} {fmt(promoSaved)}</span>}
              {party.groupPromo.message && <span style={{ fontStyle: 'italic' }}>“{party.groupPromo.message}”</span>}
            </div>
          )}

          {/* ---- tip for the whole party ---- */}
          {tipsOn && open.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5, color: 'var(--c94a3b8)' }}>
              <span>{mode === 'merge' ? L('Tip cả nhóm:', 'Party tip:') : L('Tip mỗi bill:', 'Tip per bill:')}</span>
              {TIP_STEPS.map((p) => (
                <button key={p} type="button" onClick={() => setTipPct(p)} style={{ padding: '5px 10px', borderRadius: 8, border: `1px solid ${tipPct === p ? '#4f46e5' : 'var(--c334155)'}`, background: tipPct === p ? '#4f46e5' : 'transparent', color: tipPct === p ? '#fff' : 'var(--ccbd5e1)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>{p === 0 ? L('Không', 'None') : `${p}%`}</button>
              ))}
              <button type="button" onClick={() => setTipPct(-1)} style={{ padding: '5px 10px', borderRadius: 8, border: `1px solid ${tipPct === -1 ? '#4f46e5' : 'var(--c334155)'}`, background: tipPct === -1 ? '#4f46e5' : 'transparent', color: tipPct === -1 ? '#fff' : 'var(--ccbd5e1)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>{L('Tự nhập', 'Custom')}</button>
              {tipPct === -1 && <input value={tipCustom} onChange={(e) => setTipCustom(e.target.value)} inputMode="decimal" placeholder="0.00" style={{ width: 90, height: 30, borderRadius: 8, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--cf1f5f9)', padding: '0 8px', fontSize: 13 }} />}
              {mode === 'merge' && allTip > 0 && (
                <span style={{ marginLeft: 4 }}>→ {L('tự chia theo thợ làm từng phần', 'shared out by who did what')}: {
                  Object.entries(withTips(open.map(lineOf), allTip).reduce<Record<string, number>>((acc, l) => { const k = techName(l.staffMemberId || null) || '—'; acc[k] = (acc[k] ?? 0) + l.tipCents; return acc; }, {}))
                    .map(([n, c]) => `${n} ${fmt(c)}`).join(' · ')
                }</span>
              )}
            </div>
          )}

          {/* ---- footer ---- */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 12, borderTop: '1px solid var(--c334155)', flexWrap: 'wrap' }}>
            {mode === 'merge' ? (
              <>
                <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>
                  {L('Tạm tính', 'Subtotal')} {fmt(allOpenSubtotal)}{promoSaved > 0 ? ` (${L('đã giảm nhóm', 'group discount')} −${fmt(promoSaved)})` : ''}{allTip > 0 ? ` · Tip ${fmt(allTip)}` : ''} · {L('thuế & giảm thêm ở bước sau', 'tax & extra discounts at the next step')}
                  <b style={{ display: 'block', fontSize: 22, color: 'var(--cf1f5f9)' }}>{fmt(allOpenSubtotal + allTip)}</b>
                </div>
                <div style={{ flex: 1 }} />
                {finished.length > 0 && inChair.length > 0 && earlyEntries.length > 0 && (
                  <button type="button" onClick={() => compose(earlyEntries, null)} style={btn('sec')}>
                    {L(`Thu trước ${finished.map((m) => nameOf(m, vi)).join(' + ')}`, `Take ${finished.map((m) => nameOf(m, vi)).join(' + ')} now`)} · {fmt(earlySubtotal + tipCents(earlySubtotal))}
                  </button>
                )}
                <button type="button" disabled={!open.length} onClick={() => compose(open, null)} style={{ ...btn('pri'), minWidth: 240, opacity: open.length ? 1 : 0.5 }}>
                  {L('Thanh toán cả nhóm', 'Charge the party')} · {fmt(allOpenSubtotal + allTip)}
                </button>
              </>
            ) : (
              <>
                <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>
                  {L('Nhóm', 'Party')}{party.tag ? ` ${party.tag}` : ''} · {members.length} {L('hoá đơn', 'bills')} · {L('đã thu', 'paid')} {paidCount}/{members.length}
                  <b style={{ display: 'block', fontSize: 22, color: 'var(--cf1f5f9)' }}>{L('Còn phải thu', 'Still to collect')} {fmt(allOpenSubtotal)}</b>
                </div>
                <div style={{ flex: 1 }} />
                {unpaidMembers.length > 1 && open.length > 0 && (
                  <button type="button" onClick={() => compose(open, null, unpaidMembers.length)} style={btn('sec')} title={L('Một bill cho tất cả, chia thành N phần bằng nhau', 'One bill for everyone, split into N equal tenders')}>
                    {L(`Chia đều ${unpaidMembers.length} phần`, `Split ${unpaidMembers.length} ways`)}
                  </button>
                )}
                <button type="button" onClick={onClose} style={btn('sec')}>{L('Đóng nhóm sau', 'Come back later')}</button>
              </>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>
            {mode === 'merge'
              ? L('Điểm thưởng về trưởng nhóm. Hoa hồng thợ tính theo dòng dịch vụ như bình thường. Mọi vé trong bill đóng khi thanh toán xong.', 'Points go to the party contact. Technician commission is per line as usual. Every ticket on the bill closes when it is paid.')
              : L('Ai trả xong thì vé người đó đóng, thợ được giải phóng. Nhóm tự đóng khi người cuối trả; người chưa trả vẫn hiện "Chờ thanh toán" trên bảng.', 'Whoever pays is done and her technician is free. The party closes when the last person pays; the others stay "waiting to pay" on the board.')}
          </div>
        </div>
      </div>
    </Backdrop>
  );
}

function Backdrop({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const mobile = useIsMobile(820);
  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(2,6,23,0.72)', display: 'flex', alignItems: mobile ? 'flex-end' : 'center', justifyContent: 'center', padding: mobile ? 0 : 16 }}>
      {children}
    </div>
  );
}
