'use client';

import { useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';

export default function SalonAccountPage() {
  return (
    <SalonShell>
      <Inner />
    </SalonShell>
  );
}

function Inner() {
  const { token, user, logout } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
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
    if (!currentPassword) { setErr(t('ac.needCurrentPw')); return; }
    if (newPassword && newPassword !== confirm) { setErr(t('ac.pwMismatch')); return; }
    if (newPassword && newPassword.length < 8) { setErr(t('ac.pwShort')); return; }
    setBusy(true);
    try {
      const r = await apiFetch<{ ok: boolean; email: string; passwordChanged?: boolean }>('/me/account', {
        method: 'PATCH', token,
        body: {
          currentPassword,
          newEmail: newEmail.trim() && newEmail.trim() !== currentEmail ? newEmail.trim() : undefined,
          newPassword: newPassword || undefined,
        },
      });
      setCurrentPassword(''); setNewPassword(''); setConfirm('');
      if (r.passwordChanged) {
        // Password changed → the current session is now invalid. Sign out immediately.
        setMsg(t('ac.pwLogout'));
        setTimeout(() => logout(), 1400);
        return;
      }
      setMsg(t('ac.saved').replace('{email}', r.email) + (newPassword ? ' ' + t('ac.savedPw') : ''));
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : t('ac.updateFail'));
    } finally { setBusy(false); }
  }

  return (
    <section style={{ maxWidth: 520 }}>
      <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>{t('ac.title')}</h1>
      <p style={{ color: '#94a3b8', fontSize: 14, marginTop: 0 }}>{t('ac.subtitle')}</p>

      {err && <div style={ui.banner}>{err}</div>}
      {msg && <div style={{ background: '#064e3b', color: '#a7f3d0', padding: '10px 14px', borderRadius: 8, fontSize: 14, marginBottom: 14 }}>{msg}</div>}

      <form onSubmit={save} style={ui.card}>
        <label style={{ display: 'block', marginBottom: 12 }}>
          <span style={ui.label}>{t('ac.loginEmail')}</span>
          <input style={ui.input} type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
        </label>

        <div style={{ borderTop: '1px solid #334155', margin: '6px 0 12px', paddingTop: 12, fontSize: 13, color: '#cbd5e1', fontWeight: 600 }}>{t('ac.changePw')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          <label><span style={ui.label}>{t('ac.newPw')}</span>
            <input style={ui.input} type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder={t('ac.newPwPh')} /></label>
          <label><span style={ui.label}>{t('ac.confirmPw')}</span>
            <input style={ui.input} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
        </div>

        <label style={{ display: 'block', marginTop: 12 }}>
          <span style={ui.label}>{t('ac.currentPw')}</span>
          <input style={ui.input} type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
        </label>

        <button type="submit" disabled={busy} style={{ ...ui.primaryBtn, marginTop: 16 }}>{busy ? t('ac.saving') : t('ac.save')}</button>
      </form>
    </section>
  );
}
