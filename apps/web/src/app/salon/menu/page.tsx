'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui, formatPrice, toMinorUnits, fromMinorUnits, priceInputStep } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';
import { ImportCsv } from '../../../components/ImportCsv';
import { compressImageToFit } from '../../../lib/image';
import { useBulkSelect, BulkBar, BulkAllBox, BulkRowBox, runBulkDelete } from '../../../components/BulkDelete';

interface Item { id: string; name: string; category: string | null; priceCents: number; currency: string; description: string | null; imageUrl: string | null; isActive: boolean; sortOrder: number }

const SAMPLE_MENU = `name,category,price,description,image,sort
Crispy Egg Rolls,Appetizers,8,
Fresh Spring Rolls,Appetizers,7,
Green Papaya Salad,Appetizers,11,
Fish-Sauce Chicken Wings,Appetizers,12,
Sizzling Vietnamese Crepe,Appetizers,13,
Rare Beef Pho,Pho,14,
House Special Pho,Pho,16,
Chicken Pho,Pho,14,
Vegetarian Pho,Pho,13,
Spicy Hue Beef Noodle,Vermicelli,15,
Hanoi Grilled Pork Vermicelli,Vermicelli,15,
Grilled Pork Vermicelli Bowl,Vermicelli,14,
Crab and Tomato Noodle Soup,Vermicelli,15,
Broken Rice Combo Plate,Rice Plates,16,
Crispy Chicken over Rice,Rice Plates,15,
Yang Chow Fried Rice,Rice Plates,14,
Shaking Beef,Entrees,22,
Clay-Pot Caramel Fish,Entrees,20,
Tamarind Shrimp,Entrees,21,
Grilled Pork Chops,Entrees,19,
Ginger Braised Chicken,Entrees,18,
Garlic Water Spinach,Entrees,12,
Thai Hot Pot,Hot Pot,45,
Seafood Hot Pot,Hot Pot,55,
Beef Hot Pot,Hot Pot,50,
Three-Color Sweet Dessert,Dessert,6,
Vietnamese Flan,Dessert,5,
Coconut Jelly,Dessert,5,
Vietnamese Iced Coffee,Drinks,5,
Iced Tea,Drinks,2,
Sugarcane Juice,Drinks,5,
Avocado Smoothie,Drinks,6,
Saigon Beer,Drinks,6,`;

function MenuThumb({ url, onSet, onClear }: { url: string | null; onSet: (dataUrl: string) => void; onClear: () => void }) {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const has = !!url && (url.startsWith('http') || url.startsWith('data:') || url.startsWith('/'));
  async function pick(f?: File | null) {
    if (!f) return;
    setBusy(true);
    try { const d = await compressImageToFit(f, { maxSide: 800, square: true, quality: 0.82, maxChars: 130_000 }); onSet(d); }
    catch { /* ignore */ } finally { setBusy(false); }
  }
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button type="button" onClick={() => inputRef.current?.click()} title="Upload dish photo"
        style={{ width: 48, height: 48, borderRadius: 10, border: '1px solid var(--c334155)', color: 'var(--c64748b)', cursor: 'pointer', display: 'grid', placeItems: 'center', overflow: 'hidden', padding: 0, fontSize: 18,
          background: has ? `var(--c0f172a) center/cover no-repeat url(${url})` : 'var(--c0f172a)' }}>
        {!has && (busy ? '…' : '📷')}
      </button>
      {has && <button type="button" onClick={onClear} title="Remove photo" style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', border: 'none', background: '#ef4444', color: '#fff', fontSize: 11, cursor: 'pointer', lineHeight: 1 }}>×</button>}
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => pick(e.target.files?.[0])} />
    </div>
  );
}

export default function MenuPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [items, setItems] = useState<Item[]>([]);
  // The dishes carry their own currency; a new dish follows the ones already
  // on the menu. An empty menu falls back to USD, which is what it did before.
  const pageCurrency = items[0]?.currency ?? 'USD';
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', category: '', price: '', description: '' });
  const [busy, setBusy] = useState(false);
  const [activeCat, setActiveCat] = useState<string>('');

  const load = useCallback(async () => {
    if (!token) return;
    try { setItems(await apiFetch<Item[]>('/menu-items', { token })); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed to load'); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true); setErr(null);
    try {
      await apiFetch('/menu-items', {
        method: 'POST', token,
        body: {
          name: form.name.trim(),
          category: form.category.trim() || undefined,
          priceCents: toMinorUnits(form.price, pageCurrency),
          description: form.description.trim() || undefined,
        },
      });
      setForm({ name: '', category: '', price: '', description: '' });
      await load();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : 'Failed'); }
    finally { setBusy(false); }
  }
  async function patch(id: string, data: Record<string, unknown>) {
    try { await apiFetch(`/menu-items/${id}`, { method: 'PATCH', token, body: data }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }
  async function remove(id: string) {
    try { await apiFetch(`/menu-items/${id}`, { method: 'DELETE', token }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }
  async function clearAll() {
    const n = items.length;
    const ok = window.confirm(lang === 'vi'
      ? `Xoá TẤT CẢ ${n} món trong menu của tiệm này? Không thể hoàn tác — dùng để dọn menu bị import nhầm rồi import lại file đúng.`
      : `Delete ALL ${n} menu items for this restaurant? This cannot be undone — use it to clear a wrong import, then import the correct file.`);
    if (!ok) return;
    setBusy(true); setErr(null);
    try { await apiFetch('/menu-items', { method: 'DELETE', token }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  }

  const grouped = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const it of items) { const k = it.category || '—'; const a = m.get(k) ?? []; a.push(it); m.set(k, a); }
    return Array.from(m.entries());
  }, [items]);
  const cats = useMemo(() => grouped.map(([c]) => c), [grouped]);
  useEffect(() => { if (cats.length && activeCat !== '__all' && !cats.includes(activeCat)) setActiveCat(cats[0]); }, [cats, activeCat]);
  const shownGroups = activeCat === '__all' ? grouped : grouped.filter(([c]) => c === activeCat);
  const shownIds = shownGroups.flatMap(([, list]) => list.map((it) => it.id));
  const bulk = useBulkSelect(shownIds);
  const catTab = (on: boolean): React.CSSProperties => ({ padding: '7px 14px', borderRadius: 999, border: `1px solid ${on ? '#6366f1' : 'var(--c334155)'}`, background: on ? '#6366f1' : 'transparent', color: on ? '#fff' : 'var(--ccbd5e1)', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' });

  return (
    <section style={{ maxWidth: 820 }}>
      <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>{t('mn.title')}</h1>
      <p style={{ color: 'var(--c94a3b8)', fontSize: 14, marginTop: 0 }}>{t('mn.subtitle')}</p>
      {err && <div style={ui.banner}>{err}</div>}

      <ImportCsv token={token} endpoint="/menu-items" header="name,category,price,description,image,sort" sample={SAMPLE_MENU} existing={() => new Set(items.map((i) => i.name.toLowerCase()))} buildBody={(c) => { const price = parseFloat(c[2]); if (!c[0] || !c[0].trim() || !Number.isFinite(price)) return null; return { name: c[0].trim(), category: c[1] || undefined, priceCents: toMinorUnits(price, pageCurrency), description: c[3] || undefined, imageUrl: c[4] || undefined, sortOrder: c[5] ? parseInt(c[5], 10) : undefined }; }} onDone={load} />

      {items.length > 0 && (
        <div style={{ marginTop: -6, marginBottom: 12 }}>
          <button onClick={clearAll} disabled={busy} style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #ef4444', background: 'transparent', color: 'var(--cf87171)', fontSize: 13, cursor: 'pointer' }}>
            {lang === 'vi' ? `Xoá tất cả ${items.length} món` : `Delete all ${items.length} items`}
          </button>
          <span style={{ fontSize: 11.5, color: 'var(--c64748b)', marginLeft: 10 }}>{lang === 'vi' ? 'dùng khi import nhầm file' : 'use if you imported the wrong file'}</span>
        </div>
      )}

      <form onSubmit={add} style={{ ...ui.card, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ flex: '2 1 160px' }}><span style={ui.label}>{t('mn.name')}</span>
          <input style={ui.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Phở tái" /></label>
        <label style={{ flex: '1 1 120px' }}><span style={ui.label}>{t('mn.category')}</span>
          <input style={ui.input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Phở" list="mn-cats" />
          <datalist id="mn-cats">{Array.from(new Set(items.map((i) => i.category).filter(Boolean))).map((c) => <option key={c} value={c as string} />)}</datalist></label>
        <label style={{ flex: '0 1 90px' }}><span style={ui.label}>{t('mn.price')} ($)</span>
          <input style={ui.input} type="number" min={0} step={priceInputStep(pageCurrency)} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="14" /></label>
        <label style={{ flex: '3 1 200px' }}><span style={ui.label}>{t('mn.desc')}</span>
          <input style={ui.input} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Rare beef pho" /></label>
        <button type="submit" disabled={busy} style={ui.primaryBtn}>{t('mn.add')}</button>
      </form>

      {items.length === 0 && <p style={{ color: 'var(--c64748b)', fontSize: 14, marginTop: 16 }}>{t('mn.empty')}</p>}

      {items.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '18px 0 12px', overflowX: 'auto', paddingBottom: 2 }}>
          {grouped.map(([cat, list]) => (
            <button key={cat} onClick={() => setActiveCat(cat)} style={catTab(activeCat === cat)}>{cat} <span style={{ opacity: 0.6 }}>{list.length}</span></button>
          ))}
          {grouped.length > 1 && <button onClick={() => setActiveCat('__all')} style={catTab(activeCat === '__all')}>All <span style={{ opacity: 0.6 }}>{items.length}</span></button>}
        </div>
      )}

      {shownIds.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--c94a3b8)', cursor: 'pointer' }}>
            <BulkAllBox on={bulk.allOn} onChange={bulk.toggleAll} />
            {tr('bulk.selectAll', lang)}
          </label>
        </div>
      )}
      <BulkBar count={bulk.count} ids={bulk.sel} onClear={bulk.clear} onDelete={(ids) => runBulkDelete(ids, (id) => apiFetch(`/menu-items/${id}`, { method: 'DELETE', token }), load)} />

      {shownGroups.map(([cat, list]) => (
        <div key={cat} style={{ marginTop: 4 }}>
          {activeCat === '__all' && <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--c818cf8)', textTransform: 'uppercase', letterSpacing: 0.4, margin: '14px 0 6px' }}>{cat} <span style={{ color: 'var(--c475569)' }}>· {list.length}</span></div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {list.map((it) => (
              <div key={it.id} style={{ ...ui.card, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: 10, opacity: it.isActive ? 1 : 0.5, borderColor: bulk.has(it.id) ? '#4338ca' : undefined, background: bulk.has(it.id) ? 'var(--c1e1b4b)' : undefined }}>
                <BulkRowBox on={bulk.has(it.id)} onChange={() => bulk.toggle(it.id)} />
                <MenuThumb url={it.imageUrl} onSet={(d) => patch(it.id, { imageUrl: d })} onClear={() => patch(it.id, { imageUrl: '' })} />
                <input style={{ ...ui.input, flex: '2 1 150px', minWidth: 120 }} value={it.name}
                  onChange={(e) => setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, name: e.target.value } : x)))}
                  onBlur={(e) => patch(it.id, { name: e.target.value })} />
                <input style={{ ...ui.input, width: 120 }} value={it.category ?? ''} placeholder={t('mn.category')}
                  onChange={(e) => setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, category: e.target.value } : x)))}
                  onBlur={(e) => patch(it.id, { category: e.target.value })} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  <span style={{ color: 'var(--c94a3b8)' }}>$</span>
                  <input style={{ ...ui.input, width: 78 }} type="number" min={0} step={priceInputStep(it.currency)} value={fromMinorUnits(it.priceCents, it.currency)}
                    onChange={(e) => setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, priceCents: toMinorUnits(e.target.value, it.currency) } : x)))}
                    onBlur={(e) => patch(it.id, { priceCents: toMinorUnits(e.target.value, it.currency) })} />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: 'var(--ccbd5e1)' }}>
                  <input type="checkbox" checked={it.isActive} onChange={(e) => patch(it.id, { isActive: e.target.checked })} />{t('mn.active')}
                </label>
                <button onClick={() => remove(it.id)} style={{ marginLeft: 'auto', background: 'none', border: '1px solid #ef4444', color: '#ef4444', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 13 }}>{t('mn.delete')}</button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
