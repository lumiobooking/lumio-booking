'use client';
/**
 * Menu categories (Danh mục): create one before it has dishes, rename it (its
 * dishes and the kitchen routing follow), put them in order (the menu, the
 * till and the guest QR menu show them that way), or delete one (its dishes
 * stay, under "Khác"). 10/11/2026, Nẩu Chill.
 */
import { useState } from 'react';
import { apiFetch } from '../lib/api';
import { ui } from '../lib/ui';

export interface MenuCategory { name: string; dishes: number }
export interface MenuCategories { categories: MenuCategory[]; uncategorized: number }

const ERR: Record<string, [string, string]> = {
  CATEGORY_EXISTS: ['Đã có danh mục này rồi.', 'That category already exists.'],
  CATEGORY_NAME_REQUIRED: ['Nhập tên danh mục.', 'Type a category name.'],
};

export function MenuCategoryManager({ vi, token, data, onChanged, onClose }: {
  vi: boolean; token: string | null; data: MenuCategories; onChanged: (d: MenuCategories) => void; onClose: () => void;
}) {
  const L = (v: string, e: string) => (vi ? v : e);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const list = data.categories;

  async function run(path: string, body: unknown) {
    if (!token) return;
    setBusy(true); setErr(null);
    try { onChanged(await apiFetch<MenuCategories>(`/menu-items/categories${path}`, { method: 'POST', token, body })); return true; }
    catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      const k = Object.keys(ERR).find((x) => m.includes(x));
      setErr(k ? ERR[k][vi ? 0 : 1] : m);
      return false;
    } finally { setBusy(false); }
  }
  const add = async () => { const n = name.trim(); if (n && await run('', { name: n })) setName(''); };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const names = list.map((c) => c.name);
    [names[i], names[j]] = [names[j], names[i]];
    void run('/order', { names });
  };
  const rename = async (from: string) => {
    const to = draft.trim();
    if (!to || to === from) { setEditing(null); return; }
    if (await run('/rename', { from, to })) setEditing(null);
  };
  const remove = (c: MenuCategory) => {
    const ok = window.confirm(c.dishes
      ? L(`Xoá danh mục “${c.name}”? ${c.dishes} món trong đó vẫn giữ nguyên, chuyển sang “Khác”.`, `Delete “${c.name}”? Its ${c.dishes} dishes stay, under “Other”.`)
      : L(`Xoá danh mục “${c.name}”?`, `Delete “${c.name}”?`));
    if (ok) void run('/delete', { name: c.name });
  };
  const small: React.CSSProperties = { minWidth: 34, height: 34, borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ccbd5e1)', cursor: 'pointer', fontSize: 14 };

  return (
    <div style={{ ...ui.card, marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b style={{ fontSize: 15 }}>🗂 {L('Danh mục thực đơn', 'Menu categories')}</b>
        <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{L('Thứ tự ở đây = thứ tự trên menu, màn thu ngân và QR gọi món.', 'This order = the order on the menu, the till and the QR menu.')}</span>
        <button type="button" onClick={onClose} style={{ ...small, marginLeft: 'auto' }} aria-label={L('Đóng', 'Close')}>×</button>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void add(); }} style={{ display: 'flex', gap: 8 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={L('Tên danh mục mới, VD: Lẩu, Nướng, Đồ uống', 'New category, e.g. Hot pot, Grill, Drinks')}
          aria-label={L('Tên danh mục mới', 'New category name')} style={{ ...ui.input, flex: 1, marginBottom: 0 }} />
        <button type="submit" disabled={busy || !name.trim()} style={ui.primaryBtn}>+ {L('Tạo danh mục', 'Add category')}</button>
      </form>
      {err && <div style={{ color: 'var(--ink-bad)', fontSize: 13 }}>{err}</div>}
      {list.length === 0 && <div style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{L('Chưa có danh mục nào.', 'No categories yet.')}</div>}
      {list.map((c, i) => (
        <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 10, background: 'var(--c0f172a)', border: '1px solid var(--c1f2937)' }}>
          <span style={{ width: 22, textAlign: 'right', fontSize: 12, color: 'var(--c64748b)' }}>{i + 1}</span>
          {editing === c.name ? (
            <input autoFocus value={draft} maxLength={60} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void rename(c.name); if (e.key === 'Escape') setEditing(null); }}
              onBlur={() => void rename(c.name)} aria-label={L('Tên mới', 'New name')} style={{ ...ui.input, flex: 1, marginBottom: 0, padding: '6px 8px' }} />
          ) : (
            <span style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
          )}
          <span style={{ fontSize: 12, color: 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>{c.dishes} {L('món', 'dishes')}</span>
          <button type="button" disabled={busy || i === 0} onClick={() => move(i, -1)} style={{ ...small, opacity: i === 0 ? 0.35 : 1 }} aria-label={L('Lên', 'Up')}>↑</button>
          <button type="button" disabled={busy || i === list.length - 1} onClick={() => move(i, 1)} style={{ ...small, opacity: i === list.length - 1 ? 0.35 : 1 }} aria-label={L('Xuống', 'Down')}>↓</button>
          <button type="button" disabled={busy} onClick={() => { setEditing(c.name); setDraft(c.name); }} style={small} aria-label={L('Đổi tên', 'Rename')}>✎</button>
          <button type="button" disabled={busy} onClick={() => remove(c)} style={{ ...small, color: 'var(--cf87171)' }} aria-label={L('Xoá', 'Delete')}>🗑</button>
        </div>
      ))}
      {data.uncategorized > 0 && (
        <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{L(`${data.uncategorized} món chưa có danh mục (hiện ở “Khác”) — chọn danh mục cho món ở danh sách bên dưới.`, `${data.uncategorized} dishes have no category (shown under “Other”) — set one in the list below.`)}</div>
      )}
    </div>
  );
}
