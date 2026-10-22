'use client';

/**
 * The owner's option groups for one dish: "Cỡ tô (bắt buộc, chọn 1): Thường /
 * Lớn +15.000", "Thêm (tối đa 3): Trứng +10.000, Quẩy +5.000". The till shows
 * them when the dish is tapped, prices them in, and prints them on the
 * kitchen ticket. The server cleans whatever is saved (restaurant/check-logic).
 */

import { useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { fromMinorUnits, toMinorUnits, ui } from '../lib/ui';

export interface OptionChoiceDraft { id?: string; name: string; priceCents: number }
export interface OptionGroupDraft { id?: string; name: string; required: boolean; max: number; choices: OptionChoiceDraft[] }

const inp: CSSProperties = { ...ui.input, minHeight: 40 };
const ghost: CSSProperties = { padding: '7px 12px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ccbd5e1)', fontSize: 13, cursor: 'pointer' };
const rid = () => Math.random().toString(36).slice(2, 10);

export function MenuOptionsEditor({ vi, currency, dishName, initial, onClose, onSave }: {
  vi: boolean; currency: string; dishName: string; initial: OptionGroupDraft[]; onClose: () => void; onSave: (groups: OptionGroupDraft[]) => void | Promise<void>;
}) {
  const L = (v: string, e: string) => (vi ? v : e);
  const [groups, setGroups] = useState<(OptionGroupDraft & { prices: string[] })[]>(() => (Array.isArray(initial) ? initial : []).map((g) => ({
    ...g, id: g.id || rid(), choices: g.choices.map((c) => ({ ...c, id: c.id || rid() })), prices: g.choices.map((c) => (c.priceCents ? fromMinorUnits(c.priceCents, currency) : '')),
  })));
  const [busy, setBusy] = useState(false);
  const setG = (i: number, p: Partial<OptionGroupDraft & { prices: string[] }>) => setGroups((gs) => gs.map((g, j) => (j === i ? { ...g, ...p } : g)));

  function addGroup(required: boolean) {
    setGroups((gs) => [...gs, { id: rid(), name: required ? L('Cỡ', 'Size') : L('Thêm', 'Extras'), required, max: required ? 1 : 3, choices: [{ id: rid(), name: '', priceCents: 0 }], prices: [''] }]);
  }
  async function save() {
    setBusy(true);
    try {
      await onSave(groups.map((g) => ({
        id: g.id, name: g.name.trim(), required: g.required, max: Math.max(1, Math.round(g.max) || 1),
        choices: g.choices.map((c, k) => ({ id: c.id, name: c.name.trim(), priceCents: g.prices[k] ? toMinorUnits(g.prices[k], currency) : 0 })).filter((c) => c.name),
      })).filter((g) => g.name && g.choices.length));
    } finally { setBusy(false); }
  }

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.6)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div role="dialog" aria-label={L('Tuỳ chọn món', 'Dish options')} onClick={(e) => e.stopPropagation()} style={{ ...ui.card, width: 'min(620px, 96vw)', maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <b style={{ flex: 1, fontSize: 17, color: 'var(--ce2e8f0)' }}>{L('Tuỳ chọn', 'Options')} · {dishName}</b>
          <button type="button" aria-label={L('Đóng', 'Close')} onClick={onClose} style={{ ...ghost, fontSize: 16 }}>×</button>
        </div>
        <div style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{L('Ví dụ: “Cỡ tô” bắt buộc chọn 1 (Thường / Lớn +15.000), “Thêm” tối đa 3 (Trứng +10.000). Khi gọi món, máy sẽ hỏi các tuỳ chọn này và in lên phiếu bếp.', 'E.g. “Size”, required, pick 1 (Regular / Large +$2), “Extras”, up to 3 (Egg +$1). The till asks for these when the dish is ordered and prints them on the kitchen ticket.')}</div>
        {groups.map((g, i) => (
          <div key={g.id} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <input value={g.name} onChange={(e) => setG(i, { name: e.target.value })} placeholder={L('Tên nhóm (VD: Cỡ tô)', 'Group name (e.g. Size)')} aria-label={L('Tên nhóm', 'Group name')} style={{ ...inp, flex: '2 1 160px' }} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ccbd5e1)' }}>
                <input type="checkbox" checked={g.required} onChange={(e) => setG(i, { required: e.target.checked })} />{L('Bắt buộc', 'Required')}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ccbd5e1)' }}>
                {L('Chọn tối đa', 'Up to')}
                <input type="number" min={1} max={20} value={g.max} onChange={(e) => setG(i, { max: Number(e.target.value) })} style={{ ...inp, width: 64 }} />
              </label>
              <button type="button" onClick={() => setGroups((gs) => gs.filter((_, j) => j !== i))} style={{ ...ghost, color: 'var(--ink-bad)' }}>{L('Xoá nhóm', 'Remove group')}</button>
            </div>
            {g.choices.map((c, k) => (
              <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input value={c.name} onChange={(e) => setG(i, { choices: g.choices.map((x, m) => (m === k ? { ...x, name: e.target.value } : x)) })} placeholder={L('Lựa chọn (VD: Tô lớn)', 'Choice (e.g. Large)')} aria-label={L('Lựa chọn', 'Choice')} style={{ ...inp, flex: 2 }} />
                <input inputMode="decimal" value={g.prices[k] ?? ''} onChange={(e) => setG(i, { prices: g.prices.map((x, m) => (m === k ? e.target.value : x)).concat(k >= g.prices.length ? [e.target.value] : []) })} placeholder={L('+ giá (để trống = 0)', '+ price (blank = 0)')} aria-label={L('Giá thêm', 'Extra price')} style={{ ...inp, flex: 1 }} />
                <button type="button" aria-label={L('Xoá lựa chọn', 'Remove choice')} onClick={() => setG(i, { choices: g.choices.filter((_, m) => m !== k), prices: g.prices.filter((_, m) => m !== k) })} style={ghost}>×</button>
              </div>
            ))}
            <button type="button" onClick={() => setG(i, { choices: [...g.choices, { id: rid(), name: '', priceCents: 0 }], prices: [...g.prices, ''] })} style={{ ...ghost, alignSelf: 'flex-start' }}>+ {L('Thêm lựa chọn', 'Add a choice')}</button>
          </div>
        ))}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button type="button" onClick={() => addGroup(true)} style={ghost}>+ {L('Nhóm bắt buộc (chọn 1)', 'Required group (pick 1)')}</button>
          <button type="button" onClick={() => addGroup(false)} style={ghost}>+ {L('Nhóm thêm (tuỳ chọn)', 'Optional extras')}</button>
        </div>
        <button type="button" disabled={busy} onClick={() => void save()} style={{ ...ui.primaryBtn, padding: '12px 14px' }}>{busy ? L('Đang lưu…', 'Saving…') : L('Lưu tuỳ chọn', 'Save options')}</button>
      </div>
    </div>, document.body);
}
