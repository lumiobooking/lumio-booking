'use client';

import { useEffect, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth, useCan } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';
import { ind } from '../../../lib/ui-industry';

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
  // rt205: how this person signs in — phone, e-mail or Facebook — and whether a current password is needed.
  const [info, setInfo] = useState<{ kind: 'phone' | 'email' | 'facebook'; login: string | null; needsCurrent: boolean; canChangeEmail: boolean } | null>(null);
  useEffect(() => {
    if (!token || user?.supportSession) return;
    void apiFetch<{ kind: 'phone' | 'email' | 'facebook'; login: string | null; needsCurrent: boolean; canChangeEmail: boolean }>('/me/login-info', { token }).then(setInfo).catch(() => setInfo(null));
  }, [token, user?.supportSession]);
  const needsCurrent = info ? info.needsCurrent : true;
  const [newPhone, setNewPhone] = useState('');
  const canEmail = info ? info.canChangeEmail : true;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setMsg(null);
    if (needsCurrent && !currentPassword) { setErr(t('ac.needCurrentPw')); return; }
    if (newPassword && newPassword !== confirm) { setErr(t('ac.pwMismatch')); return; }
    if (newPassword && newPassword.length < 8) { setErr(t('ac.pwShort')); return; }
    setBusy(true);
    try {
      const r = await apiFetch<{ ok: boolean; email: string; passwordChanged?: boolean }>('/me/account', {
        method: 'PATCH', token,
        body: {
          currentPassword: currentPassword || undefined,
          newEmail: canEmail && newEmail.trim() && newEmail.trim() !== currentEmail ? newEmail.trim() : undefined,
          newPassword: newPassword || undefined,
          newPhone: !canEmail && newPhone.trim() ? newPhone.trim() : undefined,
        },
      });
      setCurrentPassword(''); setNewPassword(''); setConfirm('');
      if (r.passwordChanged) {
        // Password changed → the current session is now invalid. Sign out immediately.
        setMsg(t('ac.pwLogout'));
        setTimeout(() => logout(), 1400);
        return;
      }
      setMsg(canEmail ? t('ac.saved').replace('{email}', r.email) + (newPassword ? ' ' + t('ac.savedPw') : '') : (lang === 'vi' ? 'Đã lưu. Lần sau đăng nhập bằng số điện thoại mới.' : 'Saved. Sign in with the new phone next time.'));
      setNewPhone('');
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : t('ac.updateFail'));
    } finally { setBusy(false); }
  }

  // Lumio Support inside a salon: this page would be the SUPPORT login's own
  // email and password (and its delete button) — never something to touch from
  // a salon. What support sets up here is the salon's approval PINs.
  if (user?.supportSession) {
    return (
      <section style={{ maxWidth: 560 }}>
        <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>{lang === 'vi' ? 'Tài khoản của tiệm' : "The salon's logins"}</h1>
        <p style={{ color: 'var(--c94a3b8)', fontSize: 14, marginTop: 0 }}>
          {lang === 'vi' ? 'Bạn đang ở chế độ Lumio Support: đổi mật khẩu đăng nhập và PIN duyệt cho người của tiệm. Mật khẩu của tài khoản support@ đổi ở trang Lumio Support, không phải ở đây.' : 'Lumio Support session: change the salon people’s sign-in passwords and approval PINs. The support login’s own password is changed in Lumio Support, not here.'}
        </p>
        <TeamLoginPasswords />
        <TeamApprovalPins />
      </section>
    );
  }

  return (
    <section style={{ maxWidth: 520 }}>
      <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>{t('ac.title')}</h1>
      <p style={{ color: 'var(--c94a3b8)', fontSize: 14, marginTop: 0 }}>{t('ac.subtitle')}</p>

      {err && <div style={ui.banner}>{err}</div>}
      {msg && <div style={{ background: 'var(--c064e3b)', color: 'var(--ca7f3d0)', padding: '10px 14px', borderRadius: 8, fontSize: 14, marginBottom: 14 }}>{msg}</div>}

      <form onSubmit={save} style={ui.card}>
        {canEmail ? (
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={ui.label}>{t('ac.loginEmail')}</span>
            <input style={ui.input} type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          </label>
        ) : (
          <div style={{ marginBottom: 12, fontSize: 14, color: 'var(--ce2e8f0)' }}>
            {info?.kind === 'phone'
              ? (lang === 'vi' ? <>Bạn đăng nhập bằng <b>số điện thoại {info.login}</b>.</> : <>You sign in with <b>phone {info.login}</b>.</>)
              : (lang === 'vi' ? <>Bạn đăng nhập bằng <b>Facebook</b>.</> : <>You sign in with <b>Facebook</b>.</>)}
            <label style={{ display: 'block', marginTop: 10 }}>
              <span style={ui.label}>{info?.kind === 'phone' ? (lang === 'vi' ? 'Đổi số điện thoại đăng nhập (không bắt buộc)' : 'Change sign-in phone (optional)') : (lang === 'vi' ? 'Số điện thoại để đăng nhập không cần Facebook' : 'Phone to sign in without Facebook')}</span>
              <input style={ui.input} type="tel" inputMode="tel" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="0913 456 142" />
            </label>
          </div>
        )}

        <div style={{ borderTop: '1px solid var(--c334155)', margin: '6px 0 12px', paddingTop: 12, fontSize: 13, color: 'var(--ccbd5e1)', fontWeight: 600 }}>{t('ac.changePw')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          <label><span style={ui.label}>{t('ac.newPw')}</span>
            <input style={ui.input} type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder={t('ac.newPwPh')} /></label>
          <label><span style={ui.label}>{t('ac.confirmPw')}</span>
            <input style={ui.input} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
        </div>

        {needsCurrent ? (
          <label style={{ display: 'block', marginTop: 12 }}>
            <span style={ui.label}>{t('ac.currentPw')}</span>
            <input style={ui.input} type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
          </label>
        ) : (
          <p style={{ margin: '12px 0 0', fontSize: 12.5, color: 'var(--c94a3b8)' }}>{lang === 'vi' ? 'Đặt mật khẩu lần đầu — sau đó bạn cũng đăng nhập được bằng mật khẩu này.' : 'Set your first password — you can then also sign in with it.'}</p>
        )}

        <button type="submit" disabled={busy} style={{ ...ui.primaryBtn, marginTop: 16 }}>{busy ? t('ac.saving') : t('ac.save')}</button>
      </form>

      <ApprovalPin />
      {user?.role === 'SALON_ADMIN' && <TeamApprovalPins />}
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
  const L = (vi: string, en: string) => ind(lang === 'vi' ? vi : en);
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
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--cfecaca)' }}>{L('Xoá tài khoản', 'Delete account')}</div>
      <p style={{ fontSize: 13, color: 'var(--c94a3b8)', margin: '6px 0 10px', lineHeight: 1.55 }}>
        {L('Đăng nhập của bạn bị xoá vĩnh viễn và không đăng nhập lại được. Lịch hẹn, thanh toán của tiệm vẫn được giữ vì là sổ sách của tiệm. Nếu bạn là admin duy nhất của tiệm, hãy thêm admin khác trước hoặc liên hệ support@lumiobooking.com để đóng tiệm.',
           'Your login is deleted permanently and cannot be recovered. The salon\'s bookings and payments stay, as they are the business\'s records. If you are the salon\'s only admin, add another admin first or contact support@lumiobooking.com to close the salon.')}
      </p>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} style={{ background: 'transparent', border: '1px solid #ef4444', color: 'var(--ink-bad)', borderRadius: 8, padding: '9px 14px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>
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
            <button type="submit" disabled={busy || word.trim().toUpperCase() !== 'DELETE' || !pw} style={{ background: '#ef4444', border: 'none', color: '#fff', borderRadius: 8, padding: '10px 16px', fontSize: 14, fontWeight: 700, cursor: busy ? 'wait' : 'pointer', opacity: word.trim().toUpperCase() !== 'DELETE' || !pw ? 0.5 : 1 }}>
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

/**
 * The owner's / a manager's approval PIN: typed at a cashier's till to allow a
 * refund or a void the cashier may not do alone. Only shown to people who
 * may refund and void; the current password proves it is them.
 */
function ApprovalPin() {
  const { token, user } = useAuth();
  const can = useCan();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const L = (v: string, e: string) => ind(vi ? v : e);
  const [isSet, setIsSet] = useState<boolean | null>(null);
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const allowed = can('pos.void') && !user?.supportSession;
  useEffect(() => {
    if (!token || !allowed) return;
    apiFetch<{ set: boolean }>('/auth/approval-pin', { token }).then((r) => setIsSet(!!r?.set)).catch(() => setIsSet(null));
  }, [token, allowed]);
  if (!allowed) return null;

  async function save(clear: boolean) {
    setErr(null); setMsg(null);
    if (!clear && (!/^\d{4,6}$/.test(pin) || pin !== again)) { setErr(L('PIN gồm 4–6 số và phải nhập giống nhau 2 lần.', 'The PIN is 4–6 digits, typed the same twice.')); return; }
    setBusy(true);
    try {
      const r = await apiFetch<{ set: boolean }>('/auth/approval-pin', { method: 'POST', token, body: { currentPassword: pw, pin: clear ? '' : pin } });
      setIsSet(!!r?.set); setPin(''); setAgain(''); setPw('');
      setMsg(clear ? L('Đã xoá PIN.', 'PIN removed.') : L('Đã lưu PIN.', 'PIN saved.'));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ ...ui.card, marginTop: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)' }}>🔒 {L('PIN duyệt hoàn tiền / huỷ bill', 'Approval PIN for refunds and voids')}</div>
      <p style={{ fontSize: 13, color: 'var(--c94a3b8)', margin: '4px 0 12px' }}>
        {L('Thu ngân không có quyền hoàn/huỷ sẽ cần bạn nhập PIN này ngay trên máy của họ. Mỗi lần duyệt được ghi lại với tên bạn.',
          'A cashier who may not refund or void asks you to type this PIN on their screen. Every approval is recorded with your name.')}
        {' '}{isSet === true ? <b style={{ color: 'var(--ink-good)' }}>{L('Đã đặt PIN.', 'PIN is set.')}</b> : isSet === false ? <b style={{ color: 'var(--ink-warn)' }}>{user?.role === 'SALON_ADMIN' ? L('Đang dùng PIN mặc định 0000 — nên đổi PIN riêng để thu ngân không tự duyệt được.', 'Using the default PIN 0000 — set your own so a cashier cannot approve alone.') : L('Chưa đặt PIN.', 'No PIN yet.')}</b> : null}
      </p>
      {err && <div style={ui.banner}>{err}</div>}
      {msg && <div style={{ fontSize: 13, color: 'var(--ink-good)', marginBottom: 10 }}>{msg}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        <label><span style={ui.label}>{L('PIN mới (4–6 số)', 'New PIN (4–6 digits)')}</span>
          <input style={ui.input} type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} /></label>
        <label><span style={ui.label}>{L('Nhập lại PIN', 'PIN again')}</span>
          <input style={ui.input} type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={again} onChange={(e) => setAgain(e.target.value.replace(/\D/g, ''))} /></label>
      </div>
      <label style={{ display: 'block', marginTop: 12 }}><span style={ui.label}>{L('Mật khẩu hiện tại', 'Current password')}</span>
        <input style={ui.input} type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button type="button" disabled={busy || !pw} onClick={() => void save(false)} style={ui.primaryBtn}>{busy ? '…' : L('Lưu PIN', 'Save PIN')}</button>
        {isSet && <button type="button" disabled={busy || !pw} onClick={() => void save(true)} style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ccbd5e1)', cursor: 'pointer' }}>{L('Xoá PIN', 'Remove PIN')}</button>}
      </div>
    </div>
  );
}

type TeamPin = { id: string; name: string; email: string; role: 'OWNER' | 'MANAGER' | 'STAFF'; set: boolean };

/**
 * The salon's approvers and their till PINs, set by the owner or by Lumio
 * Support during setup (19/11/2026). Who did it is written to the audit log;
 * the PIN is never shown again.
 */
function TeamApprovalPins() {
  const { token, user } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const L = (v: string, e: string) => ind(vi ? v : e);
  const [people, setPeople] = useState<TeamPin[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => {
    if (!token) return;
    apiFetch<{ people: TeamPin[] }>('/auth/approval-pins/team', { token }).then((r) => setPeople(r?.people ?? [])).catch((e) => { setPeople([]); setErr(e instanceof Error ? e.message : String(e)); });
  };
  useEffect(load, [token]);
  const roleLabel = (r: TeamPin['role']) => r === 'OWNER' ? L('Chủ', 'Owner') : r === 'MANAGER' ? L('Quản lý', 'Manager') : L('Được huỷ/hoàn', 'May void');

  async function save(id: string, clear: boolean) {
    setErr(null); setMsg(null);
    if (!clear && (!/^\d{4,6}$/.test(pin) || pin !== again)) { setErr(L('PIN gồm 4–6 số và phải nhập giống nhau 2 lần.', 'The PIN is 4–6 digits, typed the same twice.')); return; }
    if (!clear && pin === '0000') { setErr(L('Không dùng 0000 — đó là PIN mặc định ai cũng biết. Chọn 4–6 số khác.', 'Not 0000 — that is the default everyone knows. Pick other digits.')); return; }
    setBusy(true);
    try {
      await apiFetch('/auth/approval-pins/team/' + encodeURIComponent(id), { method: 'POST', token, body: { pin: clear ? '' : pin } });
      setPin(''); setAgain(''); setOpen(null);
      setMsg(clear ? L('Đã xoá PIN.', 'PIN removed.') : L('Đã lưu PIN. Hãy báo PIN cho đúng người đó và nhắc họ tự đổi lại trong Tài khoản của tôi.', 'PIN saved. Give it to that person and ask them to change it under My account.'));
      load();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  if (!user?.supportSession && people !== null && people.length <= 1) return null;
  return (
    <div style={{ ...ui.card, marginTop: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)' }}>🔑 {L('PIN duyệt của chủ và quản lý', 'Approval PINs of owners and managers')}</div>
      <p style={{ fontSize: 13, color: 'var(--c94a3b8)', margin: '4px 0 12px' }}>
        {L('Nhân viên không có quyền huỷ món / hoàn tiền phải nhờ một người trong danh sách này nhập PIN. Chủ chưa đặt PIN thì PIN mặc định là 0000 — ai cũng đoán được, nên đặt ngay.',
          'A staff member who may not void or refund needs one of these people to type their PIN. An owner with no PIN uses the default 0000, which anyone can guess — set one now.')}
      </p>
      {err && <div style={ui.banner}>{err}</div>}
      {msg && <div style={{ fontSize: 13, color: 'var(--ink-good)', marginBottom: 10 }}>{msg}</div>}
      {people === null ? <div style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>…</div> : people.length === 0 ? <div style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{L('Tiệm chưa có ai được duyệt huỷ / hoàn.', 'Nobody in this salon may approve voids or refunds yet.')}</div> : people.map((p) => (
        <div key={p.id} style={{ borderTop: '1px solid var(--c334155)', padding: '10px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: 'var(--ce2e8f0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name} · {roleLabel(p.role)}</div>
              <div style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{p.set
                ? <span style={{ color: 'var(--ink-good)' }}>{L('Đã có PIN', 'PIN set')}</span>
                : p.role === 'OWNER' ? <span style={{ color: 'var(--ink-bad)' }}>{L('Chưa đặt · đang dùng 0000', 'Not set · using 0000')}</span>
                : <span style={{ color: 'var(--ink-warn)' }}>{L('Chưa đặt PIN', 'No PIN')}</span>}</div>
            </div>
            <button type="button" onClick={() => { setOpen(open === p.id ? null : p.id); setPin(''); setAgain(''); setErr(null); }} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ccbd5e1)', cursor: 'pointer', whiteSpace: 'nowrap' }}>{p.set ? L('Đổi PIN', 'Change') : L('Đặt PIN', 'Set PIN')}</button>
          </div>
          {open === p.id && (
            <div style={{ marginTop: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
                <label><span style={ui.label}>{L('PIN mới (4–6 số)', 'New PIN (4–6 digits)')}</span>
                  <input style={ui.input} type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} /></label>
                <label><span style={ui.label}>{L('Nhập lại PIN', 'PIN again')}</span>
                  <input style={ui.input} type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={again} onChange={(e) => setAgain(e.target.value.replace(/\D/g, ''))} /></label>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button type="button" disabled={busy} onClick={() => void save(p.id, false)} style={ui.primaryBtn}>{busy ? '…' : L('Lưu PIN', 'Save PIN')}</button>
                {p.set && <button type="button" disabled={busy} onClick={() => void save(p.id, true)} style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ccbd5e1)', cursor: 'pointer' }}>{L('Xoá PIN', 'Remove PIN')}</button>}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

type TeamLogin = { id: string; name: string; email: string; role: 'OWNER' | 'STAFF'; active: boolean };

/**
 * Lumio Support, inside a salon: a new sign-in password for one of the
 * salon's logins (19/11/2026) — e.g. the shared login everyone at the till
 * knows. That person is signed out everywhere; the audit log says who did it.
 */
function TeamLoginPasswords() {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const L = (v: string, e: string) => ind(vi ? v : e);
  const [people, setPeople] = useState<TeamLogin[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!token) return;
    apiFetch<{ people: TeamLogin[] }>('/auth/team-logins', { token }).then((r) => setPeople(r?.people ?? [])).catch((e) => { setPeople([]); setErr(e instanceof Error ? e.message : String(e)); });
  }, [token]);

  async function save(p: TeamLogin) {
    setErr(null); setMsg(null);
    if (pw.length < 8) { setErr(L('Mật khẩu cần ít nhất 8 ký tự.', 'At least 8 characters.')); return; }
    if (pw !== again) { setErr(L('Hai lần nhập mật khẩu chưa giống nhau.', 'The two passwords differ.')); return; }
    setBusy(true);
    try {
      await apiFetch('/auth/team-logins/' + encodeURIComponent(p.id) + '/password', { method: 'POST', token, body: { password: pw } });
      setPw(''); setAgain(''); setOpen(null); setShow(false);
      setMsg(L(`Đã đổi mật khẩu cho ${p.email}. Người dùng tài khoản này bị đăng xuất và phải đăng nhập lại bằng mật khẩu mới.`, `Password changed for ${p.email}. Anyone using it is signed out and must sign in with the new one.`));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ ...ui.card, marginTop: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)' }}>🔐 {L('Mật khẩu đăng nhập của tiệm', "The salon's sign-in passwords")}</div>
      <p style={{ fontSize: 13, color: 'var(--c94a3b8)', margin: '4px 0 12px' }}>
        {L('Đổi mật khẩu cho chủ hoặc nhân viên của tiệm (ví dụ tài khoản dùng chung mà ai cũng biết). Người đó bị đăng xuất ngay trên mọi máy.', 'Set a new password for the owner or a staff login (e.g. a shared login everyone knows). They are signed out on every device at once.')}
      </p>
      {err && <div style={ui.banner}>{err}</div>}
      {msg && <div style={{ fontSize: 13, color: 'var(--ink-good)', marginBottom: 10 }}>{msg}</div>}
      {people === null ? <div style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>…</div> : people.map((p) => (
        <div key={p.id} style={{ borderTop: '1px solid var(--c334155)', padding: '10px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: 'var(--ce2e8f0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name} · {p.role === 'OWNER' ? L('Chủ', 'Owner') : L('Nhân viên', 'Staff')}{p.active ? '' : ` · ${L('đã tắt', 'off')}`}</div>
              <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.email}</div>
            </div>
            <button type="button" onClick={() => { setOpen(open === p.id ? null : p.id); setPw(''); setAgain(''); setErr(null); }} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ccbd5e1)', cursor: 'pointer', whiteSpace: 'nowrap' }}>{L('Đổi mật khẩu', 'Change password')}</button>
          </div>
          {open === p.id && (
            <div style={{ marginTop: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                <label><span style={ui.label}>{L('Mật khẩu mới (từ 8 ký tự)', 'New password (8+)')}</span>
                  <input style={ui.input} type={show ? 'text' : 'password'} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
                <label><span style={ui.label}>{L('Nhập lại', 'Again')}</span>
                  <input style={ui.input} type={show ? 'text' : 'password'} autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} /></label>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 13, color: 'var(--ccbd5e1)' }}>
                <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> {L('Hiện mật khẩu', 'Show password')}
              </label>
              <button type="button" disabled={busy} onClick={() => void save(p)} style={{ ...ui.primaryBtn, marginTop: 10 }}>{busy ? '…' : L('Lưu mật khẩu mới', 'Save new password')}</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
