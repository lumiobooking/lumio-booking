'use client';

import { useMemo, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { ui, formatPrice, toMinorUnits, fromMinorUnits } from '../../lib/ui';
import { cleanErr, fundLabel, groupLabel, type CatGroup, type Category, type Direction, type EntryInit, type Fund, type Tr } from './finance-types';

/**
 * Lập phiếu thu / phiếu chi — the one form for money a person writes down.
 *
 * Amount first (it is what they are holding), then what it was for, then
 * where the money came from. The category decides whether it is on the P&L;
 * a person may take one voucher off it, never put a "not P&L" one on it.
 * Big money out asks for an approver's PIN when the person typing may not
 * refund or void alone — the same rule as a refund at the till.
 */

const OUT_GROUPS: CatGroup[] = ['COGS', 'OPS', 'MARKETING', 'OTHER', 'NON_PL'];
const IN_GROUPS: CatGroup[] = ['INCOME', 'NON_PL'];

export function EntryDrawer({ token, L, currency, today, funds, categories, init, approvalOverCents, canSelfApprove, onClose, onSaved }: {
  token: string | null; L: Tr; currency: string; today: string;
  funds: Fund[]; categories: Category[]; init: EntryInit; approvalOverCents: number; canSelfApprove: boolean;
  onClose: () => void; onSaved: () => void;
}) {
  const editing = !!init.id;
  const [direction, setDirection] = useState<Direction>(init.direction);
  const [amount, setAmount] = useState(init.amountCents ? fromMinorUnits(init.amountCents, currency) : '');
  const usable = useMemo(() => categories.filter((c) => !c.hidden && !c.system && c.systemKey !== 'bank_deposit'), [categories]);
  const [catId, setCatId] = useState<string | null>(init.categoryId ?? null);
  const activeFunds = funds.filter((f) => !f.archived);
  const [fundId, setFundId] = useState(init.fundId ?? activeFunds.find((f) => f.kind === 'CASH')?.id ?? activeFunds[0]?.id ?? '');
  const [day, setDay] = useState(init.day ?? today);
  const [payee, setPayee] = useState(init.payee ?? '');
  const [note, setNote] = useState(init.note ?? '');
  const [offPl, setOffPl] = useState(init.countsInPl === false);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const cents = toMinorUnits(amount || '0', currency);
  const cat = usable.find((c) => c.id === catId) ?? null;
  const fund = activeFunds.find((f) => f.id === fundId);
  const nonPl = cat?.group === 'NON_PL';
  const askPin = direction === 'OUT' && !canSelfApprove && approvalOverCents > 0 && cents > approvalOverCents;
  const tooEarly = !!fund && day < fund.openingDate;
  const ok = cents > 0 && !!cat && cat.direction === direction && !!fund && !!day && day <= today && !tooEarly && (!askPin || pin.length >= 4);

  async function save(again: boolean) {
    if (!token || !ok) return;
    setBusy(true); setErr(null);
    const body = {
      ...(editing ? {} : { direction }), amountCents: cents, fundId, categoryId: catId, day,
      payee: payee.trim() || null, note: note.trim() || null, countsInPl: nonPl ? false : !offPl,
      ...(askPin ? { approvalPin: pin } : {}),
    };
    try {
      await apiFetch(editing ? `/finance/entries/${init.id}` : '/finance/entries', { method: editing ? 'PATCH' : 'POST', token, body });
      onSaved();
      if (again && !editing) { setAmount(''); setPayee(''); setNote(''); setPin(''); }
      else onClose();
    } catch (e) { setErr(cleanErr(e)); } finally { setBusy(false); }
  }

  const groups = direction === 'OUT' ? OUT_GROUPS : IN_GROUPS;
  const chip = (on: boolean, dashed = false) => ({
    padding: '8px 12px', borderRadius: 999, fontSize: 13, fontWeight: on ? 800 : 600, cursor: 'pointer', fontFamily: 'inherit',
    border: on ? '2px solid #6366f1' : `1px ${dashed ? 'dashed' : 'solid'} var(--c475569)`,
    background: on ? 'rgba(99,102,241,.16)' : 'transparent', color: 'var(--ce2e8f0)',
  }) as const;
  const label = { fontSize: 12.5, fontWeight: 700, color: 'var(--c94a3b8)' } as const;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.6)', zIndex: 300, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label={direction === 'OUT' ? L('Lập phiếu chi', 'New payment') : L('Lập phiếu thu', 'New receipt')}
        style={{ width: 'min(540px, 100vw)', height: '100%', background: 'var(--c1e293b)', borderLeft: '1px solid var(--c334155)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ flex: 1, fontSize: 18, fontWeight: 800, color: 'var(--ce2e8f0)' }}>
            {editing ? L('Sửa phiếu', 'Edit voucher') : direction === 'OUT' ? L('Lập phiếu chi', 'New payment') : L('Lập phiếu thu', 'New receipt')}
          </div>
          <button type="button" onClick={onClose} aria-label={L('Đóng', 'Close')} style={{ width: 40, height: 40, borderRadius: 10, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--c94a3b8)', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!editing && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, padding: 4, borderRadius: 12, border: '1px solid var(--c334155)' }}>
              {(['OUT', 'IN'] as const).map((d) => (
                <button key={d} type="button" onClick={() => { setDirection(d); setCatId(null); }}
                  style={{ height: 40, borderRadius: 9, border: 'none', fontFamily: 'inherit', fontSize: 14, fontWeight: 800, cursor: 'pointer', background: direction === d ? (d === 'OUT' ? '#b45309' : '#047857') : 'transparent', color: direction === d ? '#fff' : 'var(--c94a3b8)' }}>
                  {d === 'OUT' ? L('− Phiếu chi', '− Money out') : L('+ Phiếu thu', '+ Money in')}
                </button>
              ))}
            </div>
          )}

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={label}>{L('Số tiền', 'Amount')}</span>
            <input inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00"
              style={{ ...ui.input, height: 56, fontSize: 26, fontWeight: 800 }} />
          </label>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={label}>{direction === 'OUT' ? L('Chi cho việc gì', 'What it was for') : L('Thu từ đâu', 'Where it came from')}</span>
            {groups.map((g) => {
              const list = usable.filter((c) => c.direction === direction && c.group === g);
              if (!list.length) return null;
              return (
                <div key={g} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', color: 'var(--c94a3b8)' }}>{groupLabel(g, L).toUpperCase()}</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {list.map((c) => <button key={c.id} type="button" onClick={() => setCatId(c.id)} style={chip(catId === c.id, g === 'NON_PL')}>{catId === c.id ? '✓ ' : ''}{c.name}</button>)}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={label}>{direction === 'OUT' ? L('Chi từ quỹ', 'Paid from') : L('Vào quỹ', 'Into')}</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
              {activeFunds.map((f) => (
                <button key={f.id} type="button" onClick={() => setFundId(f.id)}
                  style={{ textAlign: 'left', padding: '9px 12px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', border: fundId === f.id ? '2px solid #6366f1' : '1px solid var(--c475569)', background: fundId === f.id ? 'rgba(99,102,241,.14)' : 'transparent', color: 'var(--ce2e8f0)' }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700 }}>{fundLabel(f, L)}</span>
                  <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{L('còn', 'holds')} {formatPrice(f.balanceCents, currency)}</span>
                </button>
              ))}
            </div>
            {fund?.kind === 'CASH' && direction === 'OUT' && (
              <div style={{ fontSize: 12.5, color: 'var(--ink-warn)', lineHeight: 1.5 }}>
                {L('Lấy tiền trong ngăn kéo khi đang mở ca? Ghi ở POS → Ca thu ngân để tiền đếm cuối ca khớp. Phiếu ở đây dành cho tiền mặt két riêng.', 'Taking it from the open drawer? Log it at POS → Cashier shift so the count matches. This voucher is for cash kept outside the drawer.')}
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={label}>{direction === 'OUT' ? L('Người nhận', 'Paid to') : L('Người nộp', 'Received from')}</span>
              <input value={payee} onChange={(e) => setPayee(e.target.value)} maxLength={120} style={ui.input} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={label}>{L('Ngày', 'Date')}</span>
              <input type="date" value={day} max={today} min={fund?.openingDate} onChange={(e) => setDay(e.target.value)} style={ui.input} />
            </label>
          </div>
          {tooEarly && <div style={{ fontSize: 12.5, color: 'var(--ink-bad)' }}>{L(`Sổ của quỹ này bắt đầu từ ${fund?.openingDate}.`, `This fund's books start on ${fund?.openingDate}.`)}</div>}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={label}>{L('Ghi chú', 'Note')}</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} style={ui.input} />
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, border: '1px solid var(--c334155)', opacity: nonPl ? 0.6 : 1 }}>
            <input type="checkbox" checked={!nonPl && !offPl} disabled={nonPl || !cat} onChange={(e) => setOffPl(!e.target.checked)} style={{ width: 18, height: 18 }} />
            <span style={{ flex: 1 }}>
              <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{L('Tính vào lãi lỗ', 'Counts on profit & loss')}</span>
              <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{nonPl ? L('Loại này không phải thu / chi kinh doanh — chỉ có trong sổ quỹ.', 'Not business income or cost — cash book only.') : L('Tắt cho tiền không phải chi phí kinh doanh của tiệm.', 'Turn off for money that is not a business cost.')}</span>
            </span>
          </label>

          {askPin && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={label}>{L(`Trên ${formatPrice(approvalOverCents, currency)} cần PIN duyệt của chủ / quản lý`, `Over ${formatPrice(approvalOverCents, currency)} needs an owner / manager PIN`)}</span>
              <input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} style={{ ...ui.input, maxWidth: 160, letterSpacing: 4 }} />
            </label>
          )}
          {err && <div style={{ ...ui.banner }}>{err}</div>}
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '12px 18px', borderTop: '1px solid var(--line)', flexWrap: 'wrap' }}>
          <button type="button" onClick={onClose} style={{ ...ui.primaryBtn, background: 'transparent', color: 'var(--ce2e8f0)', border: '1px solid var(--c475569)', height: 44 }}>{L('Huỷ', 'Cancel')}</button>
          {!editing && <button type="button" disabled={!ok || busy} onClick={() => void save(true)} style={{ ...ui.primaryBtn, background: 'transparent', color: 'var(--ink-link)', border: '1px solid var(--c475569)', height: 44, opacity: ok ? 1 : 0.5 }}>{L('Lưu & lập phiếu khác', 'Save & add another')}</button>}
          <button type="button" disabled={!ok || busy} onClick={() => void save(false)} style={{ ...ui.primaryBtn, flex: 1, height: 44, fontSize: 14, opacity: ok ? 1 : 0.5 }}>
            {busy ? '…' : `${L('Lưu', 'Save')} ${direction === 'OUT' ? '−' : '+'}${formatPrice(cents, currency)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
