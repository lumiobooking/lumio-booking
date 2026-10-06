'use client';

import { useCallback, useEffect, useRef, useState, FormEvent } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { compressImageToFit } from '../../../lib/image';
import { ui, toMinorUnits, fromMinorUnits, priceInputStep } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';
import { useIsMobile, CARD_LIST_MAX } from '../../../lib/responsive';
import { useRowDrag } from '../../../lib/useRowDrag';
import { MList, MCard, MHead, MRow, MActions } from '../../../components/MobileCard';
import { EditDialog } from '../../../components/EditDialog';
import { ServiceImport } from '../../../components/ServiceImport';
import { SearchBox, matchesQuery } from '../../../components/ListFilter';
import { useBulkSelect, BulkBar, BulkAllBox, BulkRowBox, runBulkDelete } from '../../../components/BulkDelete';
import { ind } from '../../../lib/ui-industry';

interface Service {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceCents: number;
  discountPercent?: number;
  currency: string;
  isActive: boolean;
  createdAt?: string;
  categoryId?: string | null;
  isFeatured?: boolean;
  priceFrom?: boolean;
  imageUrl?: string | null;
  sortOrder?: number;
  turnValue?: number;
  staffServices?: { staffMemberId: string }[];
}

interface Category { id: string; name: string; icon: string | null; sortOrder: number; isActive: boolean }
interface Staff { id: string; firstName: string; lastName: string | null; isActive: boolean }

const CURRENCY_SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', CAD: '$', AUD: '$', VND: '₫', JPY: '¥', SGD: '$' };

export default function ServicesPage() {
  return (
    <SalonShell>
      <ServicesInner />
    </SalonShell>
  );
}

function ServicesInner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const isMobile = useIsMobile();
  // Cards up to tablet width — an iPad gets every field, not a squeezed table.
  const cardList = useIsMobile(CARD_LIST_MAX);
  const [q, setQ] = useState('');
  // Arrived from the header search (?q=…): start with that search filled in.
  useEffect(() => { const v = new URLSearchParams(window.location.search).get('q'); if (v) setQ(v); }, []);
  const [services, setServices] = useState<Service[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  // "+ Tạo mới → Dịch vụ mới" from the header lands here with the form open.
  useEffect(() => { if (new URLSearchParams(window.location.search).get('new') === '1') setShowForm(true); }, []);
  const [showImport, setShowImport] = useState(false);
  const [filling, setFilling] = useState(false);
  const [catFilter, setCatFilter] = useState<string>('all');
  // The page has three jobs — the menu, the promotions on it, its categories —
  // and showing all of them stacked pushed the menu (the thing searched every
  // day) below five panels. One tab each; the menu is the default.
  const [tab, setTabState] = useState<PageTab>('services');
  const [promos, setPromos] = useState<PromoSummary>({});
  const [promoSel, setPromoSel] = useState<PromoKey | null>(null);
  // Currency is a salon-level setting (Settings -> Payments). The whole Services
  // screen formats prices with it, so changing the currency there is reflected here.
  const [money, setMoney] = useState({ code: 'USD', symbol: '$', pos: 'before', decimals: 2 });

  // Deep link: /salon/services?tab=promos | categories
  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get('tab');
    if (want === 'promos' || want === 'categories') setTabState(want);
  }, []);
  const setTab = (next: PageTab) => {
    setTabState(next);
    try {
      const u = new URL(window.location.href);
      if (next === 'services') u.searchParams.delete('tab'); else u.searchParams.set('tab', next);
      window.history.replaceState(window.history.state, '', u.toString());
    } catch { /* the tab still switches */ }
  };
  const promosFrom = (st: SettingsPromos | null | undefined): PromoSummary => ({
    weekday: st?.weekdayDiscounts, firstVisit: st?.firstVisitDiscount, group: st?.groupDiscount, date: st?.dateDiscounts,
  });
  const refreshPromos = useCallback(async () => {
    if (!token) return;
    const st = await apiFetch<SettingsPromos>('/settings', { token }).catch(() => null);
    if (st) setPromos(promosFrom(st));
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [svc, cats, staffList, settings] = await Promise.all([
        apiFetch<Service[]>('/services', { token }),
        apiFetch<Category[]>('/services/categories', { token }),
        apiFetch<Staff[]>('/staff', { token }).catch(() => [] as Staff[]),
        apiFetch<{ booking?: { currency?: string; currencySymbol?: string; symbolPosition?: string; priceDecimals?: number } } & SettingsPromos>('/settings', { token }).catch(() => ({})),
      ]);
      setPromos(promosFrom(settings as SettingsPromos));
      setStaff(staffList);
      const b = (settings as { booking?: { currency?: string; currencySymbol?: string; symbolPosition?: string; priceDecimals?: number } }).booking ?? {};
      const code = b.currency ?? 'USD';
      setMoney({
        code,
        symbol: b.currencySymbol || CURRENCY_SYMBOLS[code] || '$',
        pos: b.symbolPosition ?? 'before',
        decimals: typeof b.priceDecimals === 'number' ? b.priceDecimals : 2,
      });
      // Show every service in the salon's current currency (a service's own
      // stored currency may be older), so the menu always matches Settings.
      setServices(svc.map((s) => ({ ...s, currency: code })));
      setCategories(cats);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load services');
    } finally {
      setLoading(false);
    }
  }, [token]);

  const fmt = useCallback((cents: number) => {
    // A currency with no subunit is stored whole; dividing shows a hundredth.
    const v = money.decimals === 0 ? String(Math.round(cents)) : (cents / 100).toFixed(money.decimals);
    return money.pos === 'after' ? `${v}${money.symbol}` : `${money.symbol}${v}`;
  }, [money]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleActive(s: Service) {
    try {
      await apiFetch(`/services/${s.id}`, {
        method: 'PATCH',
        token,
        body: { isActive: !s.isActive },
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  }

  async function remove(id: string) {
    if (!confirm(t('sv.confirmDelete'))) return;
    try {
      await apiFetch(`/services/${id}`, { method: 'DELETE', token });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  const catName = (id?: string | null) => categories.find((c) => c.id === id)?.name ?? '—';

  // Search + category filter, in the order the CUSTOMER sees.
  //
  // This list used to be re-sorted newest-first in the browser, which quietly
  // undid the order the API had already applied — so the owner arranged the
  // menu and then looked at a screen that disagreed with the booking page.
  // The server returns [sortOrder asc, createdAt desc]; leaving it alone is
  // what makes "Thứ tự hiển thị" mean anything.
  const visible = services.filter((s) =>
    matchesQuery(`${s.name} ${s.description ?? ''}`, q) &&
    (catFilter === 'all' || (catFilter === 'none' ? !s.categoryId : s.categoryId === catFilter)));
  // No pagination on this table.
  //
  // It is a menu, and a menu is a thing you arrange. Slicing it into pages of
  // twenty-five meant the row on page 3 could never be dragged to position 1 —
  // and "tu do sap xep vi tri" is exactly that move. Search and the category
  // chips already narrow the list; sixty-six rows of text is an ordinary admin
  // table, not a performance problem.
  const drag = useRowDrag(visible, async (ids) => {
    await apiFetch('/services/reorder', { method: 'PATCH', token, body: { ids } });
    await load();
  });
  const rows = drag.order;
  const bulk = useBulkSelect(rows.map((r) => r.id));

  async function fillImages(overwrite: boolean) {
    const ask = overwrite
      ? (lang === 'vi' ? 'Thay TẤT CẢ ảnh dịch vụ bằng ảnh mẫu (kể cả dịch vụ đã có ảnh)?' : 'Replace ALL service photos with fresh sample images?')
      : (lang === 'vi' ? 'Điền ảnh mẫu cho các dịch vụ CHƯA có ảnh? (dịch vụ đã có ảnh giữ nguyên)' : 'Fill sample photos for services WITHOUT an image? (existing photos are kept)');
    if (!window.confirm(ask)) return;
    setFilling(true); setError(null);
    try {
      const r = await apiFetch<{ updated: number; skipped: number }>('/services/fill-sample-images', { method: 'POST', token, body: { overwrite } });
      await load();
      window.alert(lang === 'vi' ? `✓ Đã thêm ảnh cho ${r.updated} dịch vụ (giữ nguyên ${r.skipped}).` : `✓ Added photos to ${r.updated} services (kept ${r.skipped}).`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not fill images'); }
    finally { setFilling(false); }
  }

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>{t('sv.title')}</h2>
        <div style={{ display: 'flex', gap: 8, width: isMobile ? '100%' : 'auto', flexWrap: 'wrap' }}>
          <button onClick={() => fillImages(false)} disabled={filling}
            title={lang === 'vi' ? 'Tự thêm ảnh nail/spa mẫu cho các dịch vụ chưa có ảnh (dùng khi demo)' : 'Auto-add sample nail/spa photos to services without an image (for demos)'}
            style={{ ...ui.primaryBtn, flex: isMobile ? 1 : undefined, background: 'transparent', border: '1px solid #6366f1', color: 'var(--ca5b4fc)', opacity: filling ? 0.6 : 1 }}>
            {filling ? (lang === 'vi' ? 'Đang thêm ảnh…' : 'Adding…') : (lang === 'vi' ? '🖼 Ảnh mẫu' : '🖼 Sample images')}
          </button>
          <button onClick={() => { setShowImport((s) => !s); setShowForm(false); setTab('services'); }} style={{ ...ui.primaryBtn, flex: isMobile ? 1 : undefined, background: 'transparent', color: 'var(--ce2e8f0)', border: '1px solid var(--c475569)' }}>
            {showImport ? t('sv.close') : t('sv.importMenu')}
          </button>
          <button onClick={() => { setShowForm((s) => !s); setShowImport(false); setTab('services'); }} style={{ ...ui.primaryBtn, flex: isMobile ? 1 : undefined }}>
            {showForm ? t('sv.close') : t('sv.newService')}
          </button>
        </div>
      </div>

      <PageTabs tab={tab} onTab={setTab} vi={lang === 'vi'} isMobile={isMobile}
        counts={{ services: services.length, promos: activePromoCount(promos), categories: categories.length }} />

      {error && <div style={ui.banner}>{error}</div>}

      {tab === 'promos' && (
        <PromoBoard token={token!} categories={categories} promos={promos} sel={promoSel} onSel={setPromoSel} onSaved={refreshPromos} vi={lang === 'vi'} />
      )}

      {tab === 'categories' && (<>
        <CategoryManager token={token!} categories={categories} onChanged={load} defaultOpen />
        <SharedAddonsCard token={token!} categories={categories} currency={money.code} fmt={fmt} vi={lang === 'vi'} />
      </>)}

      {tab === 'services' && (<>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <SearchBox value={q} onChange={setQ} placeholder={t('sv.searchPh')} />
        <span style={{ color: 'var(--c94a3b8)', fontSize: 13 }}>{visible.length} {t('sv.serviceWord')}</span>
      </div>

      {showImport && <ServiceImport token={token!} currency={money.code} vi={lang === 'vi'} existingNames={services.map((x) => x.name)} onDone={async () => { setShowImport(false); await load(); }} />}

      {categories.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '0 0 16px' }}>
          <FilterChip active={catFilter === 'all'} onClick={() => setCatFilter('all')}>{t('sv.all')}</FilterChip>
          {categories.map((c) => (
            <FilterChip key={c.id} active={catFilter === c.id} onClick={() => setCatFilter(c.id)}>{c.name}</FilterChip>
          ))}
          <FilterChip active={catFilter === 'none'} onClick={() => setCatFilter('none')}>{t('sv.uncategorised')}</FilterChip>
          <button type="button" onClick={() => setTab('categories')}
            style={{ background: 'none', border: 'none', color: 'var(--ink-link)', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '6px 4px', whiteSpace: 'nowrap' }}>
            ✎ {lang === 'vi' ? 'Sửa danh mục' : 'Edit categories'}
          </button>
        </div>
      )}

      {showForm && (
        <CreateServiceForm
          token={token!}
          categories={categories}
          staff={staff}
          currency={money.code}
          onCreated={async () => {
            setShowForm(false);
            await load();
          }}
        />
      )}

      {loading ? (
        <p style={{ color: 'var(--c94a3b8)' }}>{t('sv.loading')}</p>
      ) : cardList ? (
        <div {...drag.containerProps}>
          <DragHint saved={drag.saved} lang={lang} />
          <MList>
            {rows.length === 0 && <p style={{ color: 'var(--c64748b)', fontSize: 13 }}>{t('sv.empty')}</p>}
            {rows.map((s, i) => (
              <ServiceCard key={s.id} service={s} token={token!} categories={categories} staff={staff} catName={catName} fmt={fmt} onToggle={() => toggleActive(s)} onDelete={() => remove(s.id)} onSaved={load} onGrab={drag.grab(i)} dragging={drag.dragIdx === i} />
            ))}
          </MList>
        </div>
      ) : (
        <div {...drag.containerProps}>
          <BulkBar count={bulk.count} ids={bulk.sel} onClear={bulk.clear} onDelete={(ids) => runBulkDelete(ids, (id) => apiFetch(`/services/${id}`, { method: 'DELETE', token }), load)} />
          {bulk.count > 0 && (
            <BulkServiceEdit ids={bulk.sel} services={rows} categories={categories} currency={money.code} token={token!} vi={lang === 'vi'}
              onDone={async () => { await load(); bulk.clear(); }} />
          )}
          <DragHint saved={drag.saved} lang={lang} />
          <div style={{ border: '1px solid var(--c334155)', borderRadius: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: 'var(--c1e293b)' }}>
                <th style={{ ...ui.th, width: 26 }} aria-label="drag" />
                <th style={{ ...ui.th, width: 34 }}><BulkAllBox on={bulk.allOn} onChange={bulk.toggleAll} /></th>
                <th style={ui.th}>{t('sv.colName')}</th>
                <th style={{ ...ui.th, whiteSpace: 'nowrap' }}>{t('sv.colCategory')}</th>
                <th style={{ ...ui.th, whiteSpace: 'nowrap' }}>{t('sv.colDuration')}</th>
                <th style={{ ...ui.th, whiteSpace: 'nowrap' }}>{t('sv.colPrice')}</th>
                <th style={{ ...ui.th, whiteSpace: 'nowrap' }}>{t('sv.colStatus')}</th>
                <th style={{ ...ui.th, whiteSpace: 'nowrap' }}>{t('sv.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td style={ui.td} colSpan={8}>
                    {t('sv.empty')}
                  </td>
                </tr>
              )}
              {rows.map((s, i) => (
                <FragmentRow key={s.id} service={s} token={token!} categories={categories} staff={staff} catName={catName} fmt={fmt} onToggle={() => toggleActive(s)} onDelete={() => remove(s.id)} onSaved={load} selected={bulk.has(s.id)} onSelect={() => bulk.toggle(s.id)} onGrab={drag.grab(i)} dragging={drag.dragIdx === i} />
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
      </>)}
    </section>
  );
}

// ---- Shared add-ons: one extra for a whole category, or the whole menu --------

interface SharedAddon { id: string; name: string; durationMinutes: number; priceCents: number; currency: string; isActive: boolean; categoryId: string | null; category: { id: string; name: string } | null }

/**
 * "Take Off $5" belongs on every Manicure — set it once here instead of on
 * each service. Customers see it under any service of that category (or of
 * the whole menu) on the booking page; the till lists it under the category.
 */
function SharedAddonsCard({ token, categories, currency, fmt, vi }: {
  token: string; categories: Category[]; currency: string; fmt: (c: number) => string; vi: boolean;
}) {
  const L = (v: string, e: string) => ind(vi ? v : e);
  const [items, setItems] = useState<SharedAddon[]>([]);
  const [form, setForm] = useState({ name: '', duration: '10', price: '5', scope: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await apiFetch<SharedAddon[]>('/services/addons/shared', { token })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true); setError(null);
    try {
      await apiFetch('/services/addons/shared', {
        method: 'POST', token,
        body: { name: form.name.trim(), durationMinutes: parseInt(form.duration, 10) || 0, priceCents: toMinorUnits(form.price, currency), categoryId: form.scope || null },
      });
      setForm({ ...form, name: '' });
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Create failed'); }
    finally { setBusy(false); }
  }
  async function remove(a: SharedAddon) {
    const where = a.category ? a.category.name : L('mọi dịch vụ', 'every service');
    if (!confirm(L(`Xoá "${a.name}" khỏi ${where}?`, `Remove "${a.name}" from ${where}?`))) return;
    try { await apiFetch(`/services/addons/shared/${a.id}`, { method: 'DELETE', token }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Delete failed'); }
  }

  // Grouped the way the owner thinks of them: everything, then each category.
  const groups = [
    { id: '', name: L('Tất cả dịch vụ', 'All services'), items: items.filter((a) => !a.categoryId) },
    ...categories.map((c) => ({ id: c.id, name: c.name, items: items.filter((a) => a.categoryId === c.id) })),
  ].filter((g) => g.items.length > 0);

  return (
    <div style={{ ...ui.card, marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ce2e8f0)' }}>➕ {L('Tuỳ chọn thêm dùng chung', 'Shared add-ons')}</div>
      <p style={{ color: 'var(--c94a3b8)', fontSize: 13, margin: '4px 0 12px' }}>
        {L('Món thêm áp dụng cho cả danh mục hoặc mọi dịch vụ — vd "Take Off $5" cho tất cả Manicure. Khách chọn thêm được ở bất kỳ dịch vụ nào trong danh mục đó. Món chỉ dành cho một dịch vụ thì vẫn thêm ở nút "Tùy chọn thêm" của dịch vụ đó.',
           'Extras offered on a whole category or on every service — e.g. "Take Off $5" for all Manicures. Customers can add them to any service in that category. An extra for one service only still goes under that service’s "Add-ons" button.')}
      </p>
      {error && <div style={ui.banner}>{error}</div>}
      {groups.length === 0 && <p style={{ color: 'var(--c64748b)', fontSize: 13, margin: '0 0 12px' }}>{L('Chưa có món dùng chung nào.', 'No shared add-ons yet.')}</p>}
      {groups.map((g) => (
        <div key={g.id || 'all'} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--c94a3b8)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{g.name}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {g.items.map((a) => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, padding: '8px 10px', borderRadius: 8, background: 'var(--c0f172a)', border: '1px solid var(--c334155)' }}>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                <span style={{ color: 'var(--c94a3b8)', fontSize: 13, whiteSpace: 'nowrap' }}>{a.durationMinutes} {L('phút', 'min')}</span>
                <span style={{ color: 'var(--ink-good)', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmt(a.priceCents)}</span>
                <button type="button" onClick={() => remove(a)} style={{ ...ui.dangerBtn, padding: '3px 8px', fontSize: 12 }}>{L('Xoá', 'Remove')}</button>
              </div>
            ))}
          </div>
        </div>
      ))}
      <form onSubmit={add} style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap', marginTop: 6 }}>
        <div style={{ flex: '2 1 160px' }}>
          <span style={ui.label}>{L('Tên món thêm', 'Add-on name')}</span>
          <input style={ui.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={L('vd: Take Off, French tips', 'e.g. Take Off, French tips')} required />
        </div>
        <div style={{ flex: '1 1 150px' }}>
          <span style={ui.label}>{L('Áp dụng cho', 'Applies to')}</span>
          <select style={ui.input} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>
            <option value="">{L('Tất cả dịch vụ', 'All services')}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{L('Cả danh mục', 'All of')} {c.name}</option>)}
          </select>
        </div>
        <div style={{ width: 80 }}>
          <span style={ui.label}>{L('Phút', 'Min')}</span>
          <input style={ui.input} type="number" min={0} value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} />
        </div>
        <div style={{ width: 100 }}>
          <span style={ui.label}>{L('Giá', 'Price')}</span>
          <input style={ui.input} type="number" min={0} step={priceInputStep(currency)} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
        </div>
        <button type="submit" disabled={busy} style={{ ...ui.primaryBtn, padding: '9px 14px', opacity: busy ? 0.6 : 1 }}>{L('Thêm', 'Add')}</button>
      </form>
    </div>
  );
}

// ---- Run dates: every program can start and end ------------------------------

interface RunWindow { startDate: string; endDate: string }
const runOf = (w: { startDate?: string | null; endDate?: string | null }): RunWindow => ({ startDate: w.startDate ?? '', endDate: w.endDate ?? '' });
const runBody = (r: RunWindow) => ({ startDate: r.startDate || null, endDate: r.endDate || null });

/**
 * "Chạy từ … đến …" for a program. Both optional: empty start = from now,
 * empty end = until switched off. The dates are the salon's calendar days and
 * bound the day of the VISIT.
 */
function RunDates({ value, onChange, vi }: { value: RunWindow; onChange: (v: RunWindow) => void; vi: boolean }) {
  const today = new Date().toLocaleDateString('en-CA');
  const bad = !!value.startDate && !!value.endDate && value.endDate < value.startDate;
  const ended = !!value.endDate && value.endDate < today;
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', margin: '0 0 12px', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--c334155)', background: 'var(--c0f172a)' }}>
      <label style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{vi ? 'Bắt đầu' : 'Starts'}
        <input type="date" value={value.startDate} onChange={(e) => onChange({ ...value, startDate: e.target.value })} style={{ ...ui.input, width: 'auto', display: 'block', marginTop: 3 }} />
      </label>
      <label style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{vi ? 'Kết thúc' : 'Ends'}
        <input type="date" value={value.endDate} min={value.startDate || undefined} onChange={(e) => onChange({ ...value, endDate: e.target.value })} style={{ ...ui.input, width: 'auto', display: 'block', marginTop: 3 }} />
      </label>
      {(value.startDate || value.endDate) && (
        <button type="button" onClick={() => onChange({ startDate: '', endDate: '' })} style={{ ...miniBtn, marginBottom: 8 }}>{vi ? 'Không giới hạn' : 'No end date'}</button>
      )}
      <span style={{ flex: '1 1 220px', fontSize: 12, marginBottom: 8, color: bad || ended ? 'var(--ink-bad)' : 'var(--c64748b)' }}>
        {bad ? (vi ? 'Ngày kết thúc phải sau ngày bắt đầu.' : 'The end date must be after the start date.')
          : ended ? (vi ? 'Chương trình đã kết thúc — khách không còn thấy và không được giảm.' : 'This program has ended — customers no longer see or get it.')
          : (vi ? 'Để trống = chạy liên tục. Tính theo ngày khách đến làm.' : 'Leave empty to run with no end. Counts the day of the visit.')}
      </span>
    </div>
  );
}

// ---- Page tabs: Menu · Promotions · Categories --------------------------------

type PageTab = 'services' | 'promos' | 'categories';
type PromoKey = 'weekday' | 'firstVisit' | 'group' | 'date';
interface SettingsPromos {
  weekdayDiscounts?: { enabled: boolean; message?: string; rules: DiscRule[]; startDate?: string | null; endDate?: string | null };
  firstVisitDiscount?: { enabled: boolean; percent?: number; message?: string; rules?: VisitTier[]; startDate?: string | null; endDate?: string | null };
  groupDiscount?: { enabled: boolean; message?: string; tiers: GroupTier[]; startDate?: string | null; endDate?: string | null };
  dateDiscounts?: { enabled: boolean; rules: DateRule[] };
}
interface PromoSummary {
  weekday?: SettingsPromos['weekdayDiscounts'];
  firstVisit?: SettingsPromos['firstVisitDiscount'];
  group?: SettingsPromos['groupDiscount'];
  date?: SettingsPromos['dateDiscounts'];
}

const todayYmd = () => new Date().toLocaleDateString('en-CA');

/** Date rules that still mean something: today or later. */
function liveDateRules(p: PromoSummary): DateRule[] {
  const today = todayYmd();
  return (p.date?.rules ?? []).filter((r) => r?.startDate && (r.endDate || r.startDate) >= today);
}

/** The program-level run dates (special dates carry theirs per rule). */
function windowOf(p: PromoSummary, k: PromoKey): { startDate?: string | null; endDate?: string | null } | undefined {
  return k === 'weekday' ? p.weekday : k === 'firstVisit' ? p.firstVisit : k === 'group' ? p.group : undefined;
}

function promoOn(p: PromoSummary, k: PromoKey): boolean {
  const w = windowOf(p, k);
  if (w?.endDate && w.endDate < todayYmd()) return false; // over
  if (k === 'weekday') return !!(p.weekday?.enabled && p.weekday.rules?.length);
  if (k === 'firstVisit') return !!(p.firstVisit?.enabled && ((p.firstVisit.rules?.length ?? 0) > 0 || (p.firstVisit.percent ?? 0) > 0));
  if (k === 'group') return !!(p.group?.enabled && p.group.tiers?.length);
  return !!(p.date?.enabled && liveDateRules(p).length);
}

function activePromoCount(p: PromoSummary): number {
  return (['weekday', 'firstVisit', 'group', 'date'] as PromoKey[]).filter((k) => promoOn(p, k)).length;
}

function PageTabs({ tab, onTab, counts, vi, isMobile }: {
  tab: PageTab; onTab: (t: PageTab) => void; vi: boolean; isMobile: boolean;
  counts: { services: number; promos: number; categories: number };
}) {
  const items: { id: PageTab; label: string; count: number; hot?: boolean }[] = [
    { id: 'services', label: vi ? 'Dịch vụ' : 'Services', count: counts.services },
    { id: 'promos', label: vi ? 'Khuyến mãi' : 'Promotions', count: counts.promos, hot: counts.promos > 0 },
    { id: 'categories', label: vi ? 'Danh mục' : 'Categories', count: counts.categories },
  ];
  return (
    <div role="tablist" style={{ display: 'flex', gap: isMobile ? 0 : 4, borderBottom: '1px solid var(--line)', marginBottom: 16, overflowX: 'auto', scrollbarWidth: 'none' }}>
      {items.map((it) => {
        const on = tab === it.id;
        return (
          <button key={it.id} role="tab" aria-selected={on} type="button" onClick={() => onTab(it.id)}
            style={{ flex: isMobile ? '1 0 auto' : undefined, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: isMobile ? 5 : 7, padding: isMobile ? '11px 4px' : '10px 16px',
              background: 'transparent', border: 'none', borderBottom: `2px solid ${on ? '#6366f1' : 'transparent'}`, marginBottom: -1,
              color: on ? 'var(--ce2e8f0)' : 'var(--c94a3b8)', fontSize: isMobile ? 13 : 14, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {it.label}
            <span style={{ minWidth: 18, padding: isMobile ? '0 6px' : '1px 7px', borderRadius: 999, fontSize: isMobile ? 11 : 11.5, fontWeight: 700, lineHeight: '18px',
              background: it.hot ? '#16a34a' : on ? '#6366f1' : 'var(--c334155)', color: it.hot || on ? '#ffffff' : 'var(--ccbd5e1)' }}>
              {it.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Every promotion at a glance — is it on, and what does the customer get —
 * with the one being edited open underneath. The customer always gets the
 * single best % of these; they never stack.
 */
function PromoBoard({ token, categories, promos, sel, onSel, onSaved, vi }: {
  token: string; categories: Category[]; promos: PromoSummary; sel: PromoKey | null;
  onSel: (k: PromoKey) => void; onSaved: () => void; vi: boolean;
}) {
  const isMobile = useIsMobile();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const editorRef = useRef<HTMLDivElement>(null);
  const keys: PromoKey[] = ['date', 'weekday', 'firstVisit', 'group'];
  const current: PromoKey = sel ?? keys.find((k) => promoOn(promos, k)) ?? 'date';
  const dow = vi ? DOW_VI : DOW;
  const catLabel = (id: string | null) => (id ? categories.find((c) => c.id === id)?.name ?? '' : '');
  const fmtD = (ymd: string) => {
    try { return new Date(ymd + 'T00:00:00').toLocaleDateString(vi ? 'vi-VN' : 'en-US', { day: 'numeric', month: vi ? 'numeric' : 'short' }); } catch { return ymd; }
  };
  const today = todayYmd();
  const runningToday = (promos.date?.enabled ? liveDateRules(promos) : []).filter((r) => r.startDate <= today);

  const lines = (k: PromoKey): string[] => {
    if (k === 'weekday') {
      return [...(promos.weekday?.rules ?? [])].sort((a, b) => a.day - b.day)
        .map((r) => `${dow[r.day]} −${r.percent}%${r.categoryId ? ` · ${catLabel(r.categoryId)}` : ''}`);
    }
    if (k === 'firstVisit') {
      const f = promos.firstVisit;
      const rules = f?.rules?.length ? f.rules : f?.percent ? [{ visit: 1, percent: f.percent }] : [];
      return rules.map((r) => (vi ? `Lần ${r.visit}: −${r.percent}%` : `Visit #${r.visit}: −${r.percent}%`));
    }
    if (k === 'group') {
      return [...(promos.group?.tiers ?? [])].sort((a, b) => a.minSize - b.minSize)
        .map((r) => (vi ? `${r.minSize}+ người: −${r.percent}%` : `${r.minSize}+ people: −${r.percent}%`));
    }
    return liveDateRules(promos).sort((a, b) => a.startDate.localeCompare(b.startDate)).map((r) => {
      const range = r.endDate && r.endDate !== r.startDate ? `${fmtD(r.startDate)}–${fmtD(r.endDate)}` : fmtD(r.startDate);
      return `${r.label ? `${r.label} · ` : ''}${range} −${r.percent}%${r.categoryId ? ` · ${catLabel(r.categoryId)}` : ''}`;
    });
  };

  const title: Record<PromoKey, string> = { weekday: t('sv.weekdayTitle'), firstVisit: t('sv.fvTitle'), group: t('sv.grTitle'), date: t('sv.dateTitle') };
  const pick = (k: PromoKey) => {
    onSel(k);
    if (isMobile) setTimeout(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  return (
    <div>
      {runningToday.length > 0 && (
        <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 10, background: '#dcfce7', color: '#166534', fontSize: 13.5, fontWeight: 600 }}>
          🎉 {vi ? 'Đang chạy hôm nay:' : 'Running today:'} {runningToday.map((r) => `${r.label || (vi ? 'Giảm giá' : 'Sale')} −${r.percent}%`).join(' · ')}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
        {keys.map((k) => {
          const on = promoOn(promos, k);
          const w = windowOf(promos, k);
          const ended = !!w?.endDate && w.endDate < today;
          const upcoming = on && !!w?.startDate && w.startDate > today;
          const ls = on ? lines(k) : [];
          const span = on && w && (w.startDate || w.endDate)
            ? (w.startDate && w.endDate ? `${fmtD(w.startDate)}–${fmtD(w.endDate)}` : w.endDate ? (vi ? `đến ${fmtD(w.endDate)}` : `until ${fmtD(w.endDate)}`) : (vi ? `từ ${fmtD(w.startDate!)}` : `from ${fmtD(w.startDate!)}`))
            : '';
          const active = current === k;
          return (
            <button key={k} type="button" onClick={() => pick(k)} aria-pressed={active}
              style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 6, padding: 12, borderRadius: 12, cursor: 'pointer', minWidth: 0,
                background: active ? 'var(--c312e81)' : 'var(--c1e293b)', border: `1px solid ${active ? '#6366f1' : 'var(--c334155)'}`, color: 'var(--ce2e8f0)' }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.3 }}>{title[k]}</span>
              <span style={{ alignSelf: 'flex-start', fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '1px 8px', border: '1px solid currentColor',
                color: on ? (upcoming ? 'var(--ink-warn)' : 'var(--ink-good)') : 'var(--c94a3b8)' }}>
                {on ? (upcoming ? (vi ? '◷ Sắp chạy' : '◷ Scheduled') : (vi ? '● Đang bật' : '● On')) : ended ? (vi ? 'Đã kết thúc' : 'Ended') : (vi ? 'Đang tắt' : 'Off')}
              </span>
              <span style={{ fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.45, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
                {ls.length ? ls.join(' · ') + (span ? ` · 📅 ${span}` : '') : hintFor(k, vi)}
              </span>
            </button>
          );
        })}
      </div>
      <p style={{ margin: '10px 0 14px', fontSize: 12, color: 'var(--c64748b)' }}>
        {vi ? 'Khách luôn nhận mức % cao nhất trong các chương trình đang áp dụng — không cộng dồn.' : 'Customers always get the single best % that applies — promotions never stack.'}
      </p>
      <div ref={editorRef} style={{ scrollMarginTop: 70 }}>
        {current === 'weekday' && <WeekdayDiscountCard key="weekday" token={token} categories={categories} defaultOpen onSaved={onSaved} />}
        {current === 'firstVisit' && <FirstVisitDiscountCard key="firstVisit" token={token} defaultOpen onSaved={onSaved} />}
        {current === 'group' && <GroupDiscountCard key="group" token={token} defaultOpen onSaved={onSaved} />}
        {current === 'date' && <DateDiscountCard key="date" token={token} categories={categories} defaultOpen onSaved={onSaved} />}
      </div>
    </div>
  );
}

function hintFor(k: PromoKey, vi: boolean): string {
  if (k === 'date') return vi ? 'Khai trương, ngày lễ — giảm vào đúng những ngày bạn chọn' : 'Grand opening, holidays — a sale on the dates you pick';
  if (k === 'weekday') return vi ? 'Giảm vào ngày vắng trong tuần, lặp lại hàng tuần' : 'A weekly % off on quiet days';
  if (k === 'firstVisit') return vi ? 'Ưu đãi khách mới / tri ân khách quen theo lần đến' : 'Reward new and returning customers by visit';
  return vi ? 'Đi nhóm đông được giảm nhiều hơn' : 'Bigger parties save more';
}

/**
 * Drag the menu into the order customers see.
 *
 * WHY A PANEL AND NOT DRAG HANDLES ON THE TABLE
 *
 * The table is searched, filtered and paginated. Dragging row three to the top
 * of page two means nothing globally, and a control whose effect depends on
 * which page you are looking at will be used wrongly and blamed correctly. This
 * shows the current category in ONE list, no pages, and saves the whole list.
 *
 * Arrows as well as dragging, and not as an afterthought: HTML5 drag does not
 * work on a touch screen, and most salon owners open this on a phone. The
 * arrows are also simply more precise for "move this one up by one", which is
 * the actual request — "phải thứ tự từ 1 đến 3".
 */

interface Addon {
  id: string; name: string; durationMinutes: number; priceCents: number; currency: string;
  /** Set on a shared extra (whole category / whole menu) listed under a service: read-only here. */
  shared?: 'category' | 'all'; scopeName?: string | null;
}


/** The one line telling an owner the rows move, plus the save state. */
function DragHint({ saved, lang }: { saved: string; lang: string }) {
  const text = saved === 'saving'
    ? (lang === 'vi' ? 'Đang lưu thứ tự…' : 'Saving order…')
    : saved === 'saved'
      ? (lang === 'vi' ? '✓ Đã lưu thứ tự — trang đặt lịch cập nhật ngay' : '✓ Order saved — the booking page is updated')
      : saved === 'error'
        ? (lang === 'vi' ? '✕ Chưa lưu được thứ tự' : '✕ Could not save the order')
        : (lang === 'vi' ? 'Giữ chuột vào ⠿ ở đầu dòng rồi kéo lên/xuống để đổi thứ tự. Tự lưu.' : 'Hold ⠿ at the start of a row and drag. Saves itself.');
  return (
    <div style={{
      fontSize: 12.5, marginBottom: 8, padding: '7px 11px', borderRadius: 8,
      background: saved === 'saved' ? 'var(--c14532d)' : 'var(--c1e293b)',
      color: saved === 'saved' ? 'var(--ink-good)' : saved === 'error' ? 'var(--cfca5a5)' : 'var(--c94a3b8)',
      border: '1px solid var(--c334155)',
    }}>{text}</div>
  );
}


function FragmentRow({ service: s, token, categories, staff, catName, fmt, onToggle, onDelete, onSaved, selected, onSelect, onGrab, dragging }: {
  service: Service; token: string; categories: Category[]; staff: Staff[]; catName: (id?: string | null) => string; fmt: (cents: number) => string; onToggle: () => void; onDelete: () => void; onSaved: () => void; selected?: boolean; onSelect?: () => void;
  onGrab?: (e: React.PointerEvent) => void; dragging?: boolean;
}) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  return (
    <>
      <tr
        data-row=""
        style={{
          borderTop: '1px solid var(--c334155)',
          background: dragging ? 'var(--c334155)' : selected ? 'var(--c1e1b4b)' : undefined,
        }}
      >
        {/* The handle is always here. It used to live behind a "Kéo sắp xếp"
            button in the header, and a feature you have to find is a feature
            that does not exist for the person who scrolled past it. */}
        <td style={{ ...ui.td, width: 26, padding: '0 0 0 8px' }}>
          <span
            onPointerDown={onGrab}
            title={lang === 'vi' ? 'Giữ và kéo để đổi thứ tự' : 'Hold and drag to reorder'}
            style={{
              display: 'inline-block', color: dragging ? 'var(--ink-link)' : 'var(--c64748b)',
              fontSize: 17, cursor: 'grab', padding: '6px 4px',
              touchAction: 'none', userSelect: 'none',
            }}
          >⠿</span>
        </td>
        <td style={{ ...ui.td, width: 34 }}>{onSelect && <BulkRowBox on={!!selected} onChange={onSelect} />}</td>
        <td style={ui.td}>
          <div>
            {s.name}
            {s.isFeatured && <span style={{ marginLeft: 6, background: '#eab308', color: '#1f2937', borderRadius: 6, padding: '1px 6px', fontSize: 10, fontWeight: 600 }}>{t('sv.popular')}</span>}
          </div>
          {s.description && <div style={{ color: 'var(--c94a3b8)', fontSize: 12 }}>{s.description}</div>}
        </td>
        <td style={{ ...ui.td, color: 'var(--c94a3b8)' }}>{catName(s.categoryId)}</td>
        <td style={{ ...ui.td, whiteSpace: 'nowrap' }}>{s.durationMinutes > 0
          ? `${s.durationMinutes} ${t('sv.min')}`
          : <span title={lang === 'vi' ? 'Chưa đặt thời lượng — lịch hẹn sẽ không chặn giờ của thợ' : 'No duration set — bookings will not block the technician\'s time'} style={{ color: 'var(--ink-warn)' }}>{lang === 'vi' ? 'Chưa đặt' : 'Not set'}</span>}</td>
        <td style={{ ...ui.td, whiteSpace: 'nowrap' }}>
          {s.discountPercent && s.discountPercent > 0 ? (
            <span>
              <span style={{ textDecoration: 'line-through', color: 'var(--c94a3b8)', marginRight: 6 }}>{fmt(s.priceCents)}</span>
              <span style={{ color: 'var(--ink-good)', fontWeight: 600 }}>{fmt(Math.round((s.priceCents * (100 - s.discountPercent)) / 100))}</span>
              <span style={{ marginLeft: 6, background: '#ef4444', color: '#fff', borderRadius: 6, padding: '1px 6px', fontSize: 11, fontWeight: 600 }}>-{s.discountPercent}%</span>
            </span>
          ) : (
            <>{fmt(s.priceCents)}{s.priceFrom ? <span title={lang === 'vi' ? 'Giá từ (trở lên)' : 'From price (and up)'} style={{ color: 'var(--c94a3b8)', fontWeight: 600 }}>+</span> : null}</>
          )}
        </td>
        <td style={{ ...ui.td, whiteSpace: 'nowrap' }}>
          <button onClick={onToggle} style={{ cursor: 'pointer', whiteSpace: 'nowrap', background: 'transparent', border: `1px solid ${s.isActive ? '#22c55e' : 'var(--c64748b)'}`, color: s.isActive ? 'var(--ink-good)' : 'var(--c94a3b8)', borderRadius: 999, padding: '3px 12px', fontSize: 12 }}>
            {s.isActive ? t('sv.active') : t('sv.inactive')}
          </button>
        </td>
        <td style={{ ...ui.td, whiteSpace: 'nowrap' }}>
          <div style={{ display: 'inline-flex', gap: 6 }}>
            <button onClick={() => setEditing((e) => !e)} style={actBtn(editing ? 'var(--c475569)' : '#0ea5e9')}>
              {t('sv.edit')}
            </button>
            <button onClick={() => setOpen((o) => !o)} style={actBtn(open ? 'var(--c475569)' : '#6366f1')}>
              {t('sv.addons')}
            </button>
            <button onClick={onDelete} style={actBtn('#b91c1c')}>{t('sv.delete')}</button>
          </div>
        </td>
      </tr>
      <EditDialog open={editing} onClose={() => setEditing(false)} title={`${t('sv.edit')} · ${s.name}`} subtitle={catName(s.categoryId)}>
        <EditServicePanel service={s} token={token} categories={categories} staff={staff} onSaved={onSaved} />
      </EditDialog>
      <EditDialog open={open} onClose={() => setOpen(false)} title={`${t('sv.addons')} · ${s.name}`}>
        <AddonsPanel serviceId={s.id} token={token} fmt={fmt} currency={s.currency} />
      </EditDialog>
    </>
  );
}

/** Mobile card equivalent of FragmentRow (the table renders <tr>; this renders a card). */
function ServiceCard({ service: s, token, categories, staff, catName, fmt, onToggle, onDelete, onSaved, onGrab, dragging }: {
  service: Service; token: string; categories: Category[]; staff: Staff[]; catName: (id?: string | null) => string; fmt: (cents: number) => string; onToggle: () => void; onDelete: () => void; onSaved: () => void;
  onGrab?: (e: React.PointerEvent) => void; dragging?: boolean;
}) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  return (
    <>
      <div data-row="" style={{ opacity: dragging ? 0.7 : 1 }}>
      <MCard>
        <MHead right={<button onClick={onToggle} style={{ cursor: 'pointer', whiteSpace: 'nowrap', background: 'transparent', border: `1px solid ${s.isActive ? '#22c55e' : 'var(--c64748b)'}`, color: s.isActive ? 'var(--ink-good)' : 'var(--c94a3b8)', borderRadius: 999, padding: '3px 12px', fontSize: 12 }}>{s.isActive ? t('sv.active') : t('sv.inactive')}</button>}>
          {/* Same handle as the desktop table. A phone cannot use the HTML5
              drag API at all, which is why this is a pointer handle. */}
          <span
            onPointerDown={onGrab}
            style={{ color: dragging ? 'var(--ink-link)' : 'var(--c64748b)', fontSize: 16, cursor: 'grab', paddingRight: 8, touchAction: 'none', userSelect: 'none' }}
          >⠿</span>
          {s.name}{s.isFeatured && <span style={{ marginLeft: 6, background: '#eab308', color: '#1f2937', borderRadius: 6, padding: '1px 6px', fontSize: 10, fontWeight: 600 }}>{t('sv.popular')}</span>}
        </MHead>
        {s.description && <div style={{ color: 'var(--c94a3b8)', fontSize: 12 }}>{s.description}</div>}
        <MRow label={t('sv.colCategory')}>{catName(s.categoryId)}</MRow>
        <MRow label={t('sv.colDuration')}>{s.durationMinutes} {t('sv.min')}</MRow>
        <MRow label={t('sv.colPrice')}>
          {s.discountPercent && s.discountPercent > 0 ? (
            <span>
              <span style={{ textDecoration: 'line-through', color: 'var(--c94a3b8)', marginRight: 6 }}>{fmt(s.priceCents)}</span>
              <span style={{ color: 'var(--ink-good)', fontWeight: 600 }}>{fmt(Math.round((s.priceCents * (100 - s.discountPercent)) / 100))}</span>
              <span style={{ marginLeft: 6, background: '#ef4444', color: '#fff', borderRadius: 6, padding: '1px 6px', fontSize: 11, fontWeight: 600 }}>-{s.discountPercent}%</span>
            </span>
          ) : fmt(s.priceCents)}
        </MRow>
        <MActions>
          <button onClick={() => setEditing((e) => !e)} style={actBtn(editing ? 'var(--c475569)' : '#0ea5e9')}>{t('sv.edit')}</button>
          <button onClick={() => setOpen((o) => !o)} style={actBtn(open ? 'var(--c475569)' : '#6366f1')}>{t('sv.addons')}</button>
          <button onClick={onDelete} style={actBtn('#b91c1c')}>{t('sv.delete')}</button>
        </MActions>
      </MCard>
      </div>
      <EditDialog open={editing} onClose={() => setEditing(false)} title={`${t('sv.edit')} · ${s.name}`} subtitle={catName(s.categoryId)}>
        <EditServicePanel service={s} token={token} categories={categories} staff={staff} onSaved={onSaved} />
      </EditDialog>
      <EditDialog open={open} onClose={() => setOpen(false)} title={`${t('sv.addons')} · ${s.name}`}>
        <AddonsPanel serviceId={s.id} token={token} fmt={fmt} currency={s.currency} />
      </EditDialog>
    </>
  );
}

/** Walk-in turns a service is worth: 1 normally, ½ or 0 for a small add-on. */
function TurnSelect({ value, onChange, t }: { value: number; onChange: (v: number) => void; t: (k: string) => string }) {
  const opts: [number, string][] = [[1, 'sv.turn1'], [0.5, 'sv.turnHalf'], [0, 'sv.turn0'], [1.5, 'sv.turn15'], [2, 'sv.turn2']];
  return (
    <label title={t('sv.turnHint')}><span style={ui.label}>{t('sv.fTurn')}</span>
      <select style={ui.input} value={String(value)} onChange={(e) => onChange(Number(e.target.value))}>
        {opts.map(([v, k]) => <option key={v} value={String(v)}>{t(k)}</option>)}
      </select>
    </label>
  );
}

function EditServicePanel({ service, token, categories, staff, onSaved }: { service: Service; token: string; categories: Category[]; staff: Staff[]; onSaved: () => void }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [form, setForm] = useState({
    name: service.name,
    description: service.description ?? '',
    duration: String(service.durationMinutes),
    price: fromMinorUnits(service.priceCents, service.currency),
    discount: String(service.discountPercent ?? 0),
    categoryId: service.categoryId ?? '',
    isFeatured: service.isFeatured ?? false,
    priceFrom: service.priceFrom ?? false,
    imageUrl: service.imageUrl ?? '',
    turnValue: typeof service.turnValue === 'number' ? service.turnValue : 1,
  });
  const [staffIds, setStaffIds] = useState<string[]>(service.staffServices?.map((x) => x.staffMemberId) ?? []);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const updated = await apiFetch<Service>(`/services/${service.id}`, {
        method: 'PATCH',
        token,
        body: {
          name: form.name,
          description: form.description || undefined,
          durationMinutes: form.duration.trim() === '' ? 30 : Math.max(0, parseInt(form.duration, 10) || 0),
          priceCents: toMinorUnits(form.price, service.currency),
          discountPercent: Math.min(90, Math.max(0, parseInt(form.discount, 10) || 0)),
          categoryId: form.categoryId || null,
          isFeatured: form.isFeatured,
          priceFrom: form.priceFrom,
          imageUrl: form.imageUrl.trim(),
          turnValue: form.turnValue,
          staffIds,
        },
      });
      if (updated && typeof updated === 'object') {
        setForm({
          name: updated.name,
          description: updated.description ?? '',
          duration: String(updated.durationMinutes),
          price: fromMinorUnits(updated.priceCents, updated.currency ?? service.currency),
          discount: String(updated.discountPercent ?? 0),
          categoryId: updated.categoryId ?? '',
          isFeatured: updated.isFeatured ?? false,
          priceFrom: updated.priceFrom ?? false,
          imageUrl: updated.imageUrl ?? '',
          turnValue: typeof updated.turnValue === 'number' ? updated.turnValue : form.turnValue,
        });
      }
      setSaved(true);
      onSaved(); // refresh the list/prices in the background; panel stays open
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} style={{ padding: 16 }}>
      <div style={{ fontSize: 13, color: 'var(--ccbd5e1)', marginBottom: 8, fontWeight: 600 }}>{t('sv.editService')}</div>
      {error && <div style={ui.banner}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        <label><span style={ui.label}>{t('sv.fName')}</span><input style={ui.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
        <label><span style={ui.label}>{t('sv.fDuration')}</span><input style={ui.input} type="number" min={0} value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} placeholder="30" /></label>
        <label><span style={ui.label}>{t('sv.fPrice').replace('{c}', service.currency)}</span><input style={ui.input} type="number" min={0} step={priceInputStep(service.currency)} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required /></label>
        <label><span style={ui.label}>{t('sv.fDiscount')}</span><input style={ui.input} type="number" min={0} max={90} value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} /></label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginTop: 10, alignItems: 'end' }}>
        <label><span style={ui.label}>{t('sv.fCategory')}</span>
          <select style={ui.input} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
            <option value="">{t('sv.optUncategorised')}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ce2e8f0)', paddingBottom: 8 }}>
          <input type="checkbox" checked={form.isFeatured} onChange={(e) => setForm({ ...form, isFeatured: e.target.checked })} /> {t('sv.popularLabel')}
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ce2e8f0)', paddingBottom: 8 }}>
          <input type="checkbox" checked={form.priceFrom} onChange={(e) => setForm({ ...form, priceFrom: e.target.checked })} /> {t('sv.fromPrice')}
        </label>
        <TurnSelect value={form.turnValue} onChange={(v) => { setForm({ ...form, turnValue: v }); setSaved(false); }} t={t} />
      </div>
      <label style={{ display: 'block', marginTop: 10 }}>
        <span style={ui.label}>{t('sv.fDescription')}</span>
        <input style={ui.input} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </label>

      <ImageField value={form.imageUrl} onChange={(v) => { setForm({ ...form, imageUrl: v }); setSaved(false); }} token={token} />

      <div style={{ marginTop: 12 }}>
        <span style={ui.label}>{t('sv.staffWhoDo')}</span>
        <StaffPicker all={staff} ids={staffIds} set={(v) => { setStaffIds(v); setSaved(false); }} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
        <button type="submit" disabled={saving} style={ui.primaryBtn}>{saving ? t('sv.saving') : t('sv.saveChanges')}</button>
        {saved && <span style={{ color: 'var(--ink-good)', fontSize: 13 }}>{t('sv.savedLive')}</span>}
      </div>
    </form>
  );
}

function AddonsPanel({ serviceId, token, fmt, currency = 'USD' }: { serviceId: string; token: string; fmt: (cents: number) => string; currency?: string }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [addons, setAddons] = useState<Addon[]>([]);
  const [form, setForm] = useState({ name: '', duration: '15', price: '15' });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAddons(await apiFetch<Addon[]>(`/services/${serviceId}/addons`, { token }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load add-ons');
    }
  }, [serviceId, token]);

  useEffect(() => { load(); }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch(`/services/${serviceId}/addons`, {
        method: 'POST', token,
        body: { name: form.name, durationMinutes: parseInt(form.duration, 10) || 0, priceCents: toMinorUnits(form.price, currency) },
      });
      setForm({ name: '', duration: '15', price: '15' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  }

  async function remove(id: string) {
    try {
      await apiFetch(`/services/${serviceId}/addons/${id}`, { method: 'DELETE', token });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 13, color: 'var(--ccbd5e1)', marginBottom: 8, fontWeight: 600 }}>{t('sv.addonsTitle')}</div>
      {error && <div style={ui.banner}>{error}</div>}
      {addons.length === 0 ? (
        <div style={{ color: 'var(--c64748b)', fontSize: 13, marginBottom: 10 }}>{t('sv.noAddons')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {addons.map((a) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
              <span style={{ flex: 1 }}>
                {a.name}
                {a.shared && (
                  <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: 'var(--ink-link)', border: '1px solid currentColor', borderRadius: 999, padding: '0 7px' }}>
                    {lang === 'vi' ? 'Dùng chung' : 'Shared'} · {a.shared === 'all' ? (lang === 'vi' ? 'mọi dịch vụ' : 'all services') : a.scopeName}
                  </span>
                )}
              </span>
              <span style={{ color: 'var(--c94a3b8)' }}>{a.durationMinutes} {t('sv.min')}</span>
              <span style={{ color: 'var(--ink-good)' }}>{fmt(a.priceCents)}</span>
              {a.shared
                ? <span title={lang === 'vi' ? 'Sửa ở tab Danh mục → Tuỳ chọn thêm dùng chung' : 'Edit under Categories → Shared add-ons'} style={{ width: 52, textAlign: 'center', color: 'var(--c64748b)', fontSize: 12 }}>🔗</span>
                : <button onClick={() => remove(a.id)} style={{ ...ui.dangerBtn, padding: '3px 8px', fontSize: 12 }}>{t('sv.remove')}</button>}
            </div>
          ))}
          {addons.some((a) => a.shared) && (
            <div style={{ fontSize: 11.5, color: 'var(--c64748b)' }}>
              {lang === 'vi' ? '🔗 Món dùng chung sửa ở tab Danh mục → Tuỳ chọn thêm dùng chung.' : '🔗 Shared add-ons are edited under Categories → Shared add-ons.'}
            </div>
          )}
        </div>
      )}
      <form onSubmit={add} style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        <div style={{ flex: 2, minWidth: 160 }}>
          <span style={ui.label}>{t('sv.addonName')}</span>
          <input style={ui.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder={t('sv.addonNamePh')} />
        </div>
        <div style={{ width: 90 }}>
          <span style={ui.label}>{t('sv.minLabel')}</span>
          <input style={ui.input} type="number" min={0} value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} />
        </div>
        <div style={{ width: 100 }}>
          <span style={ui.label}>{t('sv.priceLabel')}</span>
          <input style={ui.input} type="number" min={0} step={priceInputStep(currency)} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
        </div>
        <button type="submit" style={{ ...ui.primaryBtn, padding: '9px 14px' }}>{t('sv.add')}</button>
      </form>
    </div>
  );
}

function CreateServiceForm({ token, categories, staff, currency, onCreated }: { token: string; categories: Category[]; staff: Staff[]; currency: string; onCreated: () => void }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [form, setForm] = useState({ name: '', description: '', durationMinutes: '30', price: '25', discount: '0', categoryId: '', isFeatured: false, priceFrom: false, imageUrl: '', turnValue: 1 });
  const [staffIds, setStaffIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch('/services', {
        method: 'POST',
        token,
        body: {
          name: form.name,
          description: form.description || undefined,
          durationMinutes: form.durationMinutes.trim() === '' ? 30 : Math.max(0, parseInt(form.durationMinutes, 10) || 0),
          priceCents: toMinorUnits(form.price, currency),
          discountPercent: Math.min(90, Math.max(0, parseInt(form.discount, 10) || 0)),
          categoryId: form.categoryId || null,
          isFeatured: form.isFeatured,
          priceFrom: form.priceFrom,
          imageUrl: form.imageUrl.trim() || undefined,
          turnValue: form.turnValue,
          staffIds,
        },
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ ...ui.card, marginBottom: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        <label>
          <span style={ui.label}>{t('sv.serviceName')}</span>
          <input
            style={ui.input}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </label>
        <label>
          <span style={ui.label}>{t('sv.fDuration')}</span>
          <input
            style={ui.input}
            type="number"
            min={0}
            value={form.durationMinutes}
            onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
            placeholder="30"
          />
        </label>
        <label>
          <span style={ui.label}>{t('sv.fPrice').replace('{c}', currency)}</span>
          <input
            style={ui.input}
            type="number"
            min={0}
            step="0.01"
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
            required
          />
        </label>
        <label>
          <span style={ui.label}>{t('sv.fDiscount')}</span>
          <input
            style={ui.input}
            type="number"
            min={0}
            max={90}
            value={form.discount}
            onChange={(e) => setForm({ ...form, discount: e.target.value })}
          />
        </label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginTop: 12, alignItems: 'end' }}>
        <label><span style={ui.label}>{t('sv.fCategory')}</span>
          <select style={ui.input} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
            <option value="">{t('sv.optUncategorised')}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ce2e8f0)', paddingBottom: 8, whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={form.isFeatured} onChange={(e) => setForm({ ...form, isFeatured: e.target.checked })} /> {t('sv.popularLabel')}
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ce2e8f0)', paddingBottom: 8, whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={form.priceFrom} onChange={(e) => setForm({ ...form, priceFrom: e.target.checked })} /> {t('sv.fromPrice')}
        </label>
        <TurnSelect value={form.turnValue} onChange={(v) => setForm({ ...form, turnValue: v })} t={t} />
      </div>
      <label style={{ display: 'block', marginTop: 12 }}>
        <span style={ui.label}>{t('sv.fDescription')}</span>
        <input
          style={ui.input}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </label>

      <ImageField value={form.imageUrl} onChange={(v) => setForm({ ...form, imageUrl: v })} token={token} />

      <div style={{ marginTop: 12 }}>
        <span style={ui.label}>{t('sv.staffWhoDo')}</span>
        <StaffPicker all={staff} ids={staffIds} set={setStaffIds} />
      </div>

      {error && <div style={ui.banner}>{error}</div>}
      <button type="submit" disabled={submitting} style={{ ...ui.primaryBtn, marginTop: 14 }}>
        {submitting ? t('sv.creating') : t('sv.createService')}
      </button>
    </form>
  );
}

/**
 * Optional service photo. A public https:// image URL with a live thumbnail so the
 * salon sees exactly what the customer will see. Empty = no image (the customer
 * menu simply hides the picture, staying tidy).
 */
/**
 * Resize an uploaded photo down to a small JPEG entirely in the browser (no server
 * storage needed) and hand back a data: URL. A menu thumbnail never needs more than
 * ~640px, so this keeps each image to tens of KB — small enough to store inline.
 */
// Is external image storage (Hostinger/FTP) configured? Checked ONCE per page and
// cached, so uploads don't waste a round-trip discovering it every time. When it is
// configured the photo is pushed there; when it isn't, we keep the old inline method.
let _storageReady: Promise<boolean> | null = null;
function storageConfigured(token: string): Promise<boolean> {
  if (!_storageReady) {
    _storageReady = apiFetch<{ configured: boolean }>('/uploads/storage/status', { token })
      .then((r) => !!r?.configured)
      .catch(() => false);
  }
  return _storageReady;
}

function ImageField({ value, onChange, token }: { value: string; onChange: (v: string) => void; token: string }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const show = value.trim();
  const ok = /^https:\/\/\S+$/.test(show) || show.startsWith('data:image/');

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the same file be re-picked later
    if (!file) return;
    if (!file.type.startsWith('image/')) { setErr(t('sv.imgNotImage')); return; }
    setErr(null); setBusy(true);
    try {
      // Always shrink to a light, capped size first — a heavy original never reaches
      // the API or the DB, whichever path (FTP or inline) we end up taking.
      const out = await compressImageToFit(file, { maxSide: 512, maxChars: 130000, quality: 0.8 });
      if (await storageConfigured(token)) {
        try {
          const r = await apiFetch<{ url?: string }>('/uploads/service-photo', { method: 'POST', token, body: { dataUrl: out } });
          if (r?.url) { onChange(r.url); return; }
        } catch { /* storage hiccup — fall through to the inline method below */ }
      }
      onChange(out);
    } catch { setErr(t('sv.imgFailed')); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <span style={ui.label}>{t('sv.fImage')}</span>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span style={{ width: 52, height: 52, borderRadius: 10, flexShrink: 0, overflow: 'hidden', display: 'grid', placeItems: 'center', background: 'var(--c0f172a)', border: '1px solid var(--c334155)', color: 'var(--c94a3b8)', fontSize: 18 }}>
          {ok
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={show} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.display = 'none'; }} />
            : '🖼️'}
        </span>
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
          style={{ ...ui.primaryBtn, padding: '9px 14px', whiteSpace: 'nowrap', opacity: busy ? 0.6 : 1 }}>
          {busy ? t('sv.imgUploading') : `⬆ ${t('sv.imgUpload')}`}
        </button>
        {ok && (
          <button type="button" onClick={() => { onChange(''); setErr(null); }}
            style={{ ...ui.dangerBtn, padding: '9px 12px', whiteSpace: 'nowrap' }}>{t('sv.imgRemove')}</button>
        )}
        <input ref={fileRef} type="file" accept="image/*" onChange={onPick} style={{ display: 'none' }} />
      </div>
      {/* Or paste a link — still supported for anyone who hosts images elsewhere. */}
      <input style={{ ...ui.input, marginTop: 8, width: '100%' }}
        value={show.startsWith('data:') ? '' : value}
        placeholder={t('sv.imgOrPaste')}
        onChange={(e) => onChange(e.target.value)} />
      {err && <div style={{ fontSize: 11.5, color: 'var(--cf87171)', marginTop: 5 }}>{err}</div>}
      <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginTop: 5 }}>{t('sv.fImageHelp')}</div>
    </div>
  );
}

/**
 * Staff multi-select shown on the service form: which technicians can perform
 * this service. Active techs first; inactive shown dimmed so they aren't
 * silently dropped. Writes to the same staff_services join as the Staff page.
 */
function StaffPicker({ all, ids, set }: { all: Staff[]; ids: string[]; set: (v: string[]) => void }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  if (all.length === 0) {
    return <p style={{ color: 'var(--c94a3b8)', fontSize: 13 }}>{t('sv.noStaff')} <a href="/salon/staff" style={{ color: 'var(--c818cf8)' }}>{t('sv.staffLink')}</a></p>;
  }
  const has = (id: string) => ids.includes(id);
  const toggle = (id: string) => set(has(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  const ordered = [...all].sort((a, b) => Number(b.isActive) - Number(a.isActive));
  const allOn = ids.length >= all.length;
  const fullName = (s: Staff) => `${s.firstName}${s.lastName ? ' ' + s.lastName : ''}`;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{t('sv.staffHint')}</span>
        <span style={{ fontSize: 12, color: 'var(--c64748b)' }}>· {ids.length}/{all.length}</span>
        <button type="button" onClick={() => set(allOn ? [] : all.map((s) => s.id))} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 999, border: '1px solid #6366f1', background: 'transparent', color: 'var(--ca5b4fc)', cursor: 'pointer', fontWeight: 600 }}>
          {allOn ? t('sv.staffClear') : t('sv.staffAll')}
        </button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {ordered.map((s) => {
          const on = has(s.id);
          return (
            <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, border: `1px solid ${on ? '#6366f1' : 'var(--c475569)'}`, background: on ? 'var(--c312e81)' : 'transparent', color: on ? 'var(--cc7d2fe)' : 'var(--ccbd5e1)', fontSize: 13, cursor: 'pointer', opacity: s.isActive ? 1 : 0.6 }}>
              <input type="checkbox" checked={on} onChange={() => toggle(s.id)} />
              {fullName(s)}{!s.isActive && <span style={{ fontSize: 10, color: 'var(--c64748b)' }}> ({t('sv.staffOff')})</span>}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ padding: '6px 12px', borderRadius: 999, fontSize: 13, cursor: 'pointer', border: `1px solid ${active ? '#6366f1' : 'var(--c334155)'}`, background: active ? 'var(--c312e81)' : 'transparent', color: active ? 'var(--cc7d2fe)' : 'var(--c94a3b8)' }}>
      {children}
    </button>
  );
}

function CategoryManager({ token, categories, onChanged, defaultOpen }: { token: string; categories: Category[]; onChanged: () => void; defaultOpen?: boolean }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [open, setOpen] = useState(!!defaultOpen);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    try {
      await apiFetch('/services/categories', { method: 'POST', token, body: { name: name.trim(), sortOrder: categories.length } });
      setName('');
      onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : 'Create failed'); }
  }
  async function rename(c: Category) {
    const next = prompt(t('sv.renamePrompt'), c.name);
    if (!next || next.trim() === c.name) return;
    try { await apiFetch(`/services/categories/${c.id}`, { method: 'PATCH', token, body: { name: next.trim() } }); onChanged(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Rename failed'); }
  }
  async function move(c: Category, dir: -1 | 1) {
    try { await apiFetch(`/services/categories/${c.id}`, { method: 'PATCH', token, body: { sortOrder: Math.max(0, c.sortOrder + dir) } }); onChanged(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Reorder failed'); }
  }
  async function remove(c: Category) {
    if (!confirm(t('sv.deleteCatConfirm').replace('{name}', c.name))) return;
    try { await apiFetch(`/services/categories/${c.id}`, { method: 'DELETE', token }); onChanged(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Delete failed'); }
  }

  return (
    <div style={{ ...ui.card, marginBottom: 16 }}>
      <button onClick={() => setOpen((o) => !o)} style={{ background: 'none', border: 'none', color: 'var(--ccbd5e1)', cursor: 'pointer', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, padding: 0 }}>
        <span style={{ fontSize: 11, transform: open ? 'rotate(90deg)' : 'none' }}>▶</span>
        {t('sv.menuCategories')} ({categories.length})
      </button>
      {open && (
        <div style={{ marginTop: 12 }}>
          {error && <div style={ui.banner}>{error}</div>}
          {categories.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              {categories.map((c) => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                  <span style={{ flex: 1 }}>{c.name}</span>
                  <button onClick={() => move(c, -1)} style={miniBtn} aria-label={t('sv.moveUp')}>↑</button>
                  <button onClick={() => move(c, 1)} style={miniBtn} aria-label={t('sv.moveDown')}>↓</button>
                  <button onClick={() => rename(c)} style={miniBtn}>{t('sv.rename')}</button>
                  <button onClick={() => remove(c)} style={{ ...miniBtn, color: 'var(--ink-bad)', borderColor: '#ef4444' }}>{t('sv.delete')}</button>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={add} style={{ display: 'flex', gap: 8 }}>
            <input style={{ ...ui.input, flex: 1 }} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('sv.newCatPh')} />
            <button type="submit" style={ui.primaryBtn}>{t('sv.add')}</button>
          </form>
        </div>
      )}
    </div>
  );
}

const miniBtn: React.CSSProperties = { padding: '4px 10px', borderRadius: 6, border: '1px solid var(--c475569)', background: 'transparent', color: 'var(--ccbd5e1)', fontSize: 12, cursor: 'pointer' };
function actBtn(bg: string): React.CSSProperties {
  return { padding: '6px 12px', borderRadius: 8, border: 'none', background: bg, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', minWidth: 64 };
}

// ---- Weekday auto-discounts ------------------------------------------------
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_VI = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
interface DiscRule { day: number; categoryId: string | null; percent: number }

function WeekdayDiscountCard({ token, categories, defaultOpen, onSaved }: { token: string; categories: Category[]; defaultOpen?: boolean; onSaved?: () => void }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const dow = lang === 'vi' ? DOW_VI : DOW;
  const [open, setOpen] = useState(!!defaultOpen);
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState('');
  const [run, setRun] = useState<RunWindow>({ startDate: '', endDate: '' });
  const [rules, setRules] = useState<DiscRule[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open || loaded) return;
    apiFetch<{ weekdayDiscounts?: { enabled: boolean; message: string; rules: DiscRule[]; startDate?: string | null; endDate?: string | null } }>('/settings', { token })
      .then((s) => {
        const w = s.weekdayDiscounts;
        if (w) { setEnabled(!!w.enabled); setMessage(w.message || ''); setRules(Array.isArray(w.rules) ? w.rules : []); setRun(runOf(w)); }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [open, loaded, token]);

  function upd(i: number, patch: Partial<DiscRule>) { setRules(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r))); }
  async function save() {
    setBusy(true); setMsg(null);
    try { await apiFetch('/settings/weekday-discounts', { method: 'PATCH', token, body: { enabled, message, rules, ...runBody(run) } }); setMsg(t('sv.saved')); onSaved?.(); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Save failed'); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ ...ui.card, marginBottom: 16 }}>
      <button onClick={() => setOpen((o) => !o)} style={{ background: 'none', border: 'none', color: 'var(--ce2e8f0)', fontSize: 15, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
        {open ? '▾' : '▸'} {t('sv.weekdayTitle')}
      </button>
      {open && (
        <div style={{ marginTop: 12 }}>
          <p style={{ color: 'var(--c94a3b8)', fontSize: 13, margin: '0 0 10px' }}>{t('sv.weekdayDesc')}</p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span style={{ fontSize: 14 }}>{t('sv.weekdayEnable')}</span>
          </label>
          <RunDates value={run} onChange={setRun} vi={lang === 'vi'} />
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={ui.label}>{t('sv.weekdayHeadline')}</span>
            <input style={ui.input} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('sv.weekdayHeadlinePh')} />
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rules.length === 0 && <p style={{ color: 'var(--c94a3b8)', fontSize: 13 }}>{t('sv.weekdayNoRules')}</p>}
            {rules.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <select value={r.day} onChange={(e) => upd(i, { day: parseInt(e.target.value, 10) })} style={{ ...ui.input, width: 'auto' }}>
                  {dow.map((d, idx) => <option key={idx} value={idx}>{d}</option>)}
                </select>
                <select value={r.categoryId ?? ''} onChange={(e) => upd(i, { categoryId: e.target.value || null })} style={{ ...ui.input, width: 'auto' }}>
                  <option value="">{t('sv.allCategories')}</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <input type="number" min={1} max={90} value={r.percent} onChange={(e) => upd(i, { percent: parseInt(e.target.value, 10) || 0 })} style={{ ...ui.input, width: 90 }} />
                <span style={{ color: 'var(--c94a3b8)', fontSize: 13 }}>{t('sv.percentOff')}</span>
                <button onClick={() => setRules(rules.filter((_, idx) => idx !== i))} style={ui.dangerBtn}>{t('sv.remove')}</button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => setRules([...rules, { day: 2, categoryId: null, percent: 10 }])} style={{ ...ui.primaryBtn, background: 'transparent', color: 'var(--ce2e8f0)', border: '1px solid var(--c475569)' }}>{t('sv.addRule')}</button>
            <button onClick={save} disabled={busy} style={ui.primaryBtn}>{busy ? t('sv.saving') : t('sv.saveDiscounts')}</button>
            {msg && <span style={{ color: msg.startsWith('✓') ? 'var(--ink-good)' : 'var(--cf87171)', fontSize: 13 }}>{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- First-visit discount (automatic % off for new customers) ---------------
interface VisitTier { visit: number; percent: number }

function FirstVisitDiscountCard({ token, defaultOpen, onSaved }: { token: string; defaultOpen?: boolean; onSaved?: () => void }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [open, setOpen] = useState(!!defaultOpen);
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState('');
  const [run, setRun] = useState<RunWindow>({ startDate: '', endDate: '' });
  const [rules, setRules] = useState<VisitTier[]>([{ visit: 1, percent: 10 }]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open || loaded) return;
    apiFetch<{ firstVisitDiscount?: { enabled: boolean; percent: number; message: string; rules?: VisitTier[]; startDate?: string | null; endDate?: string | null } }>('/settings', { token })
      .then((s) => {
        const f = s.firstVisitDiscount;
        if (f) {
          setEnabled(!!f.enabled); setMessage(f.message || ''); setRun(runOf(f));
          setRules(Array.isArray(f.rules) && f.rules.length ? f.rules : [{ visit: 1, percent: f.percent || 10 }]);
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [open, loaded, token]);

  function upd(i: number, patch: Partial<VisitTier>) { setRules(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r))); }
  async function save() {
    setBusy(true); setMsg(null);
    try { await apiFetch('/settings/first-visit-discount', { method: 'PATCH', token, body: { enabled, message, rules, ...runBody(run) } }); setMsg(t('sv.saved')); onSaved?.(); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Save failed'); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ ...ui.card, marginBottom: 16 }}>
      <button onClick={() => setOpen((o) => !o)} style={{ background: 'none', border: 'none', color: 'var(--ce2e8f0)', fontSize: 15, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
        {open ? '▾' : '▸'} {t('sv.fvTitle')}
      </button>
      {open && (
        <div style={{ marginTop: 12 }}>
          <p style={{ color: 'var(--c94a3b8)', fontSize: 13, margin: '0 0 10px' }}>{t('sv.fvDesc')}</p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span style={{ fontSize: 14 }}>{t('sv.fvEnable')}</span>
          </label>
          <RunDates value={run} onChange={setRun} vi={lang === 'vi'} />
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={ui.label}>{t('sv.fvHeadline')}</span>
            <input style={ui.input} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="10% off your first visit!" />
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rules.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--c94a3b8)', fontSize: 13 }}>{t('sv.fvVisitNo')}</span>
                <input type="number" min={1} max={100} value={r.visit} onChange={(e) => upd(i, { visit: parseInt(e.target.value, 10) || 1 })} style={{ ...ui.input, width: 80 }} />
                <input type="number" min={1} max={90} value={r.percent} onChange={(e) => upd(i, { percent: parseInt(e.target.value, 10) || 0 })} style={{ ...ui.input, width: 90 }} />
                <span style={{ color: 'var(--c94a3b8)', fontSize: 13 }}>{t('sv.percentOff')}</span>
                <button onClick={() => setRules(rules.filter((_, idx) => idx !== i))} style={ui.dangerBtn}>{t('sv.remove')}</button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => setRules([...rules, { visit: Math.min(100, (rules[rules.length - 1]?.visit ?? 0) + 1), percent: 10 }])} style={{ ...ui.primaryBtn, background: 'transparent', color: 'var(--ce2e8f0)', border: '1px solid var(--c475569)' }}>{t('sv.grAddTier')}</button>
            <button onClick={save} disabled={busy} style={ui.primaryBtn}>{busy ? t('sv.saving') : t('sv.saveDiscounts')}</button>
            {msg && <span style={{ color: msg.startsWith('✓') ? 'var(--ink-good)' : 'var(--cf87171)', fontSize: 13 }}>{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Group discount (bring your friends — tiered by party size) --------------
interface GroupTier { minSize: number; percent: number }

function GroupDiscountCard({ token, defaultOpen, onSaved }: { token: string; defaultOpen?: boolean; onSaved?: () => void }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [open, setOpen] = useState(!!defaultOpen);
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState('');
  const [run, setRun] = useState<RunWindow>({ startDate: '', endDate: '' });
  const [tiers, setTiers] = useState<GroupTier[]>([{ minSize: 2, percent: 10 }, { minSize: 3, percent: 15 }]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open || loaded) return;
    apiFetch<{ groupDiscount?: { enabled: boolean; message: string; tiers: GroupTier[]; startDate?: string | null; endDate?: string | null } }>('/settings', { token })
      .then((s) => {
        const g = s.groupDiscount;
        if (g) { setEnabled(!!g.enabled); setMessage(g.message || ''); if (Array.isArray(g.tiers) && g.tiers.length) setTiers(g.tiers); setRun(runOf(g)); }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [open, loaded, token]);

  function upd(i: number, patch: Partial<GroupTier>) { setTiers(tiers.map((r, idx) => (idx === i ? { ...r, ...patch } : r))); }
  async function save() {
    setBusy(true); setMsg(null);
    try { await apiFetch('/settings/group-discount', { method: 'PATCH', token, body: { enabled, message, tiers, ...runBody(run) } }); setMsg(t('sv.saved')); onSaved?.(); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Save failed'); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ ...ui.card, marginBottom: 16 }}>
      <button onClick={() => setOpen((o) => !o)} style={{ background: 'none', border: 'none', color: 'var(--ce2e8f0)', fontSize: 15, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
        {open ? '▾' : '▸'} {t('sv.grTitle')}
      </button>
      {open && (
        <div style={{ marginTop: 12 }}>
          <p style={{ color: 'var(--c94a3b8)', fontSize: 13, margin: '0 0 10px' }}>{t('sv.grDesc')}</p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span style={{ fontSize: 14 }}>{t('sv.grEnable')}</span>
          </label>
          <RunDates value={run} onChange={setRun} vi={lang === 'vi'} />
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={ui.label}>{t('sv.grHeadline')}</span>
            <input style={ui.input} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Bring your friends and save!" />
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {tiers.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input type="number" min={2} max={20} value={r.minSize} onChange={(e) => upd(i, { minSize: parseInt(e.target.value, 10) || 2 })} style={{ ...ui.input, width: 80 }} />
                <span style={{ color: 'var(--c94a3b8)', fontSize: 13 }}>{t('sv.grPeople')}</span>
                <input type="number" min={1} max={90} value={r.percent} onChange={(e) => upd(i, { percent: parseInt(e.target.value, 10) || 0 })} style={{ ...ui.input, width: 90 }} />
                <span style={{ color: 'var(--c94a3b8)', fontSize: 13 }}>{t('sv.percentOff')}</span>
                <button onClick={() => setTiers(tiers.filter((_, idx) => idx !== i))} style={ui.dangerBtn}>{t('sv.remove')}</button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => setTiers([...tiers, { minSize: Math.min(20, (tiers[tiers.length - 1]?.minSize ?? 1) + 1), percent: 10 }])} style={{ ...ui.primaryBtn, background: 'transparent', color: 'var(--ce2e8f0)', border: '1px solid var(--c475569)' }}>{t('sv.grAddTier')}</button>
            <button onClick={save} disabled={busy} style={ui.primaryBtn}>{busy ? t('sv.saving') : t('sv.saveDiscounts')}</button>
            {msg && <span style={{ color: msg.startsWith('✓') ? 'var(--ink-good)' : 'var(--cf87171)', fontSize: 13 }}>{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Specific-date discounts (one-off dates / ranges) ----------------------
interface DateRule { startDate: string; endDate: string | null; categoryId: string | null; percent: number; label?: string }

function DateDiscountCard({ token, categories, defaultOpen, onSaved }: { token: string; categories: Category[]; defaultOpen?: boolean; onSaved?: () => void }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [open, setOpen] = useState(!!defaultOpen);
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [rules, setRules] = useState<DateRule[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open || loaded) return;
    apiFetch<{ dateDiscounts?: { enabled: boolean; rules: DateRule[] } }>('/settings', { token })
      .then((s) => {
        const d = s.dateDiscounts;
        if (d) { setEnabled(!!d.enabled); setRules(Array.isArray(d.rules) ? d.rules : []); }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [open, loaded, token]);

  function upd(i: number, patch: Partial<DateRule>) { setRules(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r))); }
  async function save() {
    setBusy(true); setMsg(null);
    try { await apiFetch('/settings/date-discounts', { method: 'PATCH', token, body: { enabled, rules } }); setMsg(t('sv.saved')); onSaved?.(); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Save failed'); }
    finally { setBusy(false); }
  }
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div style={{ ...ui.card, marginBottom: 16 }}>
      <button onClick={() => setOpen((o) => !o)} style={{ background: 'none', border: 'none', color: 'var(--ce2e8f0)', fontSize: 15, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
        {open ? '▾' : '▸'} {t('sv.dateTitle')}
      </button>
      {open && (
        <div style={{ marginTop: 12 }}>
          <p style={{ color: 'var(--c94a3b8)', fontSize: 13, margin: '0 0 10px' }}>{t('sv.dateDesc')}</p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span style={{ fontSize: 14 }}>{t('sv.dateEnable')}</span>
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {rules.length === 0 && <p style={{ color: 'var(--c94a3b8)', fontSize: 13 }}>{t('sv.dateNoRules')}</p>}
            {rules.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <label style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{t('sv.dateFrom')}
                  <input type="date" value={r.startDate || ''} min={today} onChange={(e) => upd(i, { startDate: e.target.value })} style={{ ...ui.input, width: 'auto', display: 'block', marginTop: 3 }} />
                </label>
                <label style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{t('sv.dateTo')}
                  <input type="date" value={r.endDate || ''} min={r.startDate || today} onChange={(e) => upd(i, { endDate: e.target.value || null })} style={{ ...ui.input, width: 'auto', display: 'block', marginTop: 3 }} />
                </label>
                <select value={r.categoryId ?? ''} onChange={(e) => upd(i, { categoryId: e.target.value || null })} style={{ ...ui.input, width: 'auto' }}>
                  <option value="">{t('sv.allCategories')}</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="number" min={1} max={90} value={r.percent} onChange={(e) => upd(i, { percent: parseInt(e.target.value, 10) || 0 })} style={{ ...ui.input, width: 74 }} />
                  <span style={{ color: 'var(--c94a3b8)', fontSize: 13 }}>{t('sv.percentOff')}</span>
                </div>
                <input value={r.label ?? ''} onChange={(e) => upd(i, { label: e.target.value })} placeholder={t('sv.dateLabelPh')} style={{ ...ui.input, width: 150 }} />
                <button onClick={() => setRules(rules.filter((_, idx) => idx !== i))} style={ui.dangerBtn}>{t('sv.remove')}</button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => setRules([...rules, { startDate: today, endDate: null, categoryId: null, percent: 10 }])} style={{ ...ui.primaryBtn, background: 'transparent', color: 'var(--ce2e8f0)', border: '1px solid var(--c475569)' }}>{t('sv.dateAddRule')}</button>
            <button onClick={save} disabled={busy} style={ui.primaryBtn}>{busy ? t('sv.saving') : t('sv.saveDiscounts')}</button>
            {msg && <span style={{ color: msg.startsWith('✓') ? 'var(--ink-good)' : 'var(--cf87171)', fontSize: 13 }}>{msg}</span>}
          </div>
          <p style={{ color: 'var(--c64748b)', fontSize: 12, marginTop: 10 }}>{t('sv.dateHint')}</p>
        </div>
      )}
    </div>
  );
}

/**
 * Edit many services at once — the ticked rows.
 *
 * Every field starts on "keep as is"; only what the person changes is sent,
 * one PATCH per service through the same endpoint the single-row editor uses
 * (so the same tenant check and validation apply). Price can be set to one
 * amount or moved by a percent or an amount, which is how a salon actually
 * reprices ("everything +$5", "acrylics +10%").
 */
function BulkServiceEdit({ ids, services, categories, currency, token, vi, onDone }: {
  ids: string[]; services: Service[]; categories: Category[]; currency: string; token: string; vi: boolean; onDone: () => Promise<void> | void;
}) {
  const T = (v: string, e: string) => ind(vi ? v : e);
  const KEEP = '__keep__';
  const [cat, setCat] = useState<string>(KEEP);
  const [dur, setDur] = useState('');
  const [priceMode, setPriceMode] = useState<'keep' | 'set' | 'pct' | 'add'>('keep');
  const [priceVal, setPriceVal] = useState('');
  const [from, setFrom] = useState<'keep' | 'on' | 'off'>('keep');
  const [active, setActive] = useState<'keep' | 'on' | 'off'>('keep');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const picked = services.filter((s) => ids.includes(s.id));
  const durN = dur.trim() === '' ? null : Math.max(0, Math.round(Number(dur)));
  const pv = priceVal.trim() === '' ? null : Number(priceVal);
  const priceOk = priceMode === 'keep' || (pv != null && Number.isFinite(pv) && (priceMode !== 'set' || pv >= 0));
  const nothing = cat === KEEP && durN == null && priceMode === 'keep' && from === 'keep' && active === 'keep';

  const newPrice = (cents: number): number => {
    if (priceMode === 'set' && pv != null) return toMinorUnits(String(pv), currency);
    if (priceMode === 'pct' && pv != null) return Math.max(0, Math.round(cents * (1 + pv / 100)));
    if (priceMode === 'add' && pv != null) return Math.max(0, cents + toMinorUnits(String(Math.abs(pv)), currency) * (pv < 0 ? -1 : 1));
    return cents;
  };

  async function apply() {
    if (nothing || !priceOk || busy) return;
    if (!confirm(T(`Áp dụng thay đổi cho ${picked.length} dịch vụ đã chọn?`, `Apply these changes to the ${picked.length} selected services?`))) return;
    setBusy(true); setMsg(null);
    let failed = 0;
    for (const s of picked) {
      const body: Record<string, unknown> = {};
      if (cat !== KEEP) body.categoryId = cat === '' ? null : cat;
      if (durN != null && Number.isFinite(durN)) body.durationMinutes = durN;
      if (priceMode !== 'keep') body.priceCents = newPrice(s.priceCents);
      if (from !== 'keep') body.priceFrom = from === 'on';
      if (active !== 'keep') body.isActive = active === 'on';
      try { await apiFetch(`/services/${s.id}`, { method: 'PATCH', token, body }); } catch { failed += 1; }
    }
    setBusy(false);
    if (failed) { setMsg(T(`${failed} dịch vụ chưa lưu được — thử lại.`, `${failed} services could not be saved — try again.`)); return; }
    setCat(KEEP); setDur(''); setPriceMode('keep'); setPriceVal(''); setFrom('keep'); setActive('keep');
    await onDone();
  }

  const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 150 };
  const lbl: React.CSSProperties = { fontSize: 12, color: 'var(--c94a3b8)', fontWeight: 600 };
  return (
    <div style={{ border: '1px solid #6366f1', background: 'rgba(99,102,241,.08)', borderRadius: 12, padding: '12px 14px', marginBottom: 10 }}>
      <div style={{ fontWeight: 700, color: 'var(--ce2e8f0)', marginBottom: 8 }}>
        ✏️ {T(`Sửa hàng loạt ${picked.length} dịch vụ`, `Edit ${picked.length} services at once`)}
        <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--c94a3b8)', marginLeft: 8 }}>{T('Ô nào để trống / "Giữ nguyên" thì không đổi.', 'Anything left blank / "Keep" stays as it is.')}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
        <label style={field}>
          <span style={lbl}>{T('Danh mục', 'Category')}</span>
          <select value={cat} onChange={(e) => setCat(e.target.value)} style={ui.input}>
            <option value={KEEP}>{T('Giữ nguyên', 'Keep')}</option>
            <option value="">{T('(Không danh mục)', '(No category)')}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label style={{ ...field, minWidth: 120 }}>
          <span style={lbl}>{T('Thời lượng (phút)', 'Duration (min)')}</span>
          <input type="number" min={0} step={5} inputMode="numeric" value={dur} placeholder={T('Giữ nguyên', 'Keep')} onChange={(e) => setDur(e.target.value)} style={ui.input} />
        </label>
        <label style={field}>
          <span style={lbl}>{T('Giá', 'Price')}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <select value={priceMode} onChange={(e) => setPriceMode(e.target.value as typeof priceMode)} style={{ ...ui.input, minWidth: 130 }}>
              <option value="keep">{T('Giữ nguyên', 'Keep')}</option>
              <option value="set">{T('Đặt bằng', 'Set to')}</option>
              <option value="add">{T('Tăng/giảm số tiền', 'Add / subtract')}</option>
              <option value="pct">{T('Tăng/giảm %', 'Change by %')}</option>
            </select>
            {priceMode !== 'keep' && (
              <input type="number" inputMode="decimal" value={priceVal} onChange={(e) => setPriceVal(e.target.value)}
                placeholder={priceMode === 'pct' ? T('vd 10 hoặc -10', 'e.g. 10 or -10') : priceMode === 'add' ? T('vd 5 hoặc -5', 'e.g. 5 or -5') : T('vd 45', 'e.g. 45')}
                style={{ ...ui.input, width: 110 }} />
            )}
          </div>
        </label>
        <label style={{ ...field, minWidth: 130 }}>
          <span style={lbl}>{T('Giá "từ" (và trở lên)', '"From" price (and up)')}</span>
          <select value={from} onChange={(e) => setFrom(e.target.value as typeof from)} style={ui.input}>
            <option value="keep">{T('Giữ nguyên', 'Keep')}</option>
            <option value="on">{T('Bật', 'On')}</option>
            <option value="off">{T('Tắt', 'Off')}</option>
          </select>
        </label>
        <label style={{ ...field, minWidth: 130 }}>
          <span style={lbl}>{T('Trạng thái', 'Status')}</span>
          <select value={active} onChange={(e) => setActive(e.target.value as typeof active)} style={ui.input}>
            <option value="keep">{T('Giữ nguyên', 'Keep')}</option>
            <option value="on">{T('Đang bật', 'Active')}</option>
            <option value="off">{T('Tắt', 'Off')}</option>
          </select>
        </label>
        <button type="button" onClick={apply} disabled={nothing || !priceOk || busy}
          style={{ ...ui.primaryBtn, opacity: nothing || !priceOk || busy ? 0.5 : 1, whiteSpace: 'nowrap' }}>
          {busy ? T('Đang lưu…', 'Saving…') : T('Áp dụng', 'Apply')}
        </button>
      </div>
      {priceMode !== 'keep' && priceOk && picked.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginTop: 8 }}>
          {T('Xem trước', 'Preview')}: {picked.slice(0, 3).map((s) => `${s.name} ${fromMinorUnits(s.priceCents, currency)} → ${fromMinorUnits(newPrice(s.priceCents), currency)}`).join(' · ')}{picked.length > 3 ? ' …' : ''}
        </div>
      )}
      {msg && <div style={{ fontSize: 12.5, color: 'var(--ink-bad)', marginTop: 8 }}>{msg}</div>}
    </div>
  );
}
