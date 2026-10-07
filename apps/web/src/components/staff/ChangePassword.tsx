'use client';

/** "Đổi mật khẩu" — the signed-in person changes their own password (POST /auth/password). */
import { useState } from 'react';
import { apiFetch } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { ui } from '../../lib/ui';
import { L, st } from './kit';

export function ChangePassword({ vi }: { vi: boolean }) {
  const { token, user } = useAuth();
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (user?.supportSession) return null;

  async function save() {
    if (next.length < 8) { setMsg({ ok: false, text: L(vi, 'Mật khẩu mới cần ít nhất 8 ký tự.', 'At least 8 characters.') }); return; }
    if (next !== again) { setMsg({ ok: false, text: L(vi, 'Hai lần nhập mật khẩu mới không khớp.', 'The new passwords do not match.') }); return; }
    setBusy(true); setMsg(null);
    try {
      await apiFetch('/auth/password', { method: 'POST', token, body: { currentPassword: cur, newPassword: next } });
      setCur(''); setNext(''); setAgain(''); setOpen(false);
      setMsg({ ok: true, text: L(vi, 'Đã đổi mật khẩu. Lần đăng nhập sau dùng mật khẩu mới.', 'Password changed. Use the new one next time you sign in.') });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Failed' }); }
    finally { setBusy(false); }
  }

  return (
    <div style={st.card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{L(vi, 'Mật khẩu', 'Password')}</div>
          <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{user?.email}</div>
        </div>
        {!open && <button type="button" onClick={() => { setOpen(true); setMsg(null); }} style={{ ...st.ghost, height: 40 }}>{L(vi, 'Đổi', 'Change')}</button>}
      </div>
      {open && (
        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          <input style={ui.input} type="password" autoComplete="current-password" placeholder={L(vi, 'Mật khẩu hiện tại', 'Current password')} value={cur} onChange={(e) => setCur(e.target.value)} />
          <input style={ui.input} type="password" autoComplete="new-password" placeholder={L(vi, 'Mật khẩu mới (ít nhất 8 ký tự)', 'New password (8+ characters)')} value={next} onChange={(e) => setNext(e.target.value)} />
          <input style={ui.input} type="password" autoComplete="new-password" placeholder={L(vi, 'Nhập lại mật khẩu mới', 'New password again')} value={again} onChange={(e) => setAgain(e.target.value)} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={save} disabled={busy || !cur || !next} style={{ ...st.primary, height: 44, flex: 1 }}>{busy ? '…' : L(vi, 'Lưu mật khẩu mới', 'Save new password')}</button>
            <button type="button" onClick={() => setOpen(false)} style={{ ...st.ghost, height: 44 }}>{L(vi, 'Huỷ', 'Cancel')}</button>
          </div>
        </div>
      )}
      {msg && <div style={{ fontSize: 13, marginTop: 8, color: msg.ok ? 'var(--ink-good)' : 'var(--ink-bad)' }}>{msg.text}</div>}
    </div>
  );
}
