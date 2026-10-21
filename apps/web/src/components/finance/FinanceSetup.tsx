'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { apiFetch } from '../../lib/api';
import { ui, formatPrice, toMinorUnits, fromMinorUnits } from '../../lib/ui';
import { PayRecurringDialog } from './FinanceDialogs';
import { cleanErr, fundLabel, groupLabel, type CatGroup, type Category, type FinanceCtx, type Fund, type Recurring } from './finance-types';

/**
 * Định kỳ & cài đặt: the costs that come round, the categories money is
 * filed under, the funds and their opening balances, and the approval limit.
 */
export function FinanceSetup({ fx }: { fx: FinanceCtx }) {
  const { token, L, currency, funds, categories, version, isOwner } = fx;
  const fmt = (c: number) => formatPrice(c, currency);
  const [recs, setRecs] = useState<Recurring[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [paying, setPaying] = useState<Recurring | null>(null);
  const [editing, setEditing] = useState<Recurring | 'new' | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try { setRecs(await apiFetch<Recurring[]>('/finance/recurring', { token })); setErr(null); }
    catch (e) { setErr(cleanErr(e)); }
  }, [token, version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try { await fn(); fx.refresh(); } catch (e) { setErr(cleanErr(e)); }
  };
  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? '—';
  const monthly = (recs ?? []).reduce((n, r) => n + (r.amountCents ?? 0) * (r.cadence === 'WEEKLY' ? 52 / 12 : r.cadence === 'YEARLY' ? 1 / 12 : 1), 0);
  const cadence = (r: Recurring) => (r.cadence === 'WEEKLY' ? L('Hằng tuần', 'Weekly') : r.cadence === 'YEARLY' ? L('Hằng năm', 'Yearly') : L('Hằng tháng', 'Monthly'));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {err && <div style={ui.banner}>{err}</div>}

      <div style={{ ...ui.card, padding: 0, overflowX: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', flexWrap: 'wrap' }}>
          <b style={{ flex: 1, fontSize: 15, color: 'var(--ce2e8f0)' }}>{L('Chi phí định kỳ', 'Recurring costs')}</b>
          <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{L('Cố định ≈', 'Fixed ≈')} <b style={{ color: 'var(--ce2e8f0)' }}>{fmt(Math.round(monthly))}</b> / {L('tháng', 'month')}</span>
          <button type="button" onClick={() => setEditing('new')} style={{ ...ui.primaryBtn, height: 38 }}>+ {L('Khoản định kỳ', 'Recurring cost')}</button>
        </div>
        <div style={{ minWidth: 760 }}>
          {(recs ?? []).length === 0 && <div style={{ padding: '10px 16px 16px', fontSize: 13, color: 'var(--c94a3b8)' }}>{recs ? L('Chưa có. Thêm tiền thuê mặt bằng, điện nước, phần mềm… để hệ thống nhắc hoặc tự ghi mỗi kỳ.', 'None yet. Add rent, utilities, software… to be reminded or have them recorded each time.') : L('Đang tải…', 'Loading…')}</div>}
          {(recs ?? []).map((r) => {
            const overdue = r.nextDue < fx.today;
            return (
              <div key={r.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) 120px 110px 110px 140px minmax(220px,auto)', gap: 10, padding: '10px 16px', borderTop: '1px solid var(--line)', alignItems: 'center', fontSize: 13, color: 'var(--ce2e8f0)' }}>
                <span><b>{r.name}</b><span style={{ display: 'block', fontSize: 12, color: 'var(--c94a3b8)' }}>{catName(r.categoryId)}{r.payee ? ` · ${r.payee}` : ''}</span></span>
                <span>{cadence(r)}</span>
                <span style={{ fontWeight: 700, color: overdue ? 'var(--ink-bad)' : 'var(--ce2e8f0)' }}>{r.nextDue}</span>
                <span style={{ textAlign: 'right', fontWeight: 700 }}>{r.amountCents ? fmt(r.amountCents) : L('thay đổi', 'varies')}</span>
                <span><span style={{ fontSize: 11.5, padding: '3px 8px', borderRadius: 7, fontWeight: 700, border: '1px solid var(--c334155)', color: r.mode === 'AUTO' ? 'var(--ink-good)' : 'var(--ink-warn)' }}>{r.mode === 'AUTO' ? L('Tự lập phiếu', 'Records itself') : L('Nhắc tôi', 'Remind me')}</span>
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--c94a3b8)', marginTop: 3 }}>{fundLabel(funds.find((f) => f.id === r.fundId), L)}</span></span>
                <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  {r.mode === 'REMIND' && <button type="button" onClick={() => setPaying(r)} style={sm}>{L('Đã trả', 'Paid')}</button>}
                  {r.mode === 'REMIND' && <button type="button" onClick={() => void act(() => apiFetch(`/finance/recurring/${r.id}/skip`, { method: 'POST', token }))} style={ghostSm}>{L('Bỏ kỳ này', 'Skip')}</button>}
                  <button type="button" onClick={() => setEditing(r)} style={ghostSm}>{L('Sửa', 'Edit')}</button>
                  <button type="button" onClick={() => { if (window.confirm(L(`Dừng "${r.name}"? Các phiếu đã ghi vẫn giữ nguyên.`, `Stop "${r.name}"? Vouchers already written stay.`))) void act(() => apiFetch(`/finance/recurring/${r.id}`, { method: 'PATCH', token, body: { active: false } })); }} style={{ ...ghostSm, color: 'var(--ink-bad)' }}>{L('Dừng', 'Stop')}</button>
                </span>
              </div>
            );
          })}
        </div>
        <div style={{ padding: '10px 16px 14px', fontSize: 12, color: 'var(--c94a3b8)', borderTop: '1px solid var(--line)', lineHeight: 1.55 }}>
          {L('Nhắc tôi: đến hạn thì hiện ở Tổng quan, bấm "Đã trả" mới ghi phiếu. Tự lập phiếu: số tiền cố định, trả tự động (thẻ, ghi nợ) — hệ thống ghi phiếu đúng ngày, vẫn huỷ được.', 'Remind me: shows on the Overview when due; "Paid" writes the voucher. Records itself: a fixed amount paid automatically (card, direct debit) — the voucher is written on the day, and can still be voided.')}
        </div>
      </div>

      <Categories fx={fx} onError={setErr} />
      <Funds fx={fx} onError={setErr} />
      {isOwner && <Limits fx={fx} onError={setErr} />}

      {paying && <PayRecurringDialog fx={fx} rec={paying} onClose={() => setPaying(null)} />}
      {editing && <RecurringForm fx={fx} rec={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

const sm: CSSProperties = { ...ui.primaryBtn, padding: '0 10px', height: 32, fontSize: 12.5 };
const ghostSm: CSSProperties = { ...ui.primaryBtn, padding: '0 10px', height: 32, fontSize: 12.5, background: 'transparent', color: 'var(--ce2e8f0)', border: '1px solid var(--c475569)' };
const lbl: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, fontWeight: 700, color: 'var(--c94a3b8)' };

function RecurringForm({ fx, rec, onClose }: { fx: FinanceCtx; rec: Recurring | null; onClose: () => void }) {
  const { token, L, currency, funds, categories, today } = fx;
  const outCats = categories.filter((c) => c.direction === 'OUT' && !c.hidden && !c.system && c.systemKey !== 'bank_deposit' && c.group !== 'NON_PL');
  const [name, setName] = useState(rec?.name ?? '');
  const [categoryId, setCategoryId] = useState(rec?.categoryId ?? outCats.find((c) => c.systemKey === 'rent')?.id ?? outCats[0]?.id ?? '');
  const [fundId, setFundId] = useState(rec?.fundId ?? funds.find((f) => f.kind === 'BANK' && f.isDefault)?.id ?? funds[0]?.id ?? '');
  const [varies, setVaries] = useState(rec ? rec.amountCents === null : false);
  const [amount, setAmount] = useState(rec?.amountCents ? fromMinorUnits(rec.amountCents, currency) : '');
  const [cadence, setCadence] = useState<Recurring['cadence']>(rec?.cadence ?? 'MONTHLY');
  const [anchorDay, setAnchorDay] = useState(rec?.anchorDay ?? today);
  const [nextDue, setNextDue] = useState(rec?.nextDue ?? today);
  const [mode, setMode] = useState<Recurring['mode']>(rec?.mode ?? 'REMIND');
  const [payee, setPayee] = useState(rec?.payee ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const cents = varies ? null : toMinorUnits(amount || '0', currency);
  const ok = !!name.trim() && !!categoryId && !!fundId && (varies ? mode === 'REMIND' : (cents ?? 0) > 0);

  async function save() {
    if (!token || !ok) return;
    setBusy(true); setErr(null);
    const body = rec
      ? { name: name.trim(), categoryId, fundId, amountCents: cents, mode, payee: payee.trim() || undefined, nextDue }
      : { name: name.trim(), categoryId, fundId, amountCents: cents, cadence, anchorDay, mode, payee: payee.trim() || undefined };
    try {
      await apiFetch(rec ? `/finance/recurring/${rec.id}` : '/finance/recurring', { method: rec ? 'PATCH' : 'POST', token, body });
      fx.refresh(); onClose();
    } catch (e) { setErr(cleanErr(e)); } finally { setBusy(false); }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.6)', zIndex: 310, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label={L('Khoản định kỳ', 'Recurring cost')} style={{ ...ui.card, width: 'min(520px, 96vw)', maxHeight: '92vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <b style={{ fontSize: 16, color: 'var(--ce2e8f0)' }}>{rec ? L('Sửa khoản định kỳ', 'Edit recurring cost') : L('Khoản định kỳ mới', 'New recurring cost')}</b>
        <label style={lbl}>{L('Tên', 'Name')}<input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={L('Thuê mặt bằng', 'Rent')} style={ui.input} /></label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <label style={lbl}>{L('Loại chi', 'Category')}<select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} style={ui.input}>{outCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label style={lbl}>{L('Trả từ quỹ', 'Paid from')}<select value={fundId} onChange={(e) => setFundId(e.target.value)} style={ui.input}>{funds.filter((f) => !f.archived).map((f) => <option key={f.id} value={f.id}>{fundLabel(f, L)}</option>)}</select></label>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ce2e8f0)' }}>
          <input type="checkbox" checked={varies} onChange={(e) => { setVaries(e.target.checked); if (e.target.checked) setMode('REMIND'); }} /> {L('Số tiền thay đổi mỗi kỳ (điện, nước…)', 'Amount changes each time (power, water…)')}
        </label>
        {!varies && <label style={lbl}>{L('Số tiền', 'Amount')}<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} style={ui.input} /></label>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          {!rec && <label style={lbl}>{L('Lặp', 'Repeats')}<select value={cadence} onChange={(e) => setCadence(e.target.value as Recurring['cadence'])} style={ui.input}><option value="MONTHLY">{L('Hằng tháng', 'Monthly')}</option><option value="WEEKLY">{L('Hằng tuần', 'Weekly')}</option><option value="YEARLY">{L('Hằng năm', 'Yearly')}</option></select></label>}
          {!rec && <label style={lbl}>{L('Đến hạn lần đầu', 'First due')}<input type="date" value={anchorDay} onChange={(e) => setAnchorDay(e.target.value)} style={ui.input} /></label>}
          {rec && <label style={lbl}>{L('Lần tới', 'Next due')}<input type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} style={ui.input} /></label>}
        </div>
        <label style={lbl}>{L('Người nhận', 'Paid to')}<input value={payee} onChange={(e) => setPayee(e.target.value)} maxLength={120} style={ui.input} /></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {(['REMIND', 'AUTO'] as const).map((m) => (
            <button key={m} type="button" disabled={m === 'AUTO' && varies} onClick={() => setMode(m)}
              style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 12, cursor: m === 'AUTO' && varies ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: m === 'AUTO' && varies ? 0.4 : 1, border: mode === m ? '2px solid #6366f1' : '1px solid var(--c475569)', background: mode === m ? 'rgba(99,102,241,.14)' : 'transparent', color: 'var(--ce2e8f0)' }}>
              <b style={{ display: 'block', fontSize: 13.5 }}>{m === 'AUTO' ? L('Tự lập phiếu', 'Records itself') : L('Nhắc tôi', 'Remind me')}</b>
              <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{m === 'AUTO' ? L('Trả tự động, số tiền cố định', 'Paid automatically, fixed amount') : L('Hiện khi đến hạn, bấm Đã trả', 'Shows when due, press Paid')}</span>
            </button>
          ))}
        </div>
        {err && <div style={ui.banner}>{err}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onClose} style={{ ...ghostSm, height: 42 }}>{L('Huỷ', 'Cancel')}</button>
          <button type="button" disabled={!ok || busy} onClick={() => void save()} style={{ ...ui.primaryBtn, flex: 1, height: 42, opacity: ok ? 1 : 0.5 }}>{L('Lưu', 'Save')}</button>
        </div>
      </div>
    </div>
  );
}

function Categories({ fx, onError }: { fx: FinanceCtx; onError: (e: string | null) => void }) {
  const { token, L, currency, categories } = fx;
  const [adding, setAdding] = useState<{ direction: 'IN' | 'OUT'; group: CatGroup; name: string } | null>(null);
  const save = async (fn: () => Promise<unknown>) => { onError(null); try { await fn(); fx.refresh(); } catch (e) { onError(cleanErr(e)); } };
  const groups: { dir: 'IN' | 'OUT'; g: CatGroup }[] = [
    { dir: 'IN', g: 'INCOME' }, { dir: 'IN', g: 'NON_PL' },
    { dir: 'OUT', g: 'COGS' }, { dir: 'OUT', g: 'STAFF' }, { dir: 'OUT', g: 'OPS' }, { dir: 'OUT', g: 'MARKETING' }, { dir: 'OUT', g: 'OTHER' }, { dir: 'OUT', g: 'NON_PL' },
  ];
  const budget = (c: Category) => {
    const v = window.prompt(L(`Ngân sách mỗi tháng cho "${c.name}" (để trống = không đặt)`, `Monthly budget for "${c.name}" (empty = none)`), c.budgetCents ? fromMinorUnits(c.budgetCents, currency) : '');
    if (v === null) return;
    const cents = v.trim() ? toMinorUnits(v, currency) : null;
    void save(() => apiFetch(`/finance/categories/${c.id}`, { method: 'PATCH', token, body: { budgetCents: cents && cents > 0 ? cents : null } }));
  };
  const rename = (c: Category) => {
    const v = window.prompt(L('Tên mới', 'New name'), c.name);
    if (v && v.trim() && v.trim() !== c.name) void save(() => apiFetch(`/finance/categories/${c.id}`, { method: 'PATCH', token, body: { name: v.trim() } }));
  };
  return (
    <div style={{ ...ui.card, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <b style={{ flex: 1, fontSize: 15, color: 'var(--ce2e8f0)' }}>{L('Loại thu chi', 'Income & expense categories')}</b>
        <button type="button" onClick={() => setAdding({ direction: 'OUT', group: 'OPS', name: '' })} style={{ ...ui.primaryBtn, height: 36 }}>+ {L('Thêm loại', 'Add category')}</button>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{L('Loại có 🔒 do hệ thống tự ghi: không đổi tên. Nhóm "Ngoài lãi lỗ" chỉ có trong sổ quỹ.', '🔒 categories are written by the system and keep their name. "Not on P&L" ones live in the cash book only.')}</div>
      {adding && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', padding: 10, borderRadius: 10, border: '1px dashed var(--c475569)' }}>
          <label style={lbl}>{L('Chiều', 'Direction')}<select value={adding.direction} onChange={(e) => setAdding({ ...adding, direction: e.target.value as 'IN' | 'OUT', group: e.target.value === 'IN' ? 'INCOME' : 'OPS' })} style={{ ...ui.input, width: 'auto' }}><option value="OUT">{L('Chi', 'Out')}</option><option value="IN">{L('Thu', 'In')}</option></select></label>
          <label style={lbl}>{L('Nhóm', 'Group')}<select value={adding.group} onChange={(e) => setAdding({ ...adding, group: e.target.value as CatGroup })} style={{ ...ui.input, width: 'auto' }}>{groups.filter((x) => x.dir === adding.direction && x.g !== 'STAFF').map((x) => <option key={x.g} value={x.g}>{groupLabel(x.g, L)}</option>)}</select></label>
          <label style={{ ...lbl, flex: '1 1 180px' }}>{L('Tên', 'Name')}<input value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} maxLength={60} style={ui.input} /></label>
          <button type="button" disabled={!adding.name.trim()} onClick={() => { const a = adding; void save(() => apiFetch('/finance/categories', { method: 'POST', token, body: { direction: a.direction, group: a.group, name: a.name.trim() } })).then(() => setAdding(null)); }} style={{ ...ui.primaryBtn, height: 40 }}>{L('Thêm', 'Add')}</button>
          <button type="button" onClick={() => setAdding(null)} style={{ ...ghostSm, height: 40 }}>{L('Huỷ', 'Cancel')}</button>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 12 }}>
        {groups.map(({ dir, g }) => {
          const list = categories.filter((c) => c.direction === dir && c.group === g);
          if (!list.length) return null;
          return (
            <div key={`${dir}${g}`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', color: dir === 'IN' ? 'var(--ink-good)' : 'var(--ink-warn)' }}>{dir === 'IN' ? L('THU', 'IN') : L('CHI', 'OUT')} · {groupLabel(g, L).toUpperCase()}</span>
              {list.map((c) => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0', borderBottom: '1px solid var(--line)', fontSize: 13, color: c.hidden ? 'var(--c94a3b8)' : 'var(--ce2e8f0)' }}>
                  <span style={{ flex: 1, minWidth: 0, textDecoration: c.hidden ? 'line-through' : 'none' }}>{c.name}{c.system ? ' 🔒' : ''}{c.budgetCents ? <span style={{ fontSize: 11.5, color: 'var(--c94a3b8)' }}> · {L('ngân sách', 'budget')} {formatPrice(c.budgetCents, currency)}</span> : null}</span>
                  {dir === 'OUT' && g !== 'NON_PL' && <button type="button" onClick={() => budget(c)} style={tiny}>{L('Ngân sách', 'Budget')}</button>}
                  {!c.system && <button type="button" onClick={() => rename(c)} style={tiny}>{L('Đổi tên', 'Rename')}</button>}
                  {!c.system && <button type="button" onClick={() => void save(() => apiFetch(`/finance/categories/${c.id}`, { method: 'PATCH', token, body: { hidden: !c.hidden } }))} style={tiny}>{c.hidden ? L('Hiện', 'Show') : L('Ẩn', 'Hide')}</button>}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const tiny: CSSProperties = { background: 'none', border: '1px solid var(--c334155)', borderRadius: 7, padding: '3px 8px', color: 'var(--ink-link)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' };

function Funds({ fx, onError }: { fx: FinanceCtx; onError: (e: string | null) => void }) {
  const { token, L, currency, funds, isOwner, today } = fx;
  const [edit, setEdit] = useState<{ id?: string; kind: 'BANK' | 'OTHER' | 'CASH'; name: string; last4: string; opening: string; openingDate: string; isDefault: boolean } | null>(null);
  const save = async (fn: () => Promise<unknown>) => { onError(null); try { await fn(); fx.refresh(); setEdit(null); } catch (e) { onError(cleanErr(e)); } };
  const start = (f?: Fund) => setEdit(f
    ? { id: f.id, kind: f.kind, name: f.name, last4: f.last4 ?? '', opening: fromMinorUnits(f.openingCents, currency), openingDate: f.openingDate, isDefault: f.isDefault }
    : { kind: 'BANK', name: '', last4: '', opening: '0', openingDate: today, isDefault: false });
  return (
    <div style={{ ...ui.card, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <b style={{ flex: 1, fontSize: 15, color: 'var(--ce2e8f0)' }}>{L('Quỹ & số dư đầu', 'Funds & opening balances')}</b>
        {isOwner && <button type="button" onClick={() => start()} style={{ ...ui.primaryBtn, height: 36 }}>+ {L('Thêm quỹ', 'Add fund')}</button>}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.55 }}>
        {L('Sổ của mỗi quỹ bắt đầu từ "ngày bắt đầu sổ" với số dư đầu bạn nhập (đếm tiền két, xem sao kê ngân hàng ngày đó). Tiền bán bằng thẻ / chuyển khoản / online vào quỹ ngân hàng mặc định.', 'Each fund\'s book starts on its start day with the opening balance you enter (count the drawer, read the bank statement that day). Card, transfer and online sales land in the default bank fund.')}
      </div>
      {funds.map((f) => (
        <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--line)', fontSize: 13, color: f.archived ? 'var(--c94a3b8)' : 'var(--ce2e8f0)', flexWrap: 'wrap' }}>
          <span style={{ flex: '1 1 180px' }}><b>{fundLabel(f, L)}</b>{f.isDefault ? <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--ink-link)', fontWeight: 700 }}>{L('nhận tiền thẻ', 'gets card sales')}</span> : null}{f.archived ? ` · ${L('đã đóng', 'closed')}` : ''}</span>
          <span style={{ color: 'var(--c94a3b8)' }}>{L('Bắt đầu', 'Starts')} {f.openingDate} · {L('đầu', 'opening')} {formatPrice(f.openingCents, currency)}</span>
          <b>{formatPrice(f.balanceCents, currency)}</b>
          {isOwner && <button type="button" onClick={() => start(f)} style={tiny}>{L('Sửa', 'Edit')}</button>}
          {isOwner && f.kind !== 'CASH' && !f.isDefault && <button type="button" onClick={() => void save(() => apiFetch(`/finance/funds/${f.id}`, { method: 'PATCH', token, body: { archived: !f.archived } }))} style={tiny}>{f.archived ? L('Mở lại', 'Reopen') : L('Đóng quỹ', 'Close')}</button>}
        </div>
      ))}
      {edit && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, padding: 12, borderRadius: 10, border: '1px dashed var(--c475569)' }}>
          {!edit.id && <label style={lbl}>{L('Loại', 'Kind')}<select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as 'BANK' | 'OTHER' })} style={ui.input}><option value="BANK">{L('Ngân hàng', 'Bank')}</option><option value="OTHER">{L('Khác (ví…)', 'Other (wallet…)')}</option></select></label>}
          <label style={lbl}>{L('Tên', 'Name')}<input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={60} style={ui.input} /></label>
          {edit.kind !== 'CASH' && <label style={lbl}>{L('4 số cuối TK', 'Last 4')}<input value={edit.last4} onChange={(e) => setEdit({ ...edit, last4: e.target.value.replace(/\D/g, '').slice(0, 4) })} style={ui.input} /></label>}
          <label style={lbl}>{L('Số dư đầu', 'Opening balance')}<input inputMode="decimal" value={edit.opening} onChange={(e) => setEdit({ ...edit, opening: e.target.value })} style={ui.input} /></label>
          <label style={lbl}>{L('Ngày bắt đầu sổ', 'Book starts on')}<input type="date" value={edit.openingDate} max={today} onChange={(e) => setEdit({ ...edit, openingDate: e.target.value })} style={ui.input} /></label>
          {edit.kind === 'BANK' && <label style={{ ...lbl, flexDirection: 'row', alignItems: 'center' }}><input type="checkbox" checked={edit.isDefault} onChange={(e) => setEdit({ ...edit, isDefault: e.target.checked })} /> {L('Nhận tiền thẻ / online', 'Gets card / online sales')}</label>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <button type="button" onClick={() => setEdit(null)} style={{ ...ghostSm, height: 40 }}>{L('Huỷ', 'Cancel')}</button>
            <button type="button" disabled={!edit.name.trim()} onClick={() => {
              const body = { name: edit.name.trim(), last4: edit.last4 || null, openingCents: toMinorUnits(edit.opening || '0', currency), openingDate: edit.openingDate, ...(edit.kind === 'BANK' && edit.isDefault ? { isDefault: true } : {}) };
              void save(() => edit.id ? apiFetch(`/finance/funds/${edit.id}`, { method: 'PATCH', token, body }) : apiFetch('/finance/funds', { method: 'POST', token, body: { ...body, kind: edit.kind } }));
            }} style={{ ...ui.primaryBtn, height: 40 }}>{L('Lưu', 'Save')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Limits({ fx, onError }: { fx: FinanceCtx; onError: (e: string | null) => void }) {
  const { token, L, currency, approvalOverCents } = fx;
  const [v, setV] = useState(fromMinorUnits(approvalOverCents, currency));
  useEffect(() => { setV(fromMinorUnits(approvalOverCents, currency)); }, [approvalOverCents, currency]);
  return (
    <div style={{ ...ui.card, padding: 16, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <label style={{ ...lbl, flex: '1 1 260px' }}>
        {L('Khoản chi trên mức này cần PIN duyệt của chủ / quản lý (người không có quyền hoàn & huỷ bill)', 'Money out above this needs an owner / manager PIN (for people who may not refund or void)')}
        <input inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} style={{ ...ui.input, maxWidth: 200 }} />
      </label>
      <button type="button" onClick={() => { onError(null); apiFetch('/finance/settings', { method: 'PATCH', token, body: { approvalOverCents: toMinorUnits(v || '0', currency) } }).then(() => fx.refresh()).catch((e) => onError(cleanErr(e))); }} style={{ ...ui.primaryBtn, height: 40 }}>{L('Lưu', 'Save')}</button>
    </div>
  );
}
