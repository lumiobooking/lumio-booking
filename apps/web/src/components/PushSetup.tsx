'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { apiFetch } from '../lib/api';
import { useLang } from '../lib/i18n';
import { isNativeApp } from '../lib/native';
import { pushState, subscribeToPush, type PushState } from '../lib/push-client';

/**
 * "Will THIS phone ring when a customer writes?" — answered on the screen
 * where the question is asked, with the one step that is missing on this
 * device and a button that proves it works.
 *
 * The server already pushes on every inbound message (see messenger.service
 * → pushPayload). What went wrong in practice was never the server: it was an
 * iPhone still running Lumio inside Safari (where Apple allows no push at
 * all), a permission the browser was never asked for, or a phone in Focus
 * mode. None of those has an error message of its own, so the salon's only
 * feedback was a silent evening. This card names the state and offers a test.
 */
type Mine = { web: number; native: number; enabled: boolean; native_on?: boolean };

export function PushSetup({ compact = false }: { compact?: boolean }) {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const [state, setState] = useState<PushState | 'native' | 'loading'>('loading');
  const [key, setKey] = useState('');
  const [mine, setMine] = useState<Mine | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState(!compact);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [k, m] = await Promise.all([
        apiFetch<{ key: string; enabled: boolean; native: boolean }>('/push/public-key', { token }),
        apiFetch<Mine>('/push/mine', { token }).catch(() => null),
      ]);
      setKey(k?.key ?? '');
      setMine(m);
      if (isNativeApp()) { setState('native'); return; }
      const st = pushState(!!k?.enabled);
      // Permission granted but this browser never registered: still a step short.
      setState(st === 'ready' && m && m.web === 0 ? 'ask' : st);
    } catch { setState('unsupported'); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  const say = (t: string) => { setNote(t); window.setTimeout(() => setNote(null), 9000); };

  async function enable() {
    if (!token) return;
    setBusy(true);
    try {
      const r = await subscribeToPush(key);
      if (r.ok && r.subscription) {
        await apiFetch('/push/subscribe', { method: 'POST', token, body: r.subscription });
        await load();
        say(vi ? 'Đã bật. Bấm "Gửi thử" để chắc chắn điện thoại này reo.' : 'On. Tap "Send a test" to be sure this phone rings.');
      } else {
        setState(r.state);
      }
    } finally { setBusy(false); }
  }

  async function test() {
    if (!token) return;
    setBusy(true);
    try {
      const r = await apiFetch<{ sent: number }>('/push/test', { method: 'POST', token, body: { vi } });
      say(r.sent > 0
        ? (vi ? `Đã gửi tới ${r.sent} thiết bị của bạn — xem thanh thông báo (khoá màn hình rồi xem cũng được).` : `Sent to ${r.sent} of your devices — check the notification shade (lock the screen and look).`)
        : (vi ? 'Chưa có thiết bị nào đăng ký. Bấm "Bật thông báo" trên máy này trước.' : 'No device registered yet. Turn notifications on here first.'));
    } catch (e) { say(String(e)); } finally { setBusy(false); }
  }

  if (state === 'loading') return null;

  const total = (mine?.web ?? 0) + (mine?.native ?? 0);
  const ok = state === 'ready' || state === 'native';
  const ios = /iPad|iPhone|iPod/.test(typeof navigator !== 'undefined' ? navigator.userAgent : '');
  const headline = ok
    ? (vi ? 'Máy này sẽ báo khi khách nhắn' : 'This phone rings when a customer writes')
    : state === 'ios-install' ? (vi ? 'iPhone: cần thêm Lumio vào màn hình chính' : 'iPhone: add Lumio to the Home Screen first')
    : state === 'denied' ? (vi ? 'Thông báo đang bị chặn trên máy này' : 'Notifications are blocked on this phone')
    : state === 'server-off' ? (vi ? 'Máy chủ chưa bật thông báo đẩy' : 'Push is not configured on the server')
    : state === 'unsupported' ? (vi ? 'Trình duyệt này không nhận được thông báo' : 'This browser cannot receive notifications')
    : (vi ? 'Máy này chưa nhận thông báo' : 'This phone does not get notifications yet');

  const steps: string[] = state === 'ios-install'
    ? [
        vi ? 'Trong Safari, bấm nút Chia sẻ (ô vuông có mũi tên lên).' : 'In Safari tap Share (the square with an arrow).',
        vi ? 'Chọn "Thêm vào MH chính" → Thêm.' : 'Choose "Add to Home Screen" → Add.',
        vi ? 'Mở Lumio từ màn hình chính (không mở trong Safari) rồi bấm "Bật thông báo" ở đây.' : 'Open Lumio from the Home Screen (not in Safari) and tap "Turn on" here.',
      ]
    : state === 'denied'
      ? [ios
          ? (vi ? 'Cài đặt iPhone → Thông báo → Lumio → Cho phép thông báo.' : 'iPhone Settings → Notifications → Lumio → Allow.')
          : (vi ? 'Cài đặt điện thoại → Ứng dụng → Chrome (hoặc Lumio) → Thông báo → Cho phép.' : 'Phone Settings → Apps → Chrome (or Lumio) → Notifications → Allow.'),
        vi ? 'Quay lại đây và bấm "Bật thông báo".' : 'Come back here and tap "Turn on".']
      : state === 'unsupported'
        ? [vi ? 'Android: mở Lumio bằng Chrome. iPhone: thêm vào màn hình chính rồi mở từ đó.' : 'Android: open Lumio in Chrome. iPhone: add to the Home Screen and open it from there.']
        : [];

  const card: React.CSSProperties = { boxSizing: 'border-box', padding: compact ? '10px 12px' : '10px 12px', borderRadius: 12, background: 'var(--c0f172a)', border: `1px solid ${ok ? 'var(--line)' : '#d97706'}`, display: 'flex', flexDirection: 'column', gap: 8 };
  const btn: React.CSSProperties = { height: 34, padding: '0 12px', borderRadius: 9, border: 'none', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', background: '#4f46e5', color: '#fff' };
  const ghost: React.CSSProperties = { height: 34, padding: '0 12px', borderRadius: 9, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ccbd5e1)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' };

  return (
    <div style={card}>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} style={{ display: 'flex', alignItems: 'center', gap: 10, border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', width: '100%' }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: ok ? '#16a34a' : '#d97706', flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ce2e8f0)', whiteSpace: compact ? 'nowrap' : 'normal', overflow: 'hidden', textOverflow: 'ellipsis' }}>{headline}</span>
          <span style={{ fontSize: 11, color: 'var(--c64748b)' }}>
            {total > 0 ? (vi ? `${total} thiết bị của bạn đang nhận` : `${total} of your devices registered`) : (vi ? 'Chưa có thiết bị nào của bạn nhận' : 'None of your devices registered')}
            {' · '}{vi ? 'báo cả khi không mở app' : 'rings with the app closed'}
          </span>
        </span>
        <span style={{ fontSize: 12, color: 'var(--c64748b)' }}>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <>
          {steps.length > 0 && (
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--ccbd5e1)', lineHeight: 1.5, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          )}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(state === 'ask' || state === 'ios-install' || state === 'denied') && (
              <button onClick={() => void enable()} disabled={busy || state === 'ios-install'} style={{ ...btn, opacity: state === 'ios-install' ? 0.5 : 1 }}>🔔 {vi ? 'Bật thông báo trên máy này' : 'Turn on for this phone'}</button>
            )}
            {(ok || total > 0) && <button onClick={() => void test()} disabled={busy} style={ok ? btn : ghost}>{vi ? 'Gửi thử' : 'Send a test'}</button>}
            <button onClick={() => void load()} disabled={busy} style={ghost}>{vi ? 'Kiểm tra lại' : 'Re-check'}</button>
          </div>
          {ok && (
            <span style={{ fontSize: 11.5, color: 'var(--c64748b)', lineHeight: 1.5 }}>
              {vi ? 'Không nghe chuông? Tắt "Không làm phiền / Tập trung", cho phép âm thanh thông báo của Lumio (hoặc Chrome), và trên Android tắt "Tối ưu pin" cho ứng dụng.' : 'No sound? Turn off Do Not Disturb / Focus, allow notification sound for Lumio (or Chrome), and on Android exclude the app from battery optimisation.'}
            </span>
          )}
          {note && <span style={{ fontSize: 12, color: 'var(--ink-good)', fontWeight: 600, lineHeight: 1.4 }}>{note}</span>}
        </>
      )}
    </div>
  );
}
