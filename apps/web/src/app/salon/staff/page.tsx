'use client';

import { Fragment, useCallback, useEffect, useState, FormEvent } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { compressImageToFit } from '../../../lib/image';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang, tr, DAY_LABEL } from '../../../lib/i18n';
import { useIsMobile } from '../../../lib/responsive';
import { MList, MCard, MHead, MRow, MActions } from '../../../components/MobileCard';
import { SearchBox, matchesQuery, sortNewest, usePaged, Pager } from '../../../components/ListFilter';
import { useBulkSelect, BulkBar, BulkAllBox, BulkRowBox, runBulkDelete } from '../../../components/BulkDelete';

interface Service {
  id: string;
  name: string;
  durationMinutes?: number | null;
  priceCents?: number | null;
  category?: { id: string; name: string } | null;
}

type Role = 'MANAGER' | 'RECEPTIONIST' | 'TECHNICIAN';

interface StaffMember {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  performanceScore: number;
  commissionPercent?: number;
  baseCents?: number;
  bookingPriority?: number;
  staffRole?: Role;
  takesAppointments?: boolean;
  tipQrUrl?: string | null;
  tipHandle?: string | null;
  staffServices: { serviceId: string }[];
  workingHours: { id: string; dayOfWeek: number; startTime: string; endTime: string; isActive: boolean }[];
  user: { id: string; email: string } | null;
  createdAt?: string;
}

/**
 * Role chooser + "takes appointments" toggle, shared by the create and edit
 * forms. Picking a role resets the bookable default (Technician = yes; Reception
 * / Manager = no), then the checkbox lets an owner who also does nails opt in.
 */
function RolePicker({
  role,
  takesAppointments,
  onChange,
}: {
  role: Role;
  takesAppointments: boolean;
  onChange: (role: Role, takesAppointments: boolean) => void;
}) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const roles: { v: Role; label: string; emoji: string }[] = [
    { v: 'TECHNICIAN', label: t('st.roleTech'), emoji: '💅' },
    { v: 'RECEPTIONIST', label: t('st.roleReception'), emoji: '💵' },
    { v: 'MANAGER', label: t('st.roleManager'), emoji: '👔' },
  ];
  return (
    <div>
      <span style={ui.label}>{t('st.roleLabel')}</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {roles.map((r) => {
          const on = role === r.v;
          return (
            <button
              type="button"
              key={r.v}
              onClick={() => onChange(r.v, r.v === 'TECHNICIAN')}
              style={{
                padding: '9px 16px', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${on ? '#6366f1' : 'var(--c475569)'}`,
                background: on ? 'var(--c312e81)' : 'transparent',
                color: on ? 'var(--cc7d2fe)' : 'var(--ccbd5e1)',
              }}
            >
              {r.emoji} {r.label}
            </button>
          );
        })}
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, cursor: 'pointer' }}>
        <input type="checkbox" checked={takesAppointments} onChange={(e) => onChange(role, e.target.checked)} />
        <span style={{ fontSize: 14, color: 'var(--ce2e8f0)', fontWeight: 600 }}>{t('st.takesAppts')}</span>
      </label>
      <p style={{ color: takesAppointments ? 'var(--c64748b)' : '#f59e0b', fontSize: 12, marginTop: 6 }}>
        {takesAppointments ? t('st.bookableHint') : t('st.notBookableHint')}
      </p>
    </div>
  );
}

/** Small colored pill showing a staff member's role in the list. */
function RoleBadge({ role, takes }: { role?: Role; takes?: boolean }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const r: Role = role ?? 'TECHNICIAN';
  const map: Record<Role, { label: string; bg: string; fg: string }> = {
    TECHNICIAN: { label: t('st.roleTech'), bg: 'var(--c312e81)', fg: 'var(--cc7d2fe)' },
    RECEPTIONIST: { label: t('st.roleReception'), bg: 'var(--c78350f)', fg: 'var(--cfcd34d)' },
    MANAGER: { label: t('st.roleManager'), bg: '#155e75', fg: '#a5f3fc' },
  };
  const m = map[r];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: m.bg, color: m.fg, whiteSpace: 'nowrap' }}>{m.label}</span>
      {takes === false && r === 'TECHNICIAN' && (
        <span style={{ fontSize: 11, color: 'var(--c94a3b8)' }}>· {t('st.notBookableTag')}</span>
      )}
      {takes === true && r !== 'TECHNICIAN' && (
        <span style={{ fontSize: 11, color: '#22c55e' }}>· {t('st.bookableTag')}</span>
      )}
    </span>
  );
}

function Avatar({ url, name }: { url: string | null; name: string }) {
  const initial = (name || '?').charAt(0).toUpperCase();
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={name} width={36} height={36} style={{ borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
  ) : (
    <span style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--c334155)', color: 'var(--ccbd5e1)', display: 'inline-grid', placeItems: 'center', fontSize: 14, fontWeight: 600, flexShrink: 0 }}>
      {initial}
    </span>
  );
}

/**
 * Reads an image file, crops it to a square and resizes it to <=256px, then
 * returns a compact JPEG data URL — small enough to store in the DB and show
 * directly on the booking page. No external storage needed.
 */
function fileToAvatarDataUrl(file: File): Promise<string> {
  // Small square avatar/QR — capped so it stays light in the DB and on the booking page.
  return compressImageToFit(file, { maxSide: 256, maxChars: 70000, quality: 0.72, square: true });
}

/** Round avatar preview + "Upload photo" button used in the staff forms. */
function AvatarPicker({ value, name, onChange }: { value: string; name: string; onChange: (dataUrl: string) => void }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    if (!file.type.startsWith('image/')) { setErr(t('st.pickImage')); return; }
    setBusy(true); setErr(null);
    try { onChange(await fileToAvatarDataUrl(file)); }
    catch { setErr(t('st.processFail')); }
    finally { setBusy(false); }
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      {value
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={value} alt="avatar" width={64} height={64} style={{ borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--c334155)' }} />
        : <span style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--c334155)', color: 'var(--ccbd5e1)', display: 'grid', placeItems: 'center', fontSize: 22, fontWeight: 700 }}>{(name || '?').charAt(0).toUpperCase()}</span>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ ...ui.input, padding: '8px 14px', cursor: 'pointer', width: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          📷 {busy ? t('st.processing') : value ? t('st.changePhoto') : t('st.uploadPhoto')}
          <input type="file" accept="image/*" onChange={pick} style={{ display: 'none' }} />
        </label>
        {value && <button type="button" onClick={() => onChange('')} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: 12, cursor: 'pointer', textAlign: 'left', padding: 0 }}>{t('st.removePhoto')}</button>}
        {err && <span style={{ color: '#ef4444', fontSize: 12 }}>{err}</span>}
        <span style={{ color: 'var(--c64748b)', fontSize: 11 }}>{t('st.photoHint')}</span>
      </div>
    </div>
  );
}

/** Square picker for a technician's tip QR image (reuses the avatar resizer). */
function QrPicker({ value, onChange }: { value: string; onChange: (dataUrl: string) => void }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [busy, setBusy] = useState(false);
  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    setBusy(true);
    try { onChange(await fileToAvatarDataUrl(file)); } catch { /* ignore */ } finally { setBusy(false); }
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      {value
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={value} alt="tip QR" width={84} height={84} style={{ borderRadius: 10, objectFit: 'cover', border: '1px solid var(--c334155)', background: '#fff' }} />
        : <span style={{ width: 84, height: 84, borderRadius: 10, background: 'var(--c0f172a)', border: '1px dashed var(--c475569)', display: 'grid', placeItems: 'center', fontSize: 26 }}>📱</span>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ ...ui.input, padding: '8px 14px', cursor: 'pointer', width: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          📷 {busy ? t('st.processing') : value ? t('st.changePhoto') : t('st.tipQrUpload')}
          <input type="file" accept="image/*" onChange={pick} style={{ display: 'none' }} />
        </label>
        {value && <button type="button" onClick={() => onChange('')} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: 12, cursor: 'pointer', textAlign: 'left', padding: 0 }}>{t('st.removePhoto')}</button>}
      </div>
    </div>
  );
}

export default function StaffPage() {
  return (
    <SalonShell>
      <StaffInner />
    </SalonShell>
  );
}

function StaffInner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const isMobile = useIsMobile();
  const [q, setQ] = useState('');
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editFor, setEditFor] = useState<string | null>(null);
  const [loginFor, setLoginFor] = useState<string | null>(null);
  const [loginMode, setLoginMode] = useState<'create' | 'reset'>('create');
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [createdMsg, setCreatedMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [staffList, serviceList] = await Promise.all([
        apiFetch<StaffMember[]>('/staff', { token }),
        apiFetch<Service[]>('/services', { token }),
      ]);
      setStaff(staffList);
      setServices(serviceList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load staff');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(id: string) {
    if (!confirm(t('st.confirmDelete'))) return;
    try {
      await apiFetch(`/staff/${id}`, { method: 'DELETE', token });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  function openLogin(m: StaffMember) {
    setLoginMode('create');
    setLoginFor(m.id);
    setLoginForm({ email: m.email ?? '', password: '' });
    setCreatedMsg(null);
    setError(null);
  }

  // Reset the password on an EXISTING staff login (toggles open/closed).
  function openReset(m: StaffMember) {
    const close = loginFor === m.id && loginMode === 'reset';
    setLoginMode('reset');
    setLoginFor(close ? null : m.id);
    setLoginForm({ email: m.user?.email ?? '', password: '' });
    setCreatedMsg(null);
    setError(null);
  }

  async function submitLogin(staffId: string) {
    setError(null);
    if (!loginForm.password || loginForm.password.length < 8) { setError(t('st.loginPwShort')); return; }
    try {
      if (loginMode === 'reset') {
        await apiFetch(`/staff/${staffId}/password`, { method: 'POST', token, body: { password: loginForm.password } });
        setLoginFor(null);
        setCreatedMsg(t('st.pwReset').replace('{email}', loginForm.email));
      } else {
        await apiFetch(`/staff/${staffId}/login`, { method: 'POST', token, body: loginForm });
        setLoginFor(null);
        setCreatedMsg(t('st.loginCreated').replace('{email}', loginForm.email));
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    }
  }

  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? '—';

  // Search only, newest first. (No date filter — staff list isn't time-based.)
  const visible = sortNewest(
    staff.filter((m) => matchesQuery(`${m.firstName} ${m.lastName ?? ''} ${m.email ?? ''} ${m.phone ?? ''}`, q)),
    (m) => m.createdAt,
  );
  const pg = usePaged(visible, 20);
  const bulk = useBulkSelect(pg.paged.map((r) => r.id));

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>{t('st.title')}</h2>
        <button onClick={() => setShowForm((s) => !s)} style={ui.primaryBtn}>
          {showForm ? t('st.close') : t('st.newStaff')}
        </button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <SearchBox value={q} onChange={setQ} placeholder={t('st.searchPh')} />
        <span style={{ color: 'var(--c94a3b8)', fontSize: 13 }}>{visible.length} {t('st.staffWord')}</span>
      </div>

      {error && <div style={ui.banner}>{error}</div>}
      {createdMsg && <div style={{ background: 'var(--c14532d)', color: 'var(--cbbf7d0)', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{createdMsg}</div>}

      {showForm && (
        <CreateStaffForm
          token={token!}
          services={services}
          onCreated={async () => {
            setShowForm(false);
            await load();
          }}
        />
      )}

      {loading ? (
        <p style={{ color: 'var(--c94a3b8)' }}>{t('st.loading')}</p>
      ) : isMobile ? (
        <MList>
          {visible.length === 0 && <p style={{ color: 'var(--c64748b)', fontSize: 13 }}>{t('st.empty')}</p>}
          {pg.paged.map((m) => (
            <Fragment key={m.id}>
              <MCard>
                <MHead right={<span style={{ color: m.isActive ? '#22c55e' : 'var(--c94a3b8)', fontSize: 12, fontWeight: 600 }}>{m.isActive ? t('st.active') : t('st.inactive')}</span>}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Avatar url={m.avatarUrl} name={m.firstName} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span>{m.firstName} {m.lastName ?? ''}</span>
                      <RoleBadge role={m.staffRole} takes={m.takesAppointments} />
                    </div>
                  </div>
                </MHead>
                <MRow label={t('st.colContact')}>{m.email || '—'}{m.phone ? ' · ' + m.phone : ''}</MRow>
                <MRow label={t('st.colSkills')}><SkillsCell m={m} total={services.length} serviceName={serviceName} t={t} /></MRow>
                <MRow label={t('st.colLogin')}>
                  {m.user ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ color: '#22c55e' }}>🔑 {m.user.email}</span>
                      <button onClick={() => openReset(m)} style={{ ...ui.primaryBtn, padding: '4px 9px', fontSize: 11, background: loginFor === m.id && loginMode === 'reset' ? 'var(--c475569)' : 'var(--c334155)' }}>{loginFor === m.id && loginMode === 'reset' ? t('st.cancel') : t('st.resetPw')}</button>
                    </span>
                  ) : (
                    <button onClick={() => openLogin(m)} style={{ ...ui.primaryBtn, padding: '5px 10px', fontSize: 12, background: loginFor === m.id ? 'var(--c475569)' : '#6366f1' }}>{loginFor === m.id ? t('st.cancel') : t('st.createLogin')}</button>
                  )}
                </MRow>
                <MActions>
                  <button onClick={() => { setEditFor(editFor === m.id ? null : m.id); setLoginFor(null); }} style={{ ...ui.primaryBtn, padding: '6px 12px', fontSize: 12, background: editFor === m.id ? 'var(--c475569)' : '#6366f1' }}>{editFor === m.id ? t('st.close') : t('st.edit')}</button>
                  <button onClick={() => remove(m.id)} style={ui.dangerBtn}>{t('st.delete')}</button>
                </MActions>
              </MCard>
              {editFor === m.id && <div style={{ padding: 12, background: 'var(--c0f172a)', border: '1px solid var(--c334155)', borderRadius: 10 }}><StaffEditPanel token={token!} member={m} services={services} onSaved={load} /></div>}
              {loginFor === m.id && (
                <div style={{ padding: 12, background: 'var(--c0f172a)', border: '1px solid var(--c334155)', borderRadius: 10 }}>
                  <div style={{ fontSize: 13, color: 'var(--ccbd5e1)', marginBottom: 8, fontWeight: 600 }}>{(loginMode === 'reset' ? t('st.resetPwFor') : t('st.createLoginFor')).replace('{name}', m.firstName)}</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
                    <label style={{ flex: 1, minWidth: 160 }}>
                      <span style={ui.label}>{t('st.loginEmail')}</span>
                      <input style={{ ...ui.input, ...(loginMode === 'reset' ? { opacity: 0.6 } : {}) }} type="email" value={loginForm.email} readOnly={loginMode === 'reset'} onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })} />
                    </label>
                    <label style={{ flex: 1, minWidth: 140 }}>
                      <span style={ui.label}>{loginMode === 'reset' ? t('st.newPassword') : t('st.password')}</span>
                      <input style={ui.input} type="text" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} placeholder={t('st.passwordPh')} />
                    </label>
                    <button onClick={() => submitLogin(m.id)} style={{ ...ui.primaryBtn, padding: '9px 14px' }}>{loginMode === 'reset' ? t('st.savePassword') : t('st.createLogin')}</button>
                  </div>
                </div>
              )}
            </Fragment>
          ))}
          <Pager paged={pg} />
        </MList>
      ) : (
        <div>
          <BulkBar count={bulk.count} ids={bulk.sel} onClear={bulk.clear} onDelete={(ids) => runBulkDelete(ids, (id) => apiFetch(`/staff/${id}`, { method: 'DELETE', token }), load)} />
          <div style={{ border: '1px solid var(--c334155)', borderRadius: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: 'var(--c1e293b)' }}>
                <th style={{ ...ui.th, width: 34 }}><BulkAllBox on={bulk.allOn} onChange={bulk.toggleAll} /></th>
                <th style={ui.th}>{t('st.colName')}</th>
                <th style={ui.th}>{t('st.colContact')}</th>
                <th style={ui.th}>{t('st.colSkills')}</th>
                <th style={ui.th}>{t('st.colLogin')}</th>
                <th style={ui.th}>{t('st.colStatus')}</th>
                <th style={ui.th}>{t('st.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td style={ui.td} colSpan={7}>
                    {t('st.empty')}
                  </td>
                </tr>
              )}
              {pg.paged.map((m) => (
                <Fragment key={m.id}>
                <tr style={{ borderTop: '1px solid var(--c334155)', background: bulk.has(m.id) ? 'var(--c1e1b4b)' : undefined }}>
                  <td style={{ ...ui.td, width: 34 }}><BulkRowBox on={bulk.has(m.id)} onChange={() => bulk.toggle(m.id)} /></td>
                  <td style={ui.td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Avatar url={m.avatarUrl} name={m.firstName} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <span>{m.firstName} {m.lastName ?? ''}</span>
                        <RoleBadge role={m.staffRole} takes={m.takesAppointments} />
                      </div>
                    </div>
                  </td>
                  <td style={{ ...ui.td, color: 'var(--c94a3b8)', fontSize: 13 }}>
                    {m.email ?? ''}
                    {m.phone ? <div>{m.phone}</div> : null}
                  </td>
                  <td style={{ ...ui.td, color: 'var(--ccbd5e1)', fontSize: 13 }}>
                    <SkillsCell m={m} total={services.length} serviceName={serviceName} t={t} />
                  </td>
                  <td style={ui.td}>
                    {m.user ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ color: '#22c55e', fontSize: 13 }}>🔑 {m.user.email}</span>
                        <button onClick={() => openReset(m)} style={{ ...ui.primaryBtn, padding: '4px 9px', fontSize: 11, background: loginFor === m.id && loginMode === 'reset' ? 'var(--c475569)' : 'var(--c334155)' }}>
                          {loginFor === m.id && loginMode === 'reset' ? t('st.cancel') : t('st.resetPw')}
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => openLogin(m)} style={{ ...ui.primaryBtn, padding: '6px 12px', fontSize: 12, background: loginFor === m.id ? 'var(--c475569)' : '#6366f1' }}>
                        {loginFor === m.id ? t('st.cancel') : t('st.createLogin')}
                      </button>
                    )}
                  </td>
                  <td style={ui.td}>
                    <span style={{ color: m.isActive ? '#22c55e' : 'var(--c94a3b8)' }}>
                      {m.isActive ? t('st.active') : t('st.inactive')}
                    </span>
                  </td>
                  <td style={ui.td}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => { setEditFor(editFor === m.id ? null : m.id); setLoginFor(null); }}
                        style={{ ...ui.primaryBtn, padding: '6px 12px', fontSize: 12, background: editFor === m.id ? 'var(--c475569)' : '#6366f1' }}
                      >
                        {editFor === m.id ? t('st.close') : t('st.edit')}
                      </button>
                      <button onClick={() => remove(m.id)} style={ui.dangerBtn}>
                        {t('st.delete')}
                      </button>
                    </div>
                  </td>
                </tr>
                {editFor === m.id && (
                  <tr>
                    <td colSpan={7} style={{ padding: 16, background: 'var(--c0f172a)' }}>
                      <StaffEditPanel
                        token={token!}
                        member={m}
                        services={services}
                        onSaved={load}
                      />
                    </td>
                  </tr>
                )}
                {loginFor === m.id && (
                  <tr>
                    <td colSpan={7} style={{ padding: 14, background: 'var(--c0f172a)' }}>
                      <div style={{ fontSize: 13, color: 'var(--ccbd5e1)', marginBottom: 8, fontWeight: 600 }}>
                        {(loginMode === 'reset' ? t('st.resetPwFor') : t('st.createLoginFor')).replace('{name}', m.firstName)}
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
                        <label style={{ flex: 1, minWidth: 200 }}>
                          <span style={ui.label}>{t('st.loginEmail')}</span>
                          <input style={{ ...ui.input, ...(loginMode === 'reset' ? { opacity: 0.6 } : {}) }} type="email" value={loginForm.email} readOnly={loginMode === 'reset'} onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })} />
                        </label>
                        <label style={{ flex: 1, minWidth: 180 }}>
                          <span style={ui.label}>{loginMode === 'reset' ? t('st.newPassword') : t('st.password')}</span>
                          <input style={ui.input} type="text" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} placeholder={t('st.passwordPh')} />
                        </label>
                        <button onClick={() => submitLogin(m.id)} style={{ ...ui.primaryBtn, padding: '9px 14px' }}>{loginMode === 'reset' ? t('st.savePassword') : t('st.createLogin')}</button>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
          <Pager paged={pg} />
          </div>
        </div>
      )}
    </section>
  );
}

// Monday-first display order mapped to JS getDay() values (0 = Sun … 6 = Sat).
const DAYS: { dow: number; label: string }[] = [
  { dow: 1, label: 'Mon' },
  { dow: 2, label: 'Tue' },
  { dow: 3, label: 'Wed' },
  { dow: 4, label: 'Thu' },
  { dow: 5, label: 'Fri' },
  { dow: 6, label: 'Sat' },
  { dow: 0, label: 'Sun' },
];

interface DayWin { start: string; end: string }
interface DayRow { dow: number; enabled: boolean; windows: DayWin[] }

/** The same pill switch the Business-hours screen uses, so the two screens
 *  read as one system instead of two generations of UI. */
function HourToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      style={{ width: 40, height: 22, borderRadius: 999, border: 'none', cursor: 'pointer', position: 'relative', background: on ? '#6366f1' : 'var(--c334155)', transition: 'background .15s ease', flexShrink: 0 }}
    >
      <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .15s ease' }} />
    </button>
  );
}

function StaffEditPanel({
  token,
  member,
  services,
  onSaved,
}: {
  token: string;
  member: StaffMember;
  services: Service[];
  onSaved: () => void;
}) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [form, setForm] = useState({
    firstName: member.firstName,
    lastName: member.lastName ?? '',
    email: member.email ?? '',
    phone: member.phone ?? '',
    avatarUrl: member.avatarUrl ?? '',
    isActive: member.isActive,
    commissionPercent: String(member.commissionPercent ?? 0),
    basePay: String(((member.baseCents ?? 0) / 100) || 0),
    bookingPriority: String(member.bookingPriority ?? 0),
    staffRole: (member.staffRole ?? 'TECHNICIAN') as Role,
    takesAppointments: member.takesAppointments ?? (member.staffRole ?? 'TECHNICIAN') === 'TECHNICIAN',
    tipQrUrl: member.tipQrUrl ?? '',
    tipHandle: member.tipHandle ?? '',
  });
  const [skillIds, setSkillIds] = useState<string[]>(member.staffServices.map((s) => s.serviceId));
  const [hours, setHours] = useState<DayRow[]>(
    DAYS.map((d) => {
      const wins = member.workingHours
        .filter((h) => h.dayOfWeek === d.dow && h.isActive)
        .map((h) => ({ start: h.startTime, end: h.endTime }))
        .sort((x, y) => x.start.localeCompare(y.start));
      return { dow: d.dow, enabled: wins.length > 0, windows: wins.length ? wins : [{ start: '09:00', end: '18:00' }] };
    }),
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function up(key: keyof typeof form, v: string | boolean) {
    setForm((f) => ({ ...f, [key]: v }));
    setSaved(false);
  }
  function updDay(dow: number, patch: Partial<DayRow>) {
    setHours((prev) => prev.map((d) => (d.dow === dow ? { ...d, ...patch } : d)));
    setSaved(false);
  }
  function setWin(dow: number, i: number, patch: Partial<DayWin>) {
    setHours((prev) => prev.map((d) => (d.dow === dow ? { ...d, windows: d.windows.map((w, j) => (j === i ? { ...w, ...patch } : w)) } : d)));
    setSaved(false);
  }
  function addWin(dow: number) {
    setHours((prev) => prev.map((d) => {
      if (d.dow !== dow) return d;
      // A split shift resumes after a break — seed the new window from the end
      // of the previous one so staff edit two digits instead of four.
      const last = d.windows[d.windows.length - 1];
      return { ...d, windows: [...d.windows, { start: last?.end ?? '16:30', end: '20:30' }] };
    }));
    setSaved(false);
  }
  function rmWin(dow: number, i: number) {
    setHours((prev) => prev.map((d) => (d.dow === dow ? { ...d, windows: d.windows.filter((_, j) => j !== i) } : d)));
    setSaved(false);
  }

  async function save() {
    if (!form.firstName.trim()) { setError(t('st.firstNameRequired')); return; }
    setSaving(true);
    setError(null);
    try {
      const workingHours = hours
        .filter((d) => d.enabled)
        .flatMap((d) => d.windows
          .filter((w) => w.start && w.end && w.start < w.end)
          .map((w) => ({ dayOfWeek: d.dow, startTime: w.start, endTime: w.end })));
      await apiFetch(`/staff/${member.id}`, {
        method: 'PATCH',
        token,
        body: {
          firstName: form.firstName,
          lastName: form.lastName || undefined,
          email: form.email || undefined,
          phone: form.phone || undefined,
          avatarUrl: form.avatarUrl || undefined,
          isActive: form.isActive,
          commissionPercent: Math.max(0, Math.min(100, parseInt(form.commissionPercent, 10) || 0)),
          baseCents: Math.max(0, Math.round((parseFloat(form.basePay) || 0) * 100)),
          staffRole: form.staffRole,
          takesAppointments: form.takesAppointments,
          bookingPriority: Math.max(0, parseInt(form.bookingPriority, 10) || 0),
          tipQrUrl: form.tipQrUrl || null,
          tipHandle: form.tipHandle.trim() || null,
          serviceIds: form.takesAppointments ? skillIds : [],
          workingHours,
        },
      });
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const anyEnabled = hours.some((d) => d.enabled);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 13, color: 'var(--ccbd5e1)', fontWeight: 600 }}>{t('st.editName').replace('{name}', member.firstName)}</div>

      {/* Profile photo */}
      <div>
        <span style={ui.label}>{t('st.profilePhoto')}</span>
        <AvatarPicker value={form.avatarUrl} name={form.firstName} onChange={(v) => up('avatarUrl', v)} />
      </div>

      {/* Role + bookable */}
      <RolePicker
        role={form.staffRole}
        takesAppointments={form.takesAppointments}
        onChange={(staffRole, takesAppointments) => { up('staffRole', staffRole); up('takesAppointments', takesAppointments); }}
      />

      {/* Profile */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column' }}><span style={ui.label}>{t('st.fFirstName')} <span style={{ color: '#ef4444' }}>*</span></span>
          <input style={{ ...ui.input, marginTop: 'auto' }} value={form.firstName} onChange={(e) => up('firstName', e.target.value)} required /></label>
        <label style={{ display: 'flex', flexDirection: 'column' }}><span style={ui.label}>{t('st.fLastName')}</span>
          <input style={{ ...ui.input, marginTop: 'auto' }} value={form.lastName} onChange={(e) => up('lastName', e.target.value)} /></label>
        <label style={{ display: 'flex', flexDirection: 'column' }}><span style={ui.label}>{t('st.fEmail')}</span>
          <input style={{ ...ui.input, marginTop: 'auto' }} type="email" value={form.email} onChange={(e) => up('email', e.target.value)} /></label>
        <label style={{ display: 'flex', flexDirection: 'column' }}><span style={ui.label}>{t('st.fPhone')}</span>
          <input style={{ ...ui.input, marginTop: 'auto' }} value={form.phone} onChange={(e) => up('phone', e.target.value)} /></label>
        <label style={{ display: 'flex', flexDirection: 'column' }}><span style={ui.label}>{t('st.commission')}</span>
          <input style={{ ...ui.input, marginTop: 'auto' }} type="number" min={0} max={100} value={form.commissionPercent} onChange={(e) => up('commissionPercent', e.target.value)} /></label>
        <label style={{ display: 'flex', flexDirection: 'column' }}><span style={ui.label}>{t('st.basePay')}</span>
          <input style={{ ...ui.input, marginTop: 'auto' }} type="number" min={0} step="0.01" value={form.basePay} onChange={(e) => up('basePay', e.target.value)} /></label>
        <label style={{ display: 'flex', flexDirection: 'column' }}><span style={ui.label}>{t('st.priority')}</span>
          <input style={{ ...ui.input, marginTop: 'auto' }} type="number" min={0} value={form.bookingPriority} onChange={(e) => up('bookingPriority', e.target.value)} /></label>
        <label style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 9 }}>
            <input type="checkbox" checked={form.isActive} onChange={(e) => up('isActive', e.target.checked)} />
            <span style={{ fontSize: 14, color: 'var(--ce2e8f0)' }}>{t('st.activeBookings')}</span>
          </span>
        </label>
      </div>

      {/* Skills (bookable technicians only) */}
      {form.takesAppointments ? (
        <div>
          <span style={ui.label}>{t('st.skills')}</span>
          <SkillPicker all={services} ids={skillIds} set={(v) => { setSkillIds(v); setSaved(false); }} />
        </div>
      ) : (
        <p style={{ color: 'var(--c64748b)', fontSize: 12 }}>{t('st.skillsTechOnly')}</p>
      )}

      {/* Working hours */}
      <div>
        <span style={ui.label}>{t('st.workingHours')}</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 460 }}>
          {hours.map((d) => {
            const label = DAY_LABEL[lang][d.dow] ?? '';
            return (
              <div key={d.dow} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--c1e293b)' }}>
                <span style={{ width: 40, fontSize: 13.5, color: 'var(--ccbd5e1)', paddingTop: 5 }}>{label}</span>
                <div style={{ paddingTop: 3 }}>
                  <HourToggle on={d.enabled} onChange={(v) => updDay(d.dow, { enabled: v })} />
                </div>
                {d.enabled ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {d.windows.map((w, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input type="time" style={{ ...ui.input, width: 118 }} value={w.start} onChange={(e) => setWin(d.dow, i, { start: e.target.value })} />
                        <span style={{ color: 'var(--c64748b)' }}>–</span>
                        <input type="time" style={{ ...ui.input, width: 118 }} value={w.end} onChange={(e) => setWin(d.dow, i, { end: e.target.value })} />
                        {d.windows.length > 1 && (
                          <button type="button" onClick={() => rmWin(d.dow, i)} style={{ background: 'none', border: 'none', color: 'var(--c64748b)', cursor: 'pointer', fontSize: 14, padding: 2 }}>✕</button>
                        )}
                      </div>
                    ))}
                    <button type="button" onClick={() => addWin(d.dow)} style={{ alignSelf: 'flex-start', background: 'none', border: '1px dashed var(--c334155)', borderRadius: 8, color: 'var(--ca5b4fc)', fontSize: 12, padding: '3px 10px', cursor: 'pointer' }}>
                      {t('st.addHours')}
                    </button>
                  </div>
                ) : (
                  <span style={{ color: 'var(--c64748b)', fontSize: 13, paddingTop: 5 }}>{t('st.off')}</span>
                )}
              </div>
            );
          })}
        </div>
        <p style={{ color: 'var(--c94a3b8)', fontSize: 12, marginTop: 8 }}>
          {anyEnabled ? t('st.hoursSet') : t('st.hoursUnset')}
        </p>
      </div>

      {/* Direct tip: this tech's payment QR (Venmo/Zelle/Cash App) + handle. */}
      <div>
        <span style={ui.label}>💸 {t('st.tipSection')}</span>
        <p style={{ color: 'var(--c64748b)', fontSize: 12, margin: '0 0 8px' }}>{t('st.tipHint')}</p>
        <QrPicker value={form.tipQrUrl} onChange={(v) => up('tipQrUrl', v)} />
        <label style={{ display: 'block', marginTop: 10, maxWidth: 360 }}>
          <span style={ui.label}>{t('st.tipHandle')}</span>
          <input style={ui.input} value={form.tipHandle} onChange={(e) => up('tipHandle', e.target.value)} placeholder={t('st.tipHandlePh')} />
        </label>
      </div>

      {error && <div style={ui.banner}>{error}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={save} disabled={saving} style={ui.primaryBtn}>
          {saving ? t('st.saving') : t('st.saveChanges')}
        </button>
        {saved && <span style={{ color: '#22c55e', fontSize: 13 }}>{t('st.saved')}</span>}
      </div>
    </div>
  );
}

function CreateStaffForm({
  token,
  services,
  onCreated,
}: {
  token: string;
  services: Service[];
  onCreated: () => void;
}) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', phone: '', avatarUrl: '',
    staffRole: 'TECHNICIAN' as Role, takesAppointments: true,
    loginEmail: '', loginPassword: '',
  });
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // Both login fields, or neither.
    if (!!form.loginEmail !== !!form.loginPassword) { setError(t('st.loginBoth')); return; }
    if (form.loginPassword && form.loginPassword.length < 8) { setError(t('st.loginPwShort')); return; }
    setSubmitting(true);
    try {
      await apiFetch('/staff', {
        method: 'POST',
        token,
        body: {
          firstName: form.firstName,
          lastName: form.lastName || undefined,
          email: form.email || undefined,
          phone: form.phone || undefined,
          avatarUrl: form.avatarUrl || undefined,
          staffRole: form.staffRole,
          takesAppointments: form.takesAppointments,
          loginEmail: form.loginEmail || undefined,
          loginPassword: form.loginPassword || undefined,
          // Skills only matter for bookable technicians.
          serviceIds: form.takesAppointments ? skillIds : [],
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
    <form onSubmit={submit} style={{ ...ui.card, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <label>
          <span style={ui.label}>{t('st.fFirstName')} <span style={{ color: '#ef4444' }}>*</span></span>
          <input
            style={ui.input}
            value={form.firstName}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
            required
          />
        </label>
        <label>
          <span style={ui.label}>{t('st.fLastName')}</span>
          <input
            style={ui.input}
            value={form.lastName}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
          />
        </label>
        <label>
          <span style={ui.label}>{t('st.fEmail')}</span>
          <input
            style={ui.input}
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </label>
        <label>
          <span style={ui.label}>{t('st.fPhone')}</span>
          <input
            style={ui.input}
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </label>
      </div>

      {/* Role + bookable: the heart of this form — picks permissions and whether
          this person shows in booking/assignment. */}
      <RolePicker
        role={form.staffRole}
        takesAppointments={form.takesAppointments}
        onChange={(staffRole, takesAppointments) => setForm({ ...form, staffRole, takesAppointments })}
      />

      <div>
        <span style={ui.label}>{t('st.profilePhotoOpt')}</span>
        <AvatarPicker value={form.avatarUrl} name={form.firstName} onChange={(v) => setForm({ ...form, avatarUrl: v })} />
      </div>

      {/* Inline login. Required for receptionists/managers to actually sign in. */}
      <div style={{ borderTop: '1px solid var(--c1e293b)', paddingTop: 14 }}>
        <span style={ui.label}>{t('st.loginOptional')}</span>
        <p style={{ color: 'var(--c94a3b8)', fontSize: 12, margin: '0 0 10px' }}>{t('st.loginHint')}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <label>
            <span style={ui.label}>{t('st.loginEmail')}</span>
            <input style={ui.input} type="email" value={form.loginEmail} onChange={(e) => setForm({ ...form, loginEmail: e.target.value })} placeholder={t('st.loginEmailPh')} />
          </label>
          <label>
            <span style={ui.label}>{t('st.password')}</span>
            <input style={ui.input} type="text" value={form.loginPassword} onChange={(e) => setForm({ ...form, loginPassword: e.target.value })} placeholder={t('st.passwordPh')} />
          </label>
        </div>
      </div>

      {/* Skills only for bookable technicians. */}
      {form.takesAppointments ? (
        <div>
          <span style={ui.label}>{t('st.skills')}</span>
          {services.length === 0 ? (
            <p style={{ color: 'var(--c94a3b8)', fontSize: 13 }}>{t('st.noServicesCreate')}</p>
          ) : (
            <SkillPicker all={services} ids={skillIds} set={setSkillIds} />
          )}
        </div>
      ) : (
        <p style={{ color: 'var(--c64748b)', fontSize: 12 }}>{t('st.skillsTechOnly')}</p>
      )}

      {error && <div style={ui.banner}>{error}</div>}
      <button type="submit" disabled={submitting} style={{ ...ui.primaryBtn }}>
        {submitting ? t('st.creating') : t('st.createStaff')}
      </button>
    </form>
  );
}

/**
 * Skills picker: services grouped by category, with a search box, a per-group
 * select-all, and a running count. Replaces the old flat 60-checkbox wall so a
 * tech's skills are quick to find and set.
 */
function SkillPicker({ all, ids, set }: { all: Service[]; ids: string[]; set: (v: string[]) => void }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [q, setQ] = useState('');
  const [selOnly, setSelOnly] = useState(false);
  const [cat, setCat] = useState<string>('__all__');
  if (all.length === 0) return <p style={{ color: 'var(--c94a3b8)', fontSize: 13 }}>{t('st.noServices')}</p>;

  const ql = q.trim().toLowerCase();
  const searching = ql.length > 0;
  const has = (id: string) => ids.includes(id);
  const toggle = (id: string) => set(has(id) ? ids.filter((x) => x !== id) : [...ids, id]);

  const cats: { key: string; name: string; items: Service[] }[] = [];
  const byKey = new Map<string, { key: string; name: string; items: Service[] }>();
  for (const sv of all) {
    const key = sv.category?.id ?? '__none__';
    let g = byKey.get(key);
    if (!g) { g = { key, name: sv.category?.name ?? t('st.skOther'), items: [] }; byKey.set(key, g); cats.push(g); }
    g.items.push(sv);
  }

  const active = cat === '__all__' ? null : byKey.get(cat) ?? null;
  let list: Service[] = active ? active.items : all;
  if (searching) list = all.filter((sv) => sv.name.toLowerCase().includes(ql));
  if (selOnly) list = list.filter((sv) => has(sv.id));

  const listIds = list.map((sv) => sv.id);
  const listAllOn = listIds.length > 0 && listIds.every((id) => has(id));
  const midTitle = searching ? t('st.skResults') : active ? active.name : t('st.skAllServices');
  const picked = ids.map((id) => all.find((sv) => sv.id === id)).filter(Boolean) as Service[];
  const allOn = ids.length >= all.length;
  const catName = (sv: Service) => sv.category?.name ?? t('st.skOther');
  const meta = (sv: Service) => {
    const bits: string[] = [];
    if (sv.durationMinutes) bits.push(`${sv.durationMinutes} min`);
    if (typeof sv.priceCents === 'number' && sv.priceCents > 0) bits.push(`$${(sv.priceCents / 100).toFixed(2)}`);
    return bits.join(' · ');
  };

  const colH = 330;
  const rowBtn = (on: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
    padding: '7px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13,
    background: on ? 'var(--c312e81)' : 'transparent', color: on ? 'var(--cc7d2fe)' : 'var(--ccbd5e1)', fontWeight: on ? 600 : 400,
  });
  const countPill = (n: number, tot: number): React.CSSProperties => ({
    marginLeft: 'auto', fontSize: 11, padding: '1px 7px', borderRadius: 999, fontWeight: 600,
    background: n > 0 ? '#4338ca' : 'var(--c1e293b)', color: n > 0 ? 'var(--ce0e7ff)' : 'var(--c64748b)',
  });
  const colHead: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--c64748b)',
    padding: '8px 10px', borderBottom: '1px solid var(--c1e293b)', display: 'flex', alignItems: 'center', gap: 8,
  };

  return (
    <div>
      {/* Toolbar: search · selected-only · counter · select all */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--c64748b)', fontSize: 13, pointerEvents: 'none' }}>🔍</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('st.skSearchPh')} style={{ ...ui.input, width: '100%', paddingLeft: 30, boxSizing: 'border-box' }} />
        </div>
        <button type="button" onClick={() => setSelOnly((v) => !v)} style={{ fontSize: 12, padding: '5px 11px', borderRadius: 999, border: `1px solid ${selOnly ? '#6366f1' : 'var(--c334155)'}`, background: selOnly ? 'var(--c312e81)' : 'transparent', color: selOnly ? 'var(--cc7d2fe)' : 'var(--c94a3b8)', cursor: 'pointer', fontWeight: 600 }}>
          {selOnly ? '✓ ' : ''}{t('st.skSelectedOnly')}
        </button>
        <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{t('st.skSelected').replace('{n}', String(ids.length)).replace('{m}', String(all.length))}</span>
        <button type="button" onClick={() => set(allOn ? [] : all.map((sv) => sv.id))} style={{ fontSize: 12, padding: '5px 12px', borderRadius: 999, border: '1px solid #6366f1', background: 'transparent', color: 'var(--ca5b4fc)', cursor: 'pointer', fontWeight: 600 }}>
          {allOn ? t('st.clearAll') : t('st.selectAll')}
        </button>
      </div>

      {/* 3 columns: categories · services · selected */}
      <div style={{ display: 'flex', flexWrap: 'wrap', border: '1px solid var(--c1e293b)', borderRadius: 12, overflow: 'hidden', background: 'var(--c0b1220)' }}>
        {/* Column 1 — categories */}
        <div style={{ width: 210, minWidth: 180, flex: '0 1 210px', borderRight: '1px solid var(--c1e293b)', display: 'flex', flexDirection: 'column' }}>
          <div style={colHead}>{t('st.skCategories')}</div>
          <div style={{ maxHeight: colH, overflowY: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <button type="button" onClick={() => { setCat('__all__'); setSelOnly(false); }} style={rowBtn(cat === '__all__' && !selOnly)}>
              <span>★</span><span>{t('st.skAllServices')}</span><span style={countPill(ids.length, all.length)}>{all.length}</span>
            </button>
            <button type="button" onClick={() => { setCat('__all__'); setSelOnly(true); }} style={rowBtn(selOnly)}>
              <span>✓</span><span>{t('st.skSelectedCol')}</span><span style={countPill(ids.length, ids.length)}>{ids.length}</span>
            </button>
            <div style={{ height: 1, background: 'var(--c1e293b)', margin: '4px 6px' }} />
            {cats.map((g) => {
              const sel = g.items.filter((sv) => has(sv.id)).length;
              return (
                <button key={g.key} type="button" onClick={() => { setCat(g.key); setSelOnly(false); }} style={rowBtn(cat === g.key && !selOnly)}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</span>
                  <span style={countPill(sel, g.items.length)}>{sel > 0 ? `${sel}/${g.items.length}` : g.items.length}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Column 2 — services in the active category */}
        <div style={{ flex: '1 1 300px', minWidth: 260, borderRight: '1px solid var(--c1e293b)', display: 'flex', flexDirection: 'column' }}>
          <div style={colHead}>
            <span style={{ color: 'var(--ccbd5e1)' }}>{midTitle}</span>
            <span style={{ color: 'var(--c64748b)', textTransform: 'none', letterSpacing: 0 }}>{list.filter((sv) => has(sv.id)).length}/{list.length}</span>
            {list.length > 0 && (
              <button type="button" onClick={() => set(listAllOn ? ids.filter((id) => !listIds.includes(id)) : [...new Set([...ids, ...listIds])])} style={{ marginLeft: 'auto', fontSize: 11, padding: '3px 9px', borderRadius: 999, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--c94a3b8)', cursor: 'pointer' }}>
                {listAllOn ? t('st.covNone') : t('st.covAll')}
              </button>
            )}
          </div>
          <div style={{ maxHeight: colH, overflowY: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {list.length === 0 ? (
              <p style={{ color: 'var(--c64748b)', fontSize: 13, padding: '10px 6px' }}>{searching ? `${t('st.skNoMatch')} "${q}"` : t('st.skEmptyList')}</p>
            ) : list.map((sv) => {
              const on = has(sv.id);
              const m = meta(sv);
              return (
                <label key={sv.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '7px 10px', borderRadius: 8, cursor: 'pointer', background: on ? 'var(--c312e81)' : 'transparent', border: `1px solid ${on ? '#4338ca' : 'transparent'}` }}>
                  <input type="checkbox" checked={on} onChange={() => toggle(sv.id)} style={{ marginTop: 2 }} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13, color: on ? 'var(--ce0e7ff)' : 'var(--ce2e8f0)' }}>{sv.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--c64748b)' }}>
                      {(searching || cat === '__all__' || selOnly) ? catName(sv) + (m ? ` · ${m}` : '') : m}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {/* Column 3 — what this technician can do */}
        <div style={{ width: 220, minWidth: 190, flex: '0 1 220px', display: 'flex', flexDirection: 'column' }}>
          <div style={colHead}>
            <span style={{ color: 'var(--ccbd5e1)' }}>{t('st.skSelectedCol')}</span>
            <span style={{ color: 'var(--c64748b)', textTransform: 'none' }}>{ids.length}</span>
            {ids.length > 0 && (
              <button type="button" onClick={() => set([])} style={{ marginLeft: 'auto', fontSize: 11, padding: '3px 9px', borderRadius: 999, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--c94a3b8)', cursor: 'pointer' }}>
                {t('st.clearAll')}
              </button>
            )}
          </div>
          <div style={{ maxHeight: colH, overflowY: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {picked.length === 0 ? (
              <p style={{ color: 'var(--c64748b)', fontSize: 12, padding: '10px 6px' }}>{t('st.skEmptySel')}</p>
            ) : picked.map((sv) => (
              <span key={sv.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 9px', borderRadius: 8, background: 'var(--c1e1b4b)', border: '1px solid #4338ca', color: 'var(--cc7d2fe)', fontSize: 12 }}>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={sv.name}>{sv.name}</span>
                <button type="button" onClick={() => toggle(sv.id)} aria-label="remove" style={{ border: 'none', background: 'transparent', color: 'var(--ca5b4fc)', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0 }}>✕</button>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The skills column used to print sixty comma-separated names — four teams of
 * that and the table was unreadable. What the owner actually needs at a glance
 * is COVERAGE: does this tech appear on the booking page, and for how much of
 * the menu? One pill answers that; clicking it reveals the full list.
 */
function SkillsCell({ m, total, serviceName, t }: {
  m: { staffServices: { serviceId: string }[]; takesAppointments?: boolean };
  total: number;
  serviceName: (id: string) => string;
  t: (k: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const n = m.staffServices.length;
  if (m.takesAppointments === false) return <span style={{ color: 'var(--c64748b)' }}>—</span>;
  if (n === 0) {
    // The one state that costs bookings — loud on purpose.
    return (
      <span style={{ display: 'inline-block', background: 'rgba(239,68,68,0.12)', border: '1px solid var(--c7f1d1d)', color: 'var(--cfca5a5)', borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 700 }}>
        ⚠ {t('st.covNone')}
      </span>
    );
  }
  const all = total > 0 && n >= total;
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          background: all ? 'rgba(34,197,94,0.12)' : 'var(--c1e293b)',
          border: `1px solid ${all ? 'var(--c166534)' : 'var(--c334155)'}`,
          color: all ? 'var(--c86efac)' : 'var(--ccbd5e1)',
          borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
        }}
      >
        {all ? t('st.covAll') : `${n} / ${total} ${t('st.covOf')}`} {open ? '▴' : '▾'}
      </button>
      {open && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 7, maxWidth: 560 }}>
          {m.staffServices.map((ss) => (
            <span key={ss.serviceId} style={{ background: 'var(--c0f172a)', border: '1px solid var(--c334155)', color: 'var(--c94a3b8)', borderRadius: 6, padding: '2px 7px', fontSize: 11.5 }}>
              {serviceName(ss.serviceId)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
