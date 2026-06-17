'use client';

import { useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';

export default function SalonAccountPage() {
  return (
    <SalonShell>
      <Inner />
    </SalonShell>
  );
}

function Inner() {
  const { token, user } = useAuth();
  const currentEmail = user?.email ?? '';
  const [newEmail, setNewEmail] = useState(currentEmail);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setMsg(null);
    if (!currentPassword) { setErr('Enter your current password to confirm the change.'); return; }
    if (newPassword && newPassword !== confirm) { setErr('New password and confirmation do not match.'); return; }
    if (newPassword && newPassword.length < 8) { setErr('New password must be at least 8 characters.'); return; }
    setBusy(true);
    try {
      const r = await apiFetch<{ ok: boolean; email: string }>('/me/account', {
        method: 'PATCH', token,
        body: {
          currentPassword,
          newEmail: newEmail.trim() && newEmail.trim() !== currentEmail ? newEmail.trim() : undefined,
          newPassword: newPassword || undefined,
        },
      });
      setMsg(`✓ Saved. Your login email is ${r.email}.${newPassword ? ' Use your new password next time you sign in.' : ''}`);
      setCurrentPassword(''); setNewPassword(''); setConfirm('');
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Update failed');
    } finally { setBusy(false); }
  }

  return (
    <section style={{ maxWidth: 520 }}>
      <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>My account</h1>
      <p style={{ color: '#94a3b8', fontSize: 14, marginTop: 0 }}>Change your own login email and password.</p>

      {err && <div style={ui.banner}>{err}</div>}
      {msg && <div style={{ background: '#064e3b', color: '#a7f3d0', padding: '10px 14px', borderRadius: 8, fontSize: 14, marginBottom: 14 }}>{msg}</div>}

      <form onSubmit={save} style={ui.card}>
        <label style={{ display: 'block', marginBottom: 12 }}>
          <span style={ui.label}>Login email</span>
          <input style={ui.input} type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
        </label>

        <div style={{ borderTop: '1px solid #334155', margin: '6px 0 12px', paddingTop: 12, fontSize: 13, color: '#cbd5e1', fontWeight: 600 }}>Change password (optional)</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label><span style={ui.label}>New password</span>
            <input style={ui.input} type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="min 8 chars — leave blank to keep" /></label>
          <label><span style={ui.label}>Confirm new password</span>
            <input style={ui.input} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
        </div>

        <label style={{ display: 'block', marginTop: 12 }}>
          <span style={ui.label}>Current password (required to confirm)</span>
          <input style={ui.input} type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
        </label>

        <button type="submit" disabled={busy} style={{ ...ui.primaryBtn, marginTop: 16 }}>{busy ? 'Saving…' : 'Save account'}</button>
      </form>
    </section>
  );
}
