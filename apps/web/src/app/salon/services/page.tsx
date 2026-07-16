'use client';

import { useCallback, useEffect, useRef, useState, FormEvent } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';
import { useIsMobile } from '../../../lib/responsive';
import { MList, MCard, MHead, MRow, MActions } from '../../../components/MobileCard';
import { SearchBox, matchesQuery, sortNewest, usePaged, Pager } from '../../../components/ListFilter';

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
  const [q, setQ] = useState('');
  const [services, setServices] = useState<Service[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [catFilter, setCatFilter] = useState<string>('all');
  // Currency is a salon-level setting (Settings -> Payments). The whole Services
  // screen formats prices with it, so changing the currency there is reflected here.
  const [money, setMoney] = useState({ code: 'USD', symbol: '$', pos: 'before', decimals: 2 });

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [svc, cats, staffList, settings] = await Promise.all([
        apiFetch<Service[]>('/services', { token }),
        apiFetch<Category[]>('/services/categories', { token }),
        apiFetch<Staff[]>('/staff', { token }).catch(() => [] as Staff[]),
        apiFetch<{ booking?: { currency?: string; currencySymbol?: string; symbolPosition?: string; priceDecimals?: number } }>('/settings', { token }).catch(() => ({})),
      ]);
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
    const v = (cents / 100).toFixed(money.decimals);
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

  // Search + category filter, then newest first. (No date filter — a service
  // menu shouldn't be hidden by when it was created.)
  const visible = sortNewest(
    services.filter((s) =>
      matchesQuery(`${s.name} ${s.description ?? ''}`, q) &&
      (catFilter === 'all' || (catFilter === 'none' ? !s.categoryId : s.categoryId === catFilter))),
    (s) => s.createdAt,
  );
  const pg = usePaged(visible, 25);

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>{t('sv.title')}</h2>
        <div style={{ display: 'flex', gap: 8, width: isMobile ? '100%' : 'auto' }}>
          <button onClick={() => { setShowImport((s) => !s); setShowForm(false); }} style={{ ...ui.primaryBtn, flex: isMobile ? 1 : undefined, background: 'transparent', border: '1px solid #475569' }}>
            {showImport ? t('sv.close') : t('sv.importMenu')}
          </button>
          <button onClick={() => { setShowForm((s) => !s); setShowImport(false); }} style={{ ...ui.primaryBtn, flex: isMobile ? 1 : undefined }}>
            {showForm ? t('sv.close') : t('sv.newService')}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <SearchBox value={q} onChange={setQ} placeholder={t('sv.searchPh')} />
        <span style={{ color: '#94a3b8', fontSize: 13 }}>{visible.length} {t('sv.serviceWord')}</span>
      </div>

      {error && <div style={ui.banner}>{error}</div>}

      {showImport && <ImportPanel token={token!} onDone={async () => { setShowImport(false); await load(); }} />}

      <CategoryManager token={token!} categories={categories} onChanged={load} />

      <WeekdayDiscountCard token={token!} categories={categories} />
      <DateDiscountCard token={token!} categories={categories} />

      {categories.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '4px 0 16px' }}>
          <FilterChip active={catFilter === 'all'} onClick={() => setCatFilter('all')}>{t('sv.all')}</FilterChip>
          {categories.map((c) => (
            <FilterChip key={c.id} active={catFilter === c.id} onClick={() => setCatFilter(c.id)}>{c.name}</FilterChip>
          ))}
          <FilterChip active={catFilter === 'none'} onClick={() => setCatFilter('none')}>{t('sv.uncategorised')}</FilterChip>
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
        <p style={{ color: '#94a3b8' }}>{t('sv.loading')}</p>
      ) : isMobile ? (
        <>
          <MList>
            {visible.length === 0 && <p style={{ color: '#64748b', fontSize: 13 }}>{t('sv.empty')}</p>}
            {pg.paged.map((s) => (
              <ServiceCard key={s.id} service={s} token={token!} categories={categories} staff={staff} catName={catName} fmt={fmt} onToggle={() => toggleActive(s)} onDelete={() => remove(s.id)} onSaved={load} />
            ))}
          </MList>
          <Pager paged={pg} />
        </>
      ) : (
        <div style={{ border: '1px solid #334155', borderRadius: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#1e293b' }}>
                <th style={ui.th}>{t('sv.colName')}</th>
                <th style={{ ...ui.th, whiteSpace: 'nowrap' }}>{t('sv.colCategory')}</th>
                <th style={{ ...ui.th, whiteSpace: 'nowrap' }}>{t('sv.colDuration')}</th>
                <th style={{ ...ui.th, whiteSpace: 'nowrap' }}>{t('sv.colPrice')}</th>
                <th style={{ ...ui.th, whiteSpace: 'nowrap' }}>{t('sv.colStatus')}</th>
                <th style={{ ...ui.th, whiteSpace: 'nowrap' }}>{t('sv.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td style={ui.td} colSpan={6}>
                    {t('sv.empty')}
                  </td>
                </tr>
              )}
              {pg.paged.map((s) => (
                <FragmentRow key={s.id} service={s} token={token!} categories={categories} staff={staff} catName={catName} fmt={fmt} onToggle={() => toggleActive(s)} onDelete={() => remove(s.id)} onSaved={load} />
              ))}
            </tbody>
          </table>
          <div style={{ padding: '0 14px 12px' }}><Pager paged={pg} /></div>
        </div>
      )}
    </section>
  );
}

interface Addon { id: string; name: string; durationMinutes: number; priceCents: number; currency: string }

function FragmentRow({ service: s, token, categories, staff, catName, fmt, onToggle, onDelete, onSaved }: {
  service: Service; token: string; categories: Category[]; staff: Staff[]; catName: (id?: string | null) => string; fmt: (cents: number) => string; onToggle: () => void; onDelete: () => void; onSaved: () => void;
}) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  return (
    <>
      <tr style={{ borderTop: '1px solid #334155' }}>
        <td style={ui.td}>
          <div>
            {s.name}
            {s.isFeatured && <span style={{ marginLeft: 6, background: '#eab308', color: '#1f2937', borderRadius: 6, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>{t('sv.popular')}</span>}
          </div>
          {s.description && <div style={{ color: '#94a3b8', fontSize: 12 }}>{s.description}</div>}
        </td>
        <td style={{ ...ui.td, color: '#94a3b8' }}>{catName(s.categoryId)}</td>
        <td style={ui.td}>{s.durationMinutes} {t('sv.min')}</td>
        <td style={ui.td}>
          {s.discountPercent && s.discountPercent > 0 ? (
            <span>
              <span style={{ textDecoration: 'line-through', color: '#94a3b8', marginRight: 6 }}>{fmt(s.priceCents)}</span>
              <span style={{ color: '#22c55e', fontWeight: 600 }}>{fmt(Math.round((s.priceCents * (100 - s.discountPercent)) / 100))}</span>
              <span style={{ marginLeft: 6, background: '#ef4444', color: '#fff', borderRadius: 6, padding: '1px 6px', fontSize: 11, fontWeight: 700 }}>-{s.discountPercent}%</span>
            </span>
          ) : (
            fmt(s.priceCents)
          )}
        </td>
        <td style={{ ...ui.td, whiteSpace: 'nowrap' }}>
          <button onClick={onToggle} style={{ cursor: 'pointer', whiteSpace: 'nowrap', background: 'transparent', border: `1px solid ${s.isActive ? '#22c55e' : '#64748b'}`, color: s.isActive ? '#22c55e' : '#94a3b8', borderRadius: 999, padding: '3px 12px', fontSize: 12 }}>
            {s.isActive ? t('sv.active') : t('sv.inactive')}
          </button>
        </td>
        <td style={{ ...ui.td, whiteSpace: 'nowrap' }}>
          <div style={{ display: 'inline-flex', gap: 6 }}>
            <button onClick={() => setEditing((e) => !e)} style={actBtn(editing ? '#475569' : '#0ea5e9')}>
              {editing ? t('sv.close') : t('sv.edit')}
            </button>
            <button onClick={() => setOpen((o) => !o)} style={actBtn(open ? '#475569' : '#6366f1')}>
              {open ? t('sv.hide') : t('sv.addons')}
            </button>
            <button onClick={onDelete} style={actBtn('#b91c1c')}>{t('sv.delete')}</button>
          </div>
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={6} style={{ padding: 0, background: '#0f172a' }}>
            <EditServicePanel service={s} token={token} categories={categories} staff={staff} onSaved={onSaved} />
          </td>
        </tr>
      )}
      {open && (
        <tr>
          <td colSpan={6} style={{ padding: 0, background: '#0f172a' }}>
            <AddonsPanel serviceId={s.id} token={token} fmt={fmt} />
          </td>
        </tr>
      )}
    </>
  );
}

/** Mobile card equivalent of FragmentRow (the table renders <tr>; this renders a card). */
function ServiceCard({ service: s, token, categories, staff, catName, fmt, onToggle, onDelete, onSaved }: {
  service: Service; token: string; categories: Category[]; staff: Staff[]; catName: (id?: string | null) => string; fmt: (cents: number) => string; onToggle: () => void; onDelete: () => void; onSaved: () => void;
}) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  return (
    <>
      <MCard>
        <MHead right={<button onClick={onToggle} style={{ cursor: 'pointer', whiteSpace: 'nowrap', background: 'transparent', border: `1px solid ${s.isActive ? '#22c55e' : '#64748b'}`, color: s.isActive ? '#22c55e' : '#94a3b8', borderRadius: 999, padding: '3px 12px', fontSize: 12 }}>{s.isActive ? t('sv.active') : t('sv.inactive')}</button>}>
          {s.name}{s.isFeatured && <span style={{ marginLeft: 6, background: '#eab308', color: '#1f2937', borderRadius: 6, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>{t('sv.popular')}</span>}
        </MHead>
        {s.description && <div style={{ color: '#94a3b8', fontSize: 12 }}>{s.description}</div>}
        <MRow label={t('sv.colCategory')}>{catName(s.categoryId)}</MRow>
        <MRow label={t('sv.colDuration')}>{s.durationMinutes} {t('sv.min')}</MRow>
        <MRow label={t('sv.colPrice')}>
          {s.discountPercent && s.discountPercent > 0 ? (
            <span>
              <span style={{ textDecoration: 'line-through', color: '#94a3b8', marginRight: 6 }}>{fmt(s.priceCents)}</span>
              <span style={{ color: '#22c55e', fontWeight: 600 }}>{fmt(Math.round((s.priceCents * (100 - s.discountPercent)) / 100))}</span>
              <span style={{ marginLeft: 6, background: '#ef4444', color: '#fff', borderRadius: 6, padding: '1px 6px', fontSize: 11, fontWeight: 700 }}>-{s.discountPercent}%</span>
            </span>
          ) : fmt(s.priceCents)}
        </MRow>
        <MActions>
          <button onClick={() => setEditing((e) => !e)} style={actBtn(editing ? '#475569' : '#0ea5e9')}>{editing ? t('sv.close') : t('sv.edit')}</button>
          <button onClick={() => setOpen((o) => !o)} style={actBtn(open ? '#475569' : '#6366f1')}>{open ? t('sv.hide') : t('sv.addons')}</button>
          <button onClick={onDelete} style={actBtn('#b91c1c')}>{t('sv.delete')}</button>
        </MActions>
      </MCard>
      {editing && <div style={{ padding: 12, background: '#0f172a', border: '1px solid #334155', borderRadius: 10 }}><EditServicePanel service={s} token={token} categories={categories} staff={staff} onSaved={onSaved} /></div>}
      {open && <div style={{ padding: 12, background: '#0f172a', border: '1px solid #334155', borderRadius: 10 }}><AddonsPanel serviceId={s.id} token={token} fmt={fmt} /></div>}
    </>
  );
}

function EditServicePanel({ service, token, categories, staff, onSaved }: { service: Service; token: string; categories: Category[]; staff: Staff[]; onSaved: () => void }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [form, setForm] = useState({
    name: service.name,
    description: service.description ?? '',
    duration: String(service.durationMinutes),
    price: (service.priceCents / 100).toString(),
    discount: String(service.discountPercent ?? 0),
    categoryId: service.categoryId ?? '',
    isFeatured: service.isFeatured ?? false,
    priceFrom: service.priceFrom ?? false,
    imageUrl: service.imageUrl ?? '',
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
          durationMinutes: parseInt(form.duration, 10),
          priceCents: Math.round(parseFloat(form.price) * 100),
          discountPercent: Math.min(90, Math.max(0, parseInt(form.discount, 10) || 0)),
          categoryId: form.categoryId || null,
          isFeatured: form.isFeatured,
          priceFrom: form.priceFrom,
          imageUrl: form.imageUrl.trim(),
          staffIds,
        },
      });
      if (updated && typeof updated === 'object') {
        setForm({
          name: updated.name,
          description: updated.description ?? '',
          duration: String(updated.durationMinutes),
          price: (updated.priceCents / 100).toString(),
          discount: String(updated.discountPercent ?? 0),
          categoryId: updated.categoryId ?? '',
          isFeatured: updated.isFeatured ?? false,
          priceFrom: updated.priceFrom ?? false,
          imageUrl: updated.imageUrl ?? '',
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
      <div style={{ fontSize: 13, color: '#cbd5e1', marginBottom: 8, fontWeight: 600 }}>{t('sv.editService')}</div>
      {error && <div style={ui.banner}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        <label><span style={ui.label}>{t('sv.fName')}</span><input style={ui.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
        <label><span style={ui.label}>{t('sv.fDuration')}</span><input style={ui.input} type="number" min={1} value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} required /></label>
        <label><span style={ui.label}>{t('sv.fPrice').replace('{c}', service.currency)}</span><input style={ui.input} type="number" min={0} step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required /></label>
        <label><span style={ui.label}>{t('sv.fDiscount')}</span><input style={ui.input} type="number" min={0} max={90} value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} /></label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginTop: 10, alignItems: 'end' }}>
        <label><span style={ui.label}>{t('sv.fCategory')}</span>
          <select style={ui.input} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
            <option value="">{t('sv.optUncategorised')}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#e2e8f0', paddingBottom: 8 }}>
          <input type="checkbox" checked={form.isFeatured} onChange={(e) => setForm({ ...form, isFeatured: e.target.checked })} /> {t('sv.popularLabel')}
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#e2e8f0', paddingBottom: 8 }}>
          <input type="checkbox" checked={form.priceFrom} onChange={(e) => setForm({ ...form, priceFrom: e.target.checked })} /> {t('sv.fromPrice')}
        </label>
      </div>
      <label style={{ display: 'block', marginTop: 10 }}>
        <span style={ui.label}>{t('sv.fDescription')}</span>
        <input style={ui.input} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </label>

      <ImageField value={form.imageUrl} onChange={(v) => { setForm({ ...form, imageUrl: v }); setSaved(false); }} />

      <div style={{ marginTop: 12 }}>
        <span style={ui.label}>{t('sv.staffWhoDo')}</span>
        <StaffPicker all={staff} ids={staffIds} set={(v) => { setStaffIds(v); setSaved(false); }} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
        <button type="submit" disabled={saving} style={ui.primaryBtn}>{saving ? t('sv.saving') : t('sv.saveChanges')}</button>
        {saved && <span style={{ color: '#22c55e', fontSize: 13 }}>{t('sv.savedLive')}</span>}
      </div>
    </form>
  );
}

function AddonsPanel({ serviceId, token, fmt }: { serviceId: string; token: string; fmt: (cents: number) => string }) {
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
        body: { name: form.name, durationMinutes: parseInt(form.duration, 10), priceCents: Math.round(parseFloat(form.price) * 100) },
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
      <div style={{ fontSize: 13, color: '#cbd5e1', marginBottom: 8, fontWeight: 600 }}>{t('sv.addonsTitle')}</div>
      {error && <div style={ui.banner}>{error}</div>}
      {addons.length === 0 ? (
        <div style={{ color: '#64748b', fontSize: 13, marginBottom: 10 }}>{t('sv.noAddons')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {addons.map((a) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
              <span style={{ flex: 1 }}>{a.name}</span>
              <span style={{ color: '#94a3b8' }}>{a.durationMinutes} {t('sv.min')}</span>
              <span style={{ color: '#22c55e' }}>{fmt(a.priceCents)}</span>
              <button onClick={() => remove(a.id)} style={{ ...ui.dangerBtn, padding: '3px 8px', fontSize: 12 }}>{t('sv.remove')}</button>
            </div>
          ))}
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
          <input style={ui.input} type="number" min={0} step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
        </div>
        <button type="submit" style={{ ...ui.primaryBtn, padding: '9px 14px' }}>{t('sv.add')}</button>
      </form>
    </div>
  );
}

function CreateServiceForm({ token, categories, staff, currency, onCreated }: { token: string; categories: Category[]; staff: Staff[]; currency: string; onCreated: () => void }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [form, setForm] = useState({ name: '', description: '', durationMinutes: '30', price: '25', discount: '0', categoryId: '', isFeatured: false, priceFrom: false, imageUrl: '' });
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
          durationMinutes: parseInt(form.durationMinutes, 10),
          priceCents: Math.round(parseFloat(form.price) * 100),
          discountPercent: Math.min(90, Math.max(0, parseInt(form.discount, 10) || 0)),
          categoryId: form.categoryId || null,
          isFeatured: form.isFeatured,
          priceFrom: form.priceFrom,
          imageUrl: form.imageUrl.trim() || undefined,
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
            min={1}
            value={form.durationMinutes}
            onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
            required
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
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#e2e8f0', paddingBottom: 8, whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={form.isFeatured} onChange={(e) => setForm({ ...form, isFeatured: e.target.checked })} /> {t('sv.popularLabel')}
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#e2e8f0', paddingBottom: 8, whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={form.priceFrom} onChange={(e) => setForm({ ...form, priceFrom: e.target.checked })} /> {t('sv.fromPrice')}
        </label>
      </div>
      <label style={{ display: 'block', marginTop: 12 }}>
        <span style={ui.label}>{t('sv.fDescription')}</span>
        <input
          style={ui.input}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </label>

      <ImageField value={form.imageUrl} onChange={(v) => setForm({ ...form, imageUrl: v })} />

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
async function compressImage(file: File, maxSide = 640, quality = 0.82): Promise<string> {
  const dataUrl: string = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = () => rej(new Error('read failed'));
    fr.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('decode failed'));
    im.src = dataUrl;
  });
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

function ImageField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
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
      let out = await compressImage(file);
      // Very large source → shrink harder so it always fits comfortably inline.
      if (out.length > 650_000) out = await compressImage(file, 480, 0.72);
      if (out.length > 650_000) { setErr(t('sv.imgTooBig')); return; }
      onChange(out);
    } catch { setErr(t('sv.imgFailed')); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <span style={ui.label}>{t('sv.fImage')}</span>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span style={{ width: 52, height: 52, borderRadius: 10, flexShrink: 0, overflow: 'hidden', display: 'grid', placeItems: 'center', background: '#0f172a', border: '1px solid #334155', color: '#475569', fontSize: 18 }}>
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
      {err && <div style={{ fontSize: 11.5, color: '#f87171', marginTop: 5 }}>{err}</div>}
      <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 5 }}>{t('sv.fImageHelp')}</div>
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
    return <p style={{ color: '#94a3b8', fontSize: 13 }}>{t('sv.noStaff')} <a href="/salon/staff" style={{ color: '#818cf8' }}>{t('sv.staffLink')}</a></p>;
  }
  const has = (id: string) => ids.includes(id);
  const toggle = (id: string) => set(has(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  const ordered = [...all].sort((a, b) => Number(b.isActive) - Number(a.isActive));
  const allOn = ids.length >= all.length;
  const fullName = (s: Staff) => `${s.firstName}${s.lastName ? ' ' + s.lastName : ''}`;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{t('sv.staffHint')}</span>
        <span style={{ fontSize: 12, color: '#64748b' }}>· {ids.length}/{all.length}</span>
        <button type="button" onClick={() => set(allOn ? [] : all.map((s) => s.id))} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 999, border: '1px solid #6366f1', background: 'transparent', color: '#a5b4fc', cursor: 'pointer', fontWeight: 600 }}>
          {allOn ? t('sv.staffClear') : t('sv.staffAll')}
        </button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {ordered.map((s) => {
          const on = has(s.id);
          return (
            <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, border: `1px solid ${on ? '#6366f1' : '#475569'}`, background: on ? '#312e81' : 'transparent', color: on ? '#c7d2fe' : '#cbd5e1', fontSize: 13, cursor: 'pointer', opacity: s.isActive ? 1 : 0.6 }}>
              <input type="checkbox" checked={on} onChange={() => toggle(s.id)} />
              {fullName(s)}{!s.isActive && <span style={{ fontSize: 10, color: '#64748b' }}> ({t('sv.staffOff')})</span>}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ padding: '6px 12px', borderRadius: 999, fontSize: 13, cursor: 'pointer', border: `1px solid ${active ? '#6366f1' : '#334155'}`, background: active ? '#312e81' : 'transparent', color: active ? '#c7d2fe' : '#94a3b8' }}>
      {children}
    </button>
  );
}

function CategoryManager({ token, categories, onChanged }: { token: string; categories: Category[]; onChanged: () => void }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [open, setOpen] = useState(false);
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
      <button onClick={() => setOpen((o) => !o)} style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, padding: 0 }}>
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
                  <button onClick={() => remove(c)} style={{ ...miniBtn, color: '#ef4444', borderColor: '#ef4444' }}>{t('sv.delete')}</button>
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

const miniBtn: React.CSSProperties = { padding: '4px 10px', borderRadius: 6, border: '1px solid #475569', background: 'transparent', color: '#cbd5e1', fontSize: 12, cursor: 'pointer' };
function actBtn(bg: string): React.CSSProperties {
  return { padding: '6px 12px', borderRadius: 8, border: 'none', background: bg, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', minWidth: 64 };
}

// ---- Weekday auto-discounts ------------------------------------------------
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_VI = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
interface DiscRule { day: number; categoryId: string | null; percent: number }

function WeekdayDiscountCard({ token, categories }: { token: string; categories: Category[] }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const dow = lang === 'vi' ? DOW_VI : DOW;
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState('');
  const [rules, setRules] = useState<DiscRule[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open || loaded) return;
    apiFetch<{ weekdayDiscounts?: { enabled: boolean; message: string; rules: DiscRule[] } }>('/settings', { token })
      .then((s) => {
        const w = s.weekdayDiscounts;
        if (w) { setEnabled(!!w.enabled); setMessage(w.message || ''); setRules(Array.isArray(w.rules) ? w.rules : []); }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [open, loaded, token]);

  function upd(i: number, patch: Partial<DiscRule>) { setRules(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r))); }
  async function save() {
    setBusy(true); setMsg(null);
    try { await apiFetch('/settings/weekday-discounts', { method: 'PATCH', token, body: { enabled, message, rules } }); setMsg(t('sv.saved')); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Save failed'); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ ...ui.card, marginBottom: 16 }}>
      <button onClick={() => setOpen((o) => !o)} style={{ background: 'none', border: 'none', color: '#e2e8f0', fontSize: 15, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
        {open ? '▾' : '▸'} {t('sv.weekdayTitle')}
      </button>
      {open && (
        <div style={{ marginTop: 12 }}>
          <p style={{ color: '#94a3b8', fontSize: 13, margin: '0 0 10px' }}>{t('sv.weekdayDesc')}</p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span style={{ fontSize: 14 }}>{t('sv.weekdayEnable')}</span>
          </label>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={ui.label}>{t('sv.weekdayHeadline')}</span>
            <input style={ui.input} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('sv.weekdayHeadlinePh')} />
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rules.length === 0 && <p style={{ color: '#94a3b8', fontSize: 13 }}>{t('sv.weekdayNoRules')}</p>}
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
                <span style={{ color: '#94a3b8', fontSize: 13 }}>{t('sv.percentOff')}</span>
                <button onClick={() => setRules(rules.filter((_, idx) => idx !== i))} style={ui.dangerBtn}>{t('sv.remove')}</button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => setRules([...rules, { day: 2, categoryId: null, percent: 10 }])} style={{ ...ui.primaryBtn, background: 'transparent', border: '1px solid #475569' }}>{t('sv.addRule')}</button>
            <button onClick={save} disabled={busy} style={ui.primaryBtn}>{busy ? t('sv.saving') : t('sv.saveDiscounts')}</button>
            {msg && <span style={{ color: msg.startsWith('✓') ? '#22c55e' : '#f87171', fontSize: 13 }}>{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Specific-date discounts (one-off dates / ranges) ----------------------
interface DateRule { startDate: string; endDate: string | null; categoryId: string | null; percent: number; label?: string }

function DateDiscountCard({ token, categories }: { token: string; categories: Category[] }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [open, setOpen] = useState(false);
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
    try { await apiFetch('/settings/date-discounts', { method: 'PATCH', token, body: { enabled, rules } }); setMsg(t('sv.saved')); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Save failed'); }
    finally { setBusy(false); }
  }
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div style={{ ...ui.card, marginBottom: 16 }}>
      <button onClick={() => setOpen((o) => !o)} style={{ background: 'none', border: 'none', color: '#e2e8f0', fontSize: 15, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
        {open ? '▾' : '▸'} {t('sv.dateTitle')}
      </button>
      {open && (
        <div style={{ marginTop: 12 }}>
          <p style={{ color: '#94a3b8', fontSize: 13, margin: '0 0 10px' }}>{t('sv.dateDesc')}</p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span style={{ fontSize: 14 }}>{t('sv.dateEnable')}</span>
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {rules.length === 0 && <p style={{ color: '#94a3b8', fontSize: 13 }}>{t('sv.dateNoRules')}</p>}
            {rules.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <label style={{ fontSize: 12, color: '#94a3b8' }}>{t('sv.dateFrom')}
                  <input type="date" value={r.startDate || ''} min={today} onChange={(e) => upd(i, { startDate: e.target.value })} style={{ ...ui.input, width: 'auto', display: 'block', marginTop: 3 }} />
                </label>
                <label style={{ fontSize: 12, color: '#94a3b8' }}>{t('sv.dateTo')}
                  <input type="date" value={r.endDate || ''} min={r.startDate || today} onChange={(e) => upd(i, { endDate: e.target.value || null })} style={{ ...ui.input, width: 'auto', display: 'block', marginTop: 3 }} />
                </label>
                <select value={r.categoryId ?? ''} onChange={(e) => upd(i, { categoryId: e.target.value || null })} style={{ ...ui.input, width: 'auto' }}>
                  <option value="">{t('sv.allCategories')}</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="number" min={1} max={90} value={r.percent} onChange={(e) => upd(i, { percent: parseInt(e.target.value, 10) || 0 })} style={{ ...ui.input, width: 74 }} />
                  <span style={{ color: '#94a3b8', fontSize: 13 }}>{t('sv.percentOff')}</span>
                </div>
                <input value={r.label ?? ''} onChange={(e) => upd(i, { label: e.target.value })} placeholder={t('sv.dateLabelPh')} style={{ ...ui.input, width: 150 }} />
                <button onClick={() => setRules(rules.filter((_, idx) => idx !== i))} style={ui.dangerBtn}>{t('sv.remove')}</button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => setRules([...rules, { startDate: today, endDate: null, categoryId: null, percent: 10 }])} style={{ ...ui.primaryBtn, background: 'transparent', border: '1px solid #475569' }}>{t('sv.dateAddRule')}</button>
            <button onClick={save} disabled={busy} style={ui.primaryBtn}>{busy ? t('sv.saving') : t('sv.saveDiscounts')}</button>
            {msg && <span style={{ color: msg.startsWith('✓') ? '#22c55e' : '#f87171', fontSize: 13 }}>{msg}</span>}
          </div>
          <p style={{ color: '#64748b', fontSize: 12, marginTop: 10 }}>{t('sv.dateHint')}</p>
        </div>
      )}
    </div>
  );
}

// ---- Bulk menu import ------------------------------------------------------
const IMPORT_EXAMPLE = `# Acrylic
New Set | 62+ | 60
Refill | 50 | 45

# Waxing
Eyebrows | 10+
Full Legs | 45+ | 40`;

interface ParsedItem { category: string; name: string; priceCents: number; durationMinutes: number; priceFrom: boolean }

/** Parse a pasted menu: "# Category" lines + "Name | price | minutes" rows. */
function parseMenu(text: string): ParsedItem[] {
  const items: ParsedItem[] = [];
  let category = '';
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#')) { category = line.replace(/^#+/, '').trim(); continue; }
    const parts = line.split('|').map((p) => p.trim());
    const name = parts[0];
    if (!name) continue;
    const priceStr = parts[1] || '';
    const priceFrom = priceStr.includes('+');
    const dollars = parseFloat((priceStr.match(/[\d.]+/) || ['0'])[0]) || 0;
    const dur = parseInt((((parts[2] || '').match(/\d+/)) || ['30'])[0], 10) || 30;
    items.push({ category, name, priceCents: Math.round(dollars * 100), durationMinutes: dur, priceFrom });
  }
  return items;
}

function ImportPanel({ token, onDone }: { token: string; onDone: () => void }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const items = parseMenu(text);
  const ok = msg?.startsWith('✓');

  async function run() {
    if (items.length === 0) { setMsg(t('sv.importPasteFirst')); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await apiFetch<{ createdCategories: number; createdServices: number; skipped: number }>(
        '/services/import', { method: 'POST', token, body: { items } },
      );
      setMsg(t('sv.importedMsg').replace('{svc}', String(r.createdServices)).replace('{cat}', String(r.createdCategories)).replace('{skip}', String(r.skipped)));
      setTimeout(onDone, 1000);
    } catch (e) { setMsg(e instanceof Error ? e.message : t('sv.importFailed')); setBusy(false); }
  }

  return (
    <div style={{ ...ui.card, marginBottom: 16 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{t('sv.importMenu')}</div>
      <p style={{ color: '#94a3b8', fontSize: 13, margin: '0 0 10px' }}>
        {lang === 'vi' ? (
          <>Dán bảng giá của bạn bên dưới. Bắt đầu một nhóm bằng <code style={{ color: '#cbd5e1' }}># Danh mục</code>, rồi mỗi dòng một dịch vụ:
          {' '}<code style={{ color: '#cbd5e1' }}>Tên | giá | phút</code>. Dấu <code style={{ color: '#cbd5e1' }}>+</code> sau giá = giá &ldquo;từ&rdquo;; số phút không bắt buộc (mặc định 30).</>
        ) : (
          <>Paste your price list below. Start a group with <code style={{ color: '#cbd5e1' }}># Category</code>, then one service per line:
          {' '}<code style={{ color: '#cbd5e1' }}>Name | price | minutes</code>. A <code style={{ color: '#cbd5e1' }}>+</code> after the price = &ldquo;from&rdquo; pricing; minutes is optional (defaults to 30).</>
        )}
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={12}
        placeholder={IMPORT_EXAMPLE}
        style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: '1px solid #475569', background: '#0f172a', color: '#e2e8f0', fontSize: 14, fontFamily: 'ui-monospace, Menlo, monospace', resize: 'vertical' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
        <button onClick={run} disabled={busy || items.length === 0} style={ui.primaryBtn}>
          {busy ? t('sv.importing') : `${t('sv.importVerb')} ${items.length || ''} ${t('sv.serviceWord')}`}
        </button>
        {items.length > 0 && !msg && <span style={{ color: '#94a3b8', fontSize: 13 }}>{t('sv.rowsDetected').replace('{n}', String(items.length))}</span>}
        {msg && <span style={{ color: ok ? '#22c55e' : '#f87171', fontSize: 13 }}>{msg}</span>}
      </div>
    </div>
  );
}
