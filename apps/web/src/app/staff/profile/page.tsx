'use client';

import { useCallback, useEffect, useState, FormEvent } from 'react';
import { StaffShell } from '../../../components/StaffShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';

interface MyProfile {
  id: string; firstName: string; lastName: string | null;
  email: string | null; phone: string | null; avatarUrl: string | null;
}

/** Resize/crop an image file to a compact square JPEG data URL. */
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
        const side = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export default function StaffProfilePage() {
  return (
    <StaffShell title="My Profile">
      <Inner />
    </StaffShell>
  );
}

function Inner() {
  const { token } = useAuth();
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '', avatarUrl: '' });
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const p = await apiFetch<MyProfile>('/staff/me', { token });
      setForm({ firstName: p.firstName ?? '', lastName: p.lastName ?? '', phone: p.phone ?? '', avatarUrl: p.avatarUrl ?? '' });
      setEmail(p.email);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load your profile');
    } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Please choose an image file'); return; }
    setBusy(true); setError(null);
    try { setForm((f) => ({ ...f, avatarUrl: await fileToAvatarDataUrl(file) })); }
    catch { setError('Could not process that image'); }
    finally { setBusy(false); }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null); setMsg(null);
    try {
      await apiFetch('/staff/me', { method: 'PATCH', token, body: {
        firstName: form.firstName, lastName: form.lastName || undefined,
        phone: form.phone || undefined, avatarUrl: form.avatarUrl,
      } });
      setMsg('Saved! Your photo now shows when clients book with you.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally { setSaving(false); }
  }

  if (loading) return <p style={{ color: '#94a3b8' }}>Loading…</p>;

  return (
    <form onSubmit={save} style={{ ...ui.card, maxWidth: 520 }}>
      {error && <div style={ui.banner}>{error}</div>}
      {msg && <div style={{ background: '#064e3b', color: '#a7f3d0', padding: '10px 14px', borderRadius: 8, fontSize: 14, marginBottom: 14 }}>{msg}</div>}

      <div style={{ fontSize: 13, color: '#cbd5e1', fontWeight: 600, marginBottom: 4 }}>Profile photo</div>
      <p style={{ color: '#64748b', fontSize: 12, margin: '0 0 12px' }}>Clients see this when choosing a technician. A clear, square face photo works best.</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18 }}>
        {form.avatarUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={form.avatarUrl} alt="avatar" width={84} height={84} style={{ borderRadius: '50%', objectFit: 'cover', border: '2px solid #334155' }} />
          : <span style={{ width: 84, height: 84, borderRadius: '50%', background: '#334155', color: '#cbd5e1', display: 'grid', placeItems: 'center', fontSize: 30, fontWeight: 700 }}>{(form.firstName || '?').charAt(0).toUpperCase()}</span>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ ...ui.input, padding: '9px 14px', cursor: 'pointer', width: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            📷 {busy ? 'Processing…' : form.avatarUrl ? 'Change photo' : 'Upload photo'}
            <input type="file" accept="image/*" onChange={pickPhoto} style={{ display: 'none' }} />
          </label>
          {form.avatarUrl && <button type="button" onClick={() => setForm((f) => ({ ...f, avatarUrl: '' }))} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: 12, cursor: 'pointer', textAlign: 'left', padding: 0 }}>Remove photo</button>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label><span style={ui.label}>First name</span>
          <input style={ui.input} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required /></label>
        <label><span style={ui.label}>Last name</span>
          <input style={ui.input} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></label>
      </div>
      <label style={{ display: 'block', marginTop: 12 }}><span style={ui.label}>Phone</span>
        <input style={ui.input} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
      <label style={{ display: 'block', marginTop: 12 }}><span style={ui.label}>Email (login — ask your manager to change)</span>
        <input style={{ ...ui.input, opacity: 0.6 }} value={email ?? ''} readOnly /></label>

      <button type="submit" disabled={saving} style={{ ...ui.primaryBtn, marginTop: 18 }}>{saving ? 'Saving…' : 'Save profile'}</button>
    </form>
  );
}
