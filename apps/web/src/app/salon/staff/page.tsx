'use client';

import { Fragment, useCallback, useEffect, useState, FormEvent } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { DateRangeBar, useDateRange, sortNewest } from '../../../components/ListFilter';

interface Service {
  id: string;
  name: string;
}

interface StaffMember {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  performanceScore: number;
  staffServices: { serviceId: string }[];
  workingHours: { id: string; dayOfWeek: number; startTime: string; endTime: string; isActive: boolean }[];
  user: { id: string; email: string } | null;
  createdAt?: string;
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

export default function StaffPage() {
  return (
    <SalonShell>
      <StaffInner />
    </SalonShell>
  );
}

function StaffInner() {
  const { token } = useAuth();
  const range = useDateRange('all');
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
    if (!confirm('Delete this staff member?')) return;
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
      setCreatedMsg(`Login created for ${loginForm.email}. The technician can now sign in at the login page.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create login');
    }
  }

  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? '—';

  // Filter by created date, then newest first.
  const visible = sortNewest(
    staff.filter((m) => range.inRange(m.createdAt)),
    (m) => m.createdAt,
  );

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>Staff / Technicians</h2>
        <button onClick={() => setShowForm((s) => !s)} style={ui.primaryBtn}>
          {showForm ? 'Close' : '+ New staff'}
        </button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <span style={{ color: '#94a3b8', fontSize: 13 }}>{visible.length} staff</span>
        <DateRangeBar range={range} />
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
        <p style={{ color: '#94a3b8' }}>Loading...</p>
      ) : (
        <div style={{ border: '1px solid #334155', borderRadius: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#1e293b' }}>
                <th style={ui.th}>Name</th>
                <th style={ui.th}>Contact</th>
                <th style={ui.th}>Skills</th>
                <th style={ui.th}>Login</th>
                <th style={ui.th}>Status</th>
                <th style={ui.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td style={ui.td} colSpan={6}>
                    No staff in this range.
                  </td>
                </tr>
              )}
              {visible.map((m) => (
                <Fragment key={m.id}>
                <tr style={{ borderTop: '1px solid #334155' }}>
                  <td style={ui.td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Avatar url={m.avatarUrl} name={m.firstName} />
                      <span>{m.firstName} {m.lastName ?? ''}</span>
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
                        {loginFor === m.id ? 'Cancel' : 'Create login'}
                      </button>
                    )}
                  </td>
                  <td style={ui.td}>
                    <span style={{ color: m.isActive ? '#22c55e' : '#94a3b8' }}>
                      {m.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={ui.td}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => { setEditFor(editFor === m.id ? null : m.id); setLoginFor(null); }}
                        style={{ ...ui.primaryBtn, padding: '6px 12px', fontSize: 12, background: editFor === m.id ? '#475569' : '#6366f1' }}
                      >
                        {editFor === m.id ? 'Close' : 'Edit'}
                      </button>
                      <button onClick={() => remove(m.id)} style={ui.dangerBtn}>
                        Delete
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
                        Create a login for {m.firstName} — they sign in to see their bookings.
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
                        <label style={{ flex: 1, minWidth: 200 }}>
                          <span style={ui.label}>Login email</span>
                          <input style={ui.input} type="email" value={loginForm.email} onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })} />
                        </label>
                        <label style={{ flex: 1, minWidth: 180 }}>
                          <span style={ui.label}>Password (min 8)</span>
                          <input style={ui.input} type="text" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} placeholder="Set a password" />
                        </label>
                        <button onClick={() => submitLogin(m.id)} style={{ ...ui.primaryBtn, padding: '9px 14px' }}>Create login</button>
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
  const [form, setForm] = useState({
    firstName: member.firstName,
    lastName: member.lastName ?? '',
    email: member.email ?? '',
    phone: member.phone ?? '',
    avatarUrl: member.avatarUrl ?? '',
    isActive: member.isActive,
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
  function toggleSkill(id: string) {
    setSkillIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setSaved(false);
  }
  function updDay(dow: number, patch: Partial<DayRow>) {
    setHours((prev) => prev.map((d) => (d.dow === dow ? { ...d, ...patch } : d)));
    setSaved(false);
  }

  async function save() {
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
          serviceIds: skillIds,
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
      <div style={{ fontSize: 13, color: '#cbd5e1', fontWeight: 600 }}>Edit {member.firstName}</div>

      {/* Profile */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <label><span style={ui.label}>First name</span>
          <input style={ui.input} value={form.firstName} onChange={(e) => up('firstName', e.target.value)} /></label>
        <label><span style={ui.label}>Last name</span>
          <input style={ui.input} value={form.lastName} onChange={(e) => up('lastName', e.target.value)} /></label>
        <label><span style={ui.label}>Email</span>
          <input style={ui.input} type="email" value={form.email} onChange={(e) => up('email', e.target.value)} /></label>
        <label><span style={ui.label}>Phone</span>
          <input style={ui.input} value={form.phone} onChange={(e) => up('phone', e.target.value)} /></label>
        <label><span style={ui.label}>Avatar image URL</span>
          <input style={ui.input} value={form.avatarUrl} onChange={(e) => up('avatarUrl', e.target.value)} placeholder="https://…" /></label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 22 }}>
          <input type="checkbox" checked={form.isActive} onChange={(e) => up('isActive', e.target.checked)} />
          <span style={{ fontSize: 14, color: '#e2e8f0' }}>Active (can take bookings)</span>
        </label>
      </div>

      {/* Skills */}
      <div>
        <span style={ui.label}>Skills (services this technician can do)</span>
        {services.length === 0 ? (
          <p style={{ color: '#94a3b8', fontSize: 13 }}>No services yet.</p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {services.map((s) => (
              <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, border: '1px solid #475569', fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={skillIds.includes(s.id)} onChange={() => toggleSkill(s.id)} />
                {s.name}
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Working hours */}
      <div>
        <span style={ui.label}>Working hours (when this technician can be auto-assigned)</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 460 }}>
          {hours.map((d) => {
            const label = DAYS.find((x) => x.dow === d.dow)?.label ?? '';
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
                  <span style={{ color: '#64748b', fontSize: 13 }}>Off</span>
                )}
              </div>
            );
          })}
        </div>
        <p style={{ color: '#94a3b8', fontSize: 12, marginTop: 8 }}>
          {anyEnabled
            ? 'The technician is only auto-assigned inside these hours.'
            : 'No hours set → available during the salon’s open hours (default).'}
        </p>
      </div>

      {error && <div style={ui.banner}>{error}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={save} disabled={saving} style={ui.primaryBtn}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {saved && <span style={{ color: '#22c55e', fontSize: 13 }}>✓ Saved</span>}
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
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', avatarUrl: '' });
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function toggleSkill(id: string) {
    setSkillIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
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
          serviceIds: skillIds,
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label>
          <span style={ui.label}>First name</span>
          <input
            style={ui.input}
            value={form.firstName}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
            required
          />
        </label>
        <label>
          <span style={ui.label}>Last name</span>
          <input
            style={ui.input}
            value={form.lastName}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
          />
        </label>
        <label>
          <span style={ui.label}>Email</span>
          <input
            style={ui.input}
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </label>
        <label>
          <span style={ui.label}>Phone</span>
          <input
            style={ui.input}
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </label>
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'end' }}>
        <label style={{ flex: 1 }}>
          <span style={ui.label}>Avatar image URL (optional)</span>
          <input
            style={ui.input}
            value={form.avatarUrl}
            onChange={(e) => setForm({ ...form, avatarUrl: e.target.value })}
            placeholder="https://… (paste an image link)"
          />
        </label>
        {form.avatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={form.avatarUrl} alt="preview" width={44} height={44} style={{ borderRadius: '50%', objectFit: 'cover' }} />
        )}
      </div>

      <div style={{ marginTop: 14 }}>
        <span style={ui.label}>Skills (services this technician can do)</span>
        {services.length === 0 ? (
          <p style={{ color: '#94a3b8', fontSize: 13 }}>
            No services yet — create services first to assign skills.
          </p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {services.map((s) => (
              <label
                key={s.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: '1px solid #475569',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={skillIds.includes(s.id)}
                  onChange={() => toggleSkill(s.id)}
                />
                {s.name}
              </label>
            ))}
          </div>
        )}
      </div>

      {error && <div style={ui.banner}>{error}</div>}
      <button type="submit" disabled={submitting} style={{ ...ui.primaryBtn, marginTop: 14 }}>
        {submitting ? 'Creating...' : 'Create staff'}
      </button>
    </form>
  );
}
