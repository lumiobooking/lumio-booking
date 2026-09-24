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
      <p style={{ color: 'var(--c94a3b8)', fontSize: 14, marginTop: 0 }}>{t('ac.subtitle')}</p>

      {err && <div style={ui.banner}>{err}</div>}
      {msg && <div style={{ background: 'var(--c064e3b)', color: 'var(--ca7f3d0)', padding: '10px 14px', borderRadius: 8, fontSize: 14, marginBottom: 14 }}>{msg}</div>}

      <form onSubmit={save} style={ui.card}>
        <label style={{ display: 'block', marginBottom: 12 }}>
          <span style={ui.label}>{t('ac.loginEmail')}</span>
          <input style={ui.input} type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
        </label>

        <div style={{ borderTop: '1px solid var(--c334155)', margin: '6px 0 12px', paddingTop: 12, fontSize: 13, color: 'var(--ccbd5e1)', fontWeight: 600 }}>{t('ac.changePw')}</div>
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

      <DeleteAccount />
    </section>
  );
}

/**
 * Close your own login, from inside the app.
 *
 * Both app stores require it (Apple 5.1.1(v), Google Play's account-deletion
 * rule): anyone who can sign in must be able to delete the account here,
 * not by emailing support. The salon's bookings and payments stay — they
 * are the business's records — the person's login and personal fields go.
 * Two locks against a slip: the current password and the typed word.
 */
function DeleteAccount() {
  const { token, logout } = useAuth();
  const { lang } = useLang();
  const L = (vi: string, en: string) => (lang === 'vi' ? vi : en);
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      await apiFetch('/me/delete-account', { method: 'POST', token, body: { currentPassword: pw, confirm: word } });
      logout();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : L('Không xoá được', 'Could not delete'));
    } finally { setBusy(false); }
  }

  return (
    <div style={{ ...ui.card, marginTop: 22, borderColor: '#7f1d1d' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--cfecaca)' }}>{L('Xoá tài khoản', 'Delete account')}</div>
      <p style={{ fontSize: 13, color: 'var(--c94a3b8)', margin: '6px 0 10px', lineHeight: 1.55 }}>
        {L('Đăng nhập của bạn bị xoá vĩnh viễn và không đăng nhập lại được. Lịch hẹn, thanh toán của tiệm vẫn được giữ vì là sổ sách của tiệm. Nếu bạn là admin duy nhất của tiệm, hãy thêm admin khác trước hoặc liên hệ support@lumiobooking.com để đóng tiệm.',
           'Your login is deleted permanently and cannot be recovered. The salon\'s bookings and payments stay, as they are the business\'s records. If you are the salon\'s only admin, add another admin first or contact support@lumiobooking.com to close the salon.')}
      </p>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} style={{ background: 'transparent', border: '1px solid #ef4444', color: 'var(--ink-bad)', borderRadius: 8, padding: '9px 14px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>
          {L('Tôi muốn xoá tài khoản…', 'I want to delete my account…')}
        </button>
      ) : (
        <form onSubmit={run}>
          {err && <div style={ui.banner}>{err}</div>}
          <label style={{ display: 'block', marginBottom: 10 }}>
            <span style={ui.label}>{L('Mật khẩu hiện tại', 'Current password')}</span>
            <input style={ui.input} type="password" value={pw} onChange={(e) => setPw(e.target.value)} required autoComplete="current-password" />
          </label>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={ui.label}>{L('Gõ DELETE để xác nhận', 'Type DELETE to confirm')}</span>
            <input style={ui.input} value={word} onChange={(e) => setWord(e.target.value)} placeholder="DELETE" autoCapitalize="characters" />
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="submit" disabled={busy || word.trim().toUpperCase() !== 'DELETE' || !pw} style={{ background: '#ef4444', border: 'none', color: '#fff', borderRadius: 8, padding: '10px 16px', fontSize: 14, fontWeight: 800, cursor: busy ? 'wait' : 'pointer', opacity: word.trim().toUpperCase() !== 'DELETE' || !pw ? 0.5 : 1 }}>
              {busy ? L('Đang xoá…', 'Deleting…') : L('Xoá vĩnh viễn tài khoản của tôi', 'Permanently delete my account')}
            </button>
            <button type="button" onClick={() => { setOpen(false); setPw(''); setWord(''); setErr(null); }} style={{ background: 'transparent', border: '1px solid var(--c334155)', color: 'var(--c94a3b8)', borderRadius: 8, padding: '10px 14px', fontSize: 14, cursor: 'pointer' }}>
              {L('Huỷ', 'Cancel')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
