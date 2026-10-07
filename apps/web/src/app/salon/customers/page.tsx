'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fmtInTz } from '../../../lib/datetime';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth, useCan } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';
import { useLiveRefresh } from '../../../lib/useLiveRefresh';
import { useIsMobile, CARD_LIST_MAX } from '../../../lib/responsive';
import { MList, MCard, MHead, MRow, MActions } from '../../../components/MobileCard';
import { DateRangeBar, useDateRange, usePaged, Pager } from '../../../components/ListFilter';
import { useBulkSelect, BulkBar, BulkAllBox, BulkRowBox, runBulkDelete } from '../../../components/BulkDelete';
import { AskedNotBookedBox } from '../../../components/AskedNotBookedBox';
import { uiIndustry } from '../../../lib/ui-industry';
import { LeadFollowUpsBox } from '../../../components/LeadFollowUpsBox';
import { RecallBox } from '../../../components/RecallBox';
import { LeadBoard } from '../../../components/LeadBoard';
import { CustomerImport } from '../../../components/CustomerImport';
import { NewCustomerForm } from '../../../components/NewCustomerForm';
import { uiLocale } from '../../../lib/datetime';

interface Customer {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  createdAt: string;
  birthDate?: string | null;
  loyaltyPoints?: number;
  noShowCount?: number;
  /** The line-of-business record; for real estate `stage` drives the pipeline. */
  industryFields?: Record<string, string | number>;
  _count: { appointments: number };
}

/** A real-estate office's lead stages — same values as api common/industry-fields. */
const LEAD_STAGES: { v: string; vi: string; en: string }[] = [
  { v: 'new', vi: 'Mới', en: 'New' }, { v: 'contacted', vi: 'Đã liên hệ', en: 'Contacted' }, { v: 'viewing', vi: 'Đang xem nhà', en: 'Viewing' },
  { v: 'negotiating', vi: 'Đàm phán', en: 'Negotiating' }, { v: 'won', vi: 'Đã chốt', en: 'Won' }, { v: 'lost', vi: 'Ngừng', en: 'Lost' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Birthday shown as "Mar 14" (no year) — the year is private and not useful here. */
function fmtBirthday(iso?: string | null): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return '—';
  return `${MONTHS[parseInt(m[2], 10) - 1]} ${parseInt(m[3], 10)}`;
}
/** Sort key for a birthday: month*100 + day, so the list runs Jan then Dec. -1 = none. */
function birthdayKey(iso?: string | null): number {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? parseInt(m[2], 10) * 100 + parseInt(m[3], 10) : -1;
}
function birthMonth(iso?: string | null): number {
  const m = iso ? /^(\d{4})-(\d{2})/.exec(iso) : null;
  return m ? parseInt(m[2], 10) : 0;
}

type SortKey = 'name' | 'bookings' | 'noShows' | 'points' | 'since' | 'birthday';

export default function CustomersPage() {
  return (
    <SalonShell>
      <Inner />
    </SalonShell>
  );
}

function Inner() {
  const { token, user } = useAuth();
  // Bringing the old system's client list over is the owner's job.
  const isOwner = user?.role === 'SALON_ADMIN' || user?.role === 'SUPER_ADMIN';
  const [importOpen, setImportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addedMsg, setAddedMsg] = useState<string | null>(null);
  const can = useCan();
  const canDelete = can('customers.delete');
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const isMobile = useIsMobile();
  // Cards up to tablet width — an iPad gets every field, not a squeezed table.
  const cardList = useIsMobile(CARD_LIST_MAX);
  const range = useDateRange('all');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  // Arrived from the header search (?q=…): start with that search filled in.
  useEffect(() => { const v = new URLSearchParams(window.location.search).get('q'); if (v) setQ(v); }, []);
  const [bMonth, setBMonth] = useState(0); // 0 = any birthday month
  // Real estate: the lead pipeline ('' = all, '_none' = no stage yet).
  const isLeads = uiIndustry() === 'REAL_ESTATE';
  const [stage, setStage] = useState('');
  // Real estate: list or board (kanban by stage).
  const [board, setBoard] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'since', dir: 'desc' });

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setCustomers(await apiFetch<Customer[]>('/customers', { token }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load);

  async function remove(c: Customer) {
    const name = `${c.firstName} ${c.lastName ?? ''}`;
    const extra = c._count.appointments > 0 ? t('cu.confirmExtra').replace('{n}', String(c._count.appointments)) : '';
    if (!confirm(t('cu.confirmDelete').replace('{name}', name) + extra + t('cu.cannotUndo'))) return;
    try {
      await apiFetch(`/customers/${c.id}`, { method: 'DELETE', token });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  /** Board: a lead dragged to another stage. Saved on the record, shown at once. */
  async function moveStage(id: string, next: string) {
    const before = customers;
    setCustomers((cs) => cs.map((c) => (c.id === id ? { ...c, industryFields: { ...(c.industryFields ?? {}), stage: next } } : c)));
    try {
      await apiFetch(`/customers/${id}`, { method: 'PATCH', token, body: { industryFields: { stage: next } } });
    } catch (err) {
      setCustomers(before);
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  // Click a column to sort; click the active column again to flip direction.
  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' || key === 'birthday' ? 'asc' : 'desc' }));
  }

  const filtered = useMemo(() => {
    const list = customers.filter((c) => {
      if (!range.inRange(c.createdAt)) return false;
      if (bMonth && birthMonth(c.birthDate) !== bMonth) return false;
      if (isLeads && stage) {
        const st = String(c.industryFields?.stage ?? '');
        if (stage === '_none' ? st !== '' : st !== stage) return false;
      }
      const s = `${c.firstName} ${c.lastName ?? ''} ${c.email ?? ''} ${c.phone ?? ''}`.toLowerCase();
      return s.includes(q.toLowerCase());
    });
    const dir = sort.dir === 'asc' ? 1 : -1;
    const val = (c: Customer): number | string => {
      switch (sort.key) {
        case 'name': return `${c.firstName} ${c.lastName ?? ''}`.trim().toLowerCase();
        case 'bookings': return c._count.appointments;
        case 'noShows': return c.noShowCount ?? 0;
        case 'points': return c.loyaltyPoints ?? 0;
        case 'birthday': return birthdayKey(c.birthDate);
        case 'since':
        default: return new Date(c.createdAt).getTime();
      }
    };
    return [...list].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb) * dir;
      return ((va as number) - (vb as number)) * dir;
    });
  }, [customers, range, bMonth, q, sort, isLeads, stage]);

  const pg = usePaged(filtered, 20);
  const bulk = useBulkSelect(pg.paged.map((r) => r.id));
  const withBirthday = customers.filter((c) => c.birthDate).length;

  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
  const Th = ({ k, label }: { k: SortKey; label: string }) => (
    <th style={{ ...ui.th, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', color: sort.key === k ? 'var(--cc7d2fe)' : undefined }}
      onClick={() => toggleSort(k)}>{label}{arrow(k)}</th>
  );

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 24, margin: 0 }}>{t('cu.title')}</h1>
          <p style={{ color: 'var(--c94a3b8)', margin: '4px 0 0', fontSize: 14 }}>{filtered.length} {t('cu.of')} {customers.length} · 🎂 {withBirthday}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => { setAddOpen((v) => !v); setAddedMsg(null); }} style={ui.primaryBtn}>
            {addOpen ? (lang === 'vi' ? 'Đóng' : 'Close') : (lang === 'vi' ? '+ Thêm khách' : '+ Add client')}
          </button>
          {isOwner && (
            <button type="button" onClick={() => setImportOpen(true)} style={{ padding: '9px 13px', borderRadius: 8, border: '1px solid var(--c475569)', background: 'transparent', color: 'var(--ce2e8f0)', fontSize: 13.5, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              ⬆ {lang === 'vi' ? 'Nhập khách cũ' : 'Import clients'}
            </button>
          )}
          <input
            placeholder={t('cu.searchPh')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ ...ui.input, maxWidth: 280 }}
          />
        </div>
      </div>
      {importOpen && <CustomerImport vi={lang === 'vi'} onClose={() => setImportOpen(false)} onDone={load} />}
      {addOpen && (
        <NewCustomerForm vi={lang === 'vi'} isOwner={isOwner} onClose={() => setAddOpen(false)}
          onCreated={(id) => { setAddOpen(false); setAddedMsg(id); void load(); }} />
      )}
      {addedMsg && (
        <div style={{ background: 'var(--c14532d)', color: 'var(--cbbf7d0)', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
          <span>{lang === 'vi' ? 'Đã thêm khách.' : 'Client added.'}</span>
          <a href={`/salon/customers/${addedMsg}`} style={{ color: 'inherit', fontWeight: 700 }}>{lang === 'vi' ? 'Mở hồ sơ →' : 'Open profile →'}</a>
          <button type="button" onClick={() => setAddedMsg(null)} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {/* Warm leads first: asked on chat / hotline, never booked. Collapsed here. */}
      <AskedNotBookedBox compact />

      {/* Real estate: call-backs due today / overdue (the morning push opens this). */}
      {isLeads && <LeadFollowUpsBox vi={lang === 'vi'} />}
      {uiIndustry() === 'DENTAL' && <RecallBox vi={lang === 'vi'} />}

      {/* Real estate: the lead pipeline — how many at each stage, tap to filter. */}
      {isLeads && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          {[{ v: '', vi: 'Tất cả', en: 'All' }, ...LEAD_STAGES, { v: '_none', vi: 'Chưa phân loại', en: 'No stage' }].map((s0) => {
            const n = s0.v === '' ? customers.length : customers.filter((c) => (s0.v === '_none' ? !c.industryFields?.stage : c.industryFields?.stage === s0.v)).length;
            const on = stage === s0.v;
            return (
              <button key={s0.v || 'all'} type="button" onClick={() => setStage(s0.v)}
                style={{ padding: '6px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: `1px solid ${on ? '#6366f1' : 'var(--c334155)'}`, background: on ? 'var(--c312e81)' : 'transparent', color: 'var(--ce2e8f0)' }}>
                {lang === 'vi' ? s0.vi : s0.en} <span style={{ color: 'var(--c94a3b8)' }}>{n}</span>
              </button>
            );
          })}
          <span style={{ flex: 1 }} />
          <span role="tablist" style={{ display: 'inline-flex', gap: 3, padding: 2, borderRadius: 9, border: '1px solid var(--c334155)' }}>
            {[false, true].map((b) => (
              <button key={String(b)} type="button" role="tab" aria-selected={board === b} onClick={() => setBoard(b)}
                style={{ padding: '5px 11px', borderRadius: 7, border: 'none', fontSize: 12.5, cursor: 'pointer', background: board === b ? 'var(--c1e293b)' : 'transparent', color: 'var(--ce2e8f0)' }}>
                {b ? (lang === 'vi' ? 'Bảng' : 'Board') : (lang === 'vi' ? 'Danh sách' : 'List')}
              </button>
            ))}
          </span>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>🎂 {t('cu.birthdayIn')}</span>
          <select value={bMonth} onChange={(e) => setBMonth(parseInt(e.target.value, 10))}
            style={{ ...ui.input, padding: '7px 10px', maxWidth: 150 }}>
            <option value={0}>{t('cu.anyMonth')}</option>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          {isMobile && (
            <select value={`${sort.key}:${sort.dir}`} onChange={(e) => { const [k, d] = e.target.value.split(':'); setSort({ key: k as SortKey, dir: d as 'asc' | 'desc' }); }}
              style={{ ...ui.input, padding: '7px 10px', maxWidth: 190 }}>
              <option value="since:desc">{t('cu.sortNewest')}</option>
              <option value="name:asc">{t('cu.sortName')}</option>
              <option value="bookings:desc">{t('cu.sortBookings')}</option>
              <option value="points:desc">{t('cu.sortPoints')}</option>
              <option value="birthday:asc">{t('cu.sortBirthday')}</option>
              <option value="noShows:desc">{t('cu.sortNoShows')}</option>
            </select>
          )}
        </div>
        <DateRangeBar range={range} />
      </div>

      {error && <div style={ui.banner}>{error}</div>}

      {loading && customers.length === 0 ? (
        <p style={{ color: 'var(--c94a3b8)' }}>{t('cu.loading')}</p>
      ) : isLeads && board ? (
        <LeadBoard leads={filtered} stages={LEAD_STAGES} vi={lang === 'vi'} onMove={moveStage} />
      ) : cardList ? (
        <>
          <MList>
            {filtered.length === 0 && <p style={{ color: 'var(--c64748b)', fontSize: 13 }}>{customers.length === 0 ? (lang === 'vi' ? 'Chưa có khách nào. Bấm "+ Thêm khách" để nhập tay, hoặc "Nhập khách cũ" để đưa file từ hệ thống cũ vào.' : 'No clients yet. Use "+ Add client" to type one in, or "Import clients" to bring a file from your old system.') : t('cu.empty')}</p>}
            {pg.paged.map((c) => (
              <MCard key={c.id}>
                <MHead>
                  <a href={`/salon/customers/${c.id}`} style={{ color: 'var(--c818cf8)', textDecoration: 'none' }}>{c.firstName} {c.lastName ?? ''}</a>
                </MHead>
                <MRow label={t('cu.colEmail')}>{c.email ?? '—'}</MRow>
                <MRow label={t('cu.colPhone')}>{c.phone ?? '—'}</MRow>
                <MRow label={t('cu.colBirthday')}>{c.birthDate ? <span style={{ color: '#f0abfc', fontWeight: 600 }}>🎂 {fmtBirthday(c.birthDate)}</span> : '—'}</MRow>
                <MRow label={t('cu.colBookings')}>{c._count.appointments}</MRow>
                <MRow label={t('cu.colNoShows')}>
                  {(c.noShowCount ?? 0) === 0 ? '0' : (c.noShowCount ?? 0) >= 2
                    ? <span style={{ background: 'var(--c7f1d1d)', color: 'var(--cfecaca)', borderRadius: 6, padding: '1px 8px', fontSize: 12, fontWeight: 600 }}>⚠ {c.noShowCount}</span>
                    : <span style={{ color: '#f97316', fontWeight: 600 }}>{c.noShowCount}</span>}
                </MRow>
                <MRow label={t('cu.colPoints')}>{c.loyaltyPoints ? <span style={{ color: 'var(--ceab308)', fontWeight: 600 }}>{c.loyaltyPoints} {t('cu.pts')}</span> : '—'}</MRow>
                <MRow label={t('cu.colSince')}>{fmtInTz(c.createdAt, { dateStyle: 'short' })}</MRow>
                <MActions>
                  {canDelete && <button onClick={() => remove(c)} style={ui.dangerBtn}>{t('cu.delete')}</button>}
                </MActions>
              </MCard>
            ))}
          </MList>
          <Pager paged={pg} />
        </>
      ) : (
        <div>
          {canDelete && <BulkBar count={bulk.count} ids={bulk.sel} onClear={bulk.clear} onDelete={(ids) => runBulkDelete(ids, (id) => apiFetch(`/customers/${id}`, { method: 'DELETE', token }), load)} />}
          <div style={{ border: '1px solid var(--c334155)', borderRadius: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: 'var(--c1e293b)' }}>
                <th style={{ ...ui.th, width: 34 }}><BulkAllBox on={bulk.allOn} onChange={bulk.toggleAll} /></th>
                <Th k="name" label={t('cu.colName')} />
                <th style={ui.th}>{t('cu.colEmail')}</th>
                <th style={ui.th}>{t('cu.colPhone')}</th>
                <Th k="birthday" label={t('cu.colBirthday')} />
                <Th k="bookings" label={t('cu.colBookings')} />
                <Th k="noShows" label={t('cu.colNoShows')} />
                <Th k="points" label={t('cu.colPoints')} />
                <Th k="since" label={t('cu.colSince')} />
                <th style={ui.th}>{t('cu.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td style={ui.td} colSpan={10}>{customers.length === 0 ? (lang === 'vi' ? 'Chưa có khách nào. Bấm "+ Thêm khách" để nhập tay, hoặc "Nhập khách cũ" để đưa file từ hệ thống cũ vào.' : 'No clients yet. Use "+ Add client" to type one in, or "Import clients" to bring a file from your old system.') : t('cu.empty')}</td></tr>
              )}
              {pg.paged.map((c) => (
                <tr key={c.id} style={{ borderTop: '1px solid var(--c334155)', background: bulk.has(c.id) ? 'var(--c1e1b4b)' : undefined }}>
                  <td style={{ ...ui.td, width: 34 }}><BulkRowBox on={bulk.has(c.id)} onChange={() => bulk.toggle(c.id)} /></td>
                  <td style={ui.td}><a href={`/salon/customers/${c.id}`} style={{ color: 'var(--c818cf8)', textDecoration: 'none', fontWeight: 600 }}>{c.firstName} {c.lastName ?? ''}</a>
                    {isLeads && c.industryFields?.stage && (() => { const st = LEAD_STAGES.find((x) => x.v === c.industryFields?.stage); return st ? <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 999, background: 'var(--c1e293b)', color: 'var(--ccbd5e1)' }}>{lang === 'vi' ? st.vi : st.en}</span> : null; })()}
                  </td>
                  <td style={{ ...ui.td, color: 'var(--c94a3b8)' }}>{c.email ?? '—'}</td>
                  <td style={{ ...ui.td, color: 'var(--c94a3b8)' }}>{c.phone ?? '—'}</td>
                  <td style={ui.td}>{c.birthDate ? <span style={{ color: '#f0abfc', fontWeight: 600 }}>🎂 {fmtBirthday(c.birthDate)}</span> : <span style={{ color: 'var(--ink-faint)' }}>—</span>}</td>
                  <td style={ui.td}>{c._count.appointments}</td>
                  <td style={ui.td}>
                    {(c.noShowCount ?? 0) === 0 ? <span style={{ color: 'var(--c94a3b8)' }}>0</span>
                      : (c.noShowCount ?? 0) >= 2
                        ? <span title={t('cu.repeatNoShow')} style={{ background: 'var(--c7f1d1d)', color: 'var(--cfecaca)', borderRadius: 6, padding: '1px 8px', fontSize: 12, fontWeight: 600 }}>⚠ {c.noShowCount}</span>
                        : <span style={{ color: '#f97316', fontWeight: 600 }}>{c.noShowCount}</span>}
                  </td>
                  <td style={ui.td}>{c.loyaltyPoints ? <span style={{ color: 'var(--ceab308)', fontWeight: 600 }}>{c.loyaltyPoints} {t('cu.pts')}</span> : '—'}</td>
                  <td style={{ ...ui.td, color: 'var(--c94a3b8)' }}>{fmtInTz(c.createdAt, { dateStyle: 'short' })}</td>
                  <td style={ui.td}>{canDelete && <button onClick={() => remove(c)} style={ui.dangerBtn}>{t('cu.delete')}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: '0 14px 12px' }}><Pager paged={pg} /></div>
          </div>
        </div>
      )}
    </section>
  );
}
