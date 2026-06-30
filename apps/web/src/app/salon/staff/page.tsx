'use client';

import { Fragment, useCallback, useEffect, useState, FormEvent } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang, tr, DAY_LABEL } from '../../../lib/i18n';
import { useIsMobile } from '../../../lib/responsive';
import { MList, MCard, MHead, MRow, MActions } from '../../../components/MobileCard';
import { SearchBox, matchesQuery, sortNewest } from '../../../components/ListFilter';

interface Service {
  id: string;
  name: string;
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
                border: `1px solid ${on ? '#6366f1' : '#475569'}`,
                background: on ? '#312e81' : 'transparent',
                color: on ? '#c7d2fe' : '#cbd5e1',
              }}
            >
              {r.emoji} {r.label}
            </button>
          );
        })}
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, cursor: 'pointer' }}>
        <input type="checkbox" checked={takesAppointments} onChange={(e) => onChange(role, e.target.checked)} />
        <span style={{ fontSize: 14, color: '#e2e8f0', fontWeight: 600 }}>{t('st.takesAppts')}</span>
      </label>
      <p style={{ color: takesAppointments ? '#64748b' : '#f59e0b', fontSize: 12, marginTop: 6 }}>
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
    TECHNICIAN: { label: t('st.roleTech'), bg: '#312e81', fg: '#c7d2fe' },
    RECEPTIONIST: { label: t('st.roleReception'), bg: '#78350f', fg: '#fcd34d' },
    MANAGER: { label: t('st.roleManager'), bg: '#155e75', fg: '#a5f3fc' },
  };
  const m = map[r];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: m.bg, color: m.fg }}>{m.label}</span>
      {takes === false && r === 'TECHNICIAN' && (
        <span style={{ fontSize: 11, color: '#94a3b8' }}>· {t('st.notBookableTag')}</span>
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
    <span style={{ width: 36, height: 36, borderRadius: '50%', background: '#334155', color: '#cbd5e1', display: 'inline-grid', placeItems: 'center', fontSize: 14, fontWeight: 600, flexShrink: 0 }}>
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
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not load image'));
      img.onload = () => {
        const SIZE = 256;
        const canvas = document.createElement('canvas');
        canvas.width = SIZE; canvas.height = SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas not supported'));
        // Center-crop to a square, then draw scaled into the canvas.
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
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
        ? <img src={value} alt="avatar" width={64} height={64} style={{ borderRadius: '50%', objectFit: 'cover', border: '2px solid #334155' }} />
        : <span style={{ width: 64, height: 64, borderRadius: '50%', background: '#334155', color: '#cbd5e1', display: 'grid', placeItems: 'center', fontSize: 22, fontWeight: 700 }}>{(name || '?').charAt(0).toUpperCase()}</span>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ ...ui.input, padding: '8px 14px', cursor: 'pointer', width: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          📷 {busy ? t('st.processing') : value ? t('st.changePhoto') : t('st.uploadPhoto')}
          <input type="file" accept="image/*" onChange={pick} style={{ display: 'none' }} />
        </label>
        {value && <button type="button" onClick={() => onChange('')} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: 12, cursor: 'pointer', textAlign: 'left', padding: 0 }}>{t('st.removePhoto')}</button>}
        {err && <span style={{ color: '#ef4444', fontSize: 12 }}>{err}</span>}
        <span style={{ color: '#64748b', fontSize: 11 }}>{t('st.photoHint')}</span>
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
        ? <img src={value} alt="tip QR" width={84} height={84} style={{ borderRadius: 10, objectFit: 'cover', border: '1px solid #334155', background: '#fff' }} />
        : <span style={{ width: 84, height: 84, borderRadius: 10, background: '#0f172a', border: '1px dashed #475569', display: 'grid', placeItems: 'center', fontSize: 26 }}>📱</span>}
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
    setLoginFor(m.id);
    setLoginForm({ email: m.email ?? '', password: '' });
    setCreatedMsg(null);
    setError(null);
  }

  async function submitLogin(staffId: string) {
    setError(null);
    try {
      await apiFetch(`/staff/${staffId}/login`, { method: 'POST', token, body: loginForm });
      setLoginFor(null);
      setCreatedMsg(t('st.loginCreated').replace('{email}', loginForm.email));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create login');
    }
  }

  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? '—';

  // Search only, newest first. (No date filter — staff list isn't time-based.)
  const visible = sortNewest(
    staff.filter((m) => matchesQuery(`${m.firstName} ${m.lastName ?? ''} ${m.email ?? ''} ${m.phone ?? ''}`, q)),
    (m) => m.createdAt,
  );

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
        <span style={{ color: '#94a3b8', fontSize: 13 }}>{visible.length} {t('st.staffWord')}</span>
      </div>

      {error && <div style={ui.banner}>{error}</div>}
      {createdMsg && <div style={{ background: '#14532d', color: '#bbf7d0', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{createdMsg}</div>}

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
        <p style={{ color: '#94a3b8' }}>{t('st.loading')}</p>
      ) : isMobile ? (
        <MList>
          {visible.length === 0 && <p style={{ color: '#64748b', fontSize: 13 }}>{t('st.empty')}</p>}
          {visible.map((m) => (
            <Fragment key={m.id}>
              <MCard>
                <MHead right={<span style={{ color: m.isActive ? '#22c55e' : '#94a3b8', fontSize: 12, fontWeight: 600 }}>{m.isActive ? t('st.active') : t('st.inactive')}</span>}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Avatar url={m.avatarUrl} name={m.firstName} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span>{m.firstName} {m.lastName ?? ''}</span>
                      <RoleBadge role={m.staffRole} takes={m.takesAppointments} />
                    </div>
                  </div>
                </MHead>
                <MRow label={t('st.colContact')}>{m.email || '—'}{m.phone ? ' · ' + m.phone : ''}</MRow>
                <MRow label={t('st.colSkills')}>{m.staffServices.length === 0 ? '—' : m.staffServices.map((ss) => serviceName(ss.serviceId)).join(', ')}</MRow>
                <MRow label={t('st.colLogin')}>
                  {m.user ? <span style={{ color: '#22c55e' }}>🔑 {m.user.email}</span> : <button onClick={() => openLogin(m)} style={{ ...ui.primaryBtn, padding: '5px 10px', fontSize: 12, background: loginFor === m.id ? '#475569' : '#6366f1' }}>{loginFor === m.id ? t('st.cancel') : t('st.createLogin')}</button>}
                </MRow>
                <MActions>
                  <button onClick={() => { setEditFor(editFor === m.id ? null : m.id); setLoginFor(null); }} style={{ ...ui.primaryBtn, padding: '6px 12px', fontSize: 12, background: editFor === m.id ? '#475569' : '#6366f1' }}>{editFor === m.id ? t('st.close') : t('st.edit')}</button>
                  <button onClick={() => remove(m.id)} style={ui.dangerBtn}>{t('st.delete')}</button>
                </MActions>
              </MCard>
              {editFor === m.id && <div style={{ padding: 12, background: '#0f172a', border: '1px solid #334155', borderRadius: 10 }}><StaffEditPanel token={token!} member={m} services={services} onSaved={load} /></div>}
              {loginFor === m.id && (
                <div style={{ padding: 12, background: '#0f172a', border: '1px solid #334155', borderRadius: 10 }}>
                  <div style={{ fontSize: 13, color: '#cbd5e1', marginBottom: 8, fontWeight: 600 }}>{t('st.createLoginFor').replace('{name}', m.firstName)}</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
                    <label style={{ flex: 1, minWidth: 160 }}>
                      <span style={ui.label}>{t('st.loginEmail')}</span>
                      <input style={ui.input} type="email" value={loginForm.email} onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })} />
                    </label>
                    <label style={{ flex: 1, minWidth: 140 }}>
                      <span style={ui.label}>{t('st.password')}</span>
                      <input style={ui.input} type="text" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} placeholder={t('st.passwordPh')} />
                    </label>
                    <button onClick={() => submitLogin(m.id)} style={{ ...ui.primaryBtn, padding: '9px 14px' }}>{t('st.createLogin')}</button>
                  </div>
                </div>
              )}
            </Fragment>
          ))}
        </MList>
      ) : (
        <div style={{ border: '1px solid #334155', borderRadius: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#1e293b' }}>
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
                  <td style={ui.td} colSpan={6}>
                    {t('st.empty')}
                  </td>
                </tr>
              )}
              {visible.map((m) => (
                <Fragment key={m.id}>
                <tr style={{ borderTop: '1px solid #334155' }}>
                  <td style={ui.td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Avatar url={m.avatarUrl} name={m.firstName} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <span>{m.firstName} {m.lastName ?? ''}</span>
                        <RoleBadge role={m.staffRole} takes={m.takesAppointments} />
                      </div>
                    </div>
                  </td>
                  <td style={{ ...ui.td, color: '#94a3b8', fontSize: 13 }}>
                    {m.email ?? ''}
                    {m.phone ? <div>{m.phone}</div> : null}
                  </td>
                  <td style={{ ...ui.td, color: '#cbd5e1', fontSize: 13 }}>
                    {m.staffServices.length === 0
                      ? '—'
                      : m.staffServices.map((ss) => serviceName(ss.serviceId)).join(', ')}
                  </td>
                  <td style={ui.td}>
                    {m.user ? (
                      <span style={{ color: '#22c55e', fontSize: 13 }}>🔑 {m.user.email}</span>
                    ) : (
                      <button onClick={() => openLogin(m)} style={{ ...ui.primaryBtn, padding: '6px 12px', fontSize: 12, background: loginFor === m.id ? '#475569' : '#6366f1' }}>
                        {loginFor === m.id ? t('st.cancel') : t('st.createLogin')}
                      </button>
                    )}
                  </td>
                  <td style={ui.td}>
                    <span style={{ color: m.isActive ? '#22c55e' : '#94a3b8' }}>
                      {m.isActive ? t('st.active') : t('st.inactive')}
                    </span>
                  </td>
                  <td style={ui.td}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => { setEditFor(editFor === m.id ? null : m.id); setLoginFor(null); }}
                        style={{ ...ui.primaryBtn, padding: '6px 12px', fontSize: 12, background: editFor === m.id ? '#475569' : '#6366f1' }}
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
                    <td colSpan={6} style={{ padding: 16, background: '#0f172a' }}>
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
                    <td colSpan={6} style={{ padding: 14, background: '#0f172a' }}>
                      <div style={{ fontSize: 13, color: '#cbd5e1', marginBottom: 8, fontWeight: 600 }}>
                        {t('st.createLoginFor').replace('{name}', m.firstName)}
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
                        <label style={{ flex: 1, minWidth: 200 }}>
                          <span style={ui.label}>{t('st.loginEmail')}</span>
                          <input style={ui.input} type="email" value={loginForm.email} onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })} />
                        </label>
                        <label style={{ flex: 1, minWidth: 180 }}>
                          <span style={ui.label}>{t('st.password')}</span>
                          <input style={ui.input} type="text" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} placeholder={t('st.passwordPh')} />
                        </label>
                        <button onClick={() => submitLogin(m.id)} style={{ ...ui.primaryBtn, padding: '9px 14px' }}>{t('st.createLogin')}</button>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
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

interface DayRow { dow: number; enabled: boolean; start: string; end: string }

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
      const wh = member.workingHours.find((h) => h.dayOfWeek === d.dow && h.isActive);
      return { dow: d.dow, enabled: !!wh, start: wh?.startTime ?? '09:00', end: wh?.endTime ?? '18:00' };
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

  async function save() {
    if (!form.firstName.trim()) { setError(t('st.firstNameRequired')); return; }
    setSaving(true);
    setError(null);
    try {
      const workingHours = hours
        .filter((d) => d.enabled)
        .map((d) => ({ dayOfWeek: d.dow, startTime: d.start, endTime: d.end }));
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
      <div style={{ fontSize: 13, color: '#cbd5e1', fontWeight: 600 }}>{t('st.editName').replace('{name}', member.firstName)}</div>

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
            <span style={{ fontSize: 14, color: '#e2e8f0' }}>{t('st.activeBookings')}</span>
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
        <p style={{ color: '#64748b', fontSize: 12 }}>{t('st.skillsTechOnly')}</p>
      )}

      {/* Working hours */}
      <div>
        <span style={ui.label}>{t('st.workingHours')}</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 460 }}>
          {hours.map((d) => {
            const label = DAY_LABEL[lang][d.dow] ?? '';
            return (
              <div key={d.dow} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, width: 64 }}>
                  <input type="checkbox" checked={d.enabled} onChange={(e) => updDay(d.dow, { enabled: e.target.checked })} />
                  <span style={{ fontSize: 14 }}>{label}</span>
                </label>
                {d.enabled ? (
                  <>
                    <input type="time" style={{ ...ui.input, width: 120 }} value={d.start} onChange={(e) => updDay(d.dow, { start: e.target.value })} />
                    <span style={{ color: '#64748b' }}>–</span>
                    <input type="time" style={{ ...ui.input, width: 120 }} value={d.end} onChange={(e) => updDay(d.dow, { end: e.target.value })} />
                  </>
                ) : (
                  <span style={{ color: '#64748b', fontSize: 13 }}>{t('st.off')}</span>
                )}
              </div>
            );
          })}
        </div>
        <p style={{ color: '#94a3b8', fontSize: 12, marginTop: 8 }}>
          {anyEnabled ? t('st.hoursSet') : t('st.hoursUnset')}
        </p>
      </div>

      {/* Direct tip: this tech's payment QR (Venmo/Zelle/Cash App) + handle. */}
      <div>
        <span style={ui.label}>💸 {t('st.tipSection')}</span>
        <p style={{ color: '#64748b', fontSize: 12, margin: '0 0 8px' }}>{t('st.tipHint')}</p>
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
      <div style={{ borderTop: '1px solid #1e293b', paddingTop: 14 }}>
        <span style={ui.label}>{t('st.loginOptional')}</span>
        <p style={{ color: '#94a3b8', fontSize: 12, margin: '0 0 10px' }}>{t('st.loginHint')}</p>
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
            <p style={{ color: '#94a3b8', fontSize: 13 }}>{t('st.noServicesCreate')}</p>
          ) : (
            <SkillPicker all={services} ids={skillIds} set={setSkillIds} />
          )}
        </div>
      ) : (
        <p style={{ color: '#64748b', fontSize: 12 }}>{t('st.skillsTechOnly')}</p>
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
  if (all.length === 0) return <p style={{ color: '#94a3b8', fontSize: 13 }}>{t('st.noServices')}</p>;

  const ql = q.trim().toLowerCase();
  const has = (id: string) => ids.includes(id);
  const toggle = (id: string) => set(has(id) ? ids.filter((x) => x !== id) : [...ids, id]);

  const groups: { name: string; items: Service[] }[] = [];
  const byKey = new Map<string, { name: string; items: Service[] }>();
  for (const s of all) {
    if (ql && !s.name.toLowerCase().includes(ql)) continue;
    const key = s.category?.id ?? '__none__';
    let g = byKey.get(key);
    if (!g) { g = { name: s.category?.name ?? t('st.skOther'), items: [] }; byKey.set(key, g); groups.push(g); }
    g.items.push(s);
  }
  const allOn = ids.length >= all.length;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: 13, pointerEvents: 'none' }}>🔍</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('st.skSearchPh')} style={{ ...ui.input, width: '100%', paddingLeft: 30, boxSizing: 'border-box' }} />
        </div>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{t('st.skSelected').replace('{n}', String(ids.length)).replace('{m}', String(all.length))}</span>
        <button type="button" onClick={() => set(allOn ? [] : all.map((s) => s.id))} style={{ fontSize: 12, padding: '5px 12px', borderRadius: 999, border: '1px solid #6366f1', background: 'transparent', color: '#a5b4fc', cursor: 'pointer', fontWeight: 600 }}>
          {allOn ? t('st.clearAll') : t('st.selectAll')}
        </button>
      </div>

      {groups.length === 0 ? (
        <p style={{ color: '#64748b', fontSize: 13 }}>{t('st.skNoMatch')} &quot;{q}&quot;</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {groups.map((g) => {
            const gids = g.items.map((s) => s.id);
            const gAllOn = gids.every((id) => has(id));
            return (
              <div key={g.name}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4 }}>{g.name}</span>
                  <button type="button" onClick={() => set(gAllOn ? ids.filter((id) => !gids.includes(id)) : [...new Set([...ids, ...gids])])} style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', cursor: 'pointer' }}>
                    {gAllOn ? t('st.skNone') : t('st.skAll')}
                  </button>
                  <div style={{ flex: 1, height: 1, background: '#1e293b' }} />
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {g.items.map((s) => {
                    const on = has(s.id);
                    return (
                      <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, border: `1px solid ${on ? '#6366f1' : '#475569'}`, background: on ? '#312e81' : 'transparent', color: on ? '#c7d2fe' : '#cbd5e1', fontSize: 13, cursor: 'pointer' }}>
                        <input type="checkbox" checked={on} onChange={() => toggle(s.id)} />
                        {s.name}
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
