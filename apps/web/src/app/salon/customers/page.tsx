'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';
import { useLiveRefresh } from '../../../lib/useLiveRefresh';
import { useIsMobile } from '../../../lib/responsive';
import { MList, MCard, MHead, MRow, MActions } from '../../../components/MobileCard';
import { DateRangeBar, useDateRange, usePaged, Pager } from '../../../components/ListFilter';

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
  _count: { appointments: number };
}

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
  const { token } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const isMobile = useIsMobile();
  const range = useDateRange('all');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [bMonth, setBMonth] = useState(0); // 0 = any birthday month
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

  // Click a column to sort; click the active column again to flip direction.
  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' || key === 'birthday' ? 'asc' : 'desc' }));
  }

  const filtered = useMemo(() => {
    const list = customers.filter((c) => {
      if (!range.inRange(c.createdAt)) return false;
      if (bMonth && birthMonth(c.birthDate) !== bMonth) return false;
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
  }, [customers, range, bMonth, q, sort]);

  const pg = usePaged(filtered, 20);
  const withBirthday = customers.filter((c) => c.birthDate).length;

  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
  const Th = ({ k, label }: { k: SortKey; label: string }) => (
    <th style={{ ...ui.th, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', color: sort.key === k ? '#c7d2fe' : undefined }}
      onClick={() => toggleSort(k)}>{label}{arrow(k)}</th>
  );

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 24, margin: 0 }}>{t('cu.title')}</h1>
          <p style={{ color: '#94a3b8', margin: '4px 0 0', fontSize: 14 }}>{filtered.length} {t('cu.of')} {customers.length} · 🎂 {withBirthday}</p>
        </div>
        <input
          placeholder={t('cu.searchPh')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ ...ui.input, maxWidth: 280 }}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, color: '#94a3b8' }}>🎂 {t('cu.birthdayIn')}</span>
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
        <p style={{ color: '#94a3b8' }}>{t('cu.loading')}</p>
      ) : isMobile ? (
        <>
          <MList>
            {filtered.length === 0 && <p style={{ color: '#64748b', fontSize: 13 }}>{t('cu.empty')}</p>}
            {pg.paged.map((c) => (
              <MCard key={c.id}>
                <MHead>
                  <a href={`/salon/customers/${c.id}`} style={{ color: '#818cf8', textDecoration: 'none' }}>{c.firstName} {c.lastName ?? ''}</a>
                </MHead>
                <MRow label={t('cu.colEmail')}>{c.email ?? '—'}</MRow>
                <MRow label={t('cu.colPhone')}>{c.phone ?? '—'}</MRow>
                <MRow label={t('cu.colBirthday')}>{c.birthDate ? <span style={{ color: '#f0abfc', fontWeight: 600 }}>🎂 {fmtBirthday(c.birthDate)}</span> : '—'}</MRow>
                <MRow label={t('cu.colBookings')}>{c._count.appointments}</MRow>
                <MRow label={t('cu.colNoShows')}>
                  {(c.noShowCount ?? 0) === 0 ? '0' : (c.noShowCount ?? 0) >= 2
                    ? <span style={{ background: '#7f1d1d', color: '#fecaca', borderRadius: 6, padding: '1px 8px', fontSize: 12, fontWeight: 700 }}>⚠ {c.noShowCount}</span>
                    : <span style={{ color: '#f97316', fontWeight: 600 }}>{c.noShowCount}</span>}
                </MRow>
                <MRow label={t('cu.colPoints')}>{c.loyaltyPoints ? <span style={{ color: '#eab308', fontWeight: 600 }}>{c.loyaltyPoints} {t('cu.pts')}</span> : '—'}</MRow>
                <MRow label={t('cu.colSince')}>{new Date(c.createdAt).toLocaleDateString('en-US')}</MRow>
                <MActions>
                  <button onClick={() => remove(c)} style={ui.dangerBtn}>{t('cu.delete')}</button>
                </MActions>
              </MCard>
            ))}
          </MList>
          <Pager paged={pg} />
        </>
      ) : (
        <div style={{ border: '1px solid #334155', borderRadius: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#1e293b' }}>
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
                <tr><td style={ui.td} colSpan={9}>{t('cu.empty')}</td></tr>
              )}
              {pg.paged.map((c) => (
                <tr key={c.id} style={{ borderTop: '1px solid #334155' }}>
                  <td style={ui.td}><a href={`/salon/customers/${c.id}`} style={{ color: '#818cf8', textDecoration: 'none', fontWeight: 600 }}>{c.firstName} {c.lastName ?? ''}</a></td>
                  <td style={{ ...ui.td, color: '#94a3b8' }}>{c.email ?? '—'}</td>
                  <td style={{ ...ui.td, color: '#94a3b8' }}>{c.phone ?? '—'}</td>
                  <td style={ui.td}>{c.birthDate ? <span style={{ color: '#f0abfc', fontWeight: 600 }}>🎂 {fmtBirthday(c.birthDate)}</span> : <span style={{ color: '#475569' }}>—</span>}</td>
                  <td style={ui.td}>{c._count.appointments}</td>
                  <td style={ui.td}>
                    {(c.noShowCount ?? 0) === 0 ? <span style={{ color: '#94a3b8' }}>0</span>
                      : (c.noShowCount ?? 0) >= 2
                        ? <span title={t('cu.repeatNoShow')} style={{ background: '#7f1d1d', color: '#fecaca', borderRadius: 6, padding: '1px 8px', fontSize: 12, fontWeight: 700 }}>⚠ {c.noShowCount}</span>
                        : <span style={{ color: '#f97316', fontWeight: 600 }}>{c.noShowCount}</span>}
                  </td>
                  <td style={ui.td}>{c.loyaltyPoints ? <span style={{ color: '#eab308', fontWeight: 600 }}>{c.loyaltyPoints} {t('cu.pts')}</span> : '—'}</td>
                  <td style={{ ...ui.td, color: '#94a3b8' }}>{new Date(c.createdAt).toLocaleDateString('en-US')}</td>
                  <td style={ui.td}><button onClick={() => remove(c)} style={ui.dangerBtn}>{t('cu.delete')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: '0 14px 12px' }}><Pager paged={pg} /></div>
        </div>
      )}
    </section>
  );
}
