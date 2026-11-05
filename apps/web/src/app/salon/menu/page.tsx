'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui, formatPrice, toMinorUnits, fromMinorUnits, priceInputStep } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';
import { MenuImport, TemplateLinks, downloadMenuTemplate } from '../../../components/MenuTableImport';
import { compressImageToFit } from '../../../lib/image';
import { useBulkSelect, BulkBar, BulkAllBox, BulkRowBox, runBulkDelete } from '../../../components/BulkDelete';
import { MenuOptionsEditor, type OptionGroupDraft } from '../../../components/MenuOptionsEditor';
import { currencySymbolFor } from '../../../lib/money';
import { useIsMobile } from '../../../lib/responsive';
import { foldText } from '../../../lib/menu-nav';

interface Item { id: string; name: string; category: string | null; priceCents: number; currency: string; description: string | null; imageUrl: string | null; isActive: boolean; sortOrder: number; options?: unknown[] }


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
  // Prices are in the restaurant's own currency (Settings), never a label
  // copied from the first dish: a đồng restaurant typing 85000 means 85.000 đ.
  const [pageCurrency, setPageCurrency] = useState('USD');
  // "Nhập thực đơn từ Excel": template, upload, check, import (MenuTableImport).
  const [showImport, setShowImport] = useState(false);
  const [optionsFor, setOptionsFor] = useState<Item | null>(null);
  const vi = lang === 'vi';
  const sym = currencySymbolFor(pageCurrency);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', category: '', price: '', description: '' });
  const [busy, setBusy] = useState(false);
  const [activeCat, setActiveCat] = useState<string>('');
  // Many categories: a side list on a wide screen, one dropdown on a phone, and a search over every dish.
  const narrow = useIsMobile(900);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [list, settings] = await Promise.all([
        apiFetch<Item[]>('/menu-items', { token }),
        apiFetch<{ booking?: { currency?: string } }>('/settings', { token }).catch(() => null),
      ]);
      setItems(list);
      setPageCurrency(settings?.booking?.currency || list[0]?.currency || 'USD');
    }
    catch (e) { setErr(e instanceof Error ? e.message : (vi ? 'Không tải được thực đơn' : 'Failed to load')); }
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
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : (vi ? 'Không lưu được' : 'Failed')); }
    finally { setBusy(false); }
  }
  async function patch(id: string, data: Record<string, unknown>) {
    try { await apiFetch(`/menu-items/${id}`, { method: 'PATCH', token, body: data }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : (vi ? 'Không lưu được' : 'Failed')); }
  }
  async function remove(id: string) {
    try { await apiFetch(`/menu-items/${id}`, { method: 'DELETE', token }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : (vi ? 'Không lưu được' : 'Failed')); }
  }
  async function clearAll() {
    const n = items.length;
    const ok = window.confirm(lang === 'vi'
      ? `Xoá TẤT CẢ ${n} món trong menu của tiệm này? Không thể hoàn tác — dùng để dọn menu bị import nhầm rồi import lại file đúng.`
      : `Delete ALL ${n} menu items for this restaurant? This cannot be undone — use it to clear a wrong import, then import the correct file.`);
    if (!ok) return;
    setBusy(true); setErr(null);
    try { await apiFetch('/menu-items', { method: 'DELETE', token }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : (vi ? 'Không lưu được' : 'Failed')); }
    finally { setBusy(false); }
  }

  const grouped = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const it of items) { const k = it.category || '—'; const a = m.get(k) ?? []; a.push(it); m.set(k, a); }
    return Array.from(m.entries());
  }, [items]);
  const cats = useMemo(() => grouped.map(([c]) => c), [grouped]);
  useEffect(() => { if (cats.length && activeCat !== '__all' && !cats.includes(activeCat)) setActiveCat(cats[0]); }, [cats, activeCat]);
  const query = foldText(q);
  // Searching looks through the whole menu, whatever category is picked.
  const shownGroups = query
    ? grouped.map(([c, list]) => [c, list.filter((it) => foldText(`${it.name} ${it.description ?? ''}`).includes(query))] as [string, Item[]]).filter(([, list]) => list.length)
    : activeCat === '__all' ? grouped : grouped.filter(([c]) => c === activeCat);
  const showHeads = !!query || activeCat === '__all';
  const shownIds = shownGroups.flatMap(([, list]) => list.map((it) => it.id));
  const bulk = useBulkSelect(shownIds);
  const catRow = (on: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 8, border: 'none',
    background: on ? 'rgba(99,102,241,.16)' : 'transparent', color: on ? 'var(--ink-link)' : 'var(--ccbd5e1)', fontSize: 13.5, fontWeight: on ? 700 : 500, cursor: 'pointer',
  });
  const countPill = (n: number, on: boolean) => (
    <span style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 11.5, fontWeight: 700, padding: '1px 7px', borderRadius: 999, background: on ? '#6366f1' : 'var(--c1e293b)', color: on ? '#fff' : 'var(--c94a3b8)' }}>{n}</span>
  );
  const pickCat = (c: string) => { setActiveCat(c); setQ(''); };

  return (
    <section style={{ maxWidth: 1120 }}>
      <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>{t('mn.title')}</h1>
      <p style={{ color: 'var(--c94a3b8)', fontSize: 14, marginTop: 0 }}>{t('mn.subtitle')}</p>
      {err && <div style={ui.banner}>{err}</div>}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <button type="button" onClick={() => setShowImport((x) => !x)} aria-expanded={showImport}
          style={ui.primaryBtn}>
          ⇪ {lang === 'vi' ? 'Nhập thực đơn từ Excel' : 'Import menu from Excel'}
        </button>
        <TemplateLinks vi={vi} label={vi ? 'Tải file mẫu thực đơn' : 'Menu template'}
          onXlsx={() => downloadMenuTemplate(vi, pageCurrency, 'xlsx')} onCsv={() => downloadMenuTemplate(vi, pageCurrency, 'csv')} />
      </div>
      {showImport && token && (
        <MenuImport token={token} vi={lang === 'vi'} currency={pageCurrency} existing={items} onDone={() => { void load(); }} onClose={() => setShowImport(false)} />
      )}

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
        <label style={{ flex: '0 1 90px' }}><span style={ui.label}>{t('mn.price')} ({sym})</span>
          <input style={ui.input} type="number" min={0} step={priceInputStep(pageCurrency)} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder={pageCurrency === 'VND' ? '85000' : '14'} /></label>
        <label style={{ flex: '3 1 200px' }}><span style={ui.label}>{t('mn.desc')}</span>
          <input style={ui.input} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={vi ? 'Phở bò tái, nước dùng hầm xương' : 'Rare beef pho'} /></label>
        <button type="submit" disabled={busy} style={ui.primaryBtn}>{t('mn.add')}</button>
      </form>

      {items.length === 0 && <p style={{ color: 'var(--c64748b)', fontSize: 14, marginTop: 16 }}>{t('mn.empty')}</p>}

      {items.length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', margin: '18px 0 12px' }}>
          {narrow && grouped.length > 1 && (
            <select value={activeCat} onChange={(e) => pickCat(e.target.value)} aria-label={vi ? 'Danh mục' : 'Category'}
              style={{ ...ui.input, flex: '1 1 200px', fontWeight: 600 }}>
              <option value="__all">{vi ? 'Tất cả danh mục' : 'All categories'} ({items.length})</option>
              {grouped.map(([cat, list]) => <option key={cat} value={cat}>{cat} ({list.length})</option>)}
            </select>
          )}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={vi ? `🔍 Tìm trong ${items.length} món…` : `🔍 Search ${items.length} dishes…`}
            style={{ ...ui.input, flex: '1 1 220px', maxWidth: narrow ? undefined : 360 }} />
          {query && <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{shownGroups.reduce((n, [, l]) => n + l.length, 0)} {vi ? 'món khớp' : 'match'}</span>}
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      {!narrow && grouped.length > 1 && (
        <nav aria-label={vi ? 'Danh mục' : 'Categories'} style={{ width: 230, flexShrink: 0, position: 'sticky', top: 12, maxHeight: 'calc(100vh - 120px)', overflowY: 'auto', border: '1px solid var(--c334155)', borderRadius: 12, padding: 6, background: 'var(--c0f172a)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--c64748b)', padding: '6px 10px 4px' }}>{vi ? `Danh mục · ${grouped.length}` : `Categories · ${grouped.length}`}</div>
          <button type="button" onClick={() => pickCat('__all')} style={catRow(!query && activeCat === '__all')}>
            <span>{vi ? 'Tất cả' : 'All'}</span>{countPill(items.length, !query && activeCat === '__all')}
          </button>
          {grouped.map(([cat, list]) => {
            const on = !query && activeCat === cat;
            return (
              <button key={cat} type="button" onClick={() => pickCat(cat)} title={cat} style={catRow(on)}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat}</span>{countPill(list.length, on)}
              </button>
            );
          })}
        </nav>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
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
          {showHeads && <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--c818cf8)', textTransform: 'uppercase', letterSpacing: 0.4, margin: '14px 0 6px' }}>{cat} <span style={{ color: 'var(--ink-faint)' }}>· {list.length}</span></div>}
          {!showHeads && <div style={{ fontSize: 17, fontWeight: 700, margin: '4px 0 8px' }}>{cat} <span style={{ fontSize: 13, color: 'var(--c94a3b8)', fontWeight: 500 }}>· {list.length} {vi ? 'món' : 'dishes'}</span></div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {list.map((it) => (
              <div key={it.id} style={{ ...ui.card, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: 10, opacity: it.isActive ? 1 : 0.5, borderColor: bulk.has(it.id) ? '#4338ca' : undefined, background: bulk.has(it.id) ? 'var(--c1e1b4b)' : undefined }}>
                <BulkRowBox on={bulk.has(it.id)} onChange={() => bulk.toggle(it.id)} />
                <MenuThumb url={it.imageUrl} onSet={(d) => patch(it.id, { imageUrl: d })} onClear={() => patch(it.id, { imageUrl: '' })} />
                <input style={{ ...ui.input, flex: '2 1 150px', minWidth: 120 }} value={it.name}
                  onChange={(e) => setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, name: e.target.value } : x)))}
                  onBlur={(e) => patch(it.id, { name: e.target.value })} />
                <input style={{ ...ui.input, width: 170 }} value={it.category ?? ''} placeholder={t('mn.category')} list="mn-cats" title={it.category ?? ''}
                  onChange={(e) => setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, category: e.target.value } : x)))}
                  onBlur={(e) => patch(it.id, { category: e.target.value })} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  <span style={{ color: 'var(--c94a3b8)' }}>{sym}</span>
                  <input style={{ ...ui.input, width: pageCurrency === 'VND' ? 100 : 78 }} type="number" min={0} step={priceInputStep(pageCurrency)} value={fromMinorUnits(it.priceCents, pageCurrency)}
                    onChange={(e) => setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, priceCents: toMinorUnits(e.target.value, pageCurrency) } : x)))}
                    onBlur={(e) => patch(it.id, { priceCents: toMinorUnits(e.target.value, pageCurrency) })} />
                </div>
                <button type="button" onClick={() => setOptionsFor(it)} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ccbd5e1)', fontSize: 13, cursor: 'pointer' }}>
                  {vi ? 'Tuỳ chọn' : 'Options'}{(it.options?.length ?? 0) ? ` (${it.options!.length})` : ''}
                </button>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: 'var(--ccbd5e1)' }}>
                  <input type="checkbox" checked={it.isActive} onChange={(e) => patch(it.id, { isActive: e.target.checked })} />{t('mn.active')}
                </label>
                <button onClick={() => remove(it.id)} style={{ marginLeft: 'auto', background: 'none', border: '1px solid #ef4444', color: 'var(--ink-bad)', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 13 }}>{t('mn.delete')}</button>
              </div>
            ))}
          </div>
        </div>
      ))}
      {query && shownGroups.length === 0 && <p style={{ color: 'var(--c64748b)', fontSize: 14 }}>{vi ? 'Không có món nào khớp.' : 'No dish matches.'}</p>}
      </div>
      </div>
      {optionsFor && (
        <MenuOptionsEditor vi={vi} currency={pageCurrency} dishName={optionsFor.name} initial={(optionsFor.options ?? []) as OptionGroupDraft[]}
          onClose={() => setOptionsFor(null)}
          onSave={async (options) => { await patch(optionsFor.id, { options }); setOptionsFor(null); }} />
      )}
    </section>
  );
}
